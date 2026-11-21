import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const asset = fileURLToPath(new URL('../environment-threshold-card.js', import.meta.url));
const cardTag = 'environment-threshold-card';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.setContent('<div id="host"></div>');
  await page.evaluate(() => {
    window.fixture = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [
      `sensor.test_${i}`, { state: '20', attributes: { friendly_name: i === 0 ? '較長的北側溫室室內感測器顯示名稱' : `感測器 ${i}`, unit_of_measurement: '°C', device_class: 'temperature' } },
    ]));
    window.mount = (tag, items) => {
      const el = document.createElement(tag);
      document.querySelector('#host').append(el);
      el.hass = { states: window.fixture };
      el.setConfig?.({ type: 'custom:environment-threshold-card', items });
      return el;
    };
  });
  try {
    await page.addScriptTag({ path: asset });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
});

for (const theme of ['light', 'dark']) {
  test(`uses the card width, not the viewport or a four-column cap (${theme})`, async ({ page }) => {
    await page.evaluate(({ cardTag, theme }) => {
      const host = document.querySelector('#host');
      host.style.setProperty('--ha-card-background', theme === 'dark' ? '#202124' : '#fff');
      host.style.setProperty('--primary-text-color', theme === 'dark' ? '#eee' : '#202124');
      window.card = window.mount(cardTag, Object.keys(window.fixture).slice(0, 9).map(entity => ({ entity })));
    }, { cardTag, theme });
    for (const [width, expected] of [[230, 1], [320, 2], [500, 3], [680, 4], [1000, 6], [500, 3]]) {
      const layout = await page.locator(cardTag).evaluate((el, width) => {
        el.parentElement.style.width = `${width}px`;
        const tiles = [...(el.shadowRoot?.querySelectorAll('.tile') ?? [])];
        const firstTop = tiles[0]?.getBoundingClientRect().top;
        return [tiles.length, tiles.filter(tile => tile.getBoundingClientRect().top === firstTop).length,
          tiles.every(tile => tile.scrollWidth <= tile.clientWidth), el.scrollWidth <= el.clientWidth];
      }, width);
      expect(layout, `width ${width}`).toEqual([9, expected, true, true]);
    }
    await page.evaluate(() => window.card.setConfig({ items: [{ entity: 'sensor.test_0' }, { entity: 'sensor.test_1' }] }));
    await expect(page.locator('.tile')).toHaveCount(2);
    expect(await page.locator('.tile').first().evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(220);
  });
}

test('updates selected entities only, preserves tile identity and distinguishes bounds and unavailable readings', async ({ page }) => {
  await page.evaluate(tag => {
    window.card = window.mount(tag, [
      { entity: 'sensor.test_0', above: 20, below: 10, unit: '°C' },
      { entity: 'sensor.test_1', below: 21 }, { entity: 'sensor.test_2' },
      { entity: 'sensor.missing', above: 1 }, { entity: 'sensor.test_3', above: 0 },
    ]);
  }, cardTag);
  const tiles = page.locator('.tile');
  const statuses = ['正常', '↓ 低於下限', '未設門檻', '無讀值', '↑ 高於上限'];
  await expect(tiles.locator('.status')).toHaveText(statuses);
  await page.evaluate(() => {
    window.first = window.card.shadowRoot.querySelector('.tile');
    window.fixture = { ...window.fixture, 'sensor.test_0': { ...window.fixture['sensor.test_0'], state: '20.1' } };
    window.card.hass = { states: window.fixture };
  });
  await expect(tiles.first().locator('.status')).toHaveText('↑ 高於上限');
  await expect(tiles.first().locator('.glyph')).toHaveCSS('animation-name', 'rise');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(tiles.first().locator('.glyph')).toHaveCSS('animation-name', 'none');
  expect(await page.evaluate(() => window.first === window.card.shadowRoot.querySelector('.tile'))).toBe(true);
  await page.evaluate(() => {
    window.fixture['sensor.test_0'] = { state: '68', attributes: { unit_of_measurement: '°F' } };
    window.fixture['sensor.test_1'] = { state: '0x10', attributes: {} };
    window.fixture['sensor.test_2'] = { state: 'unknown', attributes: {} };
    window.card.hass = { states: window.fixture };
  });
  await expect(tiles.locator('.status')).toHaveText(['單位已變更', '無讀值', '無讀值', '無讀值', statuses[4]]);
});

test('editor adds optional items, rejects invalid drafts and restores saved config when reopened', async ({ page }) => {
  await page.evaluate(tag => {
    window.emits = [];
    window.editor = window.mount(`${tag}-editor`, []);
    window.editor.addEventListener('config-changed', e => window.emits.push(e.detail.config));
  }, cardTag);
  await page.getByRole('button', { name: '新增監測項目' }).click();
  const entity = page.getByLabel('感測器實體');
  await entity.fill('sensor.test_0');
  await entity.press('Tab');
  await page.getByLabel('感測類型').selectOption('wind');
  await page.getByLabel('下限').fill('30');
  await page.getByLabel('上限').fill('20');
  await page.getByRole('button', { name: '套用項目' }).click();
  await expect(page.getByRole('alert')).toHaveText('下限必須小於上限。');
  expect(await page.evaluate(() => window.emits.length)).toBe(0);
  await page.getByLabel('下限').fill('');
  await page.getByRole('button', { name: '套用項目' }).click();
  const saved = await page.evaluate(() => window.emits.at(-1));
  expect(saved.items).toEqual([{ entity: 'sensor.test_0', kind: 'wind', above: 20, unit: '°C' }]);
  await page.evaluate(() => window.editor.setConfig(window.emits.at(-1)));
  await page.getByRole('button', { name: /較長的北側/ }).click();
  await expect(page.getByLabel('上限')).toHaveValue('20');
  await page.getByRole('button', { name: '取消' }).click();
  expect(await page.evaluate(() => window.emits.length)).toBe(1);
  await page.getByRole('button', { name: /較長的北側/ }).click();
  await page.getByRole('button', { name: '移除項目' }).click();
  expect(await page.evaluate(() => window.emits.at(-1).items)).toEqual([]);
});

test('requires a known unit before adding visual thresholds for an absent sensor', async ({ page }) => {
  await page.evaluate(tag => {
    window.emits = [];
    window.editor = window.mount(`${tag}-editor`, []);
    window.editor.addEventListener('config-changed', e => window.emits.push(e.detail.config));
  }, cardTag);
  await page.getByRole('button', { name: '新增監測項目' }).click();
  const entity = page.getByLabel('感測器實體');
  const above = page.getByLabel('上限');
  const apply = page.getByRole('button', { name: '套用項目' });
  await entity.fill('sensor.late');
  await entity.press('Tab');
  await above.fill('30');
  await apply.click();
  expect(await page.evaluate(() => window.emits)).toEqual([]);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(above).toHaveValue('30');

  await above.clear();
  await apply.click();
  expect(await page.evaluate(() => window.emits.at(-1).items)).toEqual([{ entity: 'sensor.late', kind: 'custom' }]);
  await page.evaluate(() => {
    window.fixture['sensor.late'] = { state: '25', attributes: { unit_of_measurement: '°C' } };
    window.editor.hass = { states: window.fixture };
  });
  await page.getByRole('button', { name: 'sensor.late' }).click();
  await above.fill('30');
  await apply.click();
  expect(await page.evaluate(() => window.emits.at(-1).items)).toEqual([
    { entity: 'sensor.late', kind: 'custom', above: 30, unit: '°C' },
  ]);
  await page.evaluate(tag => {
    window.card = window.mount(tag, window.emits.at(-1).items);
  }, cardTag);
  await expect(page.locator('.status')).toHaveText('正常');
  await page.evaluate(() => {
    window.fixture['sensor.late'] = { state: '77', attributes: { unit_of_measurement: '°F' } };
    window.card.hass = { states: window.fixture };
  });
  await expect(page.locator('.status')).toHaveText('單位已變更');
});

test('preserves a known unitless guard when its sensor later disappears', async ({ page }) => {
  await page.evaluate(tag => {
    window.fixture['sensor.unitless'] = { state: '7', attributes: {} };
    window.emits = [];
    window.editor = window.mount(`${tag}-editor`, []);
    window.editor.addEventListener('config-changed', e => window.emits.push(e.detail.config));
  }, cardTag);
  await page.getByRole('button', { name: '新增監測項目' }).click();
  const entity = page.getByLabel('感測器實體');
  const below = page.getByLabel('下限');
  const apply = page.getByRole('button', { name: '套用項目' });
  await entity.fill('sensor.unitless');
  await entity.press('Tab');
  await below.fill('3');
  await apply.click();
  expect(await page.evaluate(() => window.emits.at(-1).items)).toEqual([
    { entity: 'sensor.unitless', kind: 'custom', below: 3, unit: '' },
  ]);

  await page.evaluate(() => {
    delete window.fixture['sensor.unitless'];
    window.editor.hass = { states: window.fixture };
  });
  await page.getByRole('button', { name: 'sensor.unitless' }).click();
  await below.fill('4');
  await apply.click();
  expect(await page.evaluate(() => window.emits.at(-1).items)).toEqual([
    { entity: 'sensor.unitless', kind: 'custom', below: 4, unit: '' },
  ]);
});

test('does not visually resave an unguarded YAML threshold for an absent sensor', async ({ page }) => {
  await page.evaluate(tag => {
    const items = [{ entity: 'sensor.missing', below: 5 }];
    window.card = window.mount(tag, items);
    window.emits = [];
    window.editor = window.mount(`${tag}-editor`, items);
    window.editor.addEventListener('config-changed', e => window.emits.push(e.detail.config));
  }, cardTag);
  await expect(page.locator('.status')).toHaveText('無讀值');
  await page.getByRole('button', { name: 'sensor.missing' }).click();
  await expect(page.getByLabel('下限')).toHaveValue('5');
  await page.getByRole('button', { name: '套用項目' }).click();
  expect(await page.evaluate(() => window.emits)).toEqual([]);
  await expect(page.getByRole('alert')).toBeVisible();
});

test('does not save a threshold entered under a different live unit', async ({ page }) => {
  await page.evaluate(tag => {
    window.emits = [];
    window.editor = window.mount(`${tag}-editor`, [{ entity: 'sensor.test_0', above: 35, unit: '°C' }]);
    window.editor.addEventListener('config-changed', e => window.emits.push(e.detail.config));
  }, cardTag);
  await page.getByRole('button', { name: /較長的北側/ }).click();
  await page.getByLabel('上限').fill('32');
  await page.evaluate(() => {
    window.fixture['sensor.test_0'].attributes.unit_of_measurement = '°F';
    window.editor.hass = { states: window.fixture };
  });
  await page.getByRole('button', { name: '套用項目' }).click();
  expect(await page.evaluate(() => window.emits.length)).toBe(0);
  await expect(page.getByRole('alert')).toHaveText('感測器單位已變更，請取消後重新開啟項目。');
  await page.getByRole('button', { name: '取消' }).click();
  await page.getByRole('button', { name: /較長的北側/ }).click();
  await page.getByLabel('上限').fill('89.6');
  await page.getByRole('button', { name: '套用項目' }).click();
  expect(await page.evaluate(() => window.emits.length)).toBe(0);
  await page.getByLabel('已確認門檻使用目前單位').check();
  await page.getByRole('button', { name: '套用項目' }).click();
  expect(await page.evaluate(() => window.emits.at(-1).items[0])).toMatchObject({ above: 89.6, unit: '°F' });
});
