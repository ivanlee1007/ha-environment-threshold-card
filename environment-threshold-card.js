/*
MIT License

Copyright (c) 2026 ivanlee1007

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
const TAG = 'environment-threshold-card';
const DEFAULT_TITLE = '環境門檻監測';
const ENTITY_ID = /^sensor\.[a-z0-9_]+$/;
const MONITORED_SELECTOR = { entity: { filter: [{ domain: 'sensor' }] } };
const THRESHOLD_DOMAINS = ['sensor', 'input_number', 'number', 'counter'];
const THRESHOLD_ID = new RegExp(`^(?:${THRESHOLD_DOMAINS.join('|')})\\.[a-z0-9_]+$`);
const THRESHOLD_FILTER = THRESHOLD_DOMAINS.map(domain => ({ domain }));
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const KINDS = new Map([
  ['light', ['光照', 'M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z']],
  ['temperature', ['溫度', 'M10 14.2V5a2 2 0 1 1 4 0v9.2a4.5 4.5 0 1 1-4 0zM12 10v8']],
  ['humidity', ['濕度', 'M12 2c-2 4-7 8-7 13a7 7 0 0 0 14 0c0-5-5-9-7-13zM8 16a4 4 0 0 0 4 3']],
  ['wind', ['風速', 'M3 8h12a2.5 2.5 0 1 0-2.5-2.5M2 12h17a2 2 0 1 1-2 2M5 16h7a2.5 2.5 0 1 1-2.5 2.5']],
  ['custom', ['其他感測', 'M2 12h5l3-7 4 14 3-7h5']],
]);
const DEVICE_KINDS = new Map([['illuminance', 'light'], ['temperature', 'temperature'], ['humidity', 'humidity'], ['wind_speed', 'wind']]);
const STATUS = {
  high: '↑ 高於上限', low: '↓ 低於下限', normal: '正常', unavailable: '無讀值', unset: '未設門檻',
  unit: '單位已變更', source: '門檻來源異常', 'source-unit': '門檻單位不符', range: '下限必須小於上限',
};
const dom = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};
const style = css => dom('style', '', css);
const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
const format = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 15 });
const unitOf = state => state?.attributes?.unit_of_measurement ?? '';
const deviceClassOf = state => state?.attributes?.device_class;
function normalizeUnit(unit, deviceClass) {
  const trimmed = typeof unit === 'string' ? unit.trim() : unit;
  return deviceClass === 'humidity' && /^%(?:h|rh)$/i.test(trimmed) ? '%' : trimmed;
}
const evaluationUnit = (savedUnit, liveUnit, deviceClass) => savedUnit == null ? liveUnit : normalizeUnit(savedUnit, deviceClass);
const SPEED_CLASSES = new Set(['wind_speed', 'speed']);
function convertSpeed(value, from, to, deviceClass, sourceClass) {
  if (!SPEED_CLASSES.has(deviceClass) || (sourceClass && !SPEED_CLASSES.has(sourceClass))) return undefined;
  return from === 'm/s' && to === 'km/h' ? value * 3.6 :
    from === 'km/h' && to === 'm/s' ? value / 3.6 : undefined;
}
function compareValues(a, b, converted) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  if (a === b) return 0;
  // A converted pair can be equal at the displayed precision or differ only by
  // rounding in the binary inputs and the unit conversion. Leave raw pairs strict.
  if (converted && (format.format(a) === format.format(b) ||
      Math.abs(a - b) <= 2 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b)))) return 0;
  return a < b ? -1 : 1;
}
const nameOf = (item, states) => item.name || states?.[item.entity]?.attributes?.friendly_name || item.entity;
const hasBounds = item => item.below != null || item.above != null;
const numericState = raw => typeof raw === 'string' && DECIMAL.test(raw.trim()) ? Number(raw) : NaN;
const withUnit = (value, unit) => `${format.format(value)}${unit ? ` ${unit}` : ''}`;
const compactUnit = unit => unit === '%' ? '%' : unit ? ` ${unit}` : '';
const customTitle = title => typeof title === 'string' && title.trim() ? title : '';
const sectionTitle = section => customTitle(section.title).trim() || '未命名段落';
const sectionId = value => typeof value === 'string' && value.trim() !== '';
const denseMode = config => config?.display_mode === 'dense';

// Lovelace can replay a fresh config object. Only a change to the item data
// invalidates its positional draft; title and other card options do not.
function sameConfigData(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameConfigData(a[key], b[key]));
}

// This allowlist belongs to presentation only. Do not use it to resolve or compare thresholds.
function displayMeasurement(value, unit, deviceClass) {
  if (typeof unit !== 'string') return { value, unit: '' };
  if (value === undefined) return { value, unit };
  if (deviceClass === 'wind_speed' && unit === 'km/h') {
    const converted = value / 3.6;
    if (converted !== 0 || value === 0) return { value: converted, unit: 'm/s' };
  }
  if (deviceClass === 'temperature') {
    if (unit === '℃') return { value, unit: '°C' };
    if (unit === '°F') return { value: (value - 32) / 1.8, unit: '°C' };
    if (unit === 'K') return { value: value - 273.15, unit: '°C' };
  }
  if (deviceClass === 'illuminance' && (unit === 'lx' || /^lux$/i.test(unit))) return { value, unit: 'lx' };
  // Relative humidity is already normalized by the narrower evaluation rules.
  return { value, unit };
}

function describeBounds(below, above, unit, flag, deviceClass) {
  const project = bound => bound.rawUnit === undefined ? displayMeasurement(bound.value, unit, deviceClass) :
    { value: bound.value, unit: bound.rawUnit };
  const lower = project(below);
  const upper = project(above);
  if (lower.value !== undefined && upper.value !== undefined && !below.rawUnit && !above.rawUnit &&
      lower.unit === upper.unit && flag !== 'range') {
    return `${format.format(lower.value)}–${format.format(upper.value)}${compactUnit(lower.unit)}`;
  }
  return [['下限', below, lower], ['上限', above, upper]].flatMap(([side, bound, shown]) =>
    bound.reason ? [`${side}：${bound.reason}`] : shown.value === undefined ? [] :
      [`${side} ${format.format(shown.value)}${compactUnit(shown.unit)}`]).join(' · ');
}

function validate(config) {
  if (config?.display_mode !== undefined && !['standard', 'dense'].includes(config.display_mode)) throw new Error('無效的卡片顯示模式。');
  if (config?.sections !== undefined) {
    if (!Array.isArray(config.sections)) throw new Error('sections 必須是清單。');
    const ids = new Set();
    for (const section of config.sections) {
      if (!sectionId(section?.id) || ids.has(section.id)) throw new Error('段落 ID 必須是唯一且非空白的文字。');
      if (section.title !== undefined && typeof section.title !== 'string') throw new Error('段落標題必須是文字。');
      ids.add(section.id);
    }
  }
  const items = config?.items ?? [];
  if (!Array.isArray(items)) throw new Error('items 必須是清單。');
  for (const item of items) {
    if (typeof item?.entity !== 'string' || !ENTITY_ID.test(item.entity)) throw new Error('請選擇有效的 sensor 實體。');
    if (item.section !== undefined && !sectionId(item.section)) throw new Error('section 必須是非空白文字。');
    if (item.kind != null && !KINDS.has(item.kind)) throw new Error('無效的感測類型。');
    for (const key of ['name', 'unit']) if (item[key] != null && typeof item[key] !== 'string') throw new Error(`${key} 必須是文字。`);
    for (const key of ['below', 'above']) {
      const bound = item[key];
      if (bound != null && !Number.isFinite(bound) && !(typeof bound === 'string' && THRESHOLD_ID.test(bound))) {
        throw new Error('門檻必須是有限數字或支援的數值實體 ID。');
      }
    }
    if (Number.isFinite(item.below) && Number.isFinite(item.above) && item.below >= item.above) throw new Error('下限必須小於上限。');
  }
  return items;
}

function resolveBound(configured, states, monitoredUnit, deviceClass) {
  if (configured == null) return {};
  if (typeof configured === 'number') return { value: configured, label: withUnit(configured, monitoredUnit) };
  const source = states?.[configured];
  const value = numericState(source?.state);
  if (!Number.isFinite(value)) {
    const reason = !source ? '找不到實體' : ['unknown', 'unavailable', ''].includes(source.state) ? '無讀值' : '不是有限數字';
    return { issue: 'source', reason, label: `${configured}：${reason}` };
  }
  const sourceClass = deviceClassOf(source);
  const aliasClass = deviceClass === 'humidity' && (!sourceClass || sourceClass === 'humidity') ? deviceClass : undefined;
  const sourceUnit = normalizeUnit(unitOf(source), aliasClass);
  // Unitless numeric helpers are intentional setpoints; sensors must match units.
  const explicitUnit = sourceUnit !== '' || ENTITY_ID.test(configured);
  const displayUnit = normalizeUnit(unitOf(source));
  const label = `${configured} = ${withUnit(value, displayUnit || (explicitUnit ? '' : monitoredUnit))}`;
  if (monitoredUnit === undefined) return { value, label, rawUnit: displayUnit };
  if (!explicitUnit || sourceUnit === monitoredUnit) return { value, label };
  const converted = convertSpeed(value, sourceUnit, monitoredUnit, deviceClass, sourceClass);
  if (converted === undefined) return { issue: 'source-unit', reason: '單位不符', label: `${label}（單位不符）` };
  if (!Number.isFinite(converted) || (value !== 0 && converted === 0)) return { issue: 'source', reason: '換算結果無效', label: `${label}（換算結果無效）` };
  return { value: converted, converted: true, label: `${label} → ${withUnit(converted, monitoredUnit)}` };
}

function evaluate(item, states) {
  const state = states?.[item.entity];
  const deviceClass = deviceClassOf(state);
  const unit = normalizeUnit(unitOf(state), deviceClass);
  const value = numericState(state?.state);
  const usable = Number.isFinite(value);
  const boundsUnit = evaluationUnit(item.unit, state ? unit : undefined, deviceClass);
  const below = resolveBound(item.below, states, boundsUnit, deviceClass);
  const above = resolveBound(item.above, states, boundsUnit, deviceClass);

  const flag = !usable ? 'unavailable' : !hasBounds(item) ? 'unset' : item.unit != null && boundsUnit !== unit ? 'unit' :
    below.issue ?? above.issue ?? (compareValues(below.value, above.value, below.converted || above.converted) >= 0 ? 'range' :
      compareValues(value, above.value, above.converted) > 0 ? 'high' :
        compareValues(value, below.value, below.converted) < 0 ? 'low' : 'normal');
  return {
    flag, reading: usable ? displayMeasurement(value, unit, deviceClass) : { value: undefined, unit: '' },
    bounds: describeBounds(below, above, boundsUnit, flag, deviceClass),
  };
}

const CARD_CSS = `
:host { display:block; min-inline-size:0; color:var(--primary-text-color,#20313d); }
ha-card { display:block; box-sizing:border-box; height:auto; padding:12px; border:1px solid var(--ha-card-border-color,#d9e3ea); border-radius:var(--ha-card-border-radius,12px); background:var(--ha-card-background,var(--card-background-color,#fff)); }
ha-card [hidden] { display:none !important; }
.standard-card { container:standard-card / inline-size; }
.card-head { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:4px 6px; }
.standard-card .card-head { margin-block-end:8px; }
.card-head h2 { flex:1 1 auto; min-inline-size:0; margin:0; font-size:1.22em; line-height:1.3; overflow-wrap:anywhere; }
.card-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:4px; min-inline-size:0; margin-inline-start:auto; }
.card-toggle { font:inherit; font-size:11px; line-height:1.4; min-height:26px; padding:2px 6px;
  border:1px solid var(--divider-color,var(--edge,#cfdbe0)); border-radius:6px; color:inherit;
  background:var(--tile,var(--secondary-background-color,transparent)); cursor:pointer; }
.card-toggle[aria-pressed=true] { color:#0c5a55; border-color:#4a9e90; background:#ddf4ee; }
.card-toggle:focus-visible { outline:2px solid var(--primary-color,#179785); outline-offset:1px; z-index:1; }
.summary { margin:0 0 8px; padding:6px 9px; border-radius:8px; font-weight:600; background:var(--secondary-background-color,#edf3f6); }
.summary[data-tone=alarm] { border-inline-start:4px solid #d44731; background:color-mix(in srgb,#d44731 13%,transparent); }
.summary[data-tone=warning] { border-inline-start:4px solid #78909c; }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,138px),1fr)); gap:6px; }
/* Three compact tracks need 342px of inner space; keep roomier tracks on wider cards. */
@container standard-card (width < 426px) { .grid { grid-template-columns:repeat(auto-fit,minmax(min(100%,110px),1fr)); } }
.standard-section + .standard-section { margin-block-start:12px; }
.standard-section h3 { display:flex; align-items:baseline; gap:8px; margin:0 0 6px; font-size:1em; overflow-wrap:anywhere; }
.standard-section-count { flex:none; color:var(--secondary-text-color,#4d5965); font-size:.85em; font-weight:400; white-space:nowrap; }
.standard-section-empty { margin:0; color:var(--secondary-text-color,#4d5965); font-size:.85em; }

.tile { min-inline-size:0; display:grid; grid-template-columns:20px minmax(0,1fr); gap:2px 5px; align-content:start; align-items:center; padding:5px 6px; border-radius:10px; border:1px solid var(--divider-color,#d9e3ea); overflow-wrap:anywhere; }
.glyph { width:20px; height:20px; display:grid; place-items:center; background:var(--secondary-background-color,#edf3f6); border-radius:5px; }
.glyph svg { width:16px; height:16px; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
.name { min-inline-size:0; font-weight:650; line-height:1.25; }
.tile-body { grid-column:1/-1; min-inline-size:0; line-height:1.3; }
.reading { display:flex; flex-wrap:wrap; align-items:baseline; column-gap:.18em; font-size:1.3em; font-weight:700; font-variant-numeric:tabular-nums; line-height:1.2; }
.reading small { font-size:.65em; }
.status { display:inline-block; font-size:.8em; padding:1px 4px; border-radius:5px; background:var(--secondary-background-color,#edf3f6); }
.bounds { display:block; margin-top:1px; font-size:.8em; color:var(--secondary-text-color,#4d5965); }

[data-state=high] { border-color:#ed8d83; }
[data-state=high] :is(.status,.glyph) { background:#ffe6e1; color:#9e281b; }
[data-state=low] { border-color:#77a9e8; }
[data-state=low] :is(.status,.glyph) { background:#e5f0ff; color:#174f95; }
:is([data-state=unavailable],[data-state=unit],[data-state=source],[data-state=source-unit],[data-state=range]) { border-style:dashed; }
[data-state=high] .glyph { animation:rise 1.5s ease-in-out infinite; }
[data-state=low] .glyph { animation:fall 1.8s ease-in-out infinite; }
@keyframes rise { 50% { transform:translateY(-3px) scale(1.06); } }
@keyframes fall { 50% { transform:translateY(3px); } }
@media (prefers-reduced-motion:reduce) { [data-state] .glyph { animation:none; } }
`;

function tileNodes() {
  const tile = dom('div', 'tile');
  const glyph = dom('span', 'glyph');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  svg.append(path);
  glyph.append(svg);
  const body = dom('div', 'tile-body');
  const name = dom('div', 'name');
  const reading = dom('div', 'reading');
  const value = dom('span');
  const unitNode = dom('small');
  const status = dom('span', 'status');
  const bounds = dom('small', 'bounds');
  reading.append(value, unitNode);
  body.append(reading, status, bounds);
  tile.append(glyph, name, body);
  return { tile, path, name, value, unitNode, status, bounds };
}

function standardSectionNodes() {
  const node = dom('section', 'standard-section');
  const heading = dom('h3');
  const title = dom('span');
  const count = dom('span', 'standard-section-count');
  heading.append(title, count);
  const grid = dom('div', 'grid');
  const empty = dom('p', 'standard-section-empty', '尚未加入監測項目');
  node.append(heading, grid, empty);
  return { node, title, count, grid, empty };
}

const DENSE_CSS = `

.dense-shell { container-type:inline-size; }
.dense-card { --bg:#f8fafb; --tile:#fff; --edge:#cfdbe0; --ink:#162630; --dim:#435e69; padding:10px;
  border-color:var(--ha-card-border-color,var(--edge)); background:var(--ha-card-background,var(--card-background-color,var(--bg)));
  color:var(--primary-text-color,var(--ink)); line-height:1.4; }
.dense-card[data-theme=dark] { --bg:#131c22; --tile:#1c2932; --edge:#364751; --ink:#f2f8fa; --dim:#b4c7cf; }
@media (prefers-color-scheme:dark) {
  .dense-card:not([data-theme]) { --bg:#131c22; --tile:#1c2932; --edge:#364751; --ink:#f2f8fa; --dim:#b4c7cf; }
}
.dense-card .card-head h2 { font-size:16px; line-height:inherit; letter-spacing:.02em; }
.dense-summary { display:flex; align-items:center; gap:5px; box-sizing:border-box; min-height:28px; margin:3px 0 0;
  padding:5px 0; border-block-end:1px solid var(--divider-color,var(--edge)); font-size:11px; line-height:1.4; white-space:nowrap; }
.dense-summary > span { flex:none; color:var(--secondary-text-color,var(--dim)); }
.dense-summary > :is([data-tone=high],[data-tone=low],[data-tone=issue],[data-tone=unavailable]) {
  color:var(--alert-ink); background:var(--fill); border-radius:4px; padding:1px 4px; font-weight:750;
}
.dense-shell [data-tone=high] { --fill:#ffe6e1; --alert-ink:#9e281b; --alert-edge:#ed8d83; }
.dense-shell [data-tone=low] { --fill:#e5f0ff; --alert-ink:#174f95; --alert-edge:#77a9e8; }
.dense-shell :is([data-tone=issue],[data-tone=unavailable]) { --fill:#d9e3ea; --alert-ink:#33444e; --alert-edge:#78909c; }
.dense-short { display:none; }
.dense-summary[data-fit] .dense-word, .dense-summary:is([data-fit=marks],[data-fit=tight]) .dense-short { display:none; }
@container (width > 275px) {
  .dense-summary[data-fit=short] .dense-short { display:inline; }
}
.dense-section + .dense-section { margin-block-start:7px; }
.dense-section h3 { display:flex; align-items:center; gap:9px; font-size:12px; margin:6px 0 3px; font-weight:650; }
.dense-section-title { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dense-count { flex:none; color:var(--secondary-text-color,var(--dim)); font-size:11px; font-weight:400; white-space:nowrap; }
.dense-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,64px),1fr)); gap:4px; }
/* Long readings get intrinsic space up to the grid width; only the unit can wrap. */
.dense-grid[data-wide] { display:flex; flex-wrap:wrap; }
.dense-grid[data-wide] .dense-tile { flex:1 0 64px; }
.dense-grid[data-wide] .dense-tile[data-wide] { flex-basis:max-content; }
.dense-tile { box-sizing:border-box; min-width:0; max-width:100%; min-height:41px; padding:3px 2px; display:flex; flex-direction:column;
  align-items:center; justify-content:center; border-radius:6px; border:1px solid var(--alert-edge,var(--divider-color,var(--edge)));
  color:var(--alert-ink,var(--primary-text-color,var(--ink))); background:var(--fill,var(--tile)); font:inherit; cursor:pointer; }
.dense-tile:is([data-tone=issue],[data-tone=unavailable]) { border-style:dashed; }
.dense-tile[aria-expanded=true] { box-shadow:inset 0 0 0 1px var(--alert-ink,var(--dim)); }
.dense-tile:focus-visible { outline:2px solid var(--primary-color,#179785); outline-offset:1px; z-index:1; }
.dense-label { display:inline-flex; align-items:center; gap:3px; max-width:100%; line-height:1.25; font-size:11px;
  color:var(--alert-ink,var(--secondary-text-color,var(--dim))); }
.dense-label svg { width:13px; height:13px; flex:none; fill:none; stroke:currentColor; stroke-width:1.9; stroke-linecap:round; stroke-linejoin:round; }
.dense-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dense-reading,.dense-number { display:inline-flex; align-items:center; white-space:nowrap; gap:2px; }
.dense-reading { max-width:100%; font-size:11px; font-weight:660; font-variant-numeric:tabular-nums; }
.dense-number { min-width:0; align-items:baseline; }
.dense-number > span { flex:none; }
.dense-number small { white-space:normal; overflow-wrap:anywhere; text-align:start;
  font-size:9px; font-weight:500; color:var(--alert-ink,var(--secondary-text-color,var(--dim))); }
.dense-mark { display:inline-grid; place-items:center; flex:none; min-inline-size:12px; block-size:14px; border-radius:3px;
  font-size:11px; font-weight:750; line-height:1; background:var(--alert-ink,transparent); color:var(--fill,var(--secondary-text-color,var(--dim))); }
.dense-detail { margin-block-start:6px; padding:6px 8px; border-radius:7px; border:1px solid var(--divider-color,var(--edge));
  font-size:12px; overflow-wrap:anywhere; }
.dense-detail strong { margin-inline-end:6px; }
.dense-detail span,.dense-empty { color:var(--secondary-text-color,var(--dim)); }
.dense-empty { font-size:12px; margin:6px 0 0; }
@container (max-width:440px) {
  .dense-summary[data-compact] .dense-word, .dense-summary[data-compact] .dense-short { display:none; }
}
@container (max-width:360px) {
  .dense-summary { gap:4px; font-size:10px; }
  .dense-word { display:none; }
  .dense-short { display:inline; }
}
@container (max-width:275px) {
  .dense-card { padding:7px; }
  .dense-summary { gap:2px; }
  .dense-summary > :is([data-tone=high],[data-tone=low],[data-tone=issue],[data-tone=unavailable]) { padding-inline:3px; }
  .dense-short { display:none; }
  .dense-number { gap:1px; }
  .dense-mark { min-inline-size:10px; }
}
.dense-summary[data-fit=tight] { gap:1px; font-size:10px; }
/* Keep all counts in the final compact row even when a theme widens tracking. */
.dense-summary[data-fit=tight] > span { letter-spacing:normal; }
.dense-summary[data-fit=tight] > :is([data-tone=high],[data-tone=low],[data-tone=issue],[data-tone=unavailable]) { padding-inline:1px; }
`;

const DENSE_LEGEND = [
  ['high', '↑', '過高', '過高'], ['low', '↓', '過低', '過低'], ['unavailable', '!', '無讀值', '無值'],
  ['issue', '⚠', '門檻異常', '門檻'], ['normal', '✓', '正常', '正常'], ['unset', '–', '未設門檻', '未設'],
];
const denseSymbols = new Map(DENSE_LEGEND.map(([key, mark]) => [key, mark]));
const denseTone = flag => denseSymbols.has(flag) ? flag : 'issue';
const isAbnormal = flag => flag !== 'normal' && flag !== 'unset';
const scientific = new Intl.NumberFormat(undefined, { notation: 'scientific', maximumSignificantDigits: 15 });
// Don't fall back to IDs, or echo sensor/threshold IDs supplied as display metadata.
const publicLabel = (label, fallback = '') => typeof label === 'string'
  ? label.replace(/\b(?:sensor|number|input_number|counter)\.[a-z_0-9]+\b/gi, '').trim() || fallback : fallback;
const setAttr = (node, key, value) => { if (node.getAttribute(key) !== value) node.setAttribute(key, value); };
const hide = (node, value) => { if (node.hidden !== value) node.hidden = value; };
// Only validated display/threshold fields participate; live readings are not identity.
const denseItemKey = ({ entity, section, kind, name, unit, below, above }) =>
  JSON.stringify([entity, section, kind, name, unit, below, above]);

// Reorder only changed children. Equivalent HA echoes never detach a focused tile.
function reconcileChildren(parent, nodes) {
  const wanted = new Set(nodes);
  for (const node of [...parent.childNodes]) if (!wanted.has(node)) node.remove();
  let current = parent.firstChild;
  for (const node of nodes) {
    if (current === node) current = current.nextSibling;
    else parent.insertBefore(node, current);
  }
}

class DenseDisplay {
  constructor(root, filter) {
    this.root = root;
    this.filter = filter;
    this.sections = new Map();
    this.rows = [];
    this.summary = dom('div', 'dense-summary');
    this.summary.setAttribute('role', 'status');
    this.badges = DENSE_LEGEND.map(([tone, mark, label, short]) => {
      const el = dom('span', '', mark);
      el.dataset.tone = tone;
      el.setAttribute('role', 'img');
      const count = dom('span');
      el.append(dom('span', 'dense-word', ` ${label}`), dom('span', 'dense-short', ` ${short}`), count);
      return { el, tone, label, count };
    });
    this.total = dom('span');
    this.summary.append(...this.badges.map(b => b.el), this.total);
    this.summaryFrame = null;
    this.summaryObserver = new ResizeObserver(() => {
      if (this.summaryFrame !== null) return;
      // Fitting changes the observed badge widths; do not write inside observer delivery.
      this.summaryFrame = requestAnimationFrame(() => {
        this.summaryFrame = null;
        this.fitSummary();
      });
    });
    this.content = dom('div');
    this.empty = dom('p', 'dense-empty');
    this.detail = dom('div', 'dense-detail');
    this.detail.id = 'dense-detail';
    this.detail.setAttribute('aria-live', 'polite');
    this.detailTitle = dom('strong');
    this.detailBody = dom('span');
    this.detail.append(this.detailTitle, this.detailBody);
    this.nodes = [this.summary, this.content, this.empty, this.detail];
  }

  observeSummary() {
    if (!this.summary.isConnected) return;
    // Badge widths also change when an inherited theme font loads or counts change.
    for (const node of [this.summary, ...this.summary.children]) this.summaryObserver.observe(node);
  }

  stopObservingSummary() {
    this.summaryObserver.disconnect();
    if (this.summaryFrame !== null) cancelAnimationFrame(this.summaryFrame);
    this.summaryFrame = null;
  }

  fitSummary() {
    const row = this.summary;
    if (!row.isConnected) return;
    const { left, right, width } = row.getBoundingClientRect();
    if (!width) return;
    // The total is the last nonshrinking item, so it defines the end of the row.
    const fits = () => {
      const total = this.total.getBoundingClientRect();
      return total.left >= left - .01 && total.right <= right + .01;
    };
    row.removeAttribute('data-fit');
    if (fits()) return;
    for (const mode of ['short', 'marks', 'tight']) {
      setAttr(row, 'data-fit', mode);
      if (fits()) return;
    }
  }

  createRow() {
    const tile = dom('button', 'dense-tile');
    tile.type = 'button';
    tile.setAttribute('aria-controls', this.detail.id);
    const label = dom('span', 'dense-label');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    svg.append(path);
    const name = dom('span', 'dense-name');
    label.append(svg, name);
    const reading = dom('span', 'dense-reading');
    const mark = dom('span', 'dense-mark');
    mark.setAttribute('aria-hidden', 'true');
    const numeric = dom('span', 'dense-number');
    const value = dom('span');
    const unit = dom('small');
    numeric.append(value, unit);
    reading.append(mark, numeric);
    tile.append(label, reading);
    const row = { tile, path, name, reading, mark, value, unit };
    tile.onclick = () => {
      if (!tile.hidden && tile.isConnected) this.showDetail(this.open === row ? undefined : row);
    };
    return row;
  }

  createSection() {
    const node = dom('section', 'dense-section');
    const heading = dom('h3');
    const title = dom('span', 'dense-section-title');
    const count = dom('span', 'dense-count');
    heading.append(title, count);
    const grid = dom('div', 'dense-grid');
    const empty = dom('p', 'dense-empty');
    node.append(heading, grid, empty);
    return { node, title, count, grid, empty, rows: [] };
  }

  matchRows(items) {
    // An unchanged ordered list preserves positions, even for identical duplicates.
    if (sameConfigData(items, this.rows.map(row => row.item))) return this.rows;

    // For a changed list, a match must be unique on both sides.
    const previous = new Map();
    for (const row of this.rows) previous.set(row.key, previous.has(row.key) ? null : row);
    const keys = items.map(denseItemKey);
    const counts = new Map();
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    return keys.map(key => {
      const row = (counts.get(key) === 1 ? previous.get(key) : null) ?? this.createRow();
      row.key = key;
      return row;
    });
  }

  reconcileInactiveSelection(previousItems, items) {
    if (!this.open || sameConfigData(previousItems, items)) return;
    // Check each config transition without updating the detached dense body.
    const matchesOpen = item => denseItemKey(item) === this.open.key;
    if (previousItems.filter(matchesOpen).length !== 1 || items.filter(matchesOpen).length !== 1) {
      this.open = undefined;
    }
  }

  pruneInactiveSelection(states, onlyIssues) {
    if (onlyIssues && this.open && !isAbnormal(evaluate(this.open.item, states).flag)) this.open = undefined;
  }

  updateConfig(config, items, states, onlyIssues) {
    const active = this.root.activeElement;
    const sections = new Map();
    for (const section of config.sections ?? []) {
      const view = this.sections.get(section.id) ?? this.createSection();
      text(view.title, publicLabel(sectionTitle(section), '未命名段落'));
      view.rows = [];
      sections.set(section.id, view);
    }
    this.rows = this.matchRows(items);
    this.rows.forEach((row, index) => {
      const item = items[index];
      let section = sections.get(item.section);
      if (!section) {
        section = sections.get(null);
        if (!section) {
          section = this.sections.get(null) ?? this.createSection();
          text(section.title, '未分組');
          section.rows = [];
          sections.set(null, section);
        }
      }
      row.item = { ...item };
      row.section = section;
      section.rows.push(row);
    });
    if (!this.rows.includes(this.open)) this.open = undefined;
    this.sections = sections;
    reconcileChildren(this.content, [...sections.values()].map(section => section.node));
    for (const section of sections.values()) reconcileChildren(section.grid, section.rows.map(row => row.tile));
    this.update(states, onlyIssues);
    if (active?.classList.contains('dense-tile') && this.root.activeElement !== active) {
      const target = active.isConnected && !active.closest('[hidden]') ? active : this.filter;
      target.focus({ preventScroll: true });
    }
  }

  update(states, onlyIssues) {
    const counts = new Map();
    for (const row of this.rows) {
      const { item, tile, path, name, mark, value, unit } = row;
      const state = states?.[item.entity];
      const { flag, reading, bounds } = evaluate(item, states);
      const tone = denseTone(flag);
      const unitText = publicLabel(reading.unit);
      const formatted = reading.value === undefined ? '—' : format.format(reading.value);
      const numeric = formatted.length > 23 ? scientific.format(reading.value) : formatted;
      const label = publicLabel(item.name) || publicLabel(state?.attributes?.friendly_name, '感測器');
      row.flag = flag;

      row.bounds = publicLabel(bounds);
      counts.set(tone, (counts.get(tone) ?? 0) + 1);
      setAttr(tile, 'data-tone', tone);
      setAttr(tile, 'data-state', flag);
      setAttr(path, 'd', KINDS.get(item.kind ?? DEVICE_KINDS.get(deviceClassOf(state)) ?? 'custom')[1]);
      text(name, label);
      text(mark, denseSymbols.get(tone));
      text(value, numeric);
      text(unit, unitText);
      hide(unit, !unitText);
      setAttr(tile, 'aria-label', `${row.section.title.textContent}・${label}，${numeric}${unitText ? ` ${unitText}` : ''}，${STATUS[flag]}`);
    }
    this.summary.toggleAttribute('data-compact', counts.size === this.badges.length || this.rows.length > 99);
    for (const { el, tone, label, count } of this.badges) {
      const n = counts.get(tone) ?? 0;
      hide(el, !n);
      setAttr(el, 'aria-label', `${label} ${n}`);
      setAttr(el, 'title', `${label} ${n}`);
      text(count, ` ${n}`);
    }
    text(this.total, `共 ${this.rows.length} 項`);
    this.updateVisibility(onlyIssues);
  }

  updateVisibility(onlyIssues) {
    const active = this.root.activeElement;
    let any = false;
    const layouts = [];
    for (const { node, rows, grid, count, empty } of this.sections.values()) {
      const shown = onlyIssues ? rows.filter(row => isAbnormal(row.flag)) : rows;
      const visible = new Set(shown);
      hide(node, onlyIssues && !shown.length);
      hide(grid, !shown.length);
      hide(empty, Boolean(shown.length));
      text(empty, shown.length ? '' : '尚未加入監測項目');
      text(count, `${shown.length}${onlyIssues ? ` / ${rows.length}` : ''} 項`);
      for (const row of rows) hide(row.tile, !visible.has(row));
      layouts.push({ grid, shown });
      any ||= !node.hidden;
    }
    // Read all intrinsic widths before applying grid changes; no observer, timer or resize loop.
    const widths = layouts.map(({ shown }) => shown.map(row => row.reading.getBoundingClientRect().width > 55));
    layouts.forEach(({ grid, shown }, index) => {
      shown.forEach((row, i) => row.tile.toggleAttribute('data-wide', widths[index][i]));
      grid.toggleAttribute('data-wide', widths[index].some(Boolean));
    });
    hide(this.empty, any);
    text(this.empty, onlyIssues ? '目前沒有異常' : '尚未新增段落');
    this.showDetail(this.open?.tile.hidden ? undefined : this.open);
    if (active?.classList.contains('dense-tile') && active.hidden) this.filter.focus({ preventScroll: true });
  }

  showDetail(row) {
    this.open = row;
    for (const { tile } of this.rows) setAttr(tile, 'aria-expanded', String(tile === row?.tile));
    hide(this.detail, !row);
    text(this.detailTitle, row ? `${row.section.title.textContent}・${row.name.textContent}｜${STATUS[row.flag]}` : '');
    text(this.detailBody, row ? row.bounds || '未設定上下限' : '');
  }
}

class EnvironmentThresholdCard extends HTMLElement {
  static getStubConfig() { return { items: [] }; }
  static getConfigElement() { return dom(`${TAG}-editor`); }

  constructor() {
    super();
    const panel = dom('ha-card', 'standard-card');
    this.panel = panel;
    this.titleNode = dom('h2');
    this.head = dom('div', 'card-head');
    const actions = dom('div', 'card-actions');
    this.filter = dom('button', 'card-toggle', '只看異常');
    this.density = dom('button', 'card-toggle', '密集模式');
    this.onlyIssues = false;
    for (const button of [this.filter, this.density]) {
      button.type = 'button';
      button.setAttribute('aria-pressed', 'false');
    }
    this.density.onclick = () => {
      if (!this.isConnected || !this.config) return;
      this.viewDense = !this.viewDense;
      this.updateView();
    };
    this.filter.onclick = () => {
      if (!this.isConnected || !this.config) return;
      this.onlyIssues = !this.onlyIssues;
      setAttr(this.filter, 'aria-pressed', String(this.onlyIssues));
      if (this.viewDense) this.dense.updateVisibility(this.onlyIssues);
      else this.updateStandardVisibility();
    };
    actions.append(this.filter, this.density);
    this.head.append(this.titleNode, actions);
    this.summary = dom('p', 'summary');
    this.summary.setAttribute('role', 'status');
    this.grid = dom('div', 'grid');
    this.empty = dom('p', 'standard-section-empty', '目前沒有異常');
    this.empty.hidden = true;
    this.standardSections = new Map();
    panel.append(this.head, this.summary, this.grid, this.empty);
    this.shell = dom('div');
    this.shell.append(panel);
    this.attachShadow({ mode: 'open' }).append(style(CARD_CSS), style(DENSE_CSS), this.shell);
  }

  connectedCallback() {
    if (this.viewDense) {
      this.dense.update(this.states, this.onlyIssues);
      this.dense.observeSummary();
    }
  }

  disconnectedCallback() {
    this.dense?.stopObservingSummary();
  }

  setConfig(config) {
    const items = validate(config);
    const savedDense = denseMode(config);
    const wasDense = this.viewDense;
    // Only a new saved default, not a Lovelace config echo, overrides the local view.
    if (savedDense !== this.savedDense) this.viewDense = savedDense;
    this.savedDense = savedDense;
    if (!wasDense || !this.viewDense) this.dense?.reconcileInactiveSelection(this.items, items);
    this.config = { title: config?.title, sections: config?.sections?.map(({ id, title }) => ({ id, title })) };
    this.items = items.map(item => ({ ...item }));
    this.updateView();
  }

  updateView() {
    const { config, items, viewDense, onlyIssues } = this;
    const active = this.shadowRoot.activeElement;
    this.panel.classList.toggle('dense-card', viewDense);
    this.panel.classList.toggle('standard-card', !viewDense);
    this.shell.classList.toggle('dense-shell', viewDense);
    setAttr(this.density, 'aria-pressed', String(viewDense));
    if (viewDense) {
      if (!this.dense) this.dense = new DenseDisplay(this.shadowRoot, this.filter);
      text(this.titleNode, publicLabel(config.title, DEFAULT_TITLE));
      // Legacy labels can contain entity IDs; only mount the active body.
      reconcileChildren(this.panel, [this.head, ...this.dense.nodes]);
      this.updateTheme();
      this.dense.updateConfig(config, items, this.states, onlyIssues);
      this.dense.observeSummary();
      return;
    }
    this.dense?.stopObservingSummary();
    if (!sameConfigData(items, this.rows?.map(row => row.item))) {
      this.rows = items.map(item => ({ ...tileNodes(), item: { ...item } }));
    }
    this.updateStandardSections(config?.sections ?? []);
    text(this.titleNode, customTitle(config?.title) || DEFAULT_TITLE);
    this.updateStates();
    if (active?.classList.contains('dense-tile')) this.density.focus({ preventScroll: true });
  }

  set hass(hass) {
    this.states = hass?.states;
    this.darkMode = hass?.themes?.darkMode;
    if (this.viewDense) {
      this.updateTheme();
      this.dense.update(this.states, this.onlyIssues);
    } else this.updateStates();
  }

  updateTheme() {
    if (typeof this.darkMode === 'boolean') setAttr(this.panel, 'data-theme', this.darkMode ? 'dark' : 'light');
    else this.panel.removeAttribute('data-theme');
  }

  getGridOptions() { return { columns: 12, min_columns: 3 }; }
  getCardSize() {
    if (this.viewDense) return 1 + [...this.dense.sections.values()]
      .reduce((height, section) => height + Math.max(1, Math.ceil(section.rows.length / 4)), 0);
    if (this.standardSections.size) return 1 + [...this.standardSections.values()]
      .reduce((height, section) => height + 1 + (section.grid.childElementCount ? 2 * Math.ceil(section.grid.childElementCount / 2) : 1), 0);
    return 1 + Math.max(1, Math.ceil((this.rows?.length ?? 0) / 2)) * 2;
  }

  updateStandardSections(sections) {
    if (!sections.length) {
      this.standardSections.clear();
      reconcileChildren(this.grid, this.rows.map(row => row.tile));
      reconcileChildren(this.panel, [this.head, this.summary, this.grid, this.empty]);
      return;
    }
    const views = new Map();
    const add = (id, label) => {
      const view = this.standardSections.get(id) ?? standardSectionNodes();
      text(view.title, label);
      const tiles = [];
      views.set(id, { ...view, tiles });
      return tiles;
    };
    for (const section of sections) add(section.id, sectionTitle(section));
    for (const { item, tile } of this.rows) {
      const tiles = views.get(item.section)?.tiles ?? views.get(null)?.tiles ?? add(null, '未分組');
      tiles.push(tile);
    }
    this.standardSections = views;
    reconcileChildren(this.panel, [this.head, this.summary, ...[...views.values()].map(view => view.node), this.empty]);
    for (const { grid, tiles } of views.values()) reconcileChildren(grid, tiles);
  }

  updateStandardVisibility() {
    this.dense?.pruneInactiveSelection(this.states, this.onlyIssues);
    let any = false;
    for (const { tile } of this.rows) {
      const shown = !this.onlyIssues || isAbnormal(tile.dataset.state);
      hide(tile, !shown);
      any ||= shown;
    }
    for (const { node, count, grid, empty, tiles } of this.standardSections.values()) {
      const shown = tiles.filter(tile => !tile.hidden).length;
      hide(node, this.onlyIssues && !shown);
      hide(grid, !shown);
      hide(empty, Boolean(shown));
      text(count, `${shown}${this.onlyIssues ? ` / ${tiles.length}` : ''} 項`);
    }
    hide(this.empty, !this.onlyIssues || any);
  }

  updateStates() {
    if (!this.rows) return;
    const counts = new Map();
    for (const { item, tile, path, name, value, unitNode, status, bounds } of this.rows) {
      const state = this.states?.[item.entity];
      const { flag, reading, bounds: configured } = evaluate(item, this.states);
      counts.set(flag, (counts.get(flag) ?? 0) + 1);
      const kind = item.kind ?? DEVICE_KINDS.get(state?.attributes?.device_class) ?? 'custom';
      const shape = KINDS.get(kind)[1];
      if (path.getAttribute('d') !== shape) path.setAttribute('d', shape);
      if (tile.dataset.state !== flag) tile.dataset.state = flag;
      text(name, nameOf(item, this.states));
      text(value, reading.value === undefined ? '—' : format.format(reading.value));
      text(unitNode, reading.unit);
      text(status, STATUS[flag]);
      if (bounds.hidden === Boolean(configured)) bounds.hidden = !configured;
      text(bounds, configured);
    }
    const notices = ['high', 'low', 'unavailable', 'unit', 'source', 'source-unit', 'range', 'unset']
      .flatMap(key => counts.has(key) ? [`${counts.get(key)} 項${{ high: '過高', low: '過低' }[key] ?? STATUS[key]}`] : []);
    const tone = counts.has('high') || counts.has('low') ? 'alarm' : notices.length ? 'warning' : 'normal';
    if (this.summary.dataset.tone !== tone) this.summary.dataset.tone = tone;
    text(this.summary, !this.rows.length ? '請在卡片編輯器新增監測項目。' : notices.join(' · ') || '所有監測皆在範圍內');
    this.updateStandardVisibility();
  }
}

const EDITOR_CSS = `
:host { display:block; min-inline-size:0; container-type:inline-size; }
[hidden] { display:none !important; }
section { min-inline-size:0; }
.appearance { padding-block-end:10px; border-block-end:1px solid var(--divider-color,#d9e3ea); }
.monitoring, .thresholds { padding-block-start:10px; }
.thresholds { margin-block-start:10px; border-block-start:1px solid var(--divider-color,#d9e3ea); }
h3 { margin:0 0 6px; font-size:1em; }
.list,.actions { display:flex; flex-wrap:wrap; gap:8px; margin-block:8px; }
.list [aria-pressed=true] { border-color:var(--primary-color,#1976d2); font-weight:700; }
.fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
label { display:grid; gap:4px; min-width:0; }
.bound { display:grid; grid-template-columns:minmax(0,.38fr) minmax(0,.8fr) minmax(0,1.3fr); align-items:end; gap:6px; margin-block:8px; }
.bound strong { align-self:center; }
.source-detail,.unit-note { margin:0; font-size:.86em; color:var(--secondary-text-color,#4d5965); overflow-wrap:anywhere; }
.source-detail { grid-column:1/-1; }
ha-selector { display:block; width:100%; min-width:0; min-height:44px; }
.full { grid-column:1/-1; }
@container (max-width:355px) {
  .bound { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .bound strong { grid-column:1/-1; }
}
@container (max-width:275px) {
  .fields,.bound { grid-template-columns:minmax(0,1fr); }
}
button,input,select { box-sizing:border-box; min-height:44px; font:inherit; color:inherit; background:var(--card-background-color,#fff); border:1px solid var(--divider-color,#a0aab2); border-radius:8px; padding:6px 9px; }
input,select { width:100%; min-width:0; }
button { cursor:pointer; max-width:100%; overflow-wrap:anywhere; }
button:focus-visible,input:focus-visible,select:focus-visible { outline:2px solid var(--primary-color,#1976d2); outline-offset:2px; }
.dense-option { display:flex; align-items:center; gap:7px; min-height:44px; }
.dense-option input { width:auto; min-height:0; }
.section-edit { margin-block-start:8px; }
.section-edit-row { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:end; gap:6px; margin-block-end:6px; }
@container (max-width:275px) { .section-edit-row { grid-template-columns:minmax(0,1fr); } }
.primary { background:var(--primary-color,#17668a); color:var(--text-primary-color,#fff); }
[role=alert] { border-inline-start:3px solid var(--error-color,#bf3428); padding-inline-start:7px; }
`;

class EnvironmentThresholdEditor extends HTMLElement {
  constructor() {
    super();
    this.titleInput = dom('input');
    this.titleInput.placeholder = `留空：${DEFAULT_TITLE}`;
    this.titleInput.addEventListener('input', () => {
      if (!this.config) return;
      const title = customTitle(this.titleInput.value);
      if (title === customTitle(this.config.title)) return;
      this.config = { ...this.config, type: `custom:${TAG}` };
      if (title) this.config.title = title;
      else delete this.config.title;
      this.emitConfig();
    });
    const appearance = dom('section', 'appearance');
    this.density = dom('input');
    this.density.type = 'checkbox';
    this.density.addEventListener('change', () => {
      if (!this.config) return;
      const config = { ...this.config, type: `custom:${TAG}` };
      if (this.density.checked) config.display_mode = 'dense';
      else delete config.display_mode;
      this.config = config;
      this.syncSections();
      this.emitConfig();
    });
    this.sectionControls = this.createSectionControls();
    appearance.append(dom('h3', '', '卡片外觀'), this.field('卡片標題', this.titleInput),
      this.field('密集模式', this.density, 'dense-option'), this.sectionControls);
    const monitoring = dom('section', 'monitoring');
    this.list = dom('div', 'list');
    this.form = dom('form');
    this.form.tabIndex = -1;
    this.addButton = this.button('新增監測項目', () => this.openItem());
    this.fields = dom('div', 'fields');
    this.thresholds = dom('section', 'thresholds');
    this.actions = dom('div');
    this.form.append(this.fields, this.thresholds, this.actions);
    monitoring.append(dom('h3', '', '監測項目'), this.list, this.addButton, this.form);
    this.attachShadow({ mode: 'open' }).append(style(EDITOR_CSS), appearance, monitoring);
  }

  setConfig(config) {
    const next = { ...config, items: validate(config) };
    const title = customTitle(next.title);
    if (customTitle(this.titleInput.value) !== title) this.titleInput.value = title;
    const itemsChanged = !sameConfigData(next.items, this.config?.items);
    this.config = next;
    if (itemsChanged) this.closeItem();
    this.syncSections();
  }

  createSectionControls() {
    const controls = dom('div', 'section-edit');
    this.sectionSelect = dom('select');
    this.sectionSelect.setAttribute('aria-label', '選擇段落');
    this.sectionSelect.addEventListener('change', () => {
      this.selectedSection = this.sectionSelect.value;
      this.syncSections();
    });
    this.addSectionButton = this.button('新增段落', () => {
      if (!this.config) return;
      const sections = this.config.sections ?? [];
      const used = new Set([...sections.map(section => section.id), ...this.config.items.map(item => item.section)]);
      let n = 1;
      while (used.has(`section-${n}`)) n++;
      this.selectedSection = `section-${n}`;
      this.commitSections([...sections, { id: this.selectedSection, title: '新段落' }]);
      this.sectionTitleInput.focus();
      this.sectionTitleInput.select();
    });
    this.sectionTitleInput = dom('input');
    this.sectionTitleInput.placeholder = '未命名段落';
    this.sectionTitleInput.addEventListener('input', () => {
      if (!this.config) return;
      const sections = this.config.sections ?? [];
      const selected = sections.find(section => section.id === this.selectedSection);
      if (!selected || this.sectionTitleInput.value === selected.title) return;
      this.commitSections(sections.map(section => section === selected ? { ...section, title: this.sectionTitleInput.value } : section));
    });
    const remove = this.button('移除段落', () => {
      if (!this.config) return;
      const sections = this.config.sections ?? [];
      const index = sections.findIndex(section => section.id === this.selectedSection);
      if (index < 0) return;
      const removed = sections[index].id;
      const next = sections.filter(section => section.id !== removed);
      this.selectedSection = next[Math.min(index, next.length - 1)]?.id;
      const items = this.config.items.map(item => {
        if (item.section !== removed) return item;
        const { section, ...unassigned } = item;
        return unassigned;
      });
      this.commitSections(next, items);
      (next.length ? this.sectionSelect : this.addSectionButton).focus();
    });
    const tools = dom('div', 'section-edit-row');
    const fields = dom('div', 'section-edit-row');
    tools.append(this.field('選擇段落', this.sectionSelect), this.addSectionButton);
    fields.append(this.field('段落標題', this.sectionTitleInput), remove);
    this.sectionFields = fields;
    controls.append(tools, fields, dom('p', 'unit-note', '移除段落會將其中的監測項目移到「未分組」，不會刪除項目或門檻。可在各監測項目設定所屬段落。'));
    controls.hidden = true;
    return controls;
  }

  syncSections() {
    if (!this.config) return;
    const sections = this.config.sections ?? [];
    this.density.checked = denseMode(this.config);
    hide(this.sectionControls, false);
    const selected = sections.find(section => section.id === this.selectedSection) ?? sections[0];
    this.selectedSection = selected?.id;
    this.setSectionOptions(this.sectionSelect, sections, this.selectedSection);
    this.sectionSelect.disabled = !selected;
    hide(this.sectionFields, !selected);
    if (this.sectionTitleInput.value !== (selected?.title ?? '')) this.sectionTitleInput.value = selected?.title ?? '';
    this.updateAssignment?.(sections);
  }

  setSectionOptions(select, sections, value, unassigned = false) {
    const options = new Map([...select.options].map(option => [option.value, option]));
    const entries = sections.map(section => [section.id, sectionTitle(section)]);
    if (unassigned) entries.unshift(['', '未分組']);
    reconcileChildren(select, entries.map(([id, label]) => {
      const option = options.get(id) ?? new Option('', id);
      text(option, label);
      return option;
    }));
    if (select.value !== (value ?? '')) select.value = value ?? '';
  }

  commitSections(sections, items = this.config.items) {
    this.config = { ...this.config, type: `custom:${TAG}`, sections, items };
    this.syncSections();
    this.emitConfig();
  }

  set hass(hass) {
    this._hass = hass;
    this.states = hass?.states;
    const pickers = this.form.querySelectorAll('ha-selector');
    const sources = this.form.querySelectorAll('ha-selector[data-bound]');
    if (sources.length) {
      const selector = this.thresholdSelector();
      for (const picker of sources) if (picker.selector !== selector) picker.selector = selector;
    }
    for (const picker of pickers) picker.hass = hass;
    this.updateSourceDetails?.();
  }

  button(label, handler) {
    const button = dom('button', '', label);
    button.type = 'button';
    button.addEventListener('click', handler);
    return button;
  }

  field(label, node, cls) {
    const wrapper = dom('label', cls);
    wrapper.append(dom('span', '', label), node);
    return wrapper;
  }

  thresholdSelector() {
    // HA offers Create Helper for domain-only filters. This editor only reads existing entities.
    const ids = [...new Set([
      ...Object.keys(this.states ?? {}), ...Object.keys(this._hass?.entities ?? {}),
    ].filter(id => THRESHOLD_ID.test(id)))];
    const previous = this._sourceSelector?.entity.include_entities;
    if (!previous || previous.length !== ids.length || previous.some((id, i) => id !== ids[i])) {
      this._sourceSelector = { entity: { filter: THRESHOLD_FILTER, include_entities: ids } };
    }
    return this._sourceSelector;
  }

  entityPicker(label, selector, idPattern, getValue, required, onChange) {
    const picker = dom('ha-selector');
    Object.assign(picker, { selector, label, value: getValue(), required, hass: this._hass });
    picker.addEventListener('value-changed', event => {
      event.stopPropagation();
      if (!picker.isConnected || !this.form.contains(picker) ||
          !event.detail || !Object.hasOwn(event.detail, 'value')) return;
      const next = event.detail.value;
      const cleared = next == null || next === '';
      if (!picker.hidden && (cleared || (typeof next === 'string' && idPattern.test(next)))) {
        const id = cleared ? undefined : next;
        if (id !== getValue()) onChange(id);
      } else {
        // The native child sets its own value before firing. The wrapper may already hold
        // the retained value, so assigning only .value on the wrapper need not roll it back.
        const origin = event.composedPath()[0];
        if (origin?.localName === 'ha-entity-picker') origin.value = getValue();
      }
      picker.value = getValue();
    });
    return picker;
  }

  boundField(key, title, initialValue, selector) {
    const node = dom('div', 'bound');
    const mode = dom('select');
    mode.setAttribute('aria-label', `${title}來源`);
    mode.append(new Option('不設定', 'none'), new Option('手動數值', 'manual'), new Option('實體來源', 'entity'));
    const input = dom('input');
    input.type = 'number';
    input.step = 'any';
    input.setAttribute('aria-label', title);
    input.placeholder = '留空＝不判斷';
    let source = typeof initialValue === 'string' ? initialValue : undefined;
    input.value = typeof initialValue === 'number' ? initialValue : '';
    mode.value = source ? 'entity' : typeof initialValue === 'number' ? 'manual' : 'none';
    const picker = this.entityPicker(`${title}實體`, selector, THRESHOLD_ID, () => source, false, id => {
      source = id;
      this.updateSourceDetails?.();
    });
    picker.dataset.bound = key;
    const manual = this.field('數值', input);
    const detail = dom('p', 'source-detail');
    const sync = () => {
      picker.hidden = mode.value !== 'entity';
      manual.hidden = input.disabled = mode.value !== 'manual';
      this.updateSourceDetails?.();
    };
    mode.addEventListener('change', sync);
    node.append(dom('strong', '', title), this.field('來源', mode), manual, picker, detail);
    sync();
    return {
      node,
      value: () => mode.value === 'entity' ? source : mode.value === 'manual' && input.value !== '' ? input.valueAsNumber : undefined,
      updateDetail: (unit, deviceClass) => {
        const label = mode.value === 'entity' && source ? resolveBound(source, this.states, unit, deviceClass).label : '';
        detail.hidden = !label;
        text(detail, label);
      },
      reset: () => {
        source = picker.value = undefined;
        input.value = '';
        mode.value = 'none';
        sync();
      },
    };
  }

  closeItem(returnTo) {
    for (const region of [this.fields, this.thresholds, this.actions]) {
      region.hidden = true;
      region.replaceChildren();
    }
    this.form.onsubmit = null;
    this.updateSourceDetails = undefined;
    this.updateAssignment = undefined;
    this.addButton.hidden = false;
    this.list.replaceChildren(...this.config.items.map((item, index) => {
      const button = this.button(nameOf(item, this.states), () => this.openItem(index));
      button.setAttribute('aria-pressed', 'false');
      return button;
    }));
    if (returnTo !== undefined) (this.list.children[returnTo] ?? this.addButton).focus();
  }

  openItem(index) {
    this.updateSourceDetails = undefined;
    const item = this.config.items[index];
    let selectedEntity = item?.entity;
    const kind = dom('select');
    for (const [key, [label]] of KINDS) kind.append(new Option(label, key));
    const suggested = id => DEVICE_KINDS.get(this.states?.[id]?.attributes?.device_class) ?? 'custom';
    const initialKind = item?.kind ?? suggested(selectedEntity);
    kind.value = initialKind;
    const label = dom('input');
    label.value = item?.name ?? '';
    const assignment = dom('select');
    assignment.setAttribute('aria-label', '所屬段落');
    const assignmentField = this.field('所屬段落', assignment, 'full');
    let draftedSection = item?.section;
    let previousSections = new Set();
    assignment.addEventListener('change', () => {
      if (this.fields.contains(assignment) &&
          (!assignment.value || previousSections.has(assignment.value))) draftedSection = assignment.value || undefined;
    });
    this.updateAssignment = sections => {
      const available = new Set(sections.map(section => section.id));
      if (previousSections.has(draftedSection) && !available.has(draftedSection)) draftedSection = undefined;
      previousSections = available;
      this.setSectionOptions(assignment, sections, available.has(draftedSection) ? draftedSection : undefined, true);
    };
    this.updateAssignment(this.config.sections ?? []);
    const selector = this.thresholdSelector();
    const below = this.boundField('below', '下限', item?.below, selector);
    const above = this.boundField('above', '上限', item?.above, selector);
    const note = dom('p', 'unit-note');
    const error = dom('p');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const currentState = () => this.states?.[selectedEntity];
    const currentUnit = () => {
      const state = currentState();
      return state ? normalizeUnit(unitOf(state), deviceClassOf(state)) : undefined;
    };
    let draftUnit = currentUnit();
    const consent = dom('input');
    consent.type = 'checkbox';
    consent.style.width = 'auto';
    consent.style.minHeight = 'auto';
    const consentField = this.field('已確認門檻使用目前單位', consent);
    const needsConsent = () => item?.unit != null && item.entity === selectedEntity && hasBounds(item) && draftUnit !== undefined && normalizeUnit(item.unit, deviceClassOf(currentState())) !== draftUnit;
    const updateNote = () => {
      consentField.hidden = !needsConsent();
      text(note, needsConsent()
        ? `門檻原單位：${item.unit || '無'}；目前單位：${draftUnit || '無'}。請重新換算門檻。`
        : `門檻單位：${draftUnit || '未提供'}（依實體單位）`);
    };
    const entity = this.entityPicker('感測器實體', MONITORED_SELECTOR, ENTITY_ID, () => selectedEntity, true, id => {
      selectedEntity = id;
      draftUnit = currentUnit();
      consent.checked = false;
      below.reset();
      above.reset();
      kind.value = suggested(id);
      error.hidden = true;
      updateNote();
      this.updateSourceDetails();
    });
    entity.classList.add('full');
    this.updateSourceDetails = () => {
      const deviceClass = deviceClassOf(currentState());
      // Provenance follows card evaluation; draftUnit still guards what Apply can save.
      const savedUnit = selectedEntity === item?.entity ? item?.unit : undefined;
      const unit = evaluationUnit(savedUnit, currentUnit(), deviceClass);
      for (const bound of [below, above]) bound.updateDetail(unit, deviceClass);
    };
    this.updateSourceDetails();
    updateNote();
    this.fields.replaceChildren(entity, this.field('顯示名稱（選填）', label), this.field('感測類型', kind), assignmentField);
    const buttons = dom('div', 'actions');
    const apply = dom('button', 'primary', '套用項目');
    apply.type = 'submit';
    const focusIndex = index ?? this.config.items.length;
    buttons.append(apply, this.button('取消', () => this.closeItem(focusIndex)));
    if (item) buttons.append(this.button('移除項目', () => this.commit(this.config.items.filter((_, i) => i !== index), index)));
    this.thresholds.replaceChildren(dom('h3', '', '門檻設定'), note, below.node, above.node, consentField);
    this.actions.replaceChildren(error, buttons);
    this.form.onsubmit = event => {
      event.preventDefault();
      const showError = message => { text(error, message); error.hidden = false; };
      const updated = { entity: selectedEntity, kind: kind.value };
      if (label.value.trim()) updated.name = label.value.trim();
      const lower = below.value();
      const upper = above.value();
      const items = this.config.items.slice();
      const saved = items[focusIndex];
      if (saved && saved.section !== draftedSection && selectedEntity === saved.entity && kind.value === initialKind &&
          label.value.trim() === (saved.name ?? '').trim() && lower === (saved.below ?? undefined) && upper === (saved.above ?? undefined)) {
        // Moving an existing item is not a threshold edit; retain the exact YAML and its unit binding.
        const { section, ...unchanged } = saved;
        items[focusIndex] = draftedSection === undefined ? unchanged : { ...unchanged, section: draftedSection };
        this.commit(items, focusIndex);
        return;
      }
      if (draftedSection !== undefined) updated.section = draftedSection;
      if (lower !== undefined) updated.below = lower;
      if (upper !== undefined) updated.above = upper;
      if (hasBounds(updated)) {
        if (draftUnit !== currentUnit()) {
          showError('感測器單位已變更，請取消後重新開啟項目。');
          return;
        }
        if (needsConsent() && !consent.checked) {
          showError('請先確認門檻使用目前單位。');
          return;
        }
        if (draftUnit !== undefined) updated.unit = draftUnit;
        else if (item?.entity === updated.entity && item.unit != null) updated.unit = item.unit;
        else {
          showError('無法確認感測器單位。請清除門檻，或等感測器出現後重新開啟項目。');
          return;
        }
      }
      items[focusIndex] = updated;
      try { validate({ items }); }
      catch (e) { showError(e.message); return; }
      this.commit(items, focusIndex);
    };
    for (const region of [this.fields, this.thresholds, this.actions]) region.hidden = false;
    [...this.list.children].forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    this.addButton.hidden = true;
    this.form.focus();
  }

  commit(items, focusIndex) {
    this.config = { ...this.config, type: `custom:${TAG}`, items };
    this.closeItem(focusIndex);
    this.emitConfig();
  }

  emitConfig() {
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this.config }, bubbles: true, composed: true }));
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, EnvironmentThresholdCard);
if (!customElements.get(`${TAG}-editor`)) customElements.define(`${TAG}-editor`, EnvironmentThresholdEditor);
window.customCards ??= [];
if (!window.customCards.some(card => card.type === TAG)) window.customCards.push({
  type: TAG, name: '環境門檻監測', preview: false,
  description: '依卡片寬度自動排列光照、溫度、濕度、風速及其他感測器。',
});
