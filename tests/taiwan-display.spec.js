import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const asset = fileURLToPath(new URL('../environment-threshold-card.js', import.meta.url));
const tag = 'environment-threshold-card';
const fixture = [
  ['wind', '室外風速', 'wind_speed', 'km/h', 9.72, { above: 'input_number.wind_limit', unit: 'km/h' }],
  ['temperature', '室內溫度', 'temperature', '°C', 25.6, { below: 'input_number.temp_low', above: 30, unit: '°C' }],
  ['humidity', '相對濕度', 'humidity', '%', 55.6, { above: 'input_number.humidity_high', unit: '%' }],
  ['light', '室外光照', 'illuminance', 'lx', 12450, { below: 1000 }],
  ['second_temp', '育苗區溫度', 'temperature', '°C', 29.4, { above: 28 }],
  ['second_humidity', '育苗區濕度', 'humidity', '%', 72, { below: 60 }],
  ['second_light', '育苗區光照', 'illuminance', 'lx', 830, { below: 1000 }],
];
const reading = (value, unit_of_measurement, device_class, friendly_name) => ({
  state: String(value), attributes: { unit_of_measurement, device_class, friendly_name },
});
const statesFor = sensors => Object.fromEntries(sensors.map(([id, name, cls, unit, value]) => [`sensor.${id}`, reading(value, unit, cls, name)]));
const itemsFor = sensors => sensors.map(([id, , , , , bounds]) => ({ entity: `sensor.${id}`, ...bounds }));

async function mount(page, { items, states, mode = 'standard', sections, theme = 'light' }) {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.route('**/*', route => route.abort());
  await page.setContent('<main style="width:379.65625px;font:14px/1.4 system-ui,sans-serif"></main>');
  await page.addScriptTag({ type: 'module', path: asset });
  await page.evaluate(async ({ tag, items, states, mode, sections, theme }) => {
    const host = document.querySelector('main');
    if (theme === 'dark') host.style.cssText += ';--primary-text-color:#e7eef4;--secondary-text-color:#c4d0da;--ha-card-background:#18242d;--secondary-background-color:#293843;--divider-color:#465763;--ha-card-border-color:#465763';
    window.config = { items, display_mode: mode, sections, title: '即時環境門檻' };
    window.ha = { states, themes: { darkMode: theme === 'dark' } };
    const Card = await customElements.whenDefined(tag);
    const card = new Card();
    host.append(card);
    card.setConfig(window.config);
    card.hass = window.ha;
  }, { tag, items, states, mode, sections, theme });
  return page.locator(tag);
}

for (const mode of ['standard', 'dense']) {
  test(`Taiwan units project known readings and bounds in ${mode}`, async ({ page }) => {
    const sensors = [fixture[0],
      ['fahrenheit', '華氏溫度', 'temperature', '°F', 77, { below: 68, above: 77, unit: '°F' }],
      ['kelvin', '克耳文溫度', 'temperature', 'K', 298.15, { below: 273.15 }],
      ['celsius', '攝氏溫度', 'temperature', '℃', 24, { above: 25 }],
      ['humid', '室內濕度', 'humidity', ' %RH ', 56, { below: 50 }],
      ['lux', '日照', 'illuminance', 'Lux', 950, { below: 1000 }],
    ];
    const card = await mount(page, { items: itemsFor(sensors), states: {
      ...statesFor(sensors), 'input_number.wind_limit': reading(5, 'm/s'),
    }, mode });
    const dense = mode === 'dense';
    const tiles = card.locator(dense ? '.dense-tile' : '.tile');
    const readout = dense ? '.dense-number' : '.reading';
    const values = ['2.7', '25', '25', '24', '56', '950'];
    const units = ['m/s', '°C', '°C', '°C', '%', 'lx'];
    const bounds = ['上限 5 m/s', '20–25 °C', '下限 0 °C', '上限 25 °C', '下限 50%', '下限 1,000 lx'];
    await expect(tiles.locator(`${readout} > span`)).toHaveText(values);
    await expect(tiles.locator(`${readout} > small`)).toHaveText(units);
    for (let i = 0; i < bounds.length; i++) {
      await expect(tiles.nth(i)).toHaveAttribute('data-state', i === 5 ? 'low' : 'normal');
      if (dense) {
        await tiles.nth(i).click();
        await expect(card.locator('.dense-detail')).toContainText(bounds[i]);
      } else await expect(tiles.nth(i).locator('.bounds')).toHaveText(bounds[i]);
    }
    // Large projected values must not pair a scientific raw number with a different unit.
    if (dense) {
      await card.evaluate(card => { card.hass = { ...window.ha, states: { ...window.ha.states,
        'sensor.wind': { ...window.ha.states['sensor.wind'], state: '3.6e40' },
      } }; });
      await expect(tiles.first().locator(`${readout} > span`)).toHaveText('1E40');
      await expect(tiles.first().locator(`${readout} > small`)).toHaveText('m/s');
    }
  });

  test(`malformed illuminance units are not coerced and do not interrupt ${mode} updates`, async ({ page }) => {
    const items = [{ entity: 'sensor.light' }, { entity: 'sensor.sibling' }];
    const states = { 'sensor.light': reading(20, ['LuX'], 'illuminance'), 'sensor.sibling': reading(12, '°C', 'temperature') };
    const card = await mount(page, { items, states, mode });
    const display = mode === 'dense' ? '.dense-number' : '.reading';
    const numbers = card.locator(`${display} > span`);
    const unit = card.locator(`${display} > small`).first();
    await expect(numbers).toHaveText(['20', '12']);
    await expect(unit).toHaveText('');
    await card.evaluate((el, next) => { el.hass = { ...window.ha, states: next }; }, {
      'sensor.light': reading(21, { toString: 'LuX' }, 'illuminance'), 'sensor.sibling': reading(13, '°C', 'temperature'),
    });
    await expect(numbers).toHaveText(['21', '13']);
    await expect(unit).toHaveText('');
  });

  test(`display does not broaden comparison or guess unsupported units in ${mode}`, async ({ page }) => {
    const sensors = [
      ['untagged', '未標註風速', undefined, 'km/h', 9.72, { above: 18, kind: 'wind' }],
      ['litres', '不明光照單位', 'illuminance', 'L', 22, { above: 30 }],
      ['bad_lux_source', '不同照度門檻單位', 'illuminance', 'lux', 950, { above: 'input_number.light_limit' }],
      ['bad_temp_source', '不同溫度門檻單位', 'temperature', '°C', 24, { above: 'input_number.temp_limit' }],
      ['drift', '風速單位變更', 'wind_speed', 'm/s', 2.7, { above: 18, unit: 'km/h' }],
      ['legacy', '舊門檻單位', 'wind_speed', 'm/s', 2.7, { above: 18, unit: 'L' }],
      ['warning', '門檻遺失', 'wind_speed', 'km/h', 9.72, { below: 'number.missing', above: 18 }],
    ];
    const card = await mount(page, { items: [...itemsFor(sensors), { entity: 'sensor.absent', above: 'sensor.raw_bound' }], states: {
      ...statesFor(sensors), 'input_number.light_limit': reading(1000, 'lx'), 'input_number.temp_limit': reading(25, '℃'),
      'sensor.raw_bound': reading(18, 'km/h', 'wind_speed'),
    }, mode });
    const dense = mode === 'dense';
    const tiles = card.locator(dense ? '.dense-tile' : '.tile');
    await expect(tiles.locator(dense ? '.dense-number small:visible' : '.reading small')).toHaveText(dense ?
      ['km/h', 'L', 'lx', '°C', 'm/s', 'm/s', 'm/s'] : ['km/h', 'L', 'lx', '°C', 'm/s', 'm/s', 'm/s', '']);
    const flags = ['normal', 'normal', 'source-unit', 'source-unit', 'unit', 'unit', 'source', 'unavailable'];
    const bounds = ['上限 18 km/h', '上限 30 L', '上限：單位不符', '上限：單位不符', '上限 5 m/s',
      '上限 18 L', '下限：找不到實體 · 上限 5 m/s', '上限 18 km/h'];
    for (let i = 0; i < flags.length; i++) {
      await expect(tiles.nth(i)).toHaveAttribute('data-state', flags[i]);
      if (dense) {
        await tiles.nth(i).click();
        await expect(card.locator('.dense-detail')).toContainText(bounds[i]);
      } else await expect(tiles.nth(i).locator('.bounds')).toHaveText(bounds[i]);
    }
  });
}

test('the wind editor still applies manual thresholds in the entity unit', async ({ page }) => {
  const items = [{ entity: 'sensor.wind', above: 18, unit: 'km/h' }];
  const states = statesFor([fixture[0]]);
  const card = await mount(page, { items, states });
  await card.evaluate(card => {
    const Editor = customElements.get(`${card.localName}-editor`);
    const editor = new Editor();
    card.parentElement.append(editor);
    editor.hass = window.ha;
    editor.setConfig(structuredClone(window.config));
    window.emits = [];
    editor.addEventListener('config-changed', event => window.emits.push(event.detail.config));
    editor.shadowRoot.querySelector('.list button').click();
  });
  await expect(page.getByLabel('上限', { exact: true })).toHaveValue('18');
  await expect(page.getByText('門檻單位：km/h（依實體單位）', { exact: true })).toBeVisible();
  await page.getByLabel('上限', { exact: true }).fill('36');
  await page.getByRole('button', { name: '套用項目' }).click();
  expect(await page.evaluate(() => window.emits.map(config => config.items[0]))).toEqual([
    expect.objectContaining({ entity: 'sensor.wind', above: 36, unit: 'km/h' }),
  ]);
});

async function measure(card, width) {
  return card.evaluate((card, width) => {
    card.parentElement.style.width = `${width}px`;
    const root = card.shadowRoot;
    const rect = el => el.getBoundingClientRect();
    const grids = [...root.querySelectorAll('.grid')];
    return {
      viewport: innerWidth, width: rect(card).width, height: rect(card).height,
      grids: grids.map(grid => {
        const tiles = [...grid.children];
        return {
          width: rect(grid).width, count: tiles.length,
          columns: tiles.filter(tile => rect(tile).top === rect(tiles[0]).top).length,
          tileHeights: tiles.map(tile => rect(tile).height),
          intact: grid.scrollWidth <= grid.clientWidth && tiles.every(tile => {
            const box = rect(tile);
            return tile.scrollWidth <= tile.clientWidth && box.right <= rect(grid).right + .01 &&
              [...tile.querySelectorAll('.name, .reading, .status, .bounds:not([hidden])')].every(node => {
                const range = document.createRange();
                range.selectNodeContents(node);
                return [...range.getClientRects()].every(r => r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom);
              });
          }),
        };
      }),
    };
  }, width);
}

for (const theme of ['light', 'dark']) {
  test(`standard fits the measured Jingan column in ${theme}`, async ({ page }) => {
    const states = { ...statesFor(fixture), 'input_number.wind_limit': reading(5, 'm/s'),
      'input_number.temp_low': reading(20, ' °C'), 'input_number.humidity_high': reading(80, '%H') };
    const items = itemsFor(fixture);
    const card = await mount(page, { items, states, theme });
    const reports = [];
    for (const grouped of [false, true]) {
      await card.evaluate((card, grouped) => {
        card.setConfig(grouped ? { ...window.config, sections: [{ id: 'outdoor', title: '室外環境' }],
          items: window.config.items.map((item, i) => i < 3 ? { ...item, section: 'outdoor' } : item) } : window.config);
      }, grouped);
      for (const [width, columns] of [[379.65625, 3], [300, 2], [960, 6]]) {
        const report = await measure(card, width);
        reports.push({ grouped, ...report });
        if (process.env.CARD_SCREENSHOTS) {
          await mkdir(process.env.CARD_SCREENSHOTS, { recursive: true });
          await card.screenshot({ path: join(process.env.CARD_SCREENSHOTS, `${theme}-${grouped ? 'sections' : 'flat'}-${width}.png`) });
        }
        if (process.env.CARD_SCREENSHOTS) await writeFile(join(process.env.CARD_SCREENSHOTS, `${theme}-geometry.json`), JSON.stringify(reports, null, 2));
        expect(report.viewport).toBe(1200);
        expect(report.width).toBe(width);
        expect(report.grids.map(g => [g.count, g.columns, g.intact])).toEqual(grouped ?
          [[3, Math.min(3, columns), true], [4, Math.min(4, columns), true]] : [[7, columns, true]]);
        if (width === 379.65625) expect(Math.max(...report.grids.flatMap(g => g.tileHeights))).toBeLessThan(92);
      }
    }
    await card.evaluate(card => {
      card.setConfig({ items: [{ entity: 'sensor.exceptional', above: 200 }, ...window.config.items] });
      card.hass = { states: { ...window.ha.states, 'sensor.exceptional': { state: '12345.6789', attributes: {
        friendly_name: '超長感測器名稱LongUnbrokenSensorName', unit_of_measurement: 'longUnbrokenDescriptiveMeasurementUnit' } } } };
    });
    for (const width of [379.65625, 300, 960]) {
      const report = await measure(card, width);
      expect(report.grids[0].intact).toBe(true);
    }
    await expect(card.locator('.name').first()).toHaveText('超長感測器名稱LongUnbrokenSensorName');
    await expect(card.locator('.reading small').first()).toHaveText('longUnbrokenDescriptiveMeasurementUnit');
  });
}
