import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const asset = fileURLToPath(new URL('../environment-threshold-card.js', import.meta.url));
const cardTag = 'environment-threshold-card';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.setContent('<div id="host" style="width:300px;font:14px/1.4 system-ui,sans-serif"></div>');
  await page.addScriptTag({ path: asset });
  await page.evaluate(tag => {
    window.calls = [];
    const trap = () => { window.calls.push('transport'); throw Error('unexpected transport'); };
    const states = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [`sensor.dense_${i}`, {
      state: '14.7', attributes: { device_class: 'temperature', unit_of_measurement: '°C' },
    }]));
    states['number.secret_limit'] = { state: '30', attributes: {} };
    window.ha = { states, callService: trap, callApi: trap, callWS: trap };
    window.config = {
      type: `custom:${tag}`, display_mode: 'dense', title: '即時環境門檻',
      sections: [{ id: 'a', title: '室外' }, { id: 'b', title: '室外' }, { id: 'c', title: '空白' }],
      items: Array.from({ length: 13 }, (_, i) => ({
        entity: `sensor.dense_${i}`, ...(i === 12 ? {} : { name: i === 5 ? '很長的感測器名稱' : '溫度' }),
        section: i < 6 ? 'a' : i < 12 ? 'b' : 'stale',
        ...(i === 0 ? { below: 15, above: 'number.secret_limit', unit: '°C' } :
          i === 1 ? { above: 10 } : i === 2 ? { above: 'number.missing' } : i === 3 ? { above: 30 } : {}),
      })),
    };
    const host = document.querySelector('#host');
    const mount = name => {
      const el = document.createElement(name);
      host.append(el);
      el.setConfig(structuredClone(window.config));
      el.hass = window.ha;
      return el;
    };
    window.card = mount(tag);
    window.mountEditor = () => {
      window.editor = mount(`${tag}-editor`);
      window.emits = [];
      window.editor.addEventListener('config-changed', event => {
        window.config = structuredClone(event.detail.config);
        window.emits.push(window.config);
        window.card.setConfig(structuredClone(window.config));
        window.editor.setConfig(structuredClone(window.config));
        window.editor.hass = { ...window.ha, states: { ...window.ha.states } };
      });
    };
  }, cardTag);
});

for (const theme of ['light', 'dark']) {
  test(`dense sections wrap independently with intact readings (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    const sections = page.locator('.dense-section');
    await expect(sections.locator('h3')).toHaveText(['室外6 項', '室外6 項', '空白0 項', '未分組1 項'], { timeout: 1200 });
    const card = page.locator(cardTag);
    const measure = width => card.evaluate((el, width) => {
      el.parentElement.style.width = `${width}px`;
      const root = el.shadowRoot;
      const tiles = [...root.querySelectorAll('.dense-section:first-child .dense-tile')];
      const groups = Object.groupBy(tiles, t => t.getBoundingClientRect().top);
      const contained = (outer, inner) => {
        const o = outer.getBoundingClientRect(), i = inner.getBoundingClientRect();
        return i.left >= o.left && i.right <= o.right + .01;
      };
      const valid = tiles.every(t => {
        const [label, reading] = t.children;
        const [symbol, number] = reading.children;
        const [value, unit] = number.children;
        return label.firstElementChild.tagName === 'svg' && label.firstElementChild.querySelector('path').getAttribute('d').startsWith('M10') &&
          label.firstElementChild.getBoundingClientRect().right <= label.lastElementChild.getBoundingClientRect().left &&
          reading.getBoundingClientRect().top >= label.getBoundingClientRect().bottom &&
          symbol.getBoundingClientRect().right <= value.getBoundingClientRect().left &&
          value.getBoundingClientRect().right <= unit.getBoundingClientRect().left &&
          contained(t, reading) && contained(t, unit);
      });
      const summary = root.querySelector('.dense-summary');
      const children = [...summary.children].filter(n => !n.hidden && n.getClientRects().length);
      const summaryFits = children.every(n => contained(summary, n) &&
        Math.abs(n.getBoundingClientRect().top - children[0].getBoundingClientRect().top) < 5);
      return { width: el.getBoundingClientRect().width, rows: Object.values(groups).map(r => r.length),
        valid, summaryFits, colors: tiles.slice(0, 4).map(t => [getComputedStyle(t).backgroundColor, getComputedStyle(t).borderTopStyle]) };
    }, width);
    for (const [width, rows] of [[240, [3, 3]], [300, [4, 2]], [520, [6]], [840, [6]], [300, [4, 2]]]) {
      const m = await measure(width);
      expect(m, `card width ${width}`).toMatchObject({ width, rows, valid: true, summaryFits: true });
      expect(m.colors.slice(0, 3)).toEqual([['rgb(229, 240, 255)', 'solid'], ['rgb(255, 230, 225)', 'solid'], ['rgb(217, 227, 234)', 'dashed']]);
    }
    const initial = await measure(300);
    await page.evaluate(() => {
      window.ha.states['sensor.dense_0'].state = '-1234567890123.45';
      window.ha.states['sensor.dense_1'].state = '1e+100';
      window.ha.states['sensor.dense_3'].state = '0.0000000000000000123456789012345';
      window.card.hass = window.ha;
    });
    for (const width of [240, 300, 520, 840]) {
      expect(await measure(width)).toMatchObject({ width, valid: true, summaryFits: true });
    }
    const first = sections.first().locator('.dense-tile');
    await expect(first.nth(0)).toHaveAccessibleName(/-1,234,567,890,123\.45|−1,234,567,890,123\.45/);
    await expect(first.nth(1)).toHaveAccessibleName(/1E100/i);
    await expect(first.nth(3)).toHaveAccessibleName(/1\.23456789012345E-17/i);
    expect(initial.colors[3][0]).not.toBe(initial.colors[2][0]);
  });
}

test('dense 240px tracks contain scientific readings and full descriptive units', async ({ page }) => {
  const unit = 'micromoles of photons per square metre per second';
  await page.evaluate(unit => {
    document.querySelector('#host').style.width = '240px';
    window.ha.states['sensor.dense_0'] = { state: '1e+100', attributes: { unit_of_measurement: unit } };
    window.card.hass = window.ha;
    const items = [{ entity: 'sensor.dense_0', name: 'Light', above: 30 }, { entity: 'sensor.dense_1', name: 'Temperature' }];
    window.card.setConfig({ ...window.config, sections: [], items });
  }, unit);
  const [light, temperature] = await page.locator('.dense-tile').all();
  const measure = tile => tile.evaluate(tile => {
    const inside = (outer, inner) => inner.left >= outer.left - .01 && inner.right <= outer.right + .01;
    const [value, unit] = tile.querySelector('.dense-number').children;
    const fragments = node => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return [...range.getClientRects()];
    };
    const tileRect = tile.getBoundingClientRect();
    const valueRects = fragments(value), unitRects = fragments(unit);
    return {
      trackFits: inside(tile.parentElement.getBoundingClientRect(), tileRect),
      textFits: [...valueRects, ...unitRects].every(rect => inside(tileRect, rect)),
      valueLines: valueRects.length, unitLines: unitRects.length,
    };
  });
  expect(await measure(light)).toMatchObject({ trackFits: true, textFits: true, valueLines: 1 });
  expect(await measure(temperature)).toEqual({ trackFits: true, textFits: true, valueLines: 1, unitLines: 1 });
  await expect(light.locator('.dense-number span')).toHaveText('1E100');
  await expect(light).toHaveAccessibleName(new RegExp(`1E100 ${unit}`));
  await light.press('Enter');
  await expect(page.locator('.dense-detail')).toContainText(`上限 30 ${unit}`);
});

test('filter and detail update without exposing entity IDs or breaking focused tile identity', async ({ page }) => {
  const card = page.locator(cardTag);
  const tiles = card.locator('.dense-tile');
  await expect(tiles).toHaveCount(13, { timeout: 1200 });
  const first = tiles.first();
  await first.press('Space');
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  const detail = card.locator('.dense-detail');
  await expect(detail).toContainText('15–30 °C');
  await first.evaluate(el => { window.originalTile = el; });
  await page.evaluate(() => {
    window.ha.states['number.secret_limit'].state = '27';
    window.card.hass = window.ha;
    window.config.sections[0].title = '新名稱';
    window.card.setConfig(structuredClone(window.config));
  });
  await expect(detail).toContainText('新名稱');
  await expect(detail).toContainText('15–27 °C');
  expect(await first.evaluate(el => el === window.originalTile && el.getRootNode().activeElement === el)).toBe(true);
  await first.press('Enter');
  await expect(detail).toBeHidden();
  await tiles.last().click();
  await expect(detail).toBeVisible();
  expect(await card.evaluate(el => el.shadowRoot.innerHTML)).not.toMatch(/sensor\.dense_|number\.(secret_limit|missing)|\bstale\b/);
  const filter = card.getByRole('button', { name: '只看異常' });
  await filter.click();
  await expect(filter).toHaveAttribute('aria-pressed', 'true');
  await expect(detail).toBeHidden();
  await expect(card.locator('.dense-tile:visible')).toHaveCount(3);
  await expect(card.locator('.dense-section:visible h3')).toHaveText('新名稱3 / 6 項');
  await page.evaluate(() => {
    const config = structuredClone(window.config);
    config.items = config.items.map(({ below, above, ...rest }) => rest);
    window.card.setConfig(config);
  });
  await expect(card.getByText('目前沒有異常')).toBeVisible();
  await filter.click();
  await expect(card.getByText('尚未加入監測項目')).toBeVisible();
  expect(await page.evaluate(() => window.calls)).toEqual([]);
});

for (const change of ['delete', 'reorder', 'edit threshold', 'delete identical duplicate']) {
  test(`dense duplicate focus and detail follow only an unambiguous item: ${change}`, async ({ page }) => {
    await page.evaluate(change => {
      const lower = { entity: 'sensor.dense_0', name: 'Lower', below: 12, section: 'a' };
      const upper = { entity: lower.entity, name: 'Upper', above: 25, section: 'a' };
      const items = [lower, change === 'delete identical duplicate' ? { ...lower } : upper];
      window.config = { ...window.config, items };
      window.card.setConfig(structuredClone(window.config));
    }, change);
    const card = page.locator(cardTag);
    const lower = card.locator('.dense-tile').first();
    const detail = card.locator('.dense-detail');
    await lower.press('Space');
    await expect(detail).toContainText('下限 12 °C');
    await lower.evaluate(el => { window.originalTile = el; });
    await page.evaluate(change => {
      window.ha.states['sensor.dense_0'].state = '14.8';
      window.card.hass = { ...window.ha };
      if (change !== 'delete identical duplicate') window.card.setConfig(structuredClone(window.config));
    }, change);
    await expect(lower).toHaveAccessibleName(/14\.8/);
    await expect(lower).toBeFocused();
    await expect(lower).toHaveAttribute('aria-expanded', 'true');
    expect(await lower.evaluate(el => el === window.originalTile)).toBe(true);
    await page.evaluate(change => {
      const [lower, upper] = window.config.items;
      const items = change.startsWith('delete') ? [upper] :
        [upper, change === 'edit threshold' ? { ...lower, below: 13 } : lower];
      window.card.setConfig({ ...window.config, items });
    }, change);
    if (change === 'reorder') {
      const moved = card.locator('.dense-tile').last();
      await expect(moved).toBeFocused();
      await expect(moved).toHaveAttribute('aria-expanded', 'true');
      await expect(detail).toContainText('Lower｜正常下限 12 °C');
      expect(await moved.evaluate(el => el === window.originalTile)).toBe(true);
    } else {
      await expect(detail).toBeHidden({ timeout: 1200 });
      await expect(card.getByRole('button', { name: '只看異常' })).toBeFocused();
      await expect(card.locator('.dense-tile[aria-expanded=true]')).toHaveCount(0);
    }
  });
}

for (const change of ['config echo', 'section title rename', 'section reorder']) {
  test(`dense identical duplicates retain keyboard focus and detail on ${change}`, async ({ page }) => {
    await page.evaluate(() => {
      const item = { entity: 'sensor.dense_0', name: 'Same', below: 12, section: 'b' };
      const sections = [{ id: 'a', title: 'First' }, { id: 'b', title: 'Second' }];
      window.config = { ...window.config, sections, items: [item, { ...item }] };
      window.card.setConfig(structuredClone(window.config));
    });
    const card = page.locator(cardTag);
    const tiles = card.locator('.dense-tile');
    const second = tiles.nth(1);
    const detail = card.locator('.dense-detail');
    await expect(tiles).toHaveCount(2);
    await second.press('Space');
    await expect(second).toBeFocused();
    await expect(detail).toContainText('Second・Same｜正常下限 12 °C');
    await second.evaluate(el => { window.originalTile = el; });

    await page.evaluate(change => {
      const next = structuredClone(window.config);
      if (change === 'section title rename') next.sections[1].title = 'Renamed';
      if (change === 'section reorder') next.sections.reverse();
      window.config = next;
      window.card.setConfig(next);
    }, change);
    expect(await second.evaluate(el => ({
      sameButton: el === window.originalTile,
      focused: el.getRootNode().activeElement === el,
      expanded: el.getAttribute('aria-expanded'),
    }))).toEqual({ sameButton: true, focused: true, expanded: 'true' });
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(`${change === 'section title rename' ? 'Renamed' : 'Second'}・Same｜正常下限 12 °C`);
    if (change === 'section reorder') await expect(card.locator('.dense-section h3').first()).toHaveText('Second2 項');

    await page.evaluate(() => {
      const next = structuredClone(window.config);
      next.items.pop();
      window.card.setConfig(next);
    });
    await expect(tiles).toHaveCount(1);
    expect(await page.evaluate(() => window.originalTile.isConnected)).toBe(false);
    await expect(tiles.first()).toHaveAttribute('aria-expanded', 'false');
    await expect(detail).toBeHidden();
    await expect(card.getByRole('button', { name: '只看異常' })).toBeFocused();
    expect(await page.evaluate(() => window.calls)).toEqual([]);
  });
}

test('default layout preserves v0.3.0 text while dense omits entity IDs', async ({ page }) => {
  const card = page.locator(cardTag);
  await page.evaluate(() => {
    window.ha.states['sensor.roof'] = { state: '24', attributes: { unit_of_measurement: 'lux (sensor.roof)' } };
    window.ha.states['sensor.garden'] = { state: '25', attributes: { friendly_name: 'Garden (sensor.garden)' } };
    window.card.hass = window.ha;
    window.config = { items: [
      { entity: 'sensor.roof', name: 'Roof (sensor.roof)', above: 30 }, { entity: 'sensor.roof' }, { entity: 'sensor.garden' },
    ] };
    window.card.setConfig(structuredClone(window.config));
  });
  await expect(card.locator('.tile .name')).toHaveText(['Roof (sensor.roof)', 'sensor.roof', 'Garden (sensor.garden)'], { timeout: 1200 });
  await expect(card.locator('.tile .reading small').first()).toHaveText('lux (sensor.roof)');
  await expect(card.locator('.tile .bounds').first()).toHaveText('上限 30 lux (sensor.roof)');
  await page.evaluate(() => window.card.setConfig({ ...window.config, display_mode: 'dense' }));
  await expect(card.locator('.dense-name')).toHaveText(['Roof ()', '感測器', 'Garden ()']);
  expect(await card.evaluate(el => el.shadowRoot.innerHTML)).not.toMatch(/sensor\.(roof|garden)/);
  await page.evaluate(() => window.card.setConfig(structuredClone(window.config)));
  await expect(card.locator('.tile .name')).toHaveText(['Roof (sensor.roof)', 'sensor.roof', 'Garden (sensor.garden)']);
});

test('invalid section schema is refused without replacing valid tiles; unknown assignments fall back', async ({ page }) => {
  const errors = await page.evaluate(() => [
    { sections: {} }, { sections: [{ id: '', title: 'empty' }] },
    { sections: [{ id: 'dup' }, { id: 'dup' }] }, { sections: [{ id: 'bad', title: 4 }] },
    { items: [{ entity: 'sensor.dense_0', section: true }] }, { display_mode: 'matrix' },
  ].map(patch => {
    try { window.card.setConfig({ ...window.config, ...patch }); return ''; }
    catch (e) { return e.message; }
  }));
  expect(errors.every(Boolean)).toBe(true);
  await expect(page.locator('.dense-tile')).toHaveCount(13);
  await expect(page.locator('.dense-section h3').last()).toHaveText('未分組1 項');
});

test('native editor saves section CRUD and independent assignments through HA echoes', async ({ page }) => {
  await page.evaluate(() => {
    window.config = { items: [{ entity: 'sensor.dense_0', name: '既有溫度', above: 'number.secret_limit', unit: '°C' }] };
    window.mountEditor();
  });
  const editor = page.locator(`${cardTag}-editor`);
  const findButton = name => editor.getByRole('button', { name, exact: true });
  const dense = editor.getByRole('checkbox', { name: '密集模式' });
  const title = editor.getByRole('textbox', { name: '段落標題' });
  const section = editor.getByLabel('選擇段落', { exact: true });
  const assignment = editor.getByLabel('所屬段落', { exact: true });
  const picker = editor.locator('ha-selector.full');
  await expect(dense).not.toBeChecked({ timeout: 1200 });
  await dense.check();
  await findButton('新增段落').click();
  const first = await section.inputValue();
  await title.fill('室外');
  await findButton('新增段落').click();
  const second = await section.inputValue();
  expect(second).not.toBe(first);
  await title.fill('室外');
  await expect(section.locator('option')).toHaveText(['室外', '室外']);
  await findButton('既有溫度').click();
  await assignment.selectOption(first);
  const source = editor.locator('.source-detail:visible');
  await expect(source).toContainText('number.secret_limit');
  await picker.evaluate(el => { window.picker = el; });
  await title.evaluate(el => { window.sectionTitle = el; el.focus(); el.setSelectionRange(0, 0); });
  await page.keyboard.type('ABC');
  expect(await title.evaluate(el => [el === window.sectionTitle, el.getRootNode().activeElement === el, el.selectionStart])).toEqual([true, true, 3]);
  expect(await picker.evaluate(el => el === window.picker)).toBe(true);
  await dense.uncheck();
  await expect(assignment).toBeHidden();
  await dense.check();
  await expect(assignment).toHaveValue(first);
  await findButton('取消').click();
  await findButton('既有溫度').click();
  await expect(assignment).toHaveValue('');
  await assignment.selectOption(first);
  await findButton('套用項目').click();
  expect(await page.evaluate(() => window.config.items)).toMatchObject([{ section: first, above: 'number.secret_limit', unit: '°C' }]);

  await findButton('新增監測項目').click();
  await picker.evaluate(el => el.dispatchEvent(new CustomEvent('value-changed', { detail: { value: 'sensor.dense_1' }, bubbles: true })));
  await assignment.selectOption(second);
  await findButton('套用項目').click();
  expect(await page.evaluate(() => window.config.items.map(item => item.section))).toEqual([first, second]);
  await section.selectOption(first);
  await expect(editor.getByText(/移除段落.*未分組/)).toBeVisible();
  await findButton('移除段落').click();
  expect(await page.evaluate(() => window.config.items)).toEqual([
    expect.objectContaining({ entity: 'sensor.dense_0', above: 'number.secret_limit', unit: '°C' }),
    expect.objectContaining({ entity: 'sensor.dense_1', section: second }),
  ]);
  expect(await page.evaluate(() => window.config.items[0])).not.toHaveProperty('section');
  await expect(page.locator('.dense-section h3')).toHaveText(['ABC室外1 項', '未分組1 項']);
  await findButton('sensor.dense_1').click();
  await assignment.selectOption('');
  await findButton('套用項目').click();
  await expect(page.locator('.dense-section h3')).toHaveText(['ABC室外0 項', '未分組2 項']);
  expect(await page.evaluate(() => window.calls)).toEqual([]);
});

test('assignment-only edits preserve missing-sensor YAML thresholds; stale drafts cannot reassign a replacement item', async ({ page }) => {
  await page.evaluate(() => {
    window.config = { display_mode: 'dense', sections: [{ id: 'a' }], items: [{ entity: 'sensor.missing', name: '既有風速', below: 4, section: 'stale' }] };
    window.mountEditor();
  });
  const editor = page.locator(`${cardTag}-editor`);
  const button = name => editor.getByRole('button', { name, exact: true });
  await button('既有風速').click();
  const assignment = editor.getByLabel('所屬段落', { exact: true });
  await expect(assignment).toHaveValue('', { timeout: 1200 });
  await assignment.selectOption('a');
  await button('套用項目').click();
  expect(await page.evaluate(() => window.config.items)).toEqual([{ entity: 'sensor.missing', name: '既有風速', below: 4, section: 'a' }]);
  await button('既有風速').click();
  await assignment.selectOption('');
  await page.evaluate(() => {
    window.stale = window.editor.shadowRoot.querySelector('form');
    window.editor.setConfig({ ...window.config, items: [{ entity: 'sensor.dense_0', name: '新風速' }] });
    window.stale.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await expect(button('套用項目')).toBeHidden();
  await expect(button('新風速')).toBeVisible();
  expect(await page.evaluate(() => window.emits.length)).toBe(1);
});

test('all six summary states stay in one line with many items and sections', async ({ page }) => {
  await page.evaluate(() => {
    const sections = Array.from({ length: 24 }, (_, i) => ({ id: `g${i}`, title: `段落 ${i + 1}` }));
    const items = Array.from({ length: 120 }, (_, i) => ({
      ...window.config.items[i % 6], section: sections[Math.floor(i / 5)].id,
      ...(i % 6 === 5 ? { entity: 'sensor.missing' } : {}),
    }));
    window.card.setConfig({ ...window.config, items, sections });
  });
  const card = page.locator(cardTag);
  await expect(card.locator('.dense-section')).toHaveCount(24);
  await expect(card.locator('.dense-tile')).toHaveCount(120);
  const summary = card.locator('.dense-summary');
  await expect(summary.getByRole('img')).toHaveCount(6);
  await expect(summary).toContainText('共 120 項');
  for (const width of [240, 300, 360, 370, 520, 840]) {
    const fit = await summary.evaluate((el, width) => {
      el.getRootNode().host.parentElement.style.width = `${width}px`;
      const outer = el.getBoundingClientRect();
      return [...el.children].filter(n => !n.hidden).every(node => {
        const rect = node.getBoundingClientRect();
        return rect.left >= outer.left && rect.right <= outer.right + .01 && rect.height < 22;
      });
    }, width);
    expect(fit, `six counts at ${width}px`).toBe(true);
  }
});
