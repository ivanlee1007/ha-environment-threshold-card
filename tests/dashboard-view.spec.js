import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const asset = fileURLToPath(new URL('../environment-threshold-card.js', import.meta.url));
const tag = 'environment-threshold-card';
const mount = async (page, displayMode) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.setContent('<main style="width:379.65625px;font:14px/1.4 system-ui,sans-serif"></main>');
  await page.addScriptTag({ path: asset });
  await page.evaluate(({ tag, displayMode }) => {
    const freeze = value => {
      for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
      return Object.freeze(value);
    };
    const writes = [];
    const trap = (...args) => { writes.push(args); throw new Error('Unexpected dashboard I/O'); };
    for (const method of ['setItem', 'removeItem', 'clear']) Storage.prototype[method] = trap;
    window.fetch = window.XMLHttpRequest = window.WebSocket = trap;
    document.addEventListener('config-changed', trap);
    window.fixture = {
      writes, freeze,
      config: freeze({
        type: `custom:${tag}`, ...(displayMode ? { display_mode: displayMode } : {}), title: '即時環境門檻',
        sections: [{ id: 'a', title: '室外' }, { id: 'b', title: '室內' }, { id: 'c', title: '空白' }],
        items: [
          { entity: 'sensor.hot', name: '高溫', section: 'a', above: 20 },
          { entity: 'sensor.cold', name: '低溫', section: 'a', below: 10 },
          { entity: 'sensor.absent', name: '無讀值', section: 'a', above: 20 },
          { entity: 'sensor.broken', name: '無門檻讀值', section: 'b', above: 'number.absent' },
          { entity: 'sensor.normal', name: '正常室溫', section: 'b', above: 20 },
          { entity: 'sensor.unset', name: '參考溫度', section: 'b' },
        ],
      }),
      hass: freeze({ states: Object.fromEntries(Object.entries({ hot: 24, cold: 5, broken: 15, normal: 15, unset: 15 })
        .map(([id, state]) => [`sensor.${id}`, { state: String(state), attributes: { device_class: 'temperature', unit_of_measurement: '°C' } }])),
      callService: trap, callApi: trap, callWS: trap, connection: { sendMessagePromise: trap } }),
    };
    window.mountFixture = config => {
      const card = document.createElement(tag);
      // Catch non-bubbling or non-composed events as well.
      card.addEventListener('config-changed', trap);
      card.shadowRoot.addEventListener('config-changed', trap, true);
      card.setConfig(config);
      card.hass = fixture.hass;
      document.querySelector('main').append(card);
      return card;
    };
    window.card = mountFixture(fixture.config);
  }, { tag, displayMode });
  return page.locator(tag).first();
};
const mode = card => card.getByRole('button', { name: '密集模式', exact: true });
const filter = card => card.getByRole('button', { name: '只看異常', exact: true });

test('dashboard density is a local keyboard toggle with stable controls and saved-default authority', async ({ page }) => {
  const card = await mount(page);
  const density = mode(card);
  await expect(card.locator('.tile')).toHaveCount(6);
  await expect(density).toHaveAttribute('aria-pressed', 'false', { timeout: 1000 });
  await density.evaluate(el => { window.initialDensity = el; });
  await density.press('Space');
  await expect(card.locator('.dense-tile')).toHaveCount(6);
  await expect(card.locator('.tile')).toHaveCount(0);
  await expect(density).toHaveCount(1);
  await expect(density).toHaveAttribute('aria-pressed', 'true');
  await expect(density).toBeFocused();
  expect(await density.evaluate(el => el === window.initialDensity)).toBe(true);
  await page.evaluate(() => {
    card.hass = { ...fixture.hass, states: { ...fixture.hass.states } };
    card.setConfig(fixture.freeze(structuredClone(fixture.config)));
    window.edited = fixture.freeze({ ...fixture.config, display_mode: 'standard', title: '另一個名稱',
      sections: fixture.config.sections.map(s => ({ ...s, title: `${s.title}組` })) });
    card.setConfig(edited);
  });
  await expect(card.getByRole('heading', { name: '另一個名稱' })).toBeVisible();
  await expect(density).toHaveAttribute('aria-pressed', 'true');
  await expect(density).toBeFocused();
  await density.press('Enter');
  await expect(density).toHaveAttribute('aria-pressed', 'false');
  await expect(density).toBeFocused();
  await page.evaluate(() => { card.setConfig(fixture.freeze({ ...edited, display_mode: 'dense' })); });
  await expect(density).toHaveAttribute('aria-pressed', 'true');
  await density.click();
  await expect(density).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => { window.fresh = mountFixture(fixture.freeze({ ...edited, display_mode: 'dense' })); });
  await expect(mode(page.locator(tag).last())).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => { card.setConfig(fixture.config); });
  await expect(density).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => fixture.writes)).toEqual([]);
});

test('dashboard abnormal filter follows the view, live readings and section projections', async ({ page }) => {
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.route('**/*', route => route.abort());
  const card = await mount(page);
  const abnormal = filter(card);
  const density = mode(card);
  const standardNames = card.locator('.tile:visible .name');
  const denseNames = card.locator('.dense-tile:visible .dense-name');
  const expected = ['高溫', '低溫', '無讀值', '無門檻讀值'];
  await expect(standardNames).toHaveCount(6);
  await expect(abnormal).toHaveAttribute('aria-pressed', 'false', { timeout: 1000 });
  await abnormal.click();
  await expect(abnormal).toHaveAttribute('aria-pressed', 'true');
  await expect(standardNames).toHaveText(expected);
  await expect(card.locator('.standard-section:visible h3')).toHaveText(['室外3 / 3 項', '室內1 / 3 項']);
  await expect(card.getByRole('status')).toContainText('1 項未設門檻');
  await card.locator('.tile').first().evaluate(el => { window.hotTile = el; });
  await abnormal.evaluate(el => { window.initialFilter = el; });

  await density.click();
  await expect(abnormal).toHaveCount(1);
  await expect(abnormal).toHaveAttribute('aria-pressed', 'true');
  expect(await abnormal.evaluate(el => el === window.initialFilter)).toBe(true);
  await expect(denseNames).toHaveText(expected);
  await expect(card.locator('.dense-section:visible h3')).toHaveText(['室外3 / 3 項', '室內1 / 3 項']);
  await expect(card.getByRole('status')).toContainText('共 6 項');
  await card.locator('.dense-tile').first().press('Enter');
  await expect(card.locator('.dense-detail')).toContainText('上限 20 °C');
  await card.locator('.dense-tile').nth(1).evaluate(el => { window.detachedTile = el; });
  await density.press('Enter');
  await page.evaluate(() => { detachedTile.click(); });
  await density.press('Enter');
  await expect(card.locator('.dense-detail')).toContainText('上限 20 °C');
  await abnormal.press('Space');
  await expect(abnormal).toBeFocused();
  await expect(denseNames).toHaveCount(6);
  await density.click();
  await expect(abnormal).toHaveAttribute('aria-pressed', 'false');
  await expect(standardNames).toHaveCount(6);
  await expect(card.locator('.standard-section:visible h3')).toHaveCount(3);

  await abnormal.press('Enter');
  await page.evaluate(() => {
    window.edited = fixture.freeze({ ...fixture.config, title: '新名稱',
      sections: fixture.config.sections.map(s => ({ ...s, title: `${s.title}組` })) });
    card.setConfig(edited);
    card.setConfig(structuredClone(edited));
    const states = structuredClone(fixture.hass.states);
    states['sensor.hot'].state = '15';
    states['sensor.cold'].state = '15';
    states['sensor.absent'] = states['sensor.hot'];
    states['number.absent'] = { state: '20', attributes: {} };
    card.hass = { ...fixture.hass, states };
  });
  await expect(abnormal).toBeFocused();
  await expect(abnormal).toHaveAttribute('aria-pressed', 'true');
  await expect(card.getByRole('heading', { name: '新名稱' })).toBeVisible();
  await expect(card.locator('.standard-section:visible')).toHaveCount(0);
  await expect(card.getByText('目前沒有異常')).toBeVisible();
  await expect(card.getByRole('status')).toContainText('1 項未設門檻');
  expect(await card.locator('.tile').first().evaluate(el => el === window.hotTile)).toBe(true);

  await page.evaluate(() => {
    card.setConfig({ ...edited, sections: [] });
    card.hass = fixture.hass;
  });
  await expect(card.locator('.standard-section')).toHaveCount(0);
  await expect(standardNames).toHaveText(expected);
  await density.click();
  await expect(denseNames).toHaveText(expected);
  await page.evaluate(() => {
    card.setConfig({ ...edited, sections: [], items: [{ entity: 'sensor.unset' }] });
  });
  await expect(denseNames).toHaveCount(0);
  await expect(card.getByText('目前沒有異常')).toBeVisible();
  await density.click();
  await expect(standardNames).toHaveCount(0);
  await expect(card.getByText('目前沒有異常')).toBeVisible();
  await page.evaluate(() => { window.fresh = mountFixture(fixture.config); });
  await expect(filter(page.locator(tag).last())).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => fixture.writes)).toEqual([]);
  expect(requests).toEqual([]);
});

const hotDenseTile = card => card.locator('.dense-tile').filter({ hasText: '高溫' });

for (const change of ['removal', 'ambiguous duplicate']) {
  test(`dense detail does not reopen after transient ${change} in standard mode`, async ({ page }) => {
    const card = await mount(page, 'dense');
    const density = mode(card);
    const detail = card.locator('.dense-detail');
    const hot = hotDenseTile(card);
    await hot.press('Enter');
    await expect(detail).toBeVisible();
    await density.press('Enter');
    await expect(detail).toHaveCount(0);
    const removed = change === 'removal';
    await page.evaluate(removed => {
      const { items } = fixture.config;
      card.setConfig({ ...fixture.config, items: removed ? items.slice(1) : [...items, { ...items[0] }] });
    }, removed);
    await expect(card.locator('.tile').filter({ hasText: '高溫' })).toHaveCount(removed ? 0 : 2);
    await page.evaluate(() => { card.setConfig(structuredClone(fixture.config)); });
    await expect(density).toHaveAttribute('aria-pressed', 'false');
    await expect(density).toBeFocused();
    await density.press('Enter');
    await expect(hot).toBeVisible();
    await expect(hot).toHaveAttribute('aria-expanded', 'false', { timeout: 1000 });
    await expect(detail).toBeHidden();
    await expect(density).toBeFocused();
  });
}

for (const hideBy of ['telemetry', 'filter toggle']) {
  test(`dense detail does not reopen after ${hideBy} temporarily hides the item in standard mode`, async ({ page }) => {
    const card = await mount(page, 'dense');
    const density = mode(card);
    const abnormal = filter(card);
    const hot = hotDenseTile(card);
    const standardHot = card.locator('.tile').filter({ hasText: '高溫' });
    const detail = card.locator('.dense-detail');
    const normalReadings = () => page.evaluate(() => {
      const states = structuredClone(fixture.hass.states);
      states['sensor.hot'].state = states['sensor.cold'].state = '15';
      states['sensor.absent'] = states['sensor.hot'];
      states['number.absent'] = { state: '20', attributes: {} };
      card.hass = { ...fixture.hass, states };
    });
    if (hideBy === 'telemetry') await abnormal.press('Space');
    else await normalReadings();
    await hot.press('Enter');
    await expect(detail).toBeVisible();
    await density.press('Enter');
    await expect(detail).toHaveCount(0);
    await expect(standardHot).toBeVisible();
    if (hideBy === 'telemetry') await normalReadings();
    else await abnormal.press('Space');
    await expect(standardHot).toBeHidden();
    await expect(card.getByText('目前沒有異常')).toBeVisible();
    if (hideBy === 'telemetry') await page.evaluate(() => { card.hass = fixture.hass; });
    else await abnormal.press('Space');
    await expect(standardHot).toBeVisible();
    await expect(hideBy === 'telemetry' ? density : abnormal).toBeFocused();
    await density.press('Enter');
    await expect(hot).toBeVisible();
    await expect(hot).toHaveAttribute('aria-expanded', 'false', { timeout: 1000 });
    await expect(detail).toBeHidden();
    await expect(density).toBeFocused();
  });
}

test('an unchanged standard round trip restores the same expanded dense tile and detail nodes', async ({ page }) => {
  const card = await mount(page, 'dense');
  const density = mode(card);
  const hot = hotDenseTile(card);
  const detail = card.locator('.dense-detail');
  await hot.press('Enter');
  await expect(detail).toBeVisible();
  await hot.evaluate(el => { window.openTile = el; });
  await detail.evaluate(el => { window.openDetail = el; });
  await density.press('Enter');
  await expect(detail).toHaveCount(0);
  await page.evaluate(() => {
    card.setConfig(structuredClone(fixture.config));
    card.hass = { ...fixture.hass, states: structuredClone(fixture.hass.states) };
  });
  await expect(density).toHaveAttribute('aria-pressed', 'false');
  await expect(density).toBeFocused();
  await density.press('Enter');
  await expect(hot).toHaveAttribute('aria-expanded', 'true');
  await expect(detail).toBeVisible();
  expect(await hot.evaluate(el => el === window.openTile)).toBe(true);
  expect(await detail.evaluate(el => el === window.openDetail)).toBe(true);
  await expect(density).toBeFocused();
});

for (const theme of ['light', 'dark']) {
  test(`dashboard header fits both modes at measured widths (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    const card = await mount(page);
    await card.evaluate((el, theme) => {
      if (theme === 'dark') el.parentElement.style.cssText += ';--primary-text-color:#e7eef4;--secondary-text-color:#c4d0da;--ha-card-background:#18242d;--secondary-background-color:#293843;--divider-color:#465763;--ha-card-border-color:#465763';
      el.hass = { ...fixture.hass, themes: { darkMode: theme === 'dark' } };
    }, theme);
    const measurements = [];
    for (const view of ['standard', 'dense']) {
      if (view === 'dense') await mode(card).click();
      await expect(mode(card)).toHaveAttribute('aria-pressed', String(view === 'dense'));
      await expect(filter(card)).toBeVisible();
      for (const width of [240, 300, 379.65625, 840]) {
        const geometry = await card.evaluate((el, width) => {
          el.parentElement.style.width = `${width}px`;
          const $ = selector => el.shadowRoot.querySelector(selector);
          const rect = node => node.getBoundingClientRect().toJSON();
          const panel = $('ha-card');
          const title = $('h2');
          const buttons = [...panel.querySelectorAll('h2 ~ div button')];
          const [cardRect, titleRect, buttonRect, modeRect] = [rect(panel), rect(title), ...buttons.map(rect)];
          const inside = (outer, r) => r.left >= outer.left && r.right <= outer.right && r.width > 0 && r.height > 0;
          const collides = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
          const range = document.createRange();
          range.selectNodeContents(title);
          const titleInk = [...range.getClientRects()];
          const grid = $('.standard-section .grid');
          return { cardWidth: cardRect.width, titleRect, buttonRect, modeRect,
            fits: panel.scrollWidth === panel.clientWidth && el.scrollWidth === el.clientWidth &&
              inside(cardRect, titleRect) && inside(cardRect, buttonRect) && inside(cardRect, modeRect) &&
              !collides(buttonRect, modeRect) && titleInk.every(r => !collides(r, buttonRect) && !collides(r, modeRect)),
            singleRow: Math.abs((titleRect.top + titleRect.bottom) / 2 - (modeRect.top + modeRect.bottom) / 2) < 1,
            columns: grid ? [...grid.children].filter(t => t.offsetTop === grid.firstElementChild.offsetTop).length : null };
        }, width);
        expect(geometry, `${view}, ${width}px`).toMatchObject({ cardWidth: width, fits: true });
        if (width >= 300) expect(geometry.singleRow).toBe(true);
        if (view === 'standard' && width === 379.65625) expect(geometry.columns).toBe(3);
        measurements.push({ theme, view, targetWidth: width, ...geometry });
        if (process.env.DASHBOARD_CAPTURE_DIR && [240, 379.65625].includes(width)) {
          await card.screenshot({ path: `${process.env.DASHBOARD_CAPTURE_DIR}/${view}-${theme}-${width}.png`, animations: 'disabled' });
        }
      }
    }
    if (process.env.DASHBOARD_CAPTURE_DIR) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(`${process.env.DASHBOARD_CAPTURE_DIR}/geometry-${theme}.json`, JSON.stringify(measurements, null, 2));
    }
  });
}
