/* The Soil survey page: points with depth samples, kept in the project's site record and apart from boreholes. Loaded before the main
   script, so nothing here runs until the page is opened; it uses the app's helpers (siteOf, setSite, labVal, csscOf, esc, toast…). */
const SOIL_METHODS = ['Hand dig', 'Hand auger', 'Shovel', 'Probe', 'Other'];
const SOIL_STRATEGIES = { '': 'Not stated', grid: 'Grid', random: 'Random', targeted: 'Targeted', mixed: 'Mixed' };
const soilBlank = () => ({ survey: { name: '', date: '', strategy: '', notes: '', issued: false }, points: [] });
const surveyOf = () => { const s = siteOf()?.soil; return s?.points ? s : (siteOf() || {}).soil || soilBlank(); };
const setSurvey = next => setSite({ ...(siteOf() || {}), soil: next });
const soilEd = () => !S.readOnly && !surveyOf().survey?.issued;
const soilId = pre => pre + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function soilAddPoint(name = '') {
  if (!soilEd()) return null;
  const sv = surveyOf(), last = sv.points.at(-1), p = { id: soilId('sp'), name: name || nextSampleName(last?.name) || `SP-${sv.points.length + 1}`, e: null, n: null, z: null, notes: '', order: '', gg: '', sub: '', samples: [] };
  sv.points.push(p); setSurvey(sv); return p;
}
function soilAddSample(p, o = {}) {
  if (!soilEd() || !p) return null;
  const s = { id: soilId('ss'), name: '', from: null, to: null, method: '', hz: '', texture: '', colour: '', notes: '', sand: null, silt: null, clay: null, lab: {}, gsd: [], ...o };
  p.samples.push(s); setSurvey(surveyOf()); return s;
}
/* depths: metres stored; shown in cm, or feet in imperial */
const soilDepthIn = m => m == null ? '' : S.units === 'ft' ? String(+toD(m).toFixed(2)) : String(+(m * 100).toFixed(1));
const soilDepthOut = v => S.units === 'ft' ? +fromD(v).toFixed(4) : +(v / 100).toFixed(4);
const soilDepthUnit = () => S.units === 'ft' ? 'ft' : 'cm';
const soilDepthKey = s => `${s.from ?? ''}|${s.to ?? ''}`;
const soilDepthLabel = s => `${[s.from, s.to].filter(v => v != null).map(soilDepthIn).join('–') || 'No depth'}${s.from != null || s.to != null ? ' ' + soilDepthUnit() : ''}`;
function soilDepths() {
  const m = new Map(); for (const p of surveyOf().points) for (const s of p.samples) { const k = soilDepthKey(s); (m.get(k) || m.set(k, { key: k, from: s.from, to: s.to, label: soilDepthLabel(s), n: 0 }).get(k)).n++; }
  return [...m.values()].sort((a, c) => (a.from ?? a.to ?? 0) - (c.from ?? c.to ?? 0) || (a.to ?? 0) - (c.to ?? 0));
}
/* a sample's number for a property: below detection counts as half the limit, and says so */
const SOIL_FR = ['sand', 'silt', 'clay'];
function soilValue(s, k) {
  if (SOIL_FR.includes(k)) { const t = csscOf(s); return t ? { v: t[k], nd: false, dl: null } : null; }
  const r = labVal(s, k); if (!r) return null;
  return r.lt ? { v: r.v / 2, nd: true, dl: r.v } : { v: r.v, nd: false, dl: null };
}
function soilClass(s, k, p) {
  if (k === 'order') return p?.order || (p?.gg ? csscOrder(p.gg) : '') || '';
  if (k === 'gg') return p?.gg || '';
  if (k === 'texture') return s.texture || csscOf(s)?.name || '';
  return s[k] || '';
}
const SOIL_CLASS_PROPS = [['order', 'Soil order'], ['gg', 'Great group'], ['texture', 'Texture'], ['hz', 'Horizon'], ['method', 'Sampling method']];
function soilProps() {
  const ss = surveyOf().points.flatMap(p => p.samples.map(s => [s, p])), used = k => ss.some(([s, p]) => soilClass(s, k, p));
  const nums = [...SOIL_FR.map(k => [k, k[0].toUpperCase() + k.slice(1), '%']), ...LAB_ORDER.filter(k => !SOIL_FR.includes(k)).map(k => [k, LAB_PARAMS[k]?.label || k, LAB_PARAMS[k]?.unit || ''])];
  return [...SOIL_CLASS_PROPS.filter(([k]) => used(k)).map(([k, label]) => ({ k, label, kind: 'class', unit: '' })), ...nums.filter(([k]) => ss.some(([s]) => soilValue(s, k))).map(([k, label, unit]) => ({ k, label, kind: 'num', unit }))];
}
/* the grid: one row a sample; point columns repeat down its samples */
const soilCols = () => [['pname', 'Point', 'text'], ['e', 'Easting', 'num'], ['n', 'Northing', 'num'], ['name', 'Sample', 'text'], ['from', `From (${soilDepthUnit()})`, 'depth'], ['to', `To (${soilDepthUnit()})`, 'depth'], ['method', 'Method', 'text', SOIL_METHODS],
  ['gg', 'Great group', 'text', Object.values(CSSC).flat()], ['hz', 'Horizon', 'text', Object.keys(HORIZONS)], ['texture', 'Texture', 'text', TEXTURES.cssc.list], ['colour', 'Colour', 'text'], ['sand', 'Sand %', 'num'], ['silt', 'Silt %', 'num'], ['clay', 'Clay %', 'num'],
  ['lab:ec', 'EC (dS/m)', 'lab'], ['lab:sar', 'SAR', 'lab'], ['lab:ph', 'pH', 'lab'], ['lab:cl', 'Chloride', 'lab'], ['lab:om', 'OM %', 'lab'], ['notes', 'Notes', 'text']];
const soilRows = () => surveyOf().points.flatMap(p => p.samples.length ? p.samples.map(s => ({ p, s })) : [{ p, s: null }]);
const SOIL_PT = new Set(['e', 'n', 'gg']);
function soilCellText(c, r) {
  const k = c[0]; if (k === 'pname') return r.p.name; if (SOIL_PT.has(k)) return r.p[k] ?? ''; if (!r.s) return '';
  if (c[2] === 'depth') return soilDepthIn(r.s[k]); if (c[2] === 'lab') return fmtLab(r.s.lab?.[k.slice(4)]).replace('—', '');
  return r.s[k] ?? '';
}
/* one typed value; false when it cannot be read */
function soilCell(r, c, txt) {
  const k = c[0], t = String(txt ?? '').trim();
  if (k === 'pname') { if (t) r.p.name = t; return !!t; }
  if (SOIL_PT.has(k)) { if (k === 'gg') { r.p.gg = t; r.p.order = t ? csscOrder(t) : ''; return true; } const v = t ? numv(t) : null; if (t && v == null) return false; r.p[k] = v; return true; }
  r.s ||= (r.p.samples.push({ id: soilId('ss'), name: '', from: null, to: null, method: '', hz: '', texture: '', colour: '', notes: '', sand: null, silt: null, clay: null, lab: {}, gsd: [] }), r.p.samples.at(-1));
  if (c[2] === 'depth') { const v = t ? numv(t) : null; if (t && v == null) return false; r.s[k] = v == null ? null : soilDepthOut(v); return true; }
  if (c[2] === 'num') { const v = t ? numv(t) : null; if (t && v == null) return false; r.s[k] = v; return true; }
  if (c[2] === 'lab') { r.s.lab ||= {}; const p = k.slice(4); if (!t) { delete r.s.lab[p]; return true; } const x = labCell(t); if (!x) return false; r.s.lab[p] = x; return true; }
  r.s[k] = t; return true;
}
function soilPaste(txt, r0, c0) {
  if (!soilEd()) return; const rows = () => soilRows(), cols = soilCols(); let bad = 0;
  String(txt).replace(/\r/g, '').replace(/\n$/, '').split('\n').forEach((line, i) => {
    const vals = line.split('\t'), first = c0 === 0 ? vals[0].trim() : ''; let r = rows()[r0 + i];
    if (!r || (first && r.p.name !== first)) { const p = surveyOf().points.find(x => normName(x.name) === normName(first)) || (first ? soilAddPoint(first) : null); if (!p) return; r = { p, s: p.samples[0] && !r ? null : p.samples[0] || null }; }
    vals.forEach((v, d) => { const c = cols[c0 + d]; if (c && !soilCell(r, c, v)) bad++; });
  });
  setSurvey(surveyOf()); if (bad) toast(`${bad} value${bad === 1 ? '' : 's'} could not be read.`); soilGridRedraw();
}
const soilGridRedraw = () => { const g = $('#soil-grid'); if (g) g.innerHTML = soilGridHTML(); };
function soilGridHTML() {
  const cols = soilCols(), ed = soilEd(), rows = soilRows();
  return `<div class="dgrid-wrap"><table class="dgrid soil-grid"><thead><tr>${cols.map(c => `<th${['num', 'depth', 'lab'].includes(c[2]) ? ' class="r"' : ''}>${esc(c[1])}</th>`).join('')}<th></th></tr></thead><tbody>${rows.map((r, i) => `<tr data-pid="${esc(r.p.id)}">${cols.map((c, j) => `<td class="${['num', 'depth', 'lab'].includes(c[2]) ? 'r' : 'wide'}"><input data-sr="${i}" data-sc="${j}" value="${esc(soilCellText(c, r))}" ${c[3] ? `list="sdl-${c[0]}"` : ''} ${ed ? '' : 'readonly'} aria-label="${esc(`${r.p.name} ${c[1]}`)}" autocomplete="off"></td>`).join('')}<td class="del">${ed ? `<button class="x" data-soildel="${i}" aria-label="Delete row">×</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="${cols.length + 1}" class="note">No points yet. Add one, import locations, or paste from Excel.</td></tr>`}</tbody></table></div>
    ${cols.filter(c => c[3]).map(c => `<datalist id="sdl-${c[0]}">${c[3].map(v => `<option value="${esc(v)}">`).join('')}</datalist>`).join('')}`;
}
function soilHTML() {
  const sv = surveyOf(), s = sv.survey || {}, ed = soilEd(), ro = S.readOnly;
  const f = (k, label, h) => `<div class="fld"><label for="sf-${k}">${label}</label>${h}</div>`, inp = (k, t = 'text') => `<input id="sf-${k}" type="${t}" data-soilf="${k}" value="${esc(s[k] || '')}" ${ed ? '' : 'readonly'}>`;
  return `<div class="soil-page"><section class="sec"><header><h3>Soil survey</h3><div class="mini-tools">${ed ? `<button class="btn" data-act="soil-add">Add point</button><button class="btn" data-act="soil-imp-pts">Import locations</button><button class="btn" data-act="soil-imp-lab">Import lab results</button>` : ''}${ro ? '' : `<button class="btn" data-act="soil-issue">${s.issued ? 'Reopen' : 'Issue'}</button>`}</div></header>
    <div class="body"><div class="fields">${f('name', 'Survey name', inp('name'))}${f('date', 'Date', inp('date', 'date'))}${f('strategy', 'Sampling strategy', `<select id="sf-strategy" data-soilf="strategy" ${ed ? '' : 'disabled'}>${Object.entries(SOIL_STRATEGIES).map(([k, v]) => `<option value="${k}" ${(s.strategy || '') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}${f('notes', 'Notes', inp('notes'))}</div>
    <div id="soil-grid">${soilGridHTML()}</div><p class="note">Separate from boreholes. Depths with the same from and to values are mapped together. Type &lt; for results below detection, like &lt;0.5. Paste a block from Excel into any cell.</p></div></section></div>
    <input type="file" id="soil-file" hidden accept=".csv,.txt,.xlsx,.xls">`;
}
function drawSoil() {}
async function soilImportPoints(file) {
  if (!soilEd()) return; let pts; try { pts = rowsToPoints(await readTable(file)); } catch { pts = null; }
  if (!pts?.length) { toast('No location table found. The file needs a name column and easting/northing (or latitude/longitude) columns.'); return; }
  const sv = surveyOf(); let upd = 0, made = 0, zone = null;
  for (const q of pts.filter(q => q.e != null && q.n != null)) {
    let p = sv.points.find(x => normName(x.name) === normName(q.name)); if (!p) { p = soilAddPoint(q.name); made++; } else upd++;
    p.e = q.e; p.n = q.n; if (q.z != null) p.z = q.z; zone = q.zone ?? zone;
  }
  setSite({ ...(siteOf() || {}), soil: surveyOf(), ...(zone && !projList().some(b => /zone\s*\d/i.test(b.crs || '')) ? { zone } : {}) });
  renderView(true); toast(`Set ${upd + made} point location${upd + made === 1 ? '' : 's'}${made ? `, ${made} new` : ''}.`);
}
async function soilImportLab(file) {
  if (!soilEd()) return; let res; try { res = parseLabTable(await readTable(file)); } catch { res = { samples: [] }; }
  if (!res.samples.length) { toast(`No lab results found in ${file.name}.`); return; }
  const all = surveyOf().points.flatMap(p => p.samples.map(s => ({ p, s, label: `${p.name} ${soilDepthLabel(s)}${s.name ? ` (${s.name})` : ''}` })));
  const match = x => (all.find(a => normName(a.s.name) === normName(x.id) && a.s.name) || all.filter(a => normName(a.p.name) === normName(x.id)).find((a, _, l) => l.length === 1))?.s.id || '';
  S._soilLab = res.samples;
  dialog(`Import lab results from ${esc(file.name)}`, `<p class="note" style="margin:0">Check each match. Results replace any already entered for that sample.</p>
    <div class="scroll-x" style="max-height:340px;overflow:auto"><table class="sum"><thead><tr><th>Lab sample ID</th><th style="min-width:260px">Goes to</th><th class="r">Results</th></tr></thead><tbody>${res.samples.map((x, i) => { const m = match(x); return `<tr><td>${esc(x.id)}</td><td><select data-soillab="${i}" style="width:100%"><option value="" ${m ? '' : 'selected'}>Skip</option>${all.map(a => `<option value="${esc(a.s.id)}" ${a.s.id === m ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}</select></td><td class="r">${Object.keys(x.res).length}</td></tr>`; }).join('')}</tbody></table></div>
    ${res.unknown?.length ? `<p class="note">Not imported (not in this app’s parameter list): ${esc(res.unknown.slice(0, 12).join(', '))}.</p>` : ''}`, `<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="soil-lab-go">Import results</button>`);
}
function soilImportLabGo() {
  const by = new Map(surveyOf().points.flatMap(p => p.samples.map(s => [s.id, s]))); let n = 0;
  (S._soilLab || []).forEach((x, i) => {
    const s = by.get(document.querySelector(`[data-soillab="${i}"]`)?.value); if (!s) return; s.lab = { ...(s.lab || {}), ...x.res }; n++;
    for (const k of SOIL_FR) if (x.res[k]) { s[k] = x.res[k].v; delete s.lab[k]; }
  });
  S._soilLab = null; setSurvey(surveyOf()); closeOverlay(); renderView(true); toast(`Imported results for ${n} sample${n === 1 ? '' : 's'}.`);
}
function soilAct(act) {
  if (act === 'soil-add') { const p = soilAddPoint(); if (p) soilAddSample(p); renderView(true); }
  else if (act === 'soil-imp-pts' || act === 'soil-imp-lab') { const f = $('#soil-file'); f.dataset.mode = act; f.click(); }
  else if (act === 'soil-lab-go') soilImportLabGo();
  else if (act === 'soil-issue') { if (S.readOnly) return; const sv = surveyOf(); sv.survey ||= {}; sv.survey.issued = !sv.survey.issued; setSurvey(sv); renderView(true); }
}
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'soil-file') { const f = t.files[0]; if (f) (t.dataset.mode === 'soil-imp-lab' ? soilImportLab : soilImportPoints)(f); t.value = ''; return; }
  if (t.dataset?.soilf) { if (!soilEd()) return; const sv = surveyOf(); sv.survey ||= {}; sv.survey[t.dataset.soilf] = t.value; setSurvey(sv); return; }
  if (t.dataset?.sc != null && t.closest?.('.soil-grid')) { if (!soilEd()) return; const r = soilRows()[+t.dataset.sr], c = soilCols()[+t.dataset.sc]; if (!r || !c) return; if (!soilCell(r, c, t.value)) toast(`“${t.value}” isn’t a valid ${c[1].toLowerCase()}.`); setSurvey(surveyOf()); soilGridRedraw(); }
});
document.addEventListener('paste', e => {
  const el = e.target.closest?.('.soil-grid input'); if (!el) return; const txt = e.clipboardData?.getData('text/plain') || ''; if (!/[\t\n]/.test(txt.replace(/\r?\n$/, ''))) return;
  e.preventDefault(); soilPaste(txt, +el.dataset.sr, +el.dataset.sc);
});
document.addEventListener('click', e => {
  const d = e.target.closest?.('[data-soildel]'); if (!d || !soilEd()) return; const r = soilRows()[+d.dataset.soildel]; if (!r) return;
  if (r.s && r.p.samples.length > 1) r.p.samples = r.p.samples.filter(s => s !== r.s); else surveyOf().points.splice(surveyOf().points.indexOf(r.p), 1);
  setSurvey(surveyOf()); soilGridRedraw();
});
