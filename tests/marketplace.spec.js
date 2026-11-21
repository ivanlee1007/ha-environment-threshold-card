import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const root = new URL('../', import.meta.url);
const file = path => readFile(new URL(path, root), 'utf8');

test('the Marketplace manifest selects a standalone module that registers the dashboard card', async ({ page }) => {
  const manifest = JSON.parse(await file('hacs.json'));
  assert.equal(manifest.name, 'Environment Threshold Card');
  assert.equal(manifest.filename, 'environment-threshold-card.js');
  assert.notEqual(manifest.content_in_root, true, 'Keep release-asset discovery enabled');
  assert.notEqual(manifest.zip_release, true, 'Ship a single JS asset');
  const javascript = await file(manifest.filename);
  const readme = await file('README.md');
  assert.match(readme, /https:\/\/my\.home-assistant\.io\/redirect\/marketplace_repository\/\?owner=ivanlee1007&repository=ha-environment-threshold-card&category=plugin\b/);
  const requests = [];
  const errors = [];
  page.on('request', request => requests.push(request.url()));
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<main></main>');
  await page.addScriptTag({ type: 'module', content: javascript });
  await expect.poll(() => page.evaluate(() => window.customCards?.filter(card => card.type === 'environment-threshold-card').length)).toBe(1);
  const config = await page.evaluate(() => {
    const card = customElements.get('environment-threshold-card');
    const element = new card();
    element.setConfig(card.getStubConfig());
    document.querySelector('main').append(element);
    return { editor: card.getConfigElement().localName, columns: element.getGridOptions().columns };
  });
  assert.deepEqual(config, { editor: 'environment-threshold-card-editor', columns: 12 });
  await expect(page.getByText('請在卡片編輯器新增監測項目。')).toBeVisible();
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
});
