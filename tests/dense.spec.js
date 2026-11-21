import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const asset = fileURLToPath(new URL('../environment-threshold-card.js', import.meta.url));
const cardTag = 'environment-threshold-card';

function summaryGeometry(el) {
  const outer = el.getBoundingClientRect();
  const center = (outer.top + outer.bottom - parseFloat(getComputedStyle(el).borderBottomWidth)) / 2;
  const items = [...el.children].filter(node => !node.hidden).map(node => {
    const { left, right, top, bottom, height } = node.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(node);
    const text = [...range.getClientRects()];
    return { tone: node.dataset.tone ?? 'total', left: left - outer.left, right: right - outer.left,
      height, centerDelta: (top + bottom) / 2 - center,
      intact: left >= outer.left - .01 && right <= outer.right + .01 &&
        top >= outer.top - .01 && bottom <= outer.bottom + .01 && text.length > 0 &&
        text.every(r => r.left >= left - .01 && r.right <= right + .01 &&
          r.top >= outer.top - .01 && r.bottom <= outer.bottom + .01) };
  });
  return { width: outer.width, height: outer.height, items,
    fits: items.every((item, i) => item.intact && Math.abs(item.centerDelta) < .05 &&
      (!i || item.left >= items[i - 1].right - .01)) };
}

const measureSummary = async (summary, width) => {
  await summary.evaluate((el, width) => {
    el.getRootNode().host.parentElement.style.width = `${width}px`;
  }, width);
  return summary.evaluate(summaryGeometry);
};

const expectSummaryFit = (measure, message) => expect.poll(async () => {
  const report = await measure();
  return report.fits ? null : report;
}, { message }).toBeNull();

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
    const summary = card.locator('.dense-summary');
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
      return { width: el.getBoundingClientRect().width, rows: Object.values(groups).map(r => r.length),
        valid, colors: tiles.slice(0, 4).map(t => [getComputedStyle(t).backgroundColor, getComputedStyle(t).borderTopStyle]) };
    }, width);
    for (const [width, rows] of [[240, [3, 3]], [300, [4, 2]], [520, [6]], [840, [6]], [300, [4, 2]]]) {
      const m = await measure(width);
      expect(m, `card width ${width}`).toMatchObject({ width, rows, valid: true });
      await expectSummaryFit(() => summary.evaluate(summaryGeometry), `summary width ${width}`);
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
      expect(await measure(width)).toMatchObject({ width, valid: true });
      await expectSummaryFit(() => summary.evaluate(summaryGeometry), `updated summary width ${width}`);
    }
    const first = sections.first().locator('.dense-tile');
    await expect(first.nth(0)).toHaveAccessibleName(/-1,234,567,890,123\.45|−1,234,567,890,123\.45/);
    await expect(first.nth(1)).toHaveAccessibleName(/1E100/i);
    await expect(first.nth(3)).toHaveAccessibleName(/1\.23456789012345E-17/i);
    expect(initial.colors[3][0]).not.toBe(initial.colors[2][0]);
  });
}

test('summary adapts to wider glyph advances and restores full labels when there is room', async ({ page }) => {
  const summary = page.locator('.dense-summary');
  const names = ['過高 1', '過低 1', '門檻異常 1', '正常 1', '未設門檻 9'];
  await page.evaluate(() => {
    window.summaryErrors = [];
    window.addEventListener('error', event => window.summaryErrors.push(event.message));
  });
  await expect(summary.getByRole('img')).toHaveCount(names.length);
  for (const name of names) await expect(summary.getByRole('img', { name, exact: true })).toBeVisible();
  await summary.evaluate(el => { el.style.letterSpacing = '.75px'; });
  await expectSummaryFit(() => measureSummary(summary, 300), 'wide glyphs at 300px');
  await expect(summary.getByRole('img', { name: '過高 1', exact: true }).locator('.dense-word')).toBeHidden();
  await expectSummaryFit(() => measureSummary(summary, 840), 'wide glyphs at 840px');
  await expect(summary.getByRole('img', { name: '過高 1', exact: true }).locator('.dense-word')).toBeVisible();
  await expectSummaryFit(() => measureSummary(summary, 300), 'wide glyphs after shrinking again');
  for (const name of names) {
    const badge = summary.getByRole('img', { name, exact: true });
    await expect(badge).toBeVisible();
    await expect(badge.locator('span:last-child')).toBeVisible();
    await expect(badge.locator('span:last-child')).toHaveText(name.split(' ').at(-1));
  }
  await page.evaluate(() => {
    const host = window.card.parentElement;
    window.card.remove();
    host.style.width = '840px';
    host.append(window.card);
  });
  await expect(summary.getByRole('img', { name: '過高 1', exact: true }).locator('.dense-word')).toBeVisible();
  await expectSummaryFit(() => measureSummary(summary, 300), 'wide glyphs after reconnecting');
  await expect(summary).toContainText('共 13 項');
  expect(await page.evaluate(() => window.summaryErrors)).toEqual([]);
});

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

for (const theme of ['light', 'dark']) {
  test(`standard displays shared sections in its responsive tile layout (${theme})`, async ({ page }) => {
    const requests = [];
    page.on('request', request => requests.push(request.url()));
    await page.route('**/*', route => route.abort());
    await page.emulateMedia({ colorScheme: theme });
    await page.evaluate(theme => {
      const host = document.querySelector('#host');
      if (theme === 'dark') host.style.cssText += ';--primary-text-color:#e7eef4;--secondary-text-color:#c4d0da;--ha-card-background:#18242d;--secondary-background-color:#293843;--divider-color:#465763;--ha-card-border-color:#465763';
      window.ha.themes = { darkMode: theme === 'dark' };
      window.card.hass = window.ha;
      const [a, b, c] = window.config.sections;
      const items = window.config.items;
      const select = (i, name) => ({ ...items[i], name });
      const { section, ...unassigned } = select(7, '手動未分組');
      window.config = { ...window.config, sections: [b, a, c], display_mode: 'standard', items: [
        select(0, '北側溫度'), select(6, '育苗溫度'), unassigned, select(1, '南側溫度'),
        select(12, '舊段落項目'), select(2, '風速測點'), select(3, '校正測點'), select(4, '後側溫度'), select(5, '很長的感測器名稱'),
      ] };
      if (theme === 'dark') delete window.config.display_mode;
      window.card.setConfig(structuredClone(window.config));
    }, theme);
    const card = page.locator(cardTag);
    const sections = card.locator('.standard-section');
    await expect(sections.locator('h3')).toHaveText(['室外1 項', '室外6 項', '空白0 項', '未分組2 項'], { timeout: 1200 });
    await expect(sections.nth(0).locator('.name')).toHaveText(['育苗溫度']);
    await expect(sections.nth(1).locator('.name')).toHaveText(['北側溫度', '南側溫度', '風速測點', '校正測點', '後側溫度', '很長的感測器名稱']);
    await expect(sections.nth(2).getByText('尚未加入監測項目')).toBeVisible();
    await expect(sections.nth(3).locator('.name')).toHaveText(['手動未分組', '舊段落項目']);
    await expect(card.locator('.tile')).toHaveCount(9);
    await expect(card.locator('.dense-grid')).toHaveCount(0);
    await expect(card.getByRole('button')).toHaveCount(0);
    const low = sections.nth(1).locator('.tile').first();
    await expect(low.locator('svg')).toBeVisible();
    await expect(low.locator('.reading')).toHaveText('14.7°C');
    await expect(low.locator('.status')).toHaveText('↓ 低於下限');
    await expect(low.locator('.bounds')).toHaveText('15–30 °C');
    await expect(card.getByRole('status')).toContainText('1 項過低');
    expect(await card.evaluate(el => el.getCardSize())).toBe(16);

    const resize = width => card.evaluate((el, width) => { el.parentElement.style.width = `${width}px`; }, width);
    for (const [width, columns] of [[300, 1], [960, 6], [300, 1]]) {
      await resize(width);
      const geometry = await card.evaluate(el => {
        const root = el.shadowRoot;
        const grids = [...root.querySelectorAll('.standard-section .grid')].filter(g => g.children.length);
        return { viewport: innerWidth, width: el.getBoundingClientRect().width, fits: el.scrollWidth === el.clientWidth,
          columns: grids.map(g => [...g.children].filter(t => Math.abs(t.offsetTop - g.firstElementChild.offsetTop) < 1).length),
          intact: grids.every(g => [...g.children].every(t => t.scrollWidth === t.clientWidth &&
            t.getBoundingClientRect().right <= g.getBoundingClientRect().right + .01)) };
      });
      expect(geometry).toEqual({ viewport: 1200, width, fits: true,
        columns: [1, columns, Math.min(2, columns)], intact: true });
    }

    // Equivalent commits and telemetry must not replace or detach animated cells.
    expect(await low.evaluate(tile => {
      const card = window.card;
      const glyph = tile.querySelector('.glyph');
      const animation = glyph.getAnimations()[0];
      const observer = new MutationObserver(() => {});
      observer.observe(tile.parentElement, { childList: true });
      card.setConfig(structuredClone(window.config));
      card.hass = { ...window.ha, states: { ...window.ha.states } };
      const mutations = observer.takeRecords().length;
      observer.disconnect();
      const renamed = structuredClone(window.config);
      renamed.sections[1].title = '改名';
      card.setConfig(renamed);
      const attached = card.shadowRoot.querySelectorAll('.standard-section')[1].querySelector('.tile') === tile;
      card.setConfig(structuredClone(window.config));
      return [mutations, attached, Boolean(animation), glyph.getAnimations()[0] === animation];
    })).toEqual([0, true, true, true]);

    const capture = async mode => {
      if (!process.env.ETC_SECTION_SCREENSHOTS) return;
      for (const width of [300, 960]) {
        await resize(width);
        await card.screenshot({ path: `${process.env.ETC_SECTION_SCREENSHOTS}/${mode}-${theme}-${width}.png`, animations: 'disabled' });
      }
    };
    await capture('standard-grouped');
    await card.evaluate(el => el.setConfig({ ...window.config, display_mode: 'dense' }));
    await expect(card.locator('.dense-section h3')).toHaveText(['室外1 項', '室外6 項', '空白0 項', '未分組2 項']);
    await expect(card.locator('.tile')).toHaveCount(0);
    await capture('dense-grouped');
    await card.evaluate(el => el.setConfig(structuredClone(window.config)));
    await expect(sections.locator('h3')).toHaveText(['室外1 項', '室外6 項', '空白0 項', '未分組2 項']);
    await expect(sections.nth(1).locator('.name').first()).toHaveText('北側溫度');
    await expect(card.locator('.dense-grid')).toHaveCount(0);

    for (const clean of [{ sections: [] }, {}]) {
      await card.evaluate((el, clean) => {
        const { sections, ...config } = window.config;
        el.setConfig({ ...config, ...clean });
      }, clean);
      await expect(card.locator('ha-card > .grid > .tile')).toHaveCount(9);
      await expect(card.locator('h3')).toHaveCount(0);
      await expect(card.locator('.tile .name').first()).toHaveText('北側溫度');
      expect(await card.evaluate(el => el.getCardSize())).toBe(11);
    }
    await capture('standard-legacy');
    expect(await page.evaluate(() => window.calls)).toEqual([]);
    expect(requests).toEqual([]);
  });
}

for (const mode of ['standard', 'dense']) {
test(`graphical editor saves section CRUD and assignments through HA echoes (${mode})`, async ({ page }) => {
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
  if (mode === 'dense') await dense.check();
  await expect(findButton('新增段落')).toBeVisible({ timeout: 1200 });
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
  await dense.setChecked(mode === 'standard');
  await expect(assignment).toBeVisible();
  await expect(assignment).toHaveValue(first);
  expect(await picker.evaluate(el => el === window.picker)).toBe(true);
  await dense.setChecked(mode === 'dense');
  await expect(assignment).toHaveValue(first);
  await findButton('取消').click();
  await findButton('既有溫度').click();
  await expect(assignment).toHaveValue('');
  await assignment.selectOption(first);
  await findButton('套用項目').click();
  expect(await page.evaluate(() => window.config.items)).toMatchObject([{ section: first, above: 'number.secret_limit', unit: '°C' }]);
  await page.evaluate(() => {
    window.editor.remove();
    window.mountEditor();
  });
  await findButton('既有溫度').click();
  await expect(assignment).toHaveValue(first);
  await expect(source).toContainText('number.secret_limit');
  await findButton('取消').click();

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
  const headings = page.locator(`.${mode}-section h3`);
  await expect(headings).toHaveText(['ABC室外1 項', '未分組1 項']);
  await findButton('sensor.dense_1').click();
  await assignment.selectOption('');
  await findButton('套用項目').click();
  await expect(headings).toHaveText(['ABC室外0 項', '未分組2 項']);
  expect(await page.evaluate(() => window.calls)).toEqual([]);
});
}

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
  for (const label of ['過高', '過低', '無讀值', '門檻異常', '正常', '未設門檻']) {
    await expect(summary.getByRole('img', { name: `${label} 20`, exact: true })).toBeVisible();
  }
  await expect(summary).toContainText('共 120 項');
  for (const width of [240, 300, 360, 370, 520, 840]) {
    await expectSummaryFit(() => measureSummary(summary, width), `six counts at ${width}px`);
    const { items } = await summary.evaluate(summaryGeometry);
    expect(items).toHaveLength(7);
    expect(Math.max(...items.map(item => item.height))).toBeLessThan(22);
  }
  await expectSummaryFit(() => measureSummary(summary, 240), 'six counts after shrinking to 240px');
  for (const spacing of ['.75px', '1.5px']) {
    await summary.evaluate((el, value) => { el.style.letterSpacing = value; }, spacing);
    await expectSummaryFit(() => summary.evaluate(summaryGeometry), `six counts with ${spacing} wider glyphs at 240px`);
  }
  for (const badge of await summary.getByRole('img').all()) {
    await expect(badge.locator('span:last-child')).toBeVisible();
    await expect(badge.locator('span:last-child')).toHaveText('20');
  }
});
