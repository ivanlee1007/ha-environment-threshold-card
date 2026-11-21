import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const asset = fileURLToPath(new URL('../environment-threshold-card.js', import.meta.url));
const cardTag = 'environment-threshold-card';
const monitored = 'ha-selector.full';

const selectEntity = (page, selector, value) => page.locator(selector).evaluate((picker, value) => {
  const child = picker.shadowRoot.firstElementChild;
  child.value = value || undefined; // The real ha-entity-picker sets its own value before emitting.
  child.dispatchEvent(new CustomEvent('value-changed', {
    detail: { value }, bubbles: true, composed: true,
  }));
}, value);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.setContent('<div id="host"></div>');
  await page.evaluate(() => {
    // Contract fixture only; popup and keyboard behavior require the real HA frontend.
    window.registerSelectorFixture = () => customElements.define('ha-selector', class extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: 'open' }).append(document.createElement('ha-entity-picker'));
      }
      set value(value) {
        if (this._value !== value) this.shadowRoot.firstElementChild.value = value;
        this._value = value;
      }
      get value() { return this._value; }
    });
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
    await page.evaluate(() => window.registerSelectorFixture());
    await page.addScriptTag({ path: asset });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
});

test('monitored selector keeps the native contract, stable identity and valid controlled value', async ({ page }) => {
  await page.evaluate(tag => {
    window.emits = [];
    window.editor = window.mount(`${tag}-editor`, []);
    window.editor.addEventListener('config-changed', e => window.emits.push(e.detail.config));
  }, cardTag);
  await page.getByRole('button', { name: '新增監測項目' }).click();
  const picker = page.locator(monitored);
  await expect(picker).toHaveCount(1, { timeout: 1500 });
  await expect(page.locator('datalist')).toHaveCount(0);
  expect(await picker.evaluate(el => [el.selector, el.label, el.required, el.hass.states === window.fixture])).toEqual([
    { entity: { filter: [{ domain: 'sensor' }] } }, '感測器實體', true, true,
  ]);
  await selectEntity(page, monitored, 'sensor.test_0');
  await expect(picker).toHaveJSProperty('value', 'sensor.test_0');
  await expect(page.getByLabel('感測類型')).toHaveValue('temperature');
  await page.getByLabel('上限', { exact: true }).fill('35');
  await picker.evaluate(el => {
    window.oldPicker = el;
    window.live = { states: { ...window.fixture } };
    window.editor.hass = window.live;
    el.dispatchEvent(new CustomEvent('change', { detail: { value: 'sensor.test_1' }, bubbles: true }));
  });
  expect(await picker.evaluate(el => el === window.oldPicker && el.hass === window.live)).toBe(true);
  await selectEntity(page, monitored, 'input_number.forbidden');
  await expect(picker).toHaveJSProperty('value', 'sensor.test_0');
  await expect(page.getByLabel('上限', { exact: true })).toHaveValue('35');
  await selectEntity(page, monitored, undefined);
  expect(await picker.evaluate(el => el.value)).toBeUndefined();
  await page.getByRole('button', { name: '套用項目' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();
  await page.getByRole('button', { name: '新增監測項目' }).click();
  await selectEntity(page, monitored, 'sensor.test_1');
  await page.evaluate(() => window.oldPicker.dispatchEvent(new CustomEvent('value-changed', {
    detail: { value: 'sensor.test_2' }, bubbles: true, composed: true,
  })));
  await page.getByRole('button', { name: '套用項目' }).click();
  expect(await page.evaluate(() => window.emits.map(c => c.items[0].entity))).toEqual(['sensor.test_1']);
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

test('live entity thresholds update without sensor changes and fail closed per tile', async ({ page }) => {
  await page.evaluate(tag => {
    window.fixture['input_number.floor'] = { state: '0', attributes: {} };
    window.fixture['number.ceiling'] = { state: '20', attributes: { unit_of_measurement: '°C' } };
    window.fixture['counter.floor'] = { state: '20', attributes: {} };
    window.fixture['sensor.reference'] = { state: '25', attributes: { unit_of_measurement: '°C' } };
    window.card = window.mount(tag, [
      { entity: 'sensor.test_0', below: 'input_number.floor', above: 'number.ceiling', unit: '°C' },
      { entity: 'sensor.test_1', below: 'counter.floor', above: 25 },
      { entity: 'sensor.test_2', below: 10, above: 'sensor.reference' },
    ]);
    window.monitoredState = window.fixture['sensor.test_0'];
  }, cardTag);
  const tiles = page.locator('.tile');
  await expect(tiles).toHaveCount(3);
  await expect(tiles.locator('.status')).toHaveText(['正常', '正常', '正常']);
  await expect(tiles.first().locator('.bounds')).toHaveText('下限 input_number.floor = 0 °C · 上限 number.ceiling = 20 °C');
  const change = (id, state, unit) => page.evaluate(({ id, state, unit }) => {
    if (state === undefined) delete window.fixture[id];
    else window.fixture[id] = { state, attributes: unit ? { unit_of_measurement: unit } : {} };
    window.card.hass = { states: { ...window.fixture } };
  }, { id, state, unit });
  const status = tiles.first().locator('.status');
  await change('number.ceiling', '19', '°C');
  await expect(status).toHaveText('↑ 高於上限');
  expect(await page.evaluate(() => window.monitoredState === window.fixture['sensor.test_0'])).toBe(true);
  await change('input_number.floor', '19');
  await expect(status).toHaveText('下限必須小於上限');
  await change('input_number.floor', '21');
  await expect(status).toHaveText('下限必須小於上限');
  await change('input_number.floor', 'unavailable');
  await expect(status).toHaveText('門檻來源異常');
  await expect(tiles.first().locator('.bounds')).toContainText('input_number.floor：無讀值');
  await expect(tiles.nth(1).locator('.status')).toHaveText('正常');
  await change('input_number.floor', '0x10');
  await expect(tiles.first().locator('.bounds')).toContainText('input_number.floor：不是有限數字');
  await change('input_number.floor', undefined);
  await expect(tiles.first().locator('.bounds')).toContainText('input_number.floor：找不到實體');
  await change('input_number.floor', '0', '°F');
  await expect(status).toHaveText('門檻單位不符');
  await expect(tiles.first().locator('.bounds')).toContainText('input_number.floor = 0 °F（單位不符）');
  await change('input_number.floor', '0');
  await expect(status).toHaveText('↑ 高於上限');
  await change('sensor.reference', '25');
  await expect(tiles.nth(2).locator('.status')).toHaveText('門檻單位不符');
  await change('sensor.reference', '25', '°C');
  await change('sensor.test_0', '68', '°F');
  await expect(tiles.locator('.status')).toHaveText(['單位已變更', '正常', '正常']);
  await expect(page.locator('.summary')).toHaveText('1 項單位已變更');
});

test('YAML rejects numeric strings and nonnumeric source domains', async ({ page }) => {
  const errors = await page.evaluate(tag => {
    const card = window.mount(tag, []);
    return ['20', 'switch.kitchen', 'input_number.bad!', Infinity, {}].map(below => {
      try { card.setConfig({ items: [{ entity: 'sensor.test_0', below }] }); }
      catch (e) { return e.message; }
    });
  }, cardTag);
  expect(errors).toEqual(Array(5).fill('門檻必須是有限數字或支援的數值實體 ID。'));
});

test('editor adds optional items, rejects invalid drafts and restores saved config when reopened', async ({ page }) => {
  await page.evaluate(tag => {
    window.emits = [];
    window.editor = window.mount(`${tag}-editor`, []);
    window.editor.addEventListener('config-changed', e => window.emits.push(e.detail.config));
  }, cardTag);
  await page.getByRole('button', { name: '新增監測項目' }).click();
  await selectEntity(page, monitored, 'sensor.test_0');
  await page.getByLabel('感測類型').selectOption('wind');
  await page.getByLabel('下限', { exact: true }).fill('30');
  await page.getByLabel('上限', { exact: true }).fill('20');
  await page.getByRole('button', { name: '套用項目' }).click();
  await expect(page.getByRole('alert')).toHaveText('下限必須小於上限。');
  expect(await page.evaluate(() => window.emits.length)).toBe(0);
  await page.getByLabel('下限', { exact: true }).fill('');
  await page.getByRole('button', { name: '套用項目' }).click();
  const saved = await page.evaluate(() => window.emits.at(-1));
  expect(saved.items).toEqual([{ entity: 'sensor.test_0', kind: 'wind', above: 20, unit: '°C' }]);
  await page.evaluate(() => window.editor.setConfig(window.emits.at(-1)));
  await page.getByRole('button', { name: /較長的北側/ }).click();
  await expect(page.getByLabel('上限', { exact: true })).toHaveValue('20');
  await page.getByRole('button', { name: '取消' }).click();
  expect(await page.evaluate(() => window.emits.length)).toBe(1);
  await page.getByRole('button', { name: /較長的北側/ }).click();
  await page.getByRole('button', { name: '移除項目' }).click();
  expect(await page.evaluate(() => window.emits.at(-1).items)).toEqual([]);
});

test('editor switches each bound independently, retains saved missing IDs, and discards cancelled edits', async ({ page }) => {
  await page.evaluate(tag => {
    window.fixture['input_number.floor'] = { state: '10', attributes: {} };
    window.fixture['counter.ceiling'] = { state: '35', attributes: {} };
    window.fixture['switch.forbidden'] = { state: 'on', attributes: {} };
    window.emits = [];
    window.editor = window.mount(`${tag}-editor`, [{ entity: 'sensor.test_0', below: -1.25, above: 'number.missing', unit: '°C' }]);
    window.editor.addEventListener('config-changed', e => window.emits.push(e.detail.config));
  }, cardTag);
  const edit = page.getByRole('button', { name: /較長的北側/ });
  const apply = page.getByRole('button', { name: '套用項目' });
  const belowMode = page.getByLabel('下限來源');
  const aboveMode = page.getByLabel('上限來源');
  const below = 'ha-selector[data-bound="below"]';
  const above = 'ha-selector[data-bound="above"]';
  await edit.click();
  await expect(aboveMode).toHaveValue('entity', { timeout: 1500 });
  await expect(belowMode).toHaveValue('manual');
  await expect(page.getByLabel('下限', { exact: true })).toHaveValue('-1.25');
  await expect(page.locator(above)).toHaveJSProperty('value', 'number.missing');
  const [filter, required, label, allowed] = await page.locator(above).evaluate(el => [
    el.selector.entity.filter, el.required, el.label, el.selector.entity.include_entities,
  ]);
  expect(filter.map(f => f.domain)).toEqual(['sensor', 'input_number', 'number', 'counter']);
  expect([required, label]).toEqual([false, '上限實體']);
  expect(allowed).toEqual(expect.arrayContaining(['input_number.floor', 'counter.ceiling', 'sensor.test_0']));
  expect(allowed).not.toContain('switch.forbidden');
  await page.getByLabel('顯示名稱（選填）').fill('測試溫度');
  await apply.click();
  expect(await page.evaluate(() => window.emits.at(-1).items[0])).toMatchObject({
    name: '測試溫度', below: -1.25, above: 'number.missing', unit: '°C',
  });
  const rename = page.getByRole('button', { name: '測試溫度' });
  await rename.click();
  await belowMode.selectOption('entity');
  await selectEntity(page, below, 'input_number.floor');
  await selectEntity(page, above, 'counter.ceiling');
  await selectEntity(page, above, 'switch.forbidden');
  await expect(page.locator(above)).toHaveJSProperty('value', 'counter.ceiling');
  await page.locator(below).evaluate(el => { window.belowPicker = el; window.selector = el.selector; });
  await page.evaluate(() => {
    window.latestHass = { states: { ...window.fixture, 'number.new': { state: '11', attributes: {} } } };
    window.editor.hass = window.latestHass;
  });
  expect(await page.locator(below).evaluate(el => el === window.belowPicker && el.hass === window.latestHass &&
    el.selector.entity.include_entities.includes('number.new'))).toBe(true);
  await belowMode.selectOption('manual');
  await expect(page.getByLabel('下限', { exact: true })).toHaveValue('-1.25');
  await selectEntity(page, below, 'number.new'); // Hidden picker cannot overwrite the retained draft.
  await belowMode.selectOption('entity');
  await expect(page.locator(below)).toHaveJSProperty('value', 'input_number.floor');
  await apply.click();
  expect(await page.evaluate(() => window.emits.at(-1).items[0])).toMatchObject({ below: 'input_number.floor', above: 'counter.ceiling' });

  await rename.click();
  await selectEntity(page, above, '');
  expect(await page.locator(above).evaluate(el => el.value)).toBeUndefined();
  await page.getByRole('button', { name: '取消' }).click();
  expect(await page.evaluate(() => window.emits.length)).toBe(2);
  await rename.click();
  await expect(page.locator(above)).toHaveJSProperty('value', 'counter.ceiling');
  await selectEntity(page, above, null);
  await apply.click();
  expect(await page.evaluate(() => window.emits.at(-1).items[0])).not.toHaveProperty('above');
});

test('rejecting a native picker event rolls back the displayed native value too', async ({ page }) => {
  await page.evaluate(tag => window.mount(`${tag}-editor`, [{ entity: 'sensor.test_0' }]).localName, cardTag);
  await page.getByRole('button', { name: /較長的北側/ }).click();
  await selectEntity(page, monitored, 'input_number.forbidden');
  expect(await page.locator(monitored).evaluate(el => [el.value, el.shadowRoot.firstElementChild.value])).toEqual([
    'sensor.test_0', 'sensor.test_0',
  ]);
});

test('keyboard entry into an item keeps focus inside the draft ahead of the native picker', async ({ page }) => {
  await page.evaluate(tag => {
    window.editor = window.mount(`${tag}-editor`, []);
  }, cardTag);
  await page.getByRole('button', { name: '新增監測項目' }).press('Enter');
  expect(await page.evaluate(() => window.editor.shadowRoot.activeElement?.localName)).toBe('form');
});

test('requires a known unit before adding visual thresholds for an absent sensor', async ({ page }) => {
  await page.evaluate(tag => {
    window.emits = [];
    window.editor = window.mount(`${tag}-editor`, []);
    window.editor.addEventListener('config-changed', e => window.emits.push(e.detail.config));
  }, cardTag);
  await page.getByRole('button', { name: '新增監測項目' }).click();
  const above = page.getByLabel('上限', { exact: true });
  const apply = page.getByRole('button', { name: '套用項目' });
  await selectEntity(page, monitored, 'sensor.late');
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
  const below = page.getByLabel('下限', { exact: true });
  const apply = page.getByRole('button', { name: '套用項目' });
  await selectEntity(page, monitored, 'sensor.unitless');
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
  await expect(page.getByLabel('下限', { exact: true })).toHaveValue('5');
  await page.getByRole('button', { name: '套用項目' }).click();
  expect(await page.evaluate(() => window.emits)).toEqual([]);
  await expect(page.getByRole('alert')).toBeVisible();
});

test('editor does not require unit-change consent for humidity aliases and whitespace', async ({ page }) => {
  await page.evaluate(tag => {
    window.fixture['sensor.test_0'] = { state: '55', attributes: { device_class: 'humidity', unit_of_measurement: ' % ' } };
    window.emits = [];
    window.editor = window.mount(`${tag}-editor`, [{ entity: 'sensor.test_0', above: 70, unit: '%H' }]);
    window.editor.addEventListener('config-changed', e => window.emits.push(e.detail.config));
  }, cardTag);
  await page.getByRole('button', { name: 'sensor.test_0' }).click();
  await expect(page.getByLabel('已確認門檻使用目前單位')).toBeHidden();
  await page.evaluate(() => {
    window.fixture['sensor.test_0'].attributes.unit_of_measurement = '%RH';
    window.editor.hass = { states: window.fixture };
  });
  await page.getByRole('button', { name: '套用項目' }).click();
  expect(await page.evaluate(() => window.emits.at(-1)?.items[0])).toMatchObject({ above: 70, unit: '%' });
});

test('does not save a threshold entered under a different live unit', async ({ page }) => {
  await page.evaluate(tag => {
    window.emits = [];
    window.editor = window.mount(`${tag}-editor`, [{ entity: 'sensor.test_0', above: 35, unit: '°C' }]);
    window.editor.addEventListener('config-changed', e => window.emits.push(e.detail.config));
  }, cardTag);
  await page.getByRole('button', { name: /較長的北側/ }).click();
  await page.getByLabel('上限', { exact: true }).fill('32');
  await page.evaluate(() => {
    window.fixture['sensor.test_0'].attributes.unit_of_measurement = '°F';
    window.editor.hass = { states: window.fixture };
  });
  await page.getByRole('button', { name: '套用項目' }).click();
  expect(await page.evaluate(() => window.emits.length)).toBe(0);
  await expect(page.getByRole('alert')).toHaveText('感測器單位已變更，請取消後重新開啟項目。');
  await page.getByRole('button', { name: '取消' }).click();
  await page.getByRole('button', { name: /較長的北側/ }).click();
  await page.getByLabel('上限', { exact: true }).fill('89.6');
  await page.getByRole('button', { name: '套用項目' }).click();
  expect(await page.evaluate(() => window.emits.length)).toBe(0);
  await page.getByLabel('已確認門檻使用目前單位').check();
  await page.getByRole('button', { name: '套用項目' }).click();
  expect(await page.evaluate(() => window.emits.at(-1).items[0])).toMatchObject({ above: 89.6, unit: '°F' });
});
