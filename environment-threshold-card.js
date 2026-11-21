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
const ENTITY_ID = /^sensor\.[a-z0-9_]+$/;
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const KINDS = new Map([
  ['light', ['光照', 'M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z']],
  ['temperature', ['溫度', 'M10 14.2V5a2 2 0 1 1 4 0v9.2a4.5 4.5 0 1 1-4 0zM12 10v8']],
  ['humidity', ['濕度', 'M12 2c-2 4-7 8-7 13a7 7 0 0 0 14 0c0-5-5-9-7-13zM8 16a4 4 0 0 0 4 3']],
  ['wind', ['風速', 'M3 8h12a2.5 2.5 0 1 0-2.5-2.5M2 12h17a2 2 0 1 1-2 2M5 16h7a2.5 2.5 0 1 1-2.5 2.5']],
  ['custom', ['其他感測', 'M2 12h5l3-7 4 14 3-7h5']],
]);
const DEVICE_KINDS = new Map([['illuminance', 'light'], ['temperature', 'temperature'], ['humidity', 'humidity'], ['wind_speed', 'wind']]);
const STATUS = { high: '↑ 高於上限', low: '↓ 低於下限', normal: '正常', unavailable: '無讀值', unset: '未設門檻', unit: '單位已變更' };
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
const nameOf = (item, states) => item.name || states?.[item.entity]?.attributes?.friendly_name || item.entity;
const hasBounds = item => item.below != null || item.above != null;

function validate(config) {
  const items = config?.items ?? [];
  if (!Array.isArray(items)) throw new Error('items 必須是清單。');
  for (const item of items) {
    if (typeof item?.entity !== 'string' || !ENTITY_ID.test(item.entity)) throw new Error('請選擇有效的 sensor 實體。');
    if (item.kind != null && !KINDS.has(item.kind)) throw new Error('無效的感測類型。');
    for (const key of ['name', 'unit']) if (item[key] != null && typeof item[key] !== 'string') throw new Error(`${key} 必須是文字。`);
    for (const key of ['below', 'above']) if (item[key] != null && !Number.isFinite(item[key])) throw new Error('門檻必須是有限數字。');
    if (item.below != null && item.above != null && item.below >= item.above) throw new Error('下限必須小於上限。');
  }
  return items;
}

function evaluate(item, state) {
  const raw = state?.state;
  const unit = unitOf(state);
  const value = typeof raw === 'string' && DECIMAL.test(raw.trim()) ? Number(raw) : NaN;
  if (!Number.isFinite(value)) return ['unavailable', '—', ''];
  const flag = !hasBounds(item) ? 'unset' : item.unit != null && item.unit !== unit ? 'unit' :
    item.above != null && value > item.above ? 'high' : item.below != null && value < item.below ? 'low' : 'normal';
  return [flag, format.format(value), unit];
}

const CARD_CSS = `
:host { display:block; min-inline-size:0; color:var(--primary-text-color,#20313d); }
ha-card { display:block; box-sizing:border-box; height:auto; padding:12px; border:1px solid var(--ha-card-border-color,#d9e3ea); border-radius:var(--ha-card-border-radius,12px); background:var(--ha-card-background,var(--card-background-color,#fff)); }
h2 { margin:0 0 8px; font-size:1.22em; line-height:1.3; overflow-wrap:anywhere; }
.summary { margin:0 0 8px; padding:6px 9px; border-radius:8px; font-weight:600; background:var(--secondary-background-color,#edf3f6); }
.summary[data-tone=alarm] { border-inline-start:4px solid #d44731; background:color-mix(in srgb,#d44731 13%,transparent); }
.summary[data-tone=warning] { border-inline-start:4px solid #78909c; }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,138px),1fr)); gap:8px; }
.tile { min-inline-size:0; display:grid; grid-template-columns:30px minmax(0,1fr); gap:7px; align-items:start; padding:8px; border-radius:10px; border:1px solid var(--divider-color,#d9e3ea); overflow-wrap:anywhere; }
.glyph { width:30px; height:30px; display:grid; place-items:center; background:var(--secondary-background-color,#edf3f6); border-radius:8px; }
.glyph svg { width:21px; height:21px; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
.name { font-weight:650; }
.reading { font-size:1.35em; font-weight:700; font-variant-numeric:tabular-nums; line-height:1.25; }
.reading small { font-size:.62em; margin-inline-start:.27em; }
.status { display:inline-block; font-size:.8em; margin-top:3px; padding:1px 5px; border-radius:5px; background:var(--secondary-background-color,#edf3f6); }
.bounds { display:block; margin-top:4px; font-size:.78em; color:var(--secondary-text-color,#4d5965); }
.bounds[hidden] { display:none; }
[data-state=high] { border-color:#ed8d83; }
[data-state=high] :is(.status,.glyph) { background:#ffe6e1; color:#9e281b; }
[data-state=low] { border-color:#77a9e8; }
[data-state=low] :is(.status,.glyph) { background:#e5f0ff; color:#174f95; }
:is([data-state=unavailable],[data-state=unit]) { border-style:dashed; }
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
  const body = dom('div');
  const name = dom('div', 'name');
  const reading = dom('div', 'reading');
  const value = dom('span');
  const unitNode = dom('small');
  const status = dom('span', 'status');
  const bounds = dom('small', 'bounds');
  reading.append(value, unitNode);
  body.append(name, reading, status, bounds);
  tile.append(glyph, body);
  return { tile, path, name, value, unitNode, status, bounds };
}

class EnvironmentThresholdCard extends HTMLElement {
  static getStubConfig() { return { items: [] }; }
  static getConfigElement() { return dom(`${TAG}-editor`); }

  constructor() {
    super();
    const panel = dom('ha-card');
    this.titleNode = dom('h2');
    this.summary = dom('p', 'summary');
    this.summary.setAttribute('role', 'status');
    this.grid = dom('div', 'grid');
    panel.append(this.titleNode, this.summary, this.grid);
    this.attachShadow({ mode: 'open' }).append(style(CARD_CSS), panel);
  }

  setConfig(config) {
    const items = validate(config);
    this.rows = items.map(item => ({ ...tileNodes(), item: { ...item } }));
    this.grid.replaceChildren(...this.rows.map(row => row.tile));
    text(this.titleNode, typeof config?.title === 'string' && config.title.trim() ? config.title : '環境門檻監測');
    this.updateStates();
  }

  set hass(hass) {
    this.states = hass?.states;
    this.updateStates();
  }

  getGridOptions() { return { columns: 12, min_columns: 3 }; }
  getCardSize() { return 1 + Math.max(1, Math.ceil((this.rows?.length ?? 0) / 2)) * 2; }

  updateStates() {
    if (!this.rows) return;
    const counts = { high: 0, low: 0, unavailable: 0, unit: 0, unset: 0 };
    for (const { item, tile, path, name, value, unitNode, status, bounds } of this.rows) {
      const state = this.states?.[item.entity];
      const [flag, reading, unit] = evaluate(item, state);
      if (flag !== 'normal') counts[flag]++;
      const kind = item.kind ?? DEVICE_KINDS.get(state?.attributes?.device_class) ?? 'custom';
      const shape = KINDS.get(kind)[1];
      if (path.getAttribute('d') !== shape) path.setAttribute('d', shape);
      if (tile.dataset.state !== flag) tile.dataset.state = flag;
      text(name, nameOf(item, this.states));
      text(value, reading);
      text(unitNode, unit);
      text(status, STATUS[flag]);
      const boundsUnit = item.unit ?? unitOf(state);
      const configured = [item.below != null && `下限 ${format.format(item.below)}`, item.above != null && `上限 ${format.format(item.above)}`].filter(Boolean).join(' · ');
      bounds.hidden = !configured;
      text(bounds, configured && boundsUnit ? `${configured} ${boundsUnit}` : configured);
    }
    const notices = Object.entries({ high: '過高', low: '過低', unavailable: '無讀值', unit: '單位已變更', unset: '未設門檻' })
      .flatMap(([key, label]) => counts[key] ? [`${counts[key]} 項${label}`] : []);
    this.summary.dataset.tone = counts.high || counts.low ? 'alarm' : notices.length ? 'warning' : 'normal';
    text(this.summary, !this.rows.length ? '請在卡片編輯器新增監測項目。' : notices.join(' · ') || '所有監測皆在範圍內');
  }
}

const EDITOR_CSS = `
:host { display:block; }
[hidden] { display:none !important; }
.list,.actions { display:flex; flex-wrap:wrap; gap:8px; margin-block:8px; }
.fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr)); gap:8px; }
label { display:grid; gap:4px; min-width:0; }
.full { grid-column:1/-1; }
button,input,select { box-sizing:border-box; min-height:44px; font:inherit; color:inherit; background:var(--card-background-color,#fff); border:1px solid var(--divider-color,#a0aab2); border-radius:8px; padding:6px 9px; }
input,select { width:100%; min-width:0; }
button { cursor:pointer; max-width:100%; overflow-wrap:anywhere; }
button:focus-visible,input:focus-visible,select:focus-visible { outline:2px solid var(--primary-color,#1976d2); outline-offset:2px; }
.primary { background:var(--primary-color,#17668a); color:var(--text-primary-color,#fff); }
[role=alert] { border-inline-start:3px solid var(--error-color,#bf3428); padding-inline-start:7px; }
`;

class EnvironmentThresholdEditor extends HTMLElement {
  constructor() {
    super();
    this.list = dom('div', 'list');
    this.form = dom('form');
    this.form.hidden = true;
    this.addButton = this.button('新增監測項目', () => this.openItem());
    this.attachShadow({ mode: 'open' }).append(style(EDITOR_CSS), this.list, this.form, this.addButton);
  }

  setConfig(config) {
    const next = { ...config, items: validate(config) };
    if (JSON.stringify(next) === JSON.stringify(this.config)) return;
    this.config = next;
    this.closeItem();
  }

  set hass(hass) { this.states = hass?.states; }

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

  closeItem(returnTo) {
    this.form.hidden = true;
    this.form.replaceChildren();
    this.form.onsubmit = null;
    this.addButton.hidden = false;
    this.list.replaceChildren(...this.config.items.map((item, index) => this.button(nameOf(item, this.states), () => this.openItem(index))));
    if (returnTo !== undefined) (this.list.children[returnTo] ?? this.addButton).focus();
  }

  openItem(index) {
    const item = this.config.items[index];
    const entity = dom('input');
    entity.required = true;
    entity.value = item?.entity ?? '';
    entity.setAttribute('list', 'threshold-sensors');
    entity.setAttribute('autocomplete', 'off');
    const data = dom('datalist');
    data.id = 'threshold-sensors';
    for (const id of Object.keys(this.states ?? {}).filter(id => ENTITY_ID.test(id)).sort()) data.append(new Option(nameOf({ entity: id }, this.states), id));
    const kind = dom('select');
    for (const [key, [label]] of KINDS) kind.append(new Option(label, key));
    const suggested = id => DEVICE_KINDS.get(this.states?.[id]?.attributes?.device_class) ?? 'custom';
    kind.value = item?.kind ?? suggested(entity.value);
    const label = dom('input');
    label.value = item?.name ?? '';
    const below = dom('input');
    const above = dom('input');
    for (const input of [below, above]) {
      input.type = 'number';
      input.step = 'any';
      input.placeholder = '留空＝不判斷';
    }
    below.value = item?.below ?? '';
    above.value = item?.above ?? '';
    const note = dom('div');
    const error = dom('p');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    let selectedEntity = entity.value;
    const currentUnit = () => this.states?.[entity.value.trim()] ? unitOf(this.states[entity.value.trim()]) : undefined;
    let draftUnit = currentUnit();
    const consent = dom('input');
    consent.type = 'checkbox';
    consent.style.width = 'auto';
    consent.style.minHeight = 'auto';
    const consentField = this.field('已確認門檻使用目前單位', consent);
    const needsConsent = () => item?.unit != null && item.entity === selectedEntity && hasBounds(item) && draftUnit !== undefined && item.unit !== draftUnit;
    const updateNote = () => {
      consentField.hidden = !needsConsent();
      text(note, needsConsent()
        ? `門檻原單位：${item.unit || '無'}；目前單位：${draftUnit || '無'}。請重新換算門檻。`
        : `門檻單位：${draftUnit || '未提供'}（依實體單位）`);
    };
    entity.addEventListener('change', () => {
      const id = entity.value.trim();
      if (id !== selectedEntity) {
        selectedEntity = id;
        draftUnit = currentUnit();
        consent.checked = false;
        below.value = above.value = '';
        kind.value = suggested(id);
        error.hidden = true;
      }
      updateNote();
    });
    updateNote();
    const fields = dom('div', 'fields');
    fields.append(this.field('感測器實體', entity, 'full'), data, this.field('感測類型', kind), this.field('顯示名稱（選填）', label), this.field('下限', below), this.field('上限', above));
    const buttons = dom('div', 'actions');
    const apply = dom('button', 'primary', '套用項目');
    apply.type = 'submit';
    const focusIndex = index ?? this.config.items.length;
    buttons.append(apply, this.button('取消', () => this.closeItem(focusIndex)));
    if (item) buttons.append(this.button('移除項目', () => this.commit(this.config.items.filter((_, i) => i !== index), index)));
    this.form.replaceChildren(fields, note, consentField, error, buttons);
    this.form.onsubmit = event => {
      event.preventDefault();
      const showError = message => { text(error, message); error.hidden = false; };
      const updated = { entity: entity.value.trim(), kind: kind.value };
      if (label.value.trim()) updated.name = label.value.trim();
      if (below.value !== '') updated.below = below.valueAsNumber;
      if (above.value !== '') updated.above = above.valueAsNumber;
      if (hasBounds(updated)) {
        if (updated.entity !== selectedEntity || draftUnit !== currentUnit()) {
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
      const items = this.config.items.slice();
      items[focusIndex] = updated;
      try { validate({ items }); }
      catch (e) { showError(e.message); return; }
      this.commit(items, focusIndex);
    };
    this.form.hidden = false;
    this.addButton.hidden = true;
    entity.focus();
  }

  commit(items, focusIndex) {
    this.config = { ...this.config, type: `custom:${TAG}`, items };
    this.closeItem(focusIndex);
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
