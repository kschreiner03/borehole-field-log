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
    <div id="plan" class="map-canvas" data-tool="pan"></div><h4 style="margin:14px 0 6px">Points and samples</h4><div id="soil-grid">${soilGridHTML()}</div><p class="note">Separate from boreholes. Depths with the same from and to values are mapped together. Type &lt; for results below detection, like &lt;0.5. Paste a block from Excel into any cell.</p></div></section></div>
    <input type="file" id="soil-file" hidden accept=".csv,.txt,.xlsx,.xls">`;
}
/* ---------- maps ---------- */
const soilView = () => (S.soilView ||= { prop: '', depth: '', view: 'auto', method: 'auto', ramp: 'auto', labels: true, contours: false, maskOff: false, pointsHidden: false, log: 'auto', cell: null, power: 2, k: 12, vgModel: 'auto', nugget: null, sill: null, range: null, min: null, max: null, steps: 0, texMode: 'auto', forced: false });
function soilCurrent() {
  const v = soilView(), props = soilProps(), ds = soilDepths();
  if (!props.some(p => p.k === v.prop)) v.prop = (props.find(p => p.kind === 'num' && !SOIL_FR.includes(p.k)) || props.find(p => p.kind === 'num') || props[0])?.k || '';
  if (v.depth !== '*' && !ds.some(d => d.key === v.depth)) v.depth = ds[0]?.key ?? '';
  return v;
}
function soilSet(ch) { const v = soilView(); Object.assign(v, ch); if ('view' in ch) v.forced = ch.view === 'heat' || ch.view === 'zones'; if ('prop' in ch || 'depth' in ch) { v.view = 'auto'; v.forced = false; } }
const soilKind = k => soilProps().find(p => p.k === k)?.kind || (SOIL_CLASS_PROPS.some(c => c[0] === k) ? 'class' : 'num');
const soilSampleAt = (p, depth) => depth === '*' ? p.samples : p.samples.filter(s => soilDepthKey(s) === depth);
/* the measured points for a property at a depth; combined depths average a point's samples, classes take the shallowest */
function soilPts(prop, depth) {
  const kind = soilKind(prop), out = []; let unmapped = 0, nd = 0;
  for (const p of surveyOf().points) {
    const ss = soilSampleAt(p, depth); let v = null, sNd = false, s0 = null;
    if (kind === 'class') { s0 = ss.find(s => soilClass(s, prop, p)); v = s0 ? soilClass(s0, prop, p) : null; }
    else { const vs = ss.map(s => [s, soilValue(s, prop)]).filter(x => x[1]); if (vs.length) { s0 = vs[0][0]; v = vs.reduce((t, x) => t + x[1].v, 0) / vs.length; sNd = vs.some(x => x[1].nd); } }
    if (v == null || v === '') continue; if (p.e == null || p.n == null) { unmapped++; continue; } if (sNd) nd++;
    out.push({ x: p.e, y: p.n, v, pt: p, s: s0, nd: sNd });
  }
  return { pts: out, unmapped, nonDetects: nd };
}
const soilPlural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function soilSurface(prop, depth, v) {
  const key = JSON.stringify([prop, depth, v.method, v.log, v.cell, v.power, v.k, v.vgModel, v.nugget, v.sill, v.range, v.maskOff, v.forced, v.texMode, v.view === 'uncertainty', surveyOf().survey?.strategy, surveyOf().points]);
  S.soilCache ||= new Map(); if (S.soilCache.has(key)) return S.soilCache.get(key);
  const SS = SoilStats, kind = soilKind(prop), { pts: raw, unmapped, nonDetects } = soilPts(prop, depth), classy = kind === 'class';
  const { pts, merged } = classy ? { pts: raw, merged: 0 } : SS.merge(raw), n = pts.length, auto = SS.chooseMethod(n, classy ? 'class' : 'num');
  let method = v.method === 'auto' ? auto.method : v.method, why = v.method === 'auto' ? auto.why : 'Chosen in the settings.', forced = false;
  if (method === 'none' && v.forced && n >= 2) { method = classy ? 'nearest' : 'idw'; forced = true; }
  const sp = SS.spacing(pts), cell0 = v.cell > 0 ? v.cell : (sp.median || 1) / 4, ext = n ? Math.max(Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x)), Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y))) + 4 * sp.median : 0;
  const cell = Math.max(cell0, ext / 300), w = SS.decluster(pts), wp = pts.map((p, i) => ({ ...p, w: w[i] })), notes = [];
  if (merged) notes.push(`${soilPlural(merged, 'sample')} at the same spot averaged.`);
  const out = { method, why, cell, kind, n, spacing: sp.median, merged, notes, unmappedNote: unmapped ? `${soilPlural(unmapped, 'point')} ${unmapped === 1 ? 'has' : 'have'} no coordinates and ${unmapped === 1 ? 'is' : 'are'} not mapped.` : '', pts: raw, nonDetects };
  const flat = !classy && n > 0 && pts.every(p => p.v === pts[0].v); if (flat) { out.note = 'Every point has the same value, so there is no pattern to map.'; notes.push(out.note); }
  let vg = null, loo = null;
  if (method !== 'none' && n >= 2) {
    const T = !classy && (v.log === 'on' || (v.log === 'auto' && SS.logT(pts.map(p => p.v)).on)) && pts.every(p => p.v > 0) ? SS.logT(pts.map(p => p.v)) : null; out.log = !!T;
    const tp = T ? wp.map(p => ({ ...p, v: T.fwd(p.v) })) : wp, opt = { power: +v.power || 2, k: +v.k || 12 };
    if (method === 'krige') { const fit = SS.fitVariogram(SS.empirical(tp, { weights: w }), v.vgModel === 'auto' ? {} : { model: v.vgModel }); vg = v.range > 0 && v.sill > 0 ? { ...fit, range: +v.range, sill: +v.sill, nugget: +v.nugget || 0, ok: true } : fit; out.vg = vg; }
    const num = (rest, x, y) => { const q = method === 'krige' && vg?.ok ? SS.krige(rest, vg, x, y).v : SS.idw(rest, x, y, opt); return T ? T.inv(q) : q; };
    const texF = prop === 'texture' && v.texMode !== 'classes' && pts.every(p => p.s && csscOf(p.s)); out.fromFractions = !!texF;
    if (classy && texF) {
      const fr = pts.map(p => { const t = csscOf(p.s), [a, b] = SS.alr(t.sand, t.silt, t.clay); return { ...p, a, b }; }), A = fr.map(p => ({ ...p, v: p.a })), B = fr.map(p => ({ ...p, v: p.b }));
      const grid = o => { const m = method === 'indicator' ? 'krige' : 'idw'; return { m, ...o }; }, g2 = grid({ cell, pad: sp.median * 2, spacing: sp.median, ...opt });
      const va = g2.m === 'krige' ? SS.fitVariogram(SS.empirical(A)) : null, vb = g2.m === 'krige' ? SS.fitVariogram(SS.empirical(B)) : null, ra = SS.surface(A, { ...g2, method: g2.m, vg: va, cell: cell / 3 }), rb = SS.surface(B, { ...g2, method: g2.m, vg: vb, cell: cell / 3 });
      const names = [...new Set(pts.map(p => p.v))], val = new Float32Array(ra.val.length), classes = [...names];
      ra.val.forEach((a, i) => { const nm = textureClass(...SS.alrInv(a, rb.val[i])); let c = classes.indexOf(nm); if (c < 0) c = classes.push(nm) - 1; val[i] = c; });
      out.field = { ...ra, val, classes }; const pa = (rest, q) => textureClass(...SS.alrInv(SS.idw(rest.map(r => ({ ...r, v: r.a })), q.x, q.y, opt), SS.idw(rest.map(r => ({ ...r, v: r.b })), q.x, q.y, opt)));
      loo = SS.loo(fr, pa, true);
    } else {
      out.field = SS.surface(classy ? pts : wp, { method: classy ? method : vg?.ok === false ? 'idw' : method, cell: classy ? cell / (method === 'nearest' ? 6 : 3) : cell, pad: sp.median * 2, spacing: sp.median, ...opt, vg, log: !!T });
      if (flat) { out.field.val.fill(pts[0].v); }
      if (classy) { const vgs = null; loo = SS.loo(pts, (rest, q) => SS.classField(rest, q.x, q.y, { method, vgs }).cls, true); }
      else loo = SS.loo(tp.map((p, i) => ({ ...p, raw: pts[i].v })), (rest, q) => { const pr = num(rest, q.x, q.y); return T ? T.fwd(pr) : pr; });
      if (T && loo) { const rows = loo.rows.map(r => ({ ...r, actual: T.inv(r.actual), pred: T.inv(r.pred), err: T.inv(r.pred) - T.inv(r.actual) })), m = rows.length || 1, vs = rows.map(r => r.actual); loo = { ...loo, rows, rmse: Math.sqrt(rows.reduce((t, r) => t + r.err ** 2, 0) / m), bias: rows.reduce((t, r) => t + r.err, 0) / m, range: Math.max(...vs) - Math.min(...vs) }; }
    }
    out.loo = loo;
  }
  const sv = surveyOf().survey || {}, depthLabel = depth === '*' ? 'all depths combined' : soilDepths().find(d => d.key === depth)?.label || '';
  out.warnings = SS.warningsFor({ n, kind, method, vgOk: vg ? vg.ok : undefined, cell: cell0, spacing: sp.median, maskOff: v.maskOff, pointsHidden: v.pointsHidden, depthsCombined: depth === '*', strategy: sv.strategy || '', rmse: loo?.rmse, range: loo?.range, nonDetects, mixedUnits: false, forced });
  out.label = SS.surfaceLabel({ method, n, depth: depthLabel, date: sv.date || '', strategy: sv.strategy || '' });
  S.soilCache.set(key, out); if (S.soilCache.size > 40) S.soilCache.delete(S.soilCache.keys().next().value);
  return out;
}
/* colour-blind safe: viridis for values, grey for black and white, Okabe-Ito with a shape for each class */
const SOIL_RAMPS = { viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]], magma: [[252, 253, 191], [254, 159, 109], [222, 73, 104], [140, 41, 129], [59, 15, 112]], grey: [[240, 240, 240], [50, 50, 50]] };
const SOIL_CLASS_COL = ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7', '#999999'];
const soilRamp = v => bwLogs() ? 'grey' : SOIL_RAMPS[v.ramp] ? v.ramp : 'viridis';
function rampAt(name, t) { const r = SOIL_RAMPS[name], x = Math.max(0, Math.min(1, t)) * (r.length - 1), i = Math.min(r.length - 2, Math.floor(x)), f = x - i; return r[i].map((c, j) => Math.round(c + (r[i + 1][j] - c) * f)); }
const soilHex = c => `rgb(${c.join(',')})`;
const soilClassCol = (i, bw) => bw ? ['#111', '#555', '#888', '#bbb', '#333', '#777', '#aaa', '#ddd'][i % 8] : SOIL_CLASS_COL[i % 8];
const soilMark = (i, x, y, r, st, attr) => { const k = i % 5; return k === 0 ? `<circle cx="${x}" cy="${y}" r="${r}" ${st} ${attr}/>` : k === 1 ? `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" ${st} ${attr}/>` : k === 2 ? `<path d="M${x} ${y - r * 1.2}L${x + r * 1.1} ${y + r}L${x - r * 1.1} ${y + r}z" ${st} ${attr}/>` : k === 3 ? `<path d="M${x} ${y - r * 1.3}L${x + r * 1.3} ${y}L${x} ${y + r * 1.3}L${x - r * 1.3} ${y}z" ${st} ${attr}/>` : `<path d="M${x - r} ${y - r}L${x + r} ${y + r}M${x + r} ${y - r}L${x - r} ${y + r}" ${st.replace(/fill:[^;]+;?/, 'fill:none;').replace('stroke-width="1"', 'stroke-width="2"')} ${attr}/>`; };
/* a surface as a picture: one pixel a cell, faded by the mask */
function soilFieldPNG(f, colour) {
  const { nx, ny } = f.g, c = document.createElement('canvas'); c.width = nx; c.height = ny; const ctx = c.getContext('2d'), im = ctx.createImageData(nx, ny);
  for (let r = 0; r < ny; r++) for (let q = 0; q < nx; q++) { const i = r * nx + q, o = ((ny - 1 - r) * nx + q) * 4, [cr, cg, cb] = colour(i); im.data[o] = cr; im.data[o + 1] = cg; im.data[o + 2] = cb; im.data[o + 3] = Math.round(f.alpha(i) * 255); }
  ctx.putImageData(im, 0, 0); return c.toDataURL('image/png');
}
const soilFmt = v => v == null || !Number.isFinite(v) ? '—' : Math.abs(v) >= 100 ? String(Math.round(v)) : String(+v.toPrecision(3));
function soilMapSVG(W, H, v, interactive) {
  const sv = surveyOf(), located = sv.points.filter(p => p.e != null && p.n != null), o = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Soil survey map">`, `<rect width="${W}" height="${H}" style="fill:var(--panel-2)"/>`];
  if (!located.length) return o.join('') + `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="sub">Add coordinates to map the points.</text></svg>`;
  const xs = located.map(p => p.e), ys = located.map(p => p.n), pad = 60, span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 40) * 1.15;
  let cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2, sc = Math.min((W - 2 * pad) / span, (H - 2 * pad) / span);
  if (interactive) { if (S.mvTab !== 'soil') { S.mv = null; S.mvTab = 'soil'; } if (S.mv) ({ cx, cy, sc } = S.mv); S._plan = S._drawn = { W, H, cx, cy, sc }; }
  const X = e => W / 2 + (e - cx) * sc, Y = n => H / 2 - (n - cy) * sc; o.push(basemapSVG(W, H, cx, cy, sc));
  const f = soilSurface(v.prop, v.depth, v), kind = f.kind, ramp = soilRamp(v), vs = kind === 'num' ? f.pts.map(p => p.v) : [], lo = v.min ?? (vs.length ? Math.min(...vs) : 0), hi = v.max ?? (vs.length ? Math.max(...vs) : 1), span2 = hi - lo || 1;
  const stepT = t => v.steps > 1 ? Math.min(v.steps - 1, Math.floor(t * v.steps)) / (v.steps - 1) : t, tOf = x => stepT((x - lo) / span2), classes = f.field?.classes || [...new Set(f.pts.map(p => p.v))], bw = bwLogs();
  const view = v.view !== 'auto' ? v.view : f.method === 'none' ? 'symbols' : kind === 'class' ? 'zones' : 'heat', surf = f.field && ['heat', 'zones', 'uncertainty'].includes(view);
  if (surf) {
    const g = f.field.g, un = view === 'uncertainty', uMax = Math.max(...f.field.unc) || 1, field = { g, alpha: i => (v.maskOff ? 1 : f.field.mask[i]) * .78 }, hexes = classes.map((_, i) => { const h = soilClassCol(i, bw); return h.length === 4 ? [...h.slice(1)].map(c => parseInt(c + c, 16)) : [1, 3, 5].map(j => parseInt(h.slice(j, j + 2), 16)); });
    const png = soilFieldPNG(field, un ? i => rampAt('magma', f.field.unc[i] / uMax) : kind === 'class' ? i => hexes[f.field.val[i]] || [200, 200, 200] : i => rampAt(ramp, tOf(f.field.val[i])));
    o.push(`<image class="soil-surface" href="${png}" x="${X(g.x0)}" y="${Y(g.y0 + g.ny * g.cell)}" width="${g.nx * g.cell * sc}" height="${g.ny * g.cell * sc}" preserveAspectRatio="none" style="image-rendering:${kind === 'class' ? 'pixelated' : 'auto'}"/>`);
    if (v.contours && kind === 'num' && !un) { const G = { nx: g.nx - 1, ny: g.ny - 1, c: f.field.val, a: f.field.mask, x0: X(g.x0 + g.cell / 2), x1: X(g.x0 + (g.nx - .5) * g.cell), y0: Y(g.y0 + g.cell / 2), y1: Y(g.y0 + (g.ny - .5) * g.cell) };
      for (let i = 1; i < 6; i++) for (const ln of fieldContours(G, lo + span2 * i / 6, .5, true)) o.push(`<path d="M${ln.map(q => q.map(c => c.toFixed(1)).join(' ')).join('L')}" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="1"/>`); }
  }
  /* the measured points */
  if (!v.pointsHidden || !surf) for (const p of f.pts) {
    const x = +X(p.x).toFixed(1), y = +Y(p.y).toFixed(1), attr = `data-spt="${esc(p.pt.id)}"`, sel = S.soilSel === p.pt.id ? 'stroke-width="3"' : 'stroke-width="1"';
    if (view === 'pie' && p.s && csscOf(p.s)) { const t = csscOf(p.s), parts = [['sand', '#E69F00'], ['silt', '#56B4E9'], ['clay', '#D55E00']], r = 13; let a = -Math.PI / 2;
      for (const [k, c] of parts) { const b = a + t[k] / 100 * 2 * Math.PI; o.push(`<path class="soil-pie" ${attr} d="M${x} ${y}L${(x + r * Math.cos(a)).toFixed(1)} ${(y + r * Math.sin(a)).toFixed(1)}A${r} ${r} 0 ${b - a > Math.PI ? 1 : 0} 1 ${(x + r * Math.cos(b)).toFixed(1)} ${(y + r * Math.sin(b)).toFixed(1)}z" style="fill:${c};stroke:#fff" stroke-width=".7"/>`); a = b; } continue; }
    if (kind === 'class') { const i = Math.max(0, classes.indexOf(p.v)); o.push(`<g><title>${esc(`${p.pt.name}: ${p.v}`)}</title>${soilMark(i, x, y, 6, `style="fill:${soilClassCol(i, bw)};stroke:#111" ${sel}`, attr)}</g>`); continue; }
    const r = view === 'graduated' ? +(4 + Math.sqrt(Math.max(0, (p.v - lo) / span2)) * 16).toFixed(1) : 6, fill = p.nd ? '#fff' : soilHex(rampAt(ramp, tOf(p.v)));
    o.push(`<g><title>${esc(`${p.pt.name}: ${p.nd ? 'below detection, shown as ' : ''}${soilFmt(p.v)}`)}</title><circle ${attr} cx="${x}" cy="${y}" r="${r}" style="fill:${fill};stroke:#111" ${sel}/></g>`);
    if (v.labels) o.push(`<text x="${x + r + 3}" y="${y + 4}" style="font:600 10.5px Arial,sans-serif;fill:#111;paint-order:stroke;stroke:#fff;stroke-width:3px">${p.nd ? '&lt;' + soilFmt(p.s && soilValue(p.s, v.prop)?.dl) : soilFmt(p.v)}</text>`);
  }
  /* method note, legend and scale */
  const lines = [...(surf || f.method !== 'none' ? (view === 'symbols' || view === 'graduated' || view === 'pie' ? [] : f.label) : []), ...(surf && f.loo ? [f.loo.pctCorrect != null ? `Check: ${Math.round(f.loo.pctCorrect)}% of hidden points predicted correctly` : `Check: RMSE ${soilFmt(f.loo.rmse)}, bias ${soilFmt(f.loo.bias)} (one point hidden at a time)`] : []), ...f.warnings.filter(w => w.figure && surf).map(w => w.text).filter(t => !f.label.includes(t))];
  if (lines.length) { const w = Math.min(W - 64, Math.max(...lines.map(l => l.length)) * 5.6 + 16); o.push(`<rect x="52" y="10" width="${w}" height="${lines.length * 14 + 8}" rx="3" fill="#fff" opacity=".9"/>${lines.map((l, i) => `<text x="60" y="${25 + i * 14}" style="font:${i ? '' : '700'} 10.5px Arial,sans-serif;fill:#111">${esc(l)}</text>`).join('')}`); }
  const prop = soilProps().find(p => p.k === v.prop), title = view === 'uncertainty' ? `Uncertainty: ${prop?.label || ''}` : view === 'pie' ? 'Sand, silt, clay' : `${prop?.label || ''}${prop?.unit ? ` (${prop.unit})` : ''}`, lx = 14, ly = H - 16;
  if (view === 'pie') o.push(`<rect x="${lx - 4}" y="${ly - 40}" width="170" height="48" rx="3" fill="#fff" opacity=".9"/><text x="${lx}" y="${ly - 26}" style="font:700 10.5px Arial,sans-serif;fill:#111">${title}</text>${[['Sand', '#E69F00'], ['Silt', '#56B4E9'], ['Clay', '#D55E00']].map(([t, c], i) => `<rect x="${lx + i * 52}" y="${ly - 14}" width="10" height="10" fill="${c}"/><text x="${lx + 14 + i * 52}" y="${ly - 5}" style="font:10.5px Arial,sans-serif;fill:#111">${t}</text>`).join('')}`);
  else if (kind === 'class' && view !== 'uncertainty') { const n = Math.min(classes.length, 10), h = n * 15 + 24; o.push(`<rect x="${lx - 4}" y="${ly - h + 8}" width="190" height="${h}" rx="3" fill="#fff" opacity=".9"/><text x="${lx}" y="${ly - h + 22}" style="font:700 10.5px Arial,sans-serif;fill:#111">${esc(title)}</text>${classes.slice(0, n).map((c, i) => `${soilMark(i, lx + 6, ly - h + 36 + i * 15, 5, `style="fill:${soilClassCol(i, bw)};stroke:#111" stroke-width="1"`, '')}<text x="${lx + 18}" y="${ly - h + 40 + i * 15}" style="font:10.5px Arial,sans-serif;fill:#111">${esc(c)}</text>`).join('')}`); }
  else { const id = `sg${Math.random().toString(36).slice(2, 8)}`, rn = view === 'uncertainty' ? 'magma' : ramp, a = view === 'uncertainty' ? 0 : lo, b = view === 'uncertainty' ? Math.max(...(f.field?.unc || [1])) : hi; o.push(`<defs><linearGradient id="${id}">${[0, .25, .5, .75, 1].map(t => `<stop offset="${t}" stop-color="${soilHex(rampAt(rn, t))}"/>`).join('')}</linearGradient></defs><rect x="${lx - 4}" y="${ly - 38}" width="190" height="46" rx="3" fill="#fff" opacity=".9"/><text x="${lx}" y="${ly - 24}" style="font:700 10.5px Arial,sans-serif;fill:#111">${esc(title)}</text><rect x="${lx}" y="${ly - 18}" width="170" height="9" fill="url(#${id})"/><text x="${lx}" y="${ly + 4}" style="font:10px Arial,sans-serif;fill:#111">${soilFmt(a)}</text><text x="${lx + 170}" y="${ly + 4}" text-anchor="end" style="font:10px Arial,sans-serif;fill:#111">${soilFmt(b)}</text>`); }
  const nice = niceStep(120 / sc, 1), bar = nice * sc; o.push(`<rect x="${W - bar - 34}" y="${H - 34}" width="${bar + 26}" height="20" rx="3" fill="#fff" opacity=".9"/><path d="M${W - bar - 22} ${H - 22}v4h${bar}v-4" fill="none" stroke="#111"/><text x="${W - 22 - bar / 2}" y="${H - 24}" text-anchor="middle" style="font:10px Arial,sans-serif;fill:#111">${+nice.toFixed(1)} m</text>`);
  return o.join('') + '</svg>';
}
function drawSoil() {
  const el = $('#plan'); if (!el) return; const v = soilCurrent();
  el.innerHTML = soilMapSVG(Math.max(el.clientWidth, 420), 560, v, true) + planCtlHTML();
}
function soilRefresh() { drawSoil(); ctlRender(); }
function soilCtl() {
  const v = soilCurrent(), props = soilProps(), ds = soilDepths(); if (!props.length || !ds.length) return [{ id: 'soil-none', title: 'Show', icon: NAV_ICON.soil, html: '<p class="note">Add points and results to choose what to show.</p>' }];
  const f = soilSurface(v.prop, v.depth, v), sel = (k, opts) => `<select data-sv="${k}" style="width:100%">${opts.map(([a, b]) => `<option value="${esc(a)}" ${String(v[k] ?? '') === String(a) ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>`, fld = (t, h) => `<div class="fld"><label>${t}</label>${h}</div>`, num = (k, ph = '') => `<input type="number" step="any" data-sv="${k}" value="${esc(v[k] ?? '')}" placeholder="${esc(ph)}">`, chk = (k, t) => `<label class="check"><input type="checkbox" data-sv="${k}" ${v[k] ? 'checked' : ''}> ${t}</label>`;
  const isNum = f.kind === 'num', views = [['auto', 'Best for this data'], ['symbols', 'Symbols'], ...(isNum ? [['graduated', 'Graduated circles'], ['heat', 'Heat map'], ['uncertainty', 'Uncertainty']] : [['zones', 'Class zones'], ['uncertainty', 'Uncertainty']]), ...(surveyOf().points.some(p => p.samples.some(s => csscOf(s))) ? [['pie', 'Sand, silt, clay pies']] : [])];
  const methods = [['auto', `Automatic (${{ none: 'points only', idw: 'inverse distance', krige: 'kriging', nearest: 'nearest point', indicator: 'indicator kriging' }[SoilStats.chooseMethod(f.n, isNum ? 'num' : 'class').method]})`], ...(isNum ? [['idw', 'Inverse distance'], ['krige', 'Ordinary kriging']] : [['nearest', 'Nearest point'], ['indicator', 'Indicator kriging']])];
  return [
    { id: 'soil-show', title: 'Show', icon: NAV_ICON.soil, html: `${fld('Property', sel('prop', props.map(p => [p.k, p.label])))}${fld('Depth', sel('depth', [...ds.map(d => [d.key, `${d.label} (${d.n})`]), ['*', 'All depths combined']]))}${fld('View', sel('view', views))}${chk('labels', 'Value labels')}${isNum ? chk('contours', 'Contour lines') : ''}${chk('pointsHidden', 'Hide measured points')}` },
    { id: 'soil-method', title: 'Method', icon: NAV_ICON.gwm, html: `<p class="note" style="margin-top:0">${esc(f.why)}</p>${fld('Method', sel('method', methods))}${isNum ? `${fld('Inverse distance power', num('power'))}${fld('Neighbours', num('k'))}${fld('Log transform', sel('log', [['auto', `Automatic (${f.log ? 'on' : 'off'})`], ['on', 'On'], ['off', 'Off']]))}${fld('Variogram model', sel('vgModel', [['auto', 'Best fit'], ['spherical', 'Spherical'], ['exponential', 'Exponential']]))}${fld('Variogram nugget, sill, range', `<div class="inline">${num('nugget', f.vg ? soilFmt(f.vg.nugget) : '')}${num('sill', f.vg ? soilFmt(f.vg.sill) : '')}${num('range', f.vg ? soilFmt(f.vg.range) : '')}</div>`)}` : `${v.prop === 'texture' ? fld('Texture map from', sel('texMode', [['auto', 'Sand, silt and clay'], ['classes', 'Texture classes']])) : ''}`}${fld('Cell size (m)', num('cell', soilFmt(f.cell)))}${chk('maskOff', 'Draw colour far from points')}` },
    { id: 'soil-style', title: 'Colours', icon: NAV_ICON.site, html: `${fld('Colour scale', sel('ramp', [['viridis', 'Blue to yellow'], ['magma', 'Pale to dark']]))}${isNum ? `${fld('Scale from, to', `<div class="inline">${num('min', 'auto')}${num('max', 'auto')}</div>`)}${fld('Colour steps', num('steps', 'smooth'))}` : ''}` },
    { id: 'soil-warn', title: `Warnings (${f.warnings.length})`, icon: NAV_ICON.gw, html: `${f.warnings.length ? `<ul class="soil-warn">${f.warnings.map(w => `<li data-warn="${w.id}">${esc(w.text)}</li>`).join('')}</ul>` : '<p class="note" style="margin:0">Nothing to flag on this map.</p>'}${[...f.notes, f.unmappedNote].filter(Boolean).map(n => `<p class="note">${esc(n)}</p>`).join('')}` },
  ];
}
document.addEventListener('change', e => {
  const t = e.target, k = t.dataset?.sv; if (!k) return; const num = ['power', 'k', 'nugget', 'sill', 'range', 'min', 'max', 'steps', 'cell'].includes(k);
  soilSet({ [k]: t.type === 'checkbox' ? t.checked : num ? (t.value === '' ? null : +t.value) : t.value }); soilRefresh();
});
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
