import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const asset = fileURLToPath(new URL('../environment-threshold-card.js', import.meta.url));

async function mount(page, items, states) {
  await page.setContent('<main></main>');
  await page.addScriptTag({ type: 'module', path: asset });
  await page.evaluate(async ({ items, states }) => {
    const Card = await customElements.whenDefined('environment-threshold-card');
    const card = new Card();
    card.setConfig({ items });
    card.hass = { states };
    document.querySelector('main').append(card);
  }, { items, states });
}

const reading = (value, unit_of_measurement, device_class) => ({
  state: String(value), attributes: { unit_of_measurement, device_class },
});

test('the diagnosed temperature, relative humidity and wind-speed configurations all compare', async ({ page }) => {
  await mount(page, [
    { entity: 'sensor.temperature', unit: '°C', below: 'input_number.temp_low', above: 'input_number.temp_high' },
    { entity: 'sensor.humidity', unit: '%', above: 'input_number.humidity_high' },
    { entity: 'sensor.wind', unit: 'km/h', above: 'input_number.wind_high' },
  ], {
    'sensor.temperature': reading(20.6, '°C', 'temperature'), 'input_number.temp_low': reading(20, ' °C'),
    'input_number.temp_high': reading(25, '°C'), 'sensor.humidity': reading(55.6, '%', 'humidity'),
    'input_number.humidity_high': reading(80, '%H'), 'sensor.wind': reading(16.2, 'km/h', 'wind_speed'),
    'input_number.wind_high': reading(5, 'm/s'),
  });
  await expect(page.locator('.status')).toHaveText(['正常', '正常', '正常']);
  await expect(page.locator('.bounds').nth(2)).toContainText('5 m/s → 18 km/h');
  await expect(page.locator('.summary')).toHaveText('所有監測皆在範圍內');
});

test('reverse conversion, equality, updates and unsupported units stay distinct', async ({ page }) => {
  await mount(page, [
    { entity: 'sensor.wind', unit: ' m/s ', above: 'sensor.wind_limit' },
    { entity: 'sensor.battery', unit: '%', above: 'input_number.humidity_high' },
    { entity: 'sensor.temperature', unit: '°C', above: 'input_number.temp_high' },
    { entity: 'sensor.humidity', unit: '%H', above: 80 },
  ], {
    'sensor.wind': reading(0.3, 'm/s', 'wind_speed'), 'sensor.wind_limit': reading(1.08, 'km/h', 'wind_speed'),
    'sensor.battery': reading(60, '%', 'battery'), 'input_number.humidity_high': reading(80, '%H'),
    'sensor.temperature': reading(20, '°C', 'temperature'), 'input_number.temp_high': reading(77, '°F'),
    'sensor.humidity': reading(90, '%', 'humidity'),
  });
  await expect(page.locator('.status')).toHaveText(['正常', '門檻單位不符', '門檻單位不符', '↑ 高於上限']);
  await expect(page.locator('.bounds').first()).toContainText('1.08 km/h → 0.3 m/s');
  const tile = page.locator('.tile').first();
  await tile.evaluate(el => {
    const card = el.getRootNode().host;
    card.hass = { states: { ...card.states, 'sensor.wind_limit': { state: '0.72', attributes: { unit_of_measurement: 'km/h' } } } };
  });
  await expect(tile.locator('.status')).toHaveText('↑ 高於上限');
});

test('converted bounds and monitored values agree at the displayed precision', async ({ page }) => {
  await mount(page, [{ entity: 'sensor.wind', unit: 'km/h', above: 'input_number.wind_high' }], {
    'sensor.wind': reading(4.444444404444444, 'km/h', 'wind_speed'),
    'input_number.wind_high': reading(1.2345678901234567, 'm/s'),
  });
  await expect(page.locator('.status')).toHaveText('正常');
});

test('speed equality handles formatter rounding and binary conversion noise', async ({ page }) => {
  await mount(page, [
    { entity: 'sensor.metric_display', unit: 'km/h', above: 'input_number.display_limit' },
    { entity: 'sensor.metric_exact', unit: 'm/s', above: 'input_number.exact_limit' },
    { entity: 'sensor.metric_above', unit: 'm/s', above: 'input_number.exact_limit' },
  ], {
    'sensor.metric_display': reading(3.60000000000007, 'km/h', 'wind_speed'),
    'input_number.display_limit': reading(1.000000000000018, 'm/s'),
    'sensor.metric_exact': reading(1.000000000000005, 'm/s', 'wind_speed'),
    'input_number.exact_limit': reading(3.600000000000018, 'km/h'),
    'sensor.metric_above': reading(1.00000000000002, 'm/s', 'wind_speed'),
  });
  await expect(page.locator('.status')).toHaveText(['正常', '正常', '↑ 高於上限']);
});

test('an explicitly incompatible source dimension is not reinterpreted as humidity', async ({ page }) => {
  await mount(page, [{ entity: 'sensor.humidity', unit: '%', above: 'sensor.battery' }], {
    'sensor.humidity': reading(55, '%', 'humidity'), 'sensor.battery': reading(80, '%H', 'battery'),
  });
  await expect(page.locator('.status')).toHaveText('門檻單位不符');
});
