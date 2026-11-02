/* End-to-end checks of the classic interface (resources/legacy, the offline build) in a real Electron window, with the
   network blocked. Run with `npm run test:app`; exits non-zero when any check fails. Each check gets a fresh profile. */
import { app, BrowserWindow, session, ipcMain } from 'electron';
import { mf6Binary, runMf6 } from '../../src/main/mf6run.mjs';
import { resolve } from 'node:path';

const PAGE = resolve('resources/legacy/index.html');
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [];
let n = 0;
app.on('window-all-closed', () => {});   // each check closes its window; without this Electron quits between checks

ipcMain.handle('mf6:run', (_e, o) => runMf6({ bin: mf6Binary(resolve('.')), files: o?.files, outputs: o?.outputs || [] }));
async function withPage(fn, opts = {}) {
  const ses = session.fromPartition('check-' + ++n);   // in memory: a fresh profile that survives reloads within the check
  ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: /^https?:/.test(d.url) }));   // offline: nothing from the internet
  const win = new BrowserWindow({ show: false, width: 1440, height: 920, webPreferences: { session: ses, ...(opts.mf6 ? { preload: resolve('tests/app/preload-mf6.cjs') } : {}) } });
  const load = async () => {
    await win.loadFile(PAGE); await wait(1500);
    await run(`window.__errs = []; addEventListener('error', e => __errs.push(e.message)); addEventListener('unhandledrejection', e => __errs.push(String(e.reason?.stack || e.reason))); window.confirm = () => true; 1`);
  };
  const run = js => win.webContents.executeJavaScript(js);
  try { await load(); return await fn(run, load); }
  finally { win.destroy(); }
}

async function check(name, fn, opts) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;   // ONLY=<text> runs the checks whose name contains it
  try { await withPage(async (run, load) => { await fn(run, load); const errs = await run('window.__errs'); if (errs.length) throw new Error('page errors: ' + errs.join(' | ')); }, opts); results.push([name, null]); }
  catch (e) { results.push([name, e.message || String(e)]); }
}
const expect = (ok, msg) => { if (!ok) throw new Error(msg); };

app.whenReady().then(async () => {
  await check('loads offline: libraries from lib/, the system UI font, no web fonts', async run => {
    const r = await run(`(async () => { await document.fonts.ready; return { xlsx: !!window.XLSX, excel: !!window.ExcelJS, pdf: !!window.jspdf, pdfjs: !!window.pdfjsLib, pdflib: !!window.PDFLib, worker: window.pdfjsLib?.GlobalWorkerOptions?.workerSrc || '', font: getComputedStyle(document.body).fontFamily, links: [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.href).filter(h => /^https?:/.test(h)), sync: document.querySelector('#sync').textContent }; })()`);
    expect(r.xlsx && r.excel && r.pdf, 'a library did not load: ' + JSON.stringify(r));
    expect(r.pdfjs && r.pdflib && /^lib\/pdf\.worker\.min\.js$/.test(r.worker), 'PDF libraries did not load from lib/: ' + JSON.stringify(r));
    expect(/Segoe UI/.test(r.font) && /system-ui/.test(r.font), 'not the system UI font: ' + r.font);
    expect(!r.links.length, 'loads stylesheets from the internet: ' + r.links.join(', '));
    expect(r.sync === 'Saved on this computer', 'unexpected status ' + r.sync);
    expect(await run(`loadScript('lib/geotiff.js').then(() => !!window.GeoTIFF)`), 'GeoTIFF reader did not load from lib/');
  });

  await check('every view renders for every example project', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)); loadLloydExample(); loadSkExample(); loadDlExample(); await w(500);
      const projects = [...new Set([...S.bh.values()].map(b => b.project))], bad = [];
      for (const p of projects) {
        S.sel = sortedList().find(b => b.project === p).id;
        for (const t of ['home', 'site', 'table', 'gw', 'contam', 'reports', 'compose', 'log', 'edit', 'report']) {
          try { goTab(t); await w(120); if (t === 'edit') for (const d of ['details', 'soil', 'samples', 'ww']) { S.dtab = d; renderView(true); } if (t === 'table') for (const k of Object.keys(SHEETS)) { S.tsheet = k; gridRedraw(); } } catch (e) { bad.push(p + '/' + t + ': ' + e.message); }
        }
        for (const b of sortedList().filter(b => b.project === p)) { S.sel = b.id; try { goTab('log'); } catch (e) { bad.push(b.name + ': ' + e.message); } }
      }
      for (const st of ['setup', 'soil', 'samples', 'well', 'finish']) { try { openQL(st); } catch (e) { bad.push('quick log ' + st + ': ' + e.message); } } closeQL();
      return { projects: projects.length, bad };
    })()`);
    expect(r.projects === 4, `expected 4 projects, got ${r.projects}`);
    expect(!r.bad.length, r.bad.join('; '));
  });

  await check('Excel export writes an .xlsx workbook; PDF log writes a .pdf', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), saved = []; window.saveFile = async (n, d) => { saved.push([n, d?.size ?? d?.byteLength]); return true; };
      goTab('home'); openExport(); await w(200); document.querySelector('[data-act="do-export"]').click();
      for (let i = 0; i < 60 && !saved.length; i++) await w(250);
      closeOverlay(); S.sel = sortedList()[0].id; goTab('log'); await pdfLogs([cur()]);
      for (let i = 0; i < 60 && saved.length < 2; i++) await w(250);
      return saved;
    })()`);
    expect(r[0] && /\.xlsx$/.test(r[0][0]) && r[0][1] > 10000, 'Excel export: ' + JSON.stringify(r[0]));
    expect(r[1] && /\.pdf$/.test(r[1][0]) && r[1][1] > 10000, 'PDF log: ' + JSON.stringify(r[1]));
  });

  await check('text from a project file never runs as code', async run => {
    const fired = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), P = n => '"><img src=x onerror="window.__xss=(window.__xss||[]).concat(\\'' + n + '\\')">';
      const b = blankBorehole(P('name'));
      for (const k of ['project', 'projNo', 'client', 'location', 'contractor', 'rig', 'method', 'logger', 'reviewer', 'weather', 'datum', 'termination', 'notes']) b[k] = P(k);
      Object.assign(b, { easting: 500000, northing: 5900000, elevation: 700, crs: 'UTM NAD83 Zone 12 ' + P('crs') });
      b.layers = [{ ...newLayer(0), bottom: 2, uscs: P('uscs'), mods: P('mods'), colour: P('colour'), other: P('other'), origin: P('origin'), consistency: P('cons'), moisture: P('moist') }];
      b.samples = [{ depth: 1, type: 'SS', no: P('sno'), b1: 3, b2: 4, b3: 5, lab: { [P('labkey')]: { v: 5 } }, labMeta: { lab: P('lab'), report: P('rep'), date: '' }, note: P('snote') }];
      b.water = [{ kind: P('wkind'), depth: 1.2, measured: 1.2, date: P('wdate'), ref: 'gs' }];
      b.comments = [{ id: 'c1', text: P('comment'), by: P('cby'), at: '' }]; b.history = [{ at: '', by: P('hby'), what: P('hwhat') }];
      b.well = { ...blankWell(), installed: true, material: P('wmat'), slot: P('slot'), screenTop: 1, screenBottom: 2, depth: 2, annulus: [{ top: 0, bottom: 2, mat: P('ann') }] };
      S.co.name = P('coname'); S.co.projLabel = P('projlabel');
      await restore(new File([JSON.stringify({ app: 'borehole-field-log', kind: 'workspace', company: S.co, boreholes: [b] })], 'x.bhlog')); await w(200);
      for (const t of ['home', 'site', 'table', 'gw', 'contam', 'reports', 'compose', 'log', 'edit', 'report']) { goTab(t); await w(100); if (t === 'edit') for (const d of ['details', 'soil', 'samples', 'ww']) { S.dtab = d; renderView(true); } }
      openHistory(); closeOverlay(); openComments(); closeOverlay(); await w(300);
      return window.__xss || [];
    })()`);
    expect(!fired.length, 'script ran from fields: ' + fired.join(', '));
  });

  await check('saved data moves from local storage to IndexedDB and survives a restart', async (run, load) => {
    await run(`localStorage.setItem('bhlog.local', JSON.stringify([{ ...blankBorehole('OLD-01'), id: 'old1' }])); localStorage.setItem('bhlog.company', JSON.stringify({ name: 'Old Firm' })); 1`);
    await load();
    const r = await run(`({ names: sortedList().map(b => b.name), co: S.co.name, left: localStorage.getItem('bhlog.local') })`);
    expect(r.names.join() === 'OLD-01' && r.co === 'Old Firm' && r.left == null, 'migration: ' + JSON.stringify(r));
    await run(`(async () => { for (let i = 0; i < 300; i++) { const b = blankBorehole('BIG-' + i); b.notes = 'n'.repeat(3000); S.bh.set(b.id, b); store.save(b); }
      S.site = { img: 'data:image/png;base64,' + 'A'.repeat(30e6) }; saveSite(); await window.flushSaves(); })()`);
    await load();
    const r2 = await run(`({ n: S.bh.size, mb: Math.round((S.site?.img?.length || 0) / 1e6), sync: document.querySelector('#sync').textContent })`);
    expect(r2.n === 301 && r2.mb === 30 && r2.sync === 'Saved on this computer', 'large data after restart: ' + JSON.stringify(r2));
  });

  await check('a failed save is shown, never reported as saved', async run => {
    const r = await run(`(async () => {
      dataStore.put = async () => { throw new Error('blocked'); }; const real = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); };
      const b = cur(); b.notes = 'x'; store.save(b); await window.flushSaves(); const failed = document.querySelector('#sync').textContent;
      Storage.prototype.setItem = real; b.notes = 'y'; store.save(b); await window.flushSaves();
      return { failed, after: document.querySelector('#sync').textContent };
    })()`);
    expect(r.failed === 'Not saved: storage full', 'while failing: ' + r.failed);
    expect(r.after === 'Saved on this computer', 'after recovery: ' + r.after);
  });

  await check('unreadable saved data is never replaced', async (run, load) => {
    await run(`dataStore.put('bhlog.local', '{corrupt').then(() => 1)`); await load();
    const r = await run(`(async () => { const b = blankBorehole('NEW'); S.bh.set(b.id, b); store.save(b); await window.flushSaves(); return { sync: document.querySelector('#sync').textContent, stored: await dataStore.get('bhlog.local') }; })()`);
    expect(r.stored === '{corrupt', 'saved data was overwritten');
    expect(r.sync === 'Not saved: stored data unreadable', 'status: ' + r.sync);
  });

  await check('opening an older file asks before replacing issued or newer boreholes, and keeps the company', async run => {
    const r = await run(`(async () => {
      S.co.name = 'Real Firm Ltd'; const [b1, b2, b3] = sortedList();
      const file = { app: 'borehole-field-log', kind: 'project', project: b1.project, company: { name: 'OTHER FIRM' }, boreholes: [b1, b2, b3].map(b => ({ ...structuredClone(b), notes: 'FROM FILE', updated: '2020-01-01T00:00:00Z' })) };
      b1.status = 'issued'; b2.notes = 'MINE'; b2.updated = new Date().toISOString();
      let asked = false; window.confirm = () => { asked = true; return false; };
      await restore(new File([JSON.stringify(file)], 'old.bhp'));
      return { asked, b1: S.bh.get(b1.id).notes, b2: S.bh.get(b2.id).notes, b3: S.bh.get(b3.id).notes, co: S.co.name };
    })()`);
    expect(r.asked, 'did not ask');
    expect(r.b1 !== 'FROM FILE' && r.b2 === 'MINE' && r.b3 === 'FROM FILE', 'replaced the wrong boreholes: ' + JSON.stringify(r));
    expect(r.co === 'Real Firm Ltd', 'company replaced by the file: ' + r.co);
  });

  await check('menu bar: eight menus, every command runs, arrow keys move through it', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), bad = [];
      loadLloydExample(); await w(300);
      const names = [...document.querySelectorAll('#menubar [data-mb]')].map(b => b.textContent);
      // file pickers and downloads would open system dialogs in a test, so those are left out
      const skip = new Set(['open-file', 'save-proj', 'save-proj-as', 'backup', 'import', 'imp-lab', 'imp-loc', 'imp-shp', 'imp-img', 'export', 'ags', 'pdf-one', 'pdf-all', 'plan-pdf', 'clear-examples']);
      let ran = 0;
      for (const [, items] of MENUS) for (const it of items) {
        if (!Array.isArray(it) || skip.has(it[1]) || !menuEnabled(it[1])) continue;
        S.sel = sortedList()[1].id;
        try { runAct(it[1]); await w(120); ran++; } catch (e) { bad.push(it[1] + ': ' + e.message); }
        closeOverlay(); closeMenu?.(); if (S.qlOpen) closeQL(); if (S.drawer) closeDrawer(); if (!$('#find').hidden) closeFind();
        if (document.body.classList.contains('field')) toggleField();
      }
      document.querySelector('#menubar [data-mb="0"]').focus();
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      const opened = $('#mb-pop')?.dataset.mb, first = document.activeElement?.dataset.mact;
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      const next = $('#mb-pop')?.dataset.mb;
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return { names, ran, bad, opened, first, next, closed: !$('#mb-pop') };
    })()`);
    expect(r.names.join() === 'File,Edit,View,Project,Boreholes,Tools,Reports,Help', 'menus: ' + r.names.join());
    expect(!r.bad.length, r.bad.join('; '));
    expect(r.ran > 25, 'only ran ' + r.ran + ' commands');
    expect(r.opened === '0' && r.first === 'new-project' && r.next === '1' && r.closed, 'keyboard: ' + JSON.stringify(r));
  });

  await check('status bar shows the borehole, its problems and the save state', async run => {
    const r = await run(`(async () => {
      loadLloydExample(); const b = sortedList()[0]; S.sel = b.id; b.layers.push({ ...newLayer(99), bottom: null }); render();
      return { bh: document.querySelector('#sb-bh').textContent, iss: document.querySelector('#sb-iss').textContent, sync: document.querySelector('#sync').textContent, name: b.name };
    })()`);
    expect(r.bh.includes(r.name), 'borehole: ' + r.bh);
    expect(/problem/.test(r.iss) && /^\d/.test(r.iss), 'problems: ' + r.iss);
    expect(r.sync === 'Saved on this computer', 'save state: ' + r.sync);
  });

  await check('soil layers: duplicate leaves the new bottom for the user, and the grid edits one borehole', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)); loadLloydExample(); const b = sortedList().find(x => x.status !== 'issued'); S.sel = b.id; S.layer = 0; S.dtab = 'soil'; goTab('edit'); await w(100);
      const n = b.layers.length, src = b.layers[0]; layerTool('l-dup'); const d = b.layers[1];
      const dup = { n: b.layers.length - n, top: d.top, bottom: d.bottom, same: d.uscs === src.uscs && d.colour === src.colour, flagged: liveIssues(b).some(x => x.id === d.id && x.k === 'bottom') };
      runAct('grid-bh'); await w(150);   // the project grid scoped to this borehole (Data tables, Tools)
      const rows = [...document.querySelectorAll('.dgrid tbody tr[data-bh]')].map(x => x.dataset.bh);
      return { dup, srcBottom: src.bottom, tab: S.tab, rows: [...new Set(rows)], name: b.id };
    })()`);
    expect(r.dup.n === 1 && r.dup.top === r.srcBottom && r.dup.bottom == null && r.dup.same && r.dup.flagged, 'duplicate: ' + JSON.stringify(r.dup));
    expect(r.tab === 'table' && r.rows.length === 1 && r.rows[0] === r.name, 'grid: ' + JSON.stringify(r));
  });

  await check('borehole workspace: type depths in the layer list, pick the soil, Enter starts the next layer, the log follows', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)); loadLloydExample(); const b = sortedList().find(x => x.status !== 'issued'); S.sel = b.id; S.dtab = 'soil'; goTab('edit'); await w(200);
      const has = { grid: !!document.querySelector('.ws .dgrid[data-sheet="layerList"][data-scope="one"]') && !!document.querySelector('.ws #ldetail [data-qpick="uscs"]'), log: !!document.querySelector('#ws-col svg'), tree: [...document.querySelectorAll('#prail button')].map(x => x.textContent), cur: document.querySelector('#prail [aria-current="page"]')?.textContent, rows: document.querySelectorAll('#list .bl-row').length, want: projList().length };
      const n0 = b.layers.length, rows = () => [...document.querySelectorAll('.ws .dgrid[data-sheet="layerList"] tbody tr')];
      const last = rows().at(-1).querySelector('input[data-c="0"]'); last.focus();
      last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await w(200);
      const added = b.layers.length - n0, fresh = document.activeElement;
      const top = b.layers.at(-1).top, prevBottom = b.layers.at(-2).bottom;
      const set = (c, v) => { const el = document.querySelector('.ws .dgrid[data-sheet="layerList"] tbody tr:last-child input[data-c="' + c + '"]'); el.focus(); el.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
      set(1, (prevBottom + 1.2).toFixed(2)); await w(50);
      // the pick panel edits the selected (new) layer
      document.querySelector('.ws #ldetail [data-qpick="uscs"][data-term="SP"]').click(); await w(300);
      const nl = b.layers.at(-1), logText = document.querySelector('#ws-col').textContent;
      // clicking a layer on the log puts the cursor in its row
      document.querySelector('#ws-col [data-qli="0"] rect').dispatchEvent(new MouseEvent('click', { bubbles: true })); await w(100);
      const focusedRow = [...document.querySelectorAll('.ws .dgrid[data-sheet="layerList"] tbody tr')].findIndex(tr => tr.classList.contains('cur'));
      // samples tab: two grids, and the folded sample editor follows the row with the cursor
      S.dtab = 'samples'; renderView(true); await w(100);
      const sheets = [...document.querySelectorAll('.ws .dgrid')].filter(t => t.offsetParent).map(t => t.dataset.sheet);
      // a hidden test window gets no focus events, so the one a click would send is sent here
      const sIn = document.querySelectorAll('.ws .dgrid[data-sheet="samples"] input[data-c="0"]')[2]; sIn.focus(); sIn.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); await w(50);
      return { has, added, focusedCell: fresh?.dataset?.c, top, prevBottom, nl: { bottom: nl.bottom, uscs: nl.uscs }, logHasSand: /SAND/.test(logText), focusedRow, sheets, which: document.querySelector('[data-which="samples"]')?.textContent, sel: S.dsel.samples };
    })()`);
    expect(r.has.grid && r.has.log, 'workspace parts: ' + JSON.stringify(r.has));
    expect(r.has.tree.join() === 'Overview,Borehole,Map,Tables,Water,Lab,Section,Model,3D,Reports' && r.has.cur === 'Borehole' && r.has.rows === r.has.want, 'rail and list: ' + JSON.stringify(r.has));
    expect(r.added === 1 && r.top === r.prevBottom, 'Enter on the last row: ' + JSON.stringify(r));
    expect(r.nl.uscs === 'SP' && Math.abs(r.nl.bottom - (r.prevBottom + 1.2)) < 1e-6 && r.logHasSand, 'typed interval: ' + JSON.stringify(r.nl) + ' log has sand ' + r.logHasSand);
    expect(r.focusedRow === 0, 'log click focused row ' + r.focusedRow);
    expect(r.sheets.join() === 'samples,tests' && r.sel === 2 && /\S/.test(r.which || ''), 'samples tab: ' + JSON.stringify(r));
  });

  await check('borehole list: filter, status chips and sort narrow and order the boreholes', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)); loadLloydExample(); goTab('home'); await w(100);
      const names = () => [...document.querySelectorAll('#list .bl-row .nm')].map(x => x.textContent);
      const q = document.querySelector('#bl-q'); q.value = '24-0'; q.dispatchEvent(new Event('input', { bubbles: true })); await w(50);
      const filtered = names().length; const q2 = document.querySelector('#bl-q'); q2.value = ''; q2.dispatchEvent(new Event('input', { bubbles: true })); await w(50);   // the header redraws, so find the box again
      document.querySelector('[data-blst="wells"]').click(); await w(50); const wells = names().length, wantWells = projList().filter(b => b.well?.installed).length;
      document.querySelector('[data-blst="all"]').click(); document.querySelector('[data-blsort="vapour"]').click(); await w(50);
      const top = names()[0], max = sortedList().filter(b => b.project === cur().project).map(b => ({ n: b.name, v: vapourMax(b, null, null)?.cvc ?? -1 })).sort((a, b) => b.v - a.v)[0].n;
      document.querySelector('[data-blsort="name"]').click();
      document.querySelectorAll('#list .bl-row')[3].click(); await w(100);
      return { filtered, wells, wantWells, top, max, tab: S.tab, rail: document.querySelector('#prail [aria-current="page"]')?.textContent };
    })()`);
    expect(r.filtered === 9 && r.wells === r.wantWells && r.wells > 0, 'filter and chips: ' + JSON.stringify(r));
    expect(r.top === r.max, 'sort by vapour: ' + JSON.stringify(r));
    expect(r.tab === 'edit' && r.rail === 'Borehole', 'picking a borehole opens it: ' + JSON.stringify(r));
  });

  await check('report: imported PDF pages and images become pages and travel in the project file', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)); loadLloydExample(); goTab('compose'); await w(200);
      const doc = await PDFLib.PDFDocument.create(), font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
      for (let i = 1; i <= 3; i++) doc.addPage([612, 792]).drawText('ARCGIS MAP PAGE ' + i, { x: 72, y: 700, size: 18, font });
      const n0 = repLayout().pages.length;
      const added = await importReportFiles([new File([await doc.save()], 'map.pdf', { type: 'application/pdf' })]);
      const pdfPages = repLayout().pages.filter(p => p.kind === 'pdf').map(p => [p.page, p.file]);
      const png = await (await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')).blob();
      const addedImg = await importReportFiles([new File([png], 'photo.png', { type: 'image/png' })]);
      const imgPage = repLayout().pages.some(p => p.kind === 'free' && p.items.length === 1 && p.items[0].t === 'image' && /^data:image/.test(p.items[0].o?.img || ''));
      const bad = await importReportFiles([new File([new Uint8Array([1, 2, 3])], 'bad.pdf', { type: 'application/pdf' })]);
      const n1 = repLayout().pages.length;
      let saved = null; window.saveTo = async (key, name, ext, data) => { saved = data; };
      await saveProject(false);
      return { added, pdfPages, addedImg, imgPage, bad, n0, n1, travels: !!saved?.photos?.some(ph => String(ph.bhId).startsWith('reportfile:')) };
    })()`);
    expect(r.added === 3 && r.pdfPages.map(p => p[0]).join() === '1,2,3' && new Set(r.pdfPages.map(p => p[1])).size === 1, 'PDF import: ' + JSON.stringify(r));
    expect(r.addedImg === 1 && r.imgPage, 'image import: ' + JSON.stringify(r));
    expect(r.bad === 0 && r.n1 === r.n0 + 4, 'a damaged PDF adds nothing: ' + JSON.stringify(r));
    expect(r.travels, 'the imported file is not saved in the project file');
  });

  await check('report: thumbnails, page sorter, drag order, rotate and delete with undo', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)); loadLloydExample(); goTab('compose'); await w(200);
      const doc = await PDFLib.PDFDocument.create(), font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
      for (let i = 1; i <= 3; i++) doc.addPage([792, 612]).drawText('ARCGIS MAP PAGE ' + i, { x: 72, y: 500, size: 18, font });
      await importReportFiles([new File([await doc.save()], 'map.pdf', { type: 'application/pdf' })]);
      const L = () => repLayout(), pdfIx = () => L().pages.map((p, i) => p.kind === 'pdf' ? i : -1).filter(i => i >= 0);
      let thumbs = 0; for (let t = 0; t < 60 && thumbs < L().pages.length; t++) { await w(250); thumbs = [...document.querySelectorAll('.cmp-pg img')].filter(i => i.complete && i.naturalWidth).length; }
      const total = L().pages.length;
      S.csort = true; rerenderCompose(); await w(300); const tiles = document.querySelectorAll('.cmp-sorter [data-tile]').length; S.csort = false;
      const last = pdfIx().at(-1); movePage(last, 0); const first = L().pages[0];
      S.cpage = 0; composeAct('cmp-rot-r'); composeAct('cmp-rot-r'); const rot = L().pages[0].rot;
      for (const i of pdfIx().reverse()) { S.cpage = i; composeAct('cmp-delpage'); await w(80); }
      const afterDelete = pdfIx().length;
      for (let k = 0; k < 6 && pdfIx().length < 3; k++) { undo(); await w(50); }
      return { thumbs, total, tiles, first: [first.kind, first.page], rot, afterDelete, restored: pdfIx().length };
    })()`);
    expect(r.thumbs === r.total, 'thumbnails: ' + JSON.stringify(r));
    expect(r.tiles === r.total, 'page sorter tiles: ' + JSON.stringify(r));
    expect(r.first.join() === 'pdf,3', 'move page: ' + JSON.stringify(r));
    expect(r.rot === 180, 'rotate: ' + JSON.stringify(r));
    expect(r.afterDelete === 0 && r.restored === 3, 'delete and undo: ' + JSON.stringify(r));
  });

  await check('report: export keeps imported pages as real PDF pages with their text and rotation', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)); loadLloydExample(); goTab('compose'); await w(200);
      const doc = await PDFLib.PDFDocument.create(), font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
      for (let i = 1; i <= 2; i++) doc.addPage([792, 612]).drawText('ARCGIS MAP PAGE ' + i, { x: 72, y: 500, size: 18, font });
      await importReportFiles([new File([await doc.save()], 'map.pdf', { type: 'application/pdf' })]);
      const imported = repLayout().pages.filter(p => p.kind === 'pdf'); imported[1].rot = 180;
      const L = { pages: [newPage('key'), ...imported] }, outs = await layoutPages(L);
      const bytes = await buildReportBytes(L), out = await PDFLib.PDFDocument.load(bytes);
      const k = outs.findIndex(o => o.pdf), pj = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      const text = (await (await pj.getPage(k + 1)).getTextContent()).items.map(i => i.str).join(' ');
      return { n: out.getPageCount(), want: outs.length, text, rot: out.getPage(k + 1).getRotation().angle, keySize: out.getPage(0).getSize() };
    })()`);
    expect(r.n === r.want && r.want === 3, 'page count: ' + JSON.stringify(r));
    expect(/ARCGIS MAP PAGE 1/.test(r.text), 'imported text not kept: ' + JSON.stringify(r));
    expect(r.rot === 180, 'rotation: ' + JSON.stringify(r));
    expect(Math.round(r.keySize.width) === 612 && Math.round(r.keySize.height) === 792, 'Letter page size: ' + JSON.stringify(r));
  });

  await check('report: the Add and Rotate buttons and the file picker work when clicked', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)); loadLloydExample(); goTab('compose'); await w(200);
      const input = document.querySelector('#rep-file'); let opened = 0; input.click = () => { opened++; };
      document.querySelector('[data-act="cmp-import"]').click();
      const doc = await PDFLib.PDFDocument.create(); doc.addPage([792, 612]); const dt = new DataTransfer(); dt.items.add(new File([await doc.save()], 'one.pdf', { type: 'application/pdf' }));
      const n0 = repLayout().pages.length; input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      for (let t = 0; t < 40 && repLayout().pages.length === n0; t++) await w(100);
      const added = repLayout().pages.length - n0, pg = curPage();
      document.querySelector('.cmp-side [data-act="cmp-rot-r"]').click(); await w(50);
      return { opened, added, kind: pg.kind, rot: curPage().rot };
    })()`);
    expect(r.opened === 1, 'Add PDF or image did not open the picker: ' + JSON.stringify(r));
    expect(r.added === 1 && r.kind === 'pdf', 'picked file not imported: ' + JSON.stringify(r));
    expect(r.rot === 90, 'Rotate right button: ' + JSON.stringify(r));
  });

  await check('report: secured PDFs refused, shared resources copied once, deleted imports not saved, templates and missing files', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)); loadLloydExample(); goTab('compose'); await w(200);
      // a PDF whose trailer says it is encrypted: pdf-lib cannot copy its pages, so it must be refused at import
      const plain = await PDFLib.PDFDocument.create(); plain.addPage([612, 792]);
      const enc = plain.context.register(plain.context.obj({ Filter: 'Standard', V: 1, R: 2, P: -44, O: PDFLib.PDFHexString.of('00'.repeat(32)), U: PDFLib.PDFHexString.of('00'.repeat(32)) }));
      plain.context.trailerInfo.Encrypt = enc;
      const secured = await importReportFiles([new File([await plain.save({ useObjectStreams: false })], 'secured.pdf', { type: 'application/pdf' })]);
      // 40 pages sharing one picture: the export must not copy the picture 40 times
      const c = document.createElement('canvas'); c.width = c.height = 300; const ctx = c.getContext('2d'); for (let i = 0; i < 9000; i++) { ctx.fillStyle = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'); ctx.fillRect(Math.random() * 300, Math.random() * 300, 4, 4); }
      const big = await PDFLib.PDFDocument.create(), img = await big.embedPng(c.toDataURL('image/png'));
      for (let i = 0; i < 40; i++) big.addPage([612, 792]).drawImage(img, { x: 50, y: 300, width: 300, height: 300 });
      const srcBytes = await big.save(); await importReportFiles([new File([srcBytes], 'atlas.pdf', { type: 'application/pdf' })]);
      const atlas = repLayout().pages.filter(p => p.kind === 'pdf' && /^atlas/.test(p.title));
      const outBytes = await buildReportBytes({ pages: atlas });
      // template: imported pages belong to one project and are left out
      composeAct('cmp-tpl-save'); document.querySelector('#tpl-name').value = 'With imports'; composeAct('cmp-tpl-save-go');
      const tpl = (S.co.reportTpls || []).find(t => t.name === 'With imports');
      // a page whose file is missing names itself in the error
      let missingMsg = ''; try { await buildReportBytes({ pages: [{ ...newPage('pdf', { title: 'Lab certificate 7', file: 'rf-gone', page: 1, rot: 0 }) }] }); } catch (e) { missingMsg = e.message; }
      // deleted imports do not travel in the project file
      const L = repLayout(); L.pages = L.pages.filter(p => p.kind !== 'pdf'); saveLayout(L);
      let saved = null; window.saveTo = async (key, name, ext, data) => { saved = data; }; await saveProject(false);
      return { secured, srcSize: srcBytes.length, outSize: outBytes.length, atlas: atlas.length, tplPdf: tpl ? tpl.pages.filter(p => p.kind === 'pdf').length : -1, missingMsg, orphans: (saved?.photos || []).filter(ph => String(ph.bhId).startsWith('reportfile:')).length };
    })()`);
    expect(r.secured === 0, 'secured PDF was imported: ' + JSON.stringify(r));
    expect(r.atlas === 40 && r.outSize < r.srcSize * 1.5, 'shared picture copied per page: ' + JSON.stringify(r));
    expect(r.tplPdf === 0, 'template kept imported pages: ' + JSON.stringify(r));
    expect(/Lab certificate 7/.test(r.missingMsg), 'missing file not named: ' + JSON.stringify(r));
    expect(r.orphans === 0, 'deleted imports still saved in the project file: ' + JSON.stringify(r));
  });

  await check('report canvas: zoom and rulers line up with the paper', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)); loadLloydExample(); goTab('compose'); S.cpage = 1; S.csort = false; rerenderCompose(); await w(300);
      setZoom(2); await w(300);
      const paper = document.querySelector('#cmp-paper').getBoundingClientRect(), d = pgDims(curPage());
      const tick = document.querySelector('.rl-x [data-mm="100"]'), ytick = document.querySelector('.rl-y [data-mm="100"]');
      return { pw: paper.width, want: d.W * 2, off: tick ? tick.getBoundingClientRect().left - paper.left : null, yoff: ytick ? ytick.getBoundingClientRect().top - paper.top : null, mm100: 100 * 96 / 25.4 * 2 };
    })()`);
    expect(Math.abs(r.pw - r.want) < 1, 'zoomed paper width: ' + JSON.stringify(r));
    expect(r.off != null && Math.abs(r.off - r.mm100) < 1.5 && Math.abs(r.yoff - r.mm100) < 1.5, 'ruler ticks off the paper: ' + JSON.stringify(r));
  });

  await check('report canvas: guides and snapping', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)); loadLloydExample(); goTab('compose'); S.cpage = 1; S.csort = false; rerenderCompose(); await w(300);
      const pg = curPage(), bd = bodyOf(pg); addGuide(pg, 'y', 300);
      const other = newItem('text', 200, 600, { w: 100, h: 50 }); pg.items.push(other);
      const a = snapBox(pg, { x: 400, y: 296, w: 120, h: 80 }, []);
      const b = snapBox(pg, { x: bd.x + 4, y: 500, w: 100, h: 100 }, []);
      const c = snapBox(pg, { x: 303, y: 700, w: 80, h: 40 }, []);
      const far = snapBox(pg, { x: 450, y: 450, w: 37, h: 37 }, []);
      return { a, b, c, far, bdx: bd.x, guides: pg.guides };
    })()`);
    expect(r.a.y === 300 && r.a.lines.some(l => l.axis === 'y' && l.v === 300), 'guide snap: ' + JSON.stringify(r.a));
    expect(r.b.x === r.bdx, 'margin snap: ' + JSON.stringify(r));
    expect(r.c.x === 300, 'item edge snap: ' + JSON.stringify(r.c));
    expect(r.far.x === 450 && r.far.y === 450 && !r.far.lines.length, 'snapped with nothing nearby: ' + JSON.stringify(r.far));
  });

  await check('report canvas: multi-select, align and distribute', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)); loadLloydExample(); goTab('compose'); S.cpage = 1; S.csort = false; rerenderCompose(); await w(200);
      const pg = curPage(), put = () => { pg.items = [newItem('text', 100, 200, { w: 80, h: 40 }), newItem('text', 300, 260, { w: 60, h: 40 }), newItem('text', 520, 320, { w: 100, h: 40 })]; S.cmulti = new Set(pg.items.map(i => i.id)); };
      put(); alignItems('left'); const left = curPage().items.map(i => i.x);
      put(); alignItems('bottom'); const bottom = curPage().items.map(i => i.y + i.h);
      put(); distributeItems('h'); const xs = curPage().items.map(i => i.x);
      rerenderCompose(); await w(100); const panel = document.querySelector('#cmp-props')?.textContent || '';
      return { left, bottom, xs, panel: /3 selected/.test(panel) && /Align/.test(panel) };
    })()`);
    expect(r.left.every(x => x === 100), 'align left: ' + JSON.stringify(r.left));
    expect(r.bottom.every(y => y === 360), 'align bottom: ' + JSON.stringify(r.bottom));
    expect(r.xs[0] === 100 && Math.abs(r.xs[1] - 320) <= 1 && r.xs[2] === 520, 'distribute: ' + JSON.stringify(r.xs));
    expect(r.panel, 'panel does not offer align for the selection');
  });

  await check('report: scale bar matches the map real scale, fixed or fit to frame', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)); loadLloydExample(); goTab('compose'); S.cpage = 1; S.csort = false; rerenderCompose(); await w(200);
      const pg = curPage(), plan = pg.items.find(i => i.t === 'plan'); plan.o = { ...plan.o, scale: 500 };
      const sb = newItem('scalebar', 60, 900, { o: { link: plan.id } }); pg.items.push(sb);
      const read = svg => { const d = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg">' + svg + '</svg>', 'image/svg+xml'), g = d.querySelector('[data-g="' + sb.id + '"] [data-ratio]'); return g ? ['ratio', 'ppm', 'len', 'lenpx'].map(k => +g.getAttribute('data-' + k)) : null; };
      const fixed = read(pageItemsSVG(pg));
      plan.o.scale = ''; const ro = {}; withRO(ro, () => planSVG(plan.w, plan.h - (plan.cap ? 18 : 0), false));
      const fit = read(pageItemsSVG(pg));
      plan.w = Math.round(plan.w * .6); const ro2 = {}; withRO(ro2, () => planSVG(plan.w, plan.h - (plan.cap ? 18 : 0), false)); const fit2 = read(pageItemsSVG(pg));
      pg.items = pg.items.filter(i => i !== plan); const none = pageItemsSVG(pg);
      return { fixed, fit, fitSc: ro.sc, fit2, fit2Sc: ro2.sc, PPM: PX_PER_M, noMap: /No map linked/.test(none) };
    })()`);
    const [ratio, ppm, len, lenpx] = r.fixed || [];
    expect(ratio === 500 && Math.abs(ppm - r.PPM / 500) < 1e-6 && Math.abs(lenpx - len * r.PPM / 500) < 0.01, 'fixed 1:500: ' + JSON.stringify(r));
    expect(r.fit && r.fit[0] === Math.round(r.PPM / r.fitSc) && Math.abs(r.fit[3] - r.fit[2] * r.fitSc) < 0.01, 'fit to frame: ' + JSON.stringify(r));
    expect(r.fit2 && r.fit2[0] === Math.round(r.PPM / r.fit2Sc) && r.fit2[0] !== r.fit[0], 'resized frame changes the ratio: ' + JSON.stringify(r));
    expect(r.noMap, 'a scale bar without its map still drew a bar');
  });

  await check('report: north arrow (grid or true north with convergence), legend and shapes', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)); loadLloydExample(); goTab('compose'); S.cpage = 1; S.csort = false; rerenderCompose(); await w(200);
      const pg = curPage(), parse = svg => new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg">' + svg + '</svg>', 'image/svg+xml');
      const tn = newItem('north', 700, 200, { o: { mode: 'true' } }), gn = newItem('north', 600, 200, { o: { mode: 'grid' } }), lg = newItem('legend', 100, 800), ar = newItem('shape', 300, 800, { o: { kind: 'arrow' } });
      pg.items.push(tn, gn, lg, ar); const d = parse(pageItemsSVG(pg));
      const rot = id => +d.querySelector('[data-g="' + id + '"] [data-north]')?.getAttribute('data-rot');
      // expected convergence at the boreholes' centroid, from first principles
      const ll = projList().map(latLonOf).filter(Boolean), lat = ll.reduce((t, p) => t + p.lat, 0) / ll.length, lon = ll.reduce((t, p) => t + p.lon, 0) / ll.length, z = crsZone(), rad = Math.PI / 180;
      const gamma = Math.atan(Math.tan((lon - (z * 6 - 183)) * rad) * Math.sin(lat * rad)) / rad;
      const legendText = d.querySelector('[data-g="' + lg.id + '"]')?.textContent || '';
      return { trueRot: rot(tn.id), gridRot: rot(gn.id), gamma, legendText, arrowHead: !!d.querySelector('[data-g="' + ar.id + '"] [data-head]') };
    })()`);
    expect(Math.abs(r.trueRot + r.gamma) < 0.05 && Math.abs(r.gamma) > 0.1, 'true north rotation: ' + JSON.stringify(r));
    expect(r.gridRot === 0, 'grid north must be upright: ' + JSON.stringify(r));
    expect(/Borehole/.test(r.legendText) && /Monitoring well/.test(r.legendText), 'legend: ' + JSON.stringify(r));
    expect(r.arrowHead, 'arrow shape has no head');
  });

  await check('report: paper sizes, margins and title block fields', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)); loadLloydExample(); goTab('compose'); S.cpage = 1; S.csort = false; rerenderCompose(); await w(200);
      const a3 = newPage('free', { title: 'A3 FIGURE', orient: 'land', items: [newItem('text', 1300, 700, { w: 200, h: 60, o: { text: 'far right' } })] }); setPaper(a3, 'a3');
      const tab = newPage('free', { title: 'TABLOID', items: [] }); setPaper(tab, 'tabloid');
      const out = await PDFLib.PDFDocument.load(await buildReportBytes({ pages: [a3, tab] })), sz = i => out.getPage(i).getSize();
      setPaper(a3, 'letter'); const d = pgDims(a3), it = a3.items[0];
      const m = newPage('free', { title: 'MARGINS', margin: 20, items: [] }), bd = bodyOf(m);
      const tb = newPage('free', { title: 'SITE PLAN', tb: { fig: '3', drawn: 'K.S.', checked: 'L.M.', date: '2026-10-31', rev: '1' }, items: [] });
      const frame = pageFrame(tb.title, 2, 9, '', pgDims(tb));
      return { a3: sz(0), tab: sz(1), clamped: it.x + it.w <= d.W && it.y + it.h <= d.H, bdx: bd.x, mm20: 20 * 96 / 25.4, frame };
    })()`);
    expect(Math.abs(r.a3.width - 1190.55) < 0.6 && Math.abs(r.a3.height - 841.89) < 0.6, 'A3 landscape size: ' + JSON.stringify(r.a3));
    expect(Math.abs(r.tab.width - 792) < 0.6 && Math.abs(r.tab.height - 1224) < 0.6, 'Tabloid size: ' + JSON.stringify(r.tab));
    expect(r.clamped, 'items left off a smaller paper');
    expect(Math.abs(r.bdx - r.mm20) < 0.5, 'margin: ' + JSON.stringify(r));
    for (const t of ['Figure 3', 'Drawn K.S.', 'Checked L.M.', '2026-10-31', 'Rev 1']) expect(r.frame.includes(t), 'title block is missing ' + t);
  });

  await check('report: bookmarks name every report page and open at its first page', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)); loadLloydExample(); goTab('compose'); await w(200);
      const logs = newPage('logs'); logs.bh = projList().slice(0, 2).map(b => b.id);
      const L = { pages: [newPage('key'), logs, newPage('free', { title: 'SITE PLAN', items: [] })] }, outs = await layoutPages(L);
      const bytes = await buildReportBytes(L), pj = await pdfjsLib.getDocument({ data: bytes.slice() }).promise, ol = await pj.getOutline() || [];
      const at = []; for (const o of ol) { const dest = typeof o.dest === 'string' ? await pj.getDestination(o.dest) : o.dest; at.push(dest ? await pj.getPageIndex(dest[0]) : -1); }
      return { titles: ol.map(o => o.title), at, n: outs.length, want: L.pages.map(pageLabel) };
    })()`);
    expect(r.titles.join('|') === r.want.join('|'), 'bookmark titles: ' + JSON.stringify(r));
    expect(r.at[0] === 0 && r.at[1] === 1 && r.at[2] === r.n - 1, 'bookmark targets: ' + JSON.stringify(r));
  });

  await check('report canvas review: group drag, page changes, north note, links, placeholder scales, convergence', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)); loadLloydExample(); goTab('compose'); S.cpage = 1; S.csort = false; rerenderCompose(); await w(200);
      const out = {}, pg = curPage(), z = () => S.cz || 1;
      const drag = async (id, dx) => { const box = document.querySelector('[data-box="' + id + '"]'), r0 = box.getBoundingClientRect(), x = r0.left + 5, y = r0.top + 5;
        box.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 7 }));
        document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x + dx, clientY: y, pointerId: 7 })); document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 })); await w(80); };
      // 1. two items aligned on the left edge move together by a small drag
      pg.items = [newItem('text', 300, 200, { w: 120, h: 50 }), newItem('text', 300, 400, { w: 160, h: 50 })]; S.cmulti = new Set(pg.items.map(i => i.id)); S.csel = pg.items[0].id; rerenderCompose(); await w(100);
      const a0 = curPage().items.map(i => i.x); await drag(curPage().items[0].id, 4 * z() > 2 ? 4 : 4);
      out.small = { before: a0, after: curPage().items.map(i => i.x) };
      // 2. a group dragged into the page edge keeps its spacing
      { const p2 = curPage(); p2.items = [newItem('text', 100, 200, { w: 100, h: 50 }), newItem('text', 600, 300, { w: 150, h: 50 })]; S.cmulti = new Set(p2.items.map(i => i.id)); S.csel = p2.items[0].id; rerenderCompose(); await w(100);
        await drag(curPage().items[0].id, 900 * z()); const [i1, i2] = curPage().items; out.edge = { gap: i2.x - i1.x, right: i2.x + i2.w, W: pgDims(curPage()).W }; }
      // 3. paper and margin changes keep items inside the printable area
      { const p3 = newPage('free', { items: [fullBody('plan')] }); setPaper(p3, 'a4'); const b = bodyOf(p3), it = p3.items[0]; out.paper = { right: it.x + it.w, bodyRight: b.x + b.w };
        p3.margin = 15; fitToBody(p3); const b2 = bodyOf(p3); out.margin = { y: p3.items[0].y, bodyY: b2.y, bottom: p3.items[0].y + p3.items[0].h, bodyBottom: b2.y + b2.h }; }
      // 4. the true-north note fits the default arrow; without coordinates it says grid north
      { const d = new DOMParser().parseFromString(northSVG(newItem('north', 0, 0, { o: { mode: 'true' } }), RITEMS.north[1], RITEMS.north[2]), 'image/svg+xml'); out.noteLines = [...d.querySelectorAll('[data-note]')].map(t => t.textContent); }
      // 5. duplicating a page or applying a template keeps a scale bar on its map
      { const L = repLayout(); const p5 = newPage('free', { title: 'LINKED', items: [fullBody('plan')] }); p5.items.push({ ...newItem('scalebar'), o: { link: p5.items[0].id } }); L.pages.push(p5); S.cpage = L.pages.length - 1; S.csel = null;
        composeAct('cmp-dup'); const c = repLayout().pages[S.cpage]; out.dup = { link: c.items[1].o.link, plan: c.items[0].id };
        composeAct('cmp-tpl-save'); document.querySelector('#tpl-name').value = 'Linked'; composeAct('cmp-tpl-save-go');
        const tpl = S.co.reportTpls.find(t => t.name === 'Linked'); document.querySelector('#cmp-tpl').value = 't:' + tpl.id; composeAct('cmp-tpl-apply');
        const tp = repLayout().pages.find(p => p.title === 'LINKED'); out.tpl = { link: tp.items[1].o.link, plan: tp.items[0].id }; }
      // 6. a flow map gives its scale bar a scale
      { const p6 = newPage('free', { items: [fullBody('flow')] }); p6.items.push({ ...newItem('scalebar'), o: { link: p6.items[0].id } }); out.flow = /data-ratio/.test(pageItemsSVG(p6)); }
      // 8. convergence against an independent value: 3 deg east of the central meridian at 50 N, gamma = +2.30 deg (arrow turns anticlockwise)
      { const [E, N] = llToUtm(50, -108, 12), b = blankBorehole('ZT1'); Object.assign(b, { project: 'Convergence test', easting: E, northing: N, crs: 'UTM NAD83(CSRS) Zone 12' }); S.bh.set(b.id, normalize(b)); S.sel = b.id;
        out.utm = +new DOMParser().parseFromString(northSVG(newItem('north', 0, 0, { o: { mode: 'true' } }), 160, 120), 'image/svg+xml').querySelector('[data-north]').getAttribute('data-rot');
        Object.assign(b, { easting: -108, northing: 50, crs: 'Lat/Long WGS84' });
        out.ll = +new DOMParser().parseFromString(northSVG(newItem('north', 0, 0, { o: { mode: 'true' } }), 160, 120), 'image/svg+xml').querySelector('[data-north]').getAttribute('data-rot');
        Object.assign(b, { easting: null, northing: null, crs: '' }); const d = new DOMParser().parseFromString(northSVG(newItem('north', 0, 0, { o: { mode: 'true' } }), 160, 120), 'image/svg+xml');
        out.none = { mode: d.querySelector('[data-north]').getAttribute('data-mode'), text: d.documentElement.textContent }; }
      // 7. a water-table map that only shows a placeholder (two wells) gives no scale
      { for (const n of ['BH-EX1', 'BH-EX2']) { const c = structuredClone(sortedList().find(b => b.name === n)); Object.assign(c, { id: uid('bh'), project: 'Two wells' }); S.bh.set(c.id, normalize(c)); S.sel = c.id; } const p7 = newPage('free', { items: [fullBody('wt')] }); p7.items.push({ ...newItem('scalebar'), o: { link: p7.items[0].id } }); out.wt = pageItemsSVG(p7); out.wtRatio = /data-ratio/.test(out.wt); out.wt = out.wt.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300); }
      return out;
    })()`);
    expect(r.small.after[0] - r.small.before[0] === r.small.after[1] - r.small.before[1] && r.small.after[0] !== r.small.before[0], 'group drag stuck: ' + JSON.stringify(r.small));
    expect(r.edge.gap === 500 && r.edge.right <= r.edge.W, 'group spacing at the edge: ' + JSON.stringify(r.edge));
    expect(r.paper.right <= r.paper.bodyRight + 0.5, 'item past the margin after a paper change: ' + JSON.stringify(r.paper));
    expect(r.margin.y >= r.margin.bodyY - 0.5 && r.margin.bottom <= r.margin.bodyBottom + 0.5, 'item outside the body after a margin change: ' + JSON.stringify(r.margin));
    expect(r.noteLines.length >= 1 && r.noteLines.every(t => t.length <= 16), 'north note too long for the arrow: ' + JSON.stringify(r.noteLines));
    expect(r.dup.link === r.dup.plan && r.tpl.link === r.tpl.plan, 'scale bar link lost: ' + JSON.stringify(r));
    expect(r.flow, 'flow map gives no scale');
    expect(Math.abs(r.utm + 2.30) < 0.02, 'UTM convergence (expected -2.30 rotation): ' + r.utm);
    expect(r.ll === 0, 'lat/long map should not turn: ' + r.ll);
    expect(r.none.mode === 'grid' && /Grid north/.test(r.none.text), 'no coordinates must read grid north: ' + JSON.stringify(r.none));
    expect(!r.wtRatio, 'placeholder map gave a scale: ' + r.wt);
  });

  await check('cross-section: page on the rail', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)); loadLloydExample(); await w(100);
      const tabs = [...document.querySelectorAll('#prail [data-tab]')].map(b => b.dataset.tab);
      goTab('xsec'); await w(200); const svg = !!document.querySelector('#xs-draw svg'), chips = document.querySelectorAll('#ctl [data-secpick]').length;   /* the section line moved into the settings panel */
      goTab('site'); await w(200); const link = !!document.querySelector('#view [data-tab="xsec"]'), old = !!document.querySelector('#section');
      return { tabs, svg, chips, link, old };
    })()`);
    expect(r.tabs.indexOf('xsec') === r.tabs.indexOf('contam') + 1 && r.tabs.indexOf('gwm') === r.tabs.indexOf('xsec') + 1 && r.tabs.indexOf('v3d') === r.tabs.indexOf('gwm') + 1 && r.tabs.indexOf('compose') === r.tabs.indexOf('v3d') + 1, 'rail order: ' + r.tabs);
    expect(r.svg && r.chips >= 2, 'section page draws: ' + JSON.stringify(r));
    expect(r.link && !r.old, 'map page links to the section page: ' + JSON.stringify(r));
  });

  await check('cross-section: offsets, interpreted ground and unit pairing', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms));
      const mk = (name, de, dn, unit) => { const b = blankBorehole(name); Object.assign(b, { project: 'Section test', easting: 500000 + de, northing: 6000000 + dn, crs: 'UTM NAD83(CSRS) Zone 12', elevation: 600, layers: [{ id: uid('l'), top: 0, bottom: 3, uscs: 'cl', unit }] }); const n = normalize(b); S.bh.set(n.id, n); return n; };
      const A = mk('XA', 0, 0, 'Upper clay'), B = mk('XB', 100, 0, 'Upper clay'), C = mk('XC', 50, 6, 'Clay till'), D = mk('XD', 50, -6, 'Upper clay');
      S.sel = A.id; S.secIds = new Set(); goTab('xsec'); await w(200);
      const svg = document.querySelector('#xs-draw svg'), texts = [...svg.querySelectorAll('text')].map(t => t.textContent);
      const ground = svg.querySelector('[data-ground]'), out = { offC: texts.find(t => /XC|6\\.0/.test(t) && /projected/.test(t)) || texts.filter(t => /projected/.test(t)), ground: ground && { dash: ground.getAttribute('stroke-dasharray'), title: ground.querySelector('title')?.textContent } };
      const joins = () => [...document.querySelectorAll('#xs-draw svg path[data-unit]')].map(p => p.dataset.unit);
      out.before = joins();
      const sel = document.querySelector('[data-xsalias="' + C.id + '|Clay till"]'); out.ui = !!sel; if (sel) { sel.value = 'Upper clay'; sel.dispatchEvent(new Event('change', { bubbles: true })); } await w(100); out.after = joins(); out.saved = siteOf()?.xsec?.alias?.[C.id + '|Clay till'];
      // RF4: two boreholes at the same place
      const E = mk('XE', 100, 0, 'Upper clay'); drawXsec(); out.finite = !/NaN|Infinity/.test(document.querySelector('#xs-draw').innerHTML);
      return out;
    })()`);
    expect(JSON.stringify(r.offC).includes('6.0 m') && JSON.stringify(r.offC).includes('projected'), 'off-line label: ' + JSON.stringify(r.offC));
    expect(r.ground && r.ground.dash && /interpolated between boreholes/.test(r.ground.title || ''), 'ground marked interpolated: ' + JSON.stringify(r.ground));
    expect(r.ui && r.saved === 'Upper clay' && r.after.filter(u => u === 'join').length > r.before.filter(u => u === 'join').length, 'alias joins units: ' + JSON.stringify(r));
    expect(r.finite, 'coincident boreholes give NaN/Infinity');
  });

  await check('cross-section: water by date', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms));
      const R = (date, depth, kind) => ({ id: uid('w'), date, depth, measured: depth, ref: 'gs', kind });
      const mk = (name, de, water) => { const b = blankBorehole(name); Object.assign(b, { project: 'Water test', easting: 500000 + de, northing: 6000000, crs: 'UTM NAD83(CSRS) Zone 12', elevation: 600, layers: [{ id: uid('l'), top: 0, bottom: 6, uscs: 'sm' }], water }); const n = normalize(b); S.bh.set(n.id, n); return n; };
      const A = mk('WA', 0, [R('2026-05-01', 2.0, 'static'), R('2026-08-01', 1.5, 'static')]);
      const B = mk('WB', 50, [R('2026-05-03', 2.4, 'static'), R('2026-08-02', 1.9, 'static')]);
      const C = mk('WC', 100, [R('2026-05-02', 3.1, 'strike')]);
      S.sel = A.id; S.secIds = new Set(); S.xs = { ...S.xs, date: '2026-06-15' }; goTab('xsec'); await w(200);
      const q = sel => [...document.querySelectorAll('#xs-draw svg ' + sel)];
      const out = { at: { A: waterAt(A, '2026-06-15')?.date, B: waterAt(B, '2026-06-15')?.depth, early: waterAt(A, '2026-04-01') },
        ticks: q('[data-wtick]').map(t => t.querySelector('title')?.textContent || t.parentNode.querySelector('title')?.textContent), joins: q('[data-wjoin]').length, strike: q('[data-wkind="strike"]').length };
      B.water[0].date = '2026-05-20'; drawXsec(); out.joinsFar = q('[data-wjoin]').length;
      return out;
    })()`);
    expect(r.at.A === '2026-05-01' && r.at.B === 2.4 && r.at.early === null, 'waterAt: ' + JSON.stringify(r.at));
    expect(r.ticks.length === 2 && r.ticks.every(t => /2026-05-0[13]/.test(t || '')), 'static ticks at the earlier round: ' + JSON.stringify(r.ticks));
    expect(r.joins === 1 && r.strike === 1, 'only static readings of one round are joined: ' + JSON.stringify(r));
    expect(r.joinsFar === 0, 'readings 19 days apart are not joined: ' + r.joinsFar);
  });

  await check('groundwater results: entry, guideline, import and lock', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), out = {};
      const b0 = blankBorehole('MW-1'); Object.assign(b0, { project: 'GW test', well: { ...blankWell(), installed: true, type: 'well', screenTop: 2, screenBottom: 5 } }); const b = normalize(b0); S.bh.set(b.id, b); store.save(b);
      S.sel = b.id; S.dtab = 'ww'; goTab('edit'); await w(250);
      out.section = !!document.querySelector('[data-t="gwlab"]');
      document.querySelector('[data-act="gw-new"]')?.click(); await w(150);
      out.n = S.bh.get(b.id).gwSamples.length;
      const inp = document.querySelector('[data-gw="benzene"][data-i="0"]'); if (inp) { inp.value = '0.02'; inp.dispatchEvent(new Event('change', { bubbles: true })); } await w(150);
      out.benz = S.bh.get(b.id).gwSamples[0]?.res?.benzene;
      const g = document.querySelector('[data-gwguide="benzene"]'); if (g) { g.value = '0.005'; g.dispatchEvent(new Event('change', { bubbles: true })); } await w(150);
      out.guide = siteOf()?.gwGuide?.benzene; out.over = !!document.querySelector('[data-t="gwlab"] .over, [data-t="gwlab"] [data-over]');
      // issued: no new rows
      S.bh.get(b.id).status = 'issued'; renderView(true); await w(150); const n0 = S.bh.get(b.id).gwSamples.length; document.querySelector('[data-act="gw-new"]')?.click(); await w(100); out.lockedN = S.bh.get(b.id).gwSamples.length - n0;
      S.bh.get(b.id).status = 'draft';
      renderView(true); await w(100); const nd = S.bh.get(b.id).gwSamples.length; S.bh.get(b.id).gwSamples.push({ id: 'tmp', date: '2020-01-01', res: {} }); renderView(true); await w(100); document.querySelector('[data-act="gw-del"][data-i="' + S.bh.get(b.id).gwSamples.findIndex(s => s.id === 'tmp') + '"]')?.click(); await w(100); out.delOk = S.bh.get(b.id).gwSamples.length === nd && !S.bh.get(b.id).gwSamples.some(s => s.id === 'tmp');
      // RF5: a water sample in ug/L
      const P = parseLabTable([['Sample ID', 'Analyte', 'Result', 'Units', 'Sample date'], ['MW-1', 'Benzene', '12', 'ug/L', '2026-08-01']]); out.parsed = P.samples[0]; out.paste = parseLabTable([['Sample ID', 'Analyte', 'Result', 'Units'], ['MW-1 1.5', 'Chloride', '850', 'mg/L']]).samples[0];
      await importLabFile(new File(['Sample ID,Analyte,Result,Units,Sample date\\nMW-1,Benzene,12,ug/L,2026-08-01\\nMW-1,Toluene,<0.5,ug/L,2026-08-01\\n'], 'gw.csv', { type: 'text/csv' })); await w(150);
      out.dest = document.querySelector('[data-labmap="0"]')?.value; importLabGo(); await w(150);
      out.imported = S.bh.get(b.id).gwSamples.find(s => s.date === '2026-08-01');
      return out;
    })()`);
    expect(r.section && r.n === 1, 'groundwater section and new row: ' + JSON.stringify(r));
    expect(r.benz && r.benz.v === 0.02 && r.benz.lt === false, 'typed result saved: ' + JSON.stringify(r.benz));
    expect(r.guide === 0.005 && r.over, 'guideline saved and exceedance marked: ' + JSON.stringify(r));
    expect(r.lockedN === 0, 'issued borehole took a new row');
    expect(r.delOk, 'delete removes the clicked row');
    expect(r.paste && !r.paste.water && r.paste.res.cl.v === 850, 'saturated-paste chloride stays soil: ' + JSON.stringify(r.paste));
    expect(r.parsed && r.parsed.res.benzene.v === 0.012 && r.parsed.water && r.parsed.unit0 === 'ug/L', 'ug/L converted: ' + JSON.stringify(r.parsed));
    expect(/\|gw$/.test(r.dest || '') && r.imported && r.imported.res.benzene.v === 0.012 && r.imported.res.toluene.lt === true && r.imported.unit0 === 'ug/L', 'imported as a groundwater sample: ' + JSON.stringify(r));
  });

  await check('cross-section: plume points by date', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)); loadDlExample(); await w(150);
      const list = sectionList(), pos = secPos(list.filter(b => (b.layers || []).some(l => l.bottom > l.top) || b.water?.length));
      const want = list.flatMap(b => b.samples.filter(sm => labVal(sm, 'benzene') && sm.depth != null).map(sm => b.id + '@' + sm.depth)).sort();
      const all = plumePoints(pos, 'soil', 'benzene', '', false), got = all.map(p => p.b.id + '@' + p.top).sort();
      const drill = list.map(b => b.dateEnd || b.date).sort(), first = drill[0];
      const dates = xsDates(list);
      const before = plumePoints(pos, 'soil', 'benzene', '2026-01-01', false).length;
      const late = new Date(Date.parse(drill[drill.length - 1]) + 30 * 864e5).toISOString().slice(0, 10);
      const roundLate = plumePoints(pos, 'soil', 'benzene', late, true).length, anyLate = plumePoints(pos, 'soil', 'benzene', late, false).length;
      const vap = plumePoints(pos, 'vapour', '', '', false);
      const ages = plumePoints(pos, 'soil', 'benzene', late, false).every(p => p.age >= 30);
      // a groundwater sample at a well: drawn over the screen below the water table
      const mw = list.find(b => b.well?.installed); mw.gwSamples = [{ id: 'g1', date: '2026-09-15', sid: 'x', res: { benzene: { v: .03, lt: false } } }];
      const gp = plumePoints(pos, 'groundwater', 'benzene', '', false), wt = waterAt(mw, '2026-09-15');
      // one date only
      const one = blankBorehole('OD1'); Object.assign(one, { project: 'One date', date: '2026-05-05', samples: [{ id: 's', no: 1, depth: 1, lab: { benzene: { v: 1, lt: false } } }] });
      return { want, got, dates, first, before, roundLate, anyLate, vap: vap.length, vapWant: list.flatMap(b => b.samples.filter(sm => sm.cvc != null && sm.depth != null)).length, ages, gp: gp.map(p => ({ id: p.b.id, top: p.top, bot: p.bot, v: p.v })), mw: mw.id, wt: wt?.depth, scr: [mw.well.screenTop, mw.well.screenBottom], oneDates: xsDates([normalize(one)]) };
    })()`);
    expect(r.got.length > 0 && JSON.stringify(r.got) === JSON.stringify(r.want), 'soil benzene points: ' + r.got.length + ' vs ' + r.want.length);
    expect(r.dates.includes(r.first) && r.dates.every((d, i) => !i || d > r.dates[i - 1]), 'sorted unique dates incl. drilling: ' + JSON.stringify(r.dates.slice(0, 5)));
    expect(r.before === 0, 'no results before sampling');
    expect(r.anyLate > 0 && r.roundLate === 0 && r.ages, 'round hides results older than 7 days: ' + JSON.stringify(r));
    expect(r.vap === r.vapWant, 'vapour points: ' + r.vap + '/' + r.vapWant);
    expect(r.gp.length === 1 && r.gp[0].id === r.mw && Math.abs(r.gp[0].top - Math.max(r.scr[0], r.wt)) < 1e-9 && r.gp[0].bot === r.scr[1] && r.gp[0].v === .03, 'groundwater over the saturated screen: ' + JSON.stringify(r));
    expect(r.oneDates.length === 1, 'one-date project: ' + JSON.stringify(r.oneDates));
  });

  await check('cross-section: plume contours', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)); loadDlExample(); await w(150);
      setSite({ ...siteOf(), guide: { ...siteOf().guide, benzene: .02 } });   // inside the example's range, so contours cross the data
      S.secIds = new Set(); S.xs = { ...S.xs, date: '', medium: 'soil', param: 'benzene', round: false, plume: true }; goTab('xsec'); await w(250);
      const out = {}, g = projGuide().benzene;
      // independent check: each contour vertex lies on a segment between two plotted points whose log values bracket the level,
      // at the linear position in log10 concentration
      const C = plumeContours(xsLastPts(), [g, 10 * g, 100 * g]); out.nseg = C.segs.length; out.bad = []; out.dbg = { n: xsLastPts().length, g, z: xsLastPts().map(p => +p[2].toFixed(2)).slice(0, 30), tris: C.tris.length, xs: S.xs, msg: document.querySelector('#xs-draw')?.textContent.slice(0, 200) };
      const P = xsLastPts();
      for (const sgm of C.segs) for (const E of [sgm.a, sgm.b]) {
        const L = Math.log10(sgm.level); let hit = false;
        for (let i = 0; i < P.length && !hit; i++) for (let j = 0; j < P.length && !hit; j++) {
          const A = P[i], B = P[j]; if ((A[2] - L) * (B[2] - L) >= 0) continue;
          const t = (L - A[2]) / (B[2] - A[2]), x = A[0] + t * (B[0] - A[0]), y = A[1] + t * (B[1] - A[1]);
          if (Math.hypot(x - E[0], y - E[1]) < 1e-6) hit = true;
        }
        if (!hit) out.bad.push(E);
      }
      out.drawn = [...document.querySelectorAll('#xs-draw svg path[data-contour]')].map(p => p.dataset.contour);
      out.pts = document.querySelectorAll('#xs-draw svg [data-pt]').length; out.hollow = document.querySelectorAll('#xs-draw svg [data-pt][data-lt="1"]').length;
      out.label = [...document.querySelectorAll('#xs-draw svg path[data-contour] title')].map(t => t.textContent)[0];
      // RF2: nothing to show
      for (const b of projList()) b.gwSamples = []; setXs('medium', 'groundwater'); await w(100);
      out.none = document.querySelector('#xs-draw').textContent.includes('No Benzene results in groundwater'); out.noneContours = document.querySelectorAll('#xs-draw svg path[data-contour]').length;
      // RF3: one date, play disabled; several dates, enabled
      setXs('medium', 'soil'); renderView(true); await w(100); out.playMany = document.querySelector('#xs-play')?.disabled;
      const one = []; for (const n of ['OD1', 'OD2']) { const b = blankBorehole(n); Object.assign(b, { project: 'One date', date: '2026-05-05', layers: [{ id: uid('l'), top: 0, bottom: 4, uscs: 'sm' }], samples: [{ id: uid('s'), no: 1, depth: 1, lab: { benzene: { v: 1, lt: false } } }, { id: uid('s'), no: 2, depth: 3, lab: { benzene: { v: .01, lt: true } } }] }); const nb = normalize(b); S.bh.set(nb.id, nb); one.push(nb); }
      // RF1: no elevations or coordinates still draws the plume on the depth axis
      S.sel = one[0].id; S.secIds = new Set(); renderView(true); await w(150);
      out.playOne = document.querySelector('#xs-play')?.disabled; out.depthPts = document.querySelectorAll('#xs-draw svg [data-pt]').length; out.finite = !/NaN/.test(document.querySelector('#xs-draw').innerHTML);
      return out;
    })()`);
    expect(r.nseg > 0 && r.bad.length === 0, 'contour vertices must interpolate between data points in log10: ' + JSON.stringify(r.dbg) + r.nseg + ' segments, bad ' + JSON.stringify(r.bad.slice(0, 3)));
    expect(r.drawn.includes('1') && r.pts > 0 && r.hollow > 0 && /interpolated/.test(r.label || ''), 'plume drawn: ' + JSON.stringify(r));
    expect(r.none && r.noneContours === 0, 'no results message: ' + JSON.stringify(r));
    expect(r.playMany === false && r.playOne === true, 'play enabled only with several dates: ' + JSON.stringify(r));
    expect(r.depthPts === 4 && r.finite, 'depth-only project draws points: ' + JSON.stringify(r));
  });

  await check('report: section item carries date and plume', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)); loadDlExample(); await w(150); S.secIds = new Set();
      const dates = xsDates(sectionList()), d = dates[Math.floor(dates.length / 2)];
      S.xs = { ...S.xs, date: d, medium: 'vapour', plume: true, round: false };
      goTab('compose'); await w(150); const L = repLayout(), pg = newPage('free', { orient: 'land', items: [] }); L.pages.push(pg); S.cpage = L.pages.length - 1; rerenderCompose(); await w(150);
      document.querySelector('[data-cadd="section"]').click(); await w(150);
      const it = curPage().items.find(x => x.t === 'section');
      const stored = structuredClone(it.o.xs);
      S.xs = { ...S.xs, date: '', medium: 'soil' };   // the page keeps what was placed, not the live view
      const svg = itemInner(it, 900, 420), txt = svg.replace(/<[^>]+>/g, ' ');
      S.csel = it.id; rerenderCompose(); await w(100); const btn = !!document.querySelector('[data-act="cmp-xs-use"]'); S.xs = { ...S.xs, date: dates[0], medium: 'soil', param: 'benzene' }; document.querySelector('[data-act="cmp-xs-use"]')?.click(); await w(100); const used = curPage().items.find(x => x.t === 'section').o.xs;
      return { stored, d, hasDate: txt.includes(d), interp: /interpolated/.test(svg), vapour: /Headspace vapour/.test(txt), btn, used, d0: dates[0], link: !!document.querySelector('#cmp-props [data-tab="xsec"]') };
    })()`);
    expect(r.stored && r.stored.date === r.d && r.stored.medium === 'vapour', 'section item stores the view: ' + JSON.stringify(r.stored));
    expect(r.hasDate && r.interp && r.vapour, 'printed section shows its date, plume and interpolated labels: ' + JSON.stringify(r));
    expect(r.btn && r.link && r.used?.date === r.d0 && r.used?.medium === 'soil', 'panel offers Use current view and links to the section page: ' + JSON.stringify(r));
  });

  await check('model: properties are cited', async run => {
    const r = await run(`(() => {
      const uncited = []; for (const [p, c] of Object.entries(CHEM)) for (const k of ['koc', 'H', 'sol', 'hl']) if (c[k] != null && !(c.src?.[k] || '').trim()) uncited.push(p + '.' + k);
      const b = modelInputs('benzene', {}), x = modelInputs('xylenes', {}), xe = modelInputs('xylenes', { koc: 363, H: .213, sol: 178 }), f1 = modelInputs('f1', {});
      return { uncited, b: { koc: b.koc, H: b.H, sol: b.sol, missing: b.missing, src: b.src.koc, hl: b.hl, decay: b.decayNote }, xMissing: x.missing, xe: { missing: xe.missing, src: xe.src.koc }, f1: { mixture: f1.mixture, missing: f1.missing } };
    })()`);
    expect(!r.uncited.length, 'values without a source: ' + r.uncited);
    // US EPA (1996) Soil Screening Guidance TBD: Table 39 calculated Koc 5.89E+01 L/kg; Table 36 H' 2.28E-01, S 1.75E+03 mg/L
    expect(r.b.koc === 58.9 && r.b.H === 0.228 && r.b.sol === 1750 && !r.b.missing.length && /Table 39/.test(r.b.src), 'benzene properties: ' + JSON.stringify(r.b));
    expect(r.b.hl == null && /no biodegradation/i.test(r.b.decay || ''), 'no half-life means no decay, said plainly: ' + JSON.stringify(r.b));
    expect(r.xMissing.includes('Koc') && !r.xe.missing.length && r.xe.src === 'entered', 'xylenes need entered values: ' + JSON.stringify(r));
    expect(r.f1.mixture && r.f1.missing.length, 'F1 is a mixture: ' + JSON.stringify(r.f1));
  });

  await check('model: Domenico against exact solutions and published values', async run => {
    const r = await run(`(() => {
      const out = {};
      // Abramowitz and Stegun Table 7.1
      out.erfc = [[.5, .4795001222], [1, .1572992071], [2, .0046777350], [0, 1]].map(([x, v]) => Math.abs(erfc(x) - v));
      // 1-D limit (wide, deep source, no lateral or vertical spreading, no decay) against the full Ogata–Banks (1961) solution
      const v = .05, ax = 1, D = ax * v, worst = []; for (const x of [10, 20, 40, 80]) for (const t of [200, 400, 800, 1600, 3200]) {
        // Domenico keeps the first Ogata–Banks term; the second, exp(x/ax)·erfc((x+vt)/2√(ax v t)), is the known approximation (West et al. 2007)
        const ob1 = erfc((x - v * t) / (2 * Math.sqrt(D * t))) / 2, ob = ogataBanks({ C0: 1, v, D, R: 1, x, t }), dm = domenico({ C0: 1, v, R: 1, ax, ay: 0, az: 0, k: 0, ks: 0, Y: 1e6, Z: 1e6, x, y: 0, z: 0, t });
        if (ob1 > .01) worst.push(Math.abs(dm - ob1) / ob1); out.gap = Math.max(out.gap || 0, Math.abs(ob - dm)); }
      out.ob = Math.max(...worst); out.obN = worst.length;
      // at the front (x = vt) the dropped term is close to 1/sqrt(pi x/ax) (asymptotic), here x = 80 m, ax = 1 m
      out.front = { gap: ogataBanks({ C0: 1, v, D, R: 1, x: 80, t: 1600 }) - domenico({ C0: 1, v, R: 1, ax, ay: 0, az: 0, k: 0, ks: 0, Y: 1e6, Z: 1e6, x: 80, y: 0, z: 0, t: 1600 }), est: 1 / Math.sqrt(Math.PI * 80) / 2 };
      // steady state with decay against the exact 1-D steady solution C/C0 = exp[x/(2ax)(1 - sqrt(1 + 4k ax/v))]
      out.ss = [5, 20, 60].map(x => { const k = .002, ex = Math.exp(x / (2 * ax) * (1 - Math.sqrt(1 + 4 * k * ax / v))); return Math.abs(domenico({ C0: 1, v, R: 1, ax, ay: 0, az: 0, k, ks: 0, Y: 1e6, Z: 1e6, x, y: 0, z: 0, t: 1e6 }) - ex) / ex; });
      // retardation slows the front by R; upgradient is clean; the source holds C0 at its centre
      out.ret = Math.abs(domenico({ C0: 1, v, R: 2, ax, ay: .1, az: 0, k: 0, ks: 0, Y: 10, Z: 3, x: 20, y: 0, z: 0, t: 800 }) - domenico({ C0: 1, v, R: 1, ax, ay: .1, az: 0, k: 0, ks: 0, Y: 10, Z: 3, x: 20, y: 0, z: 0, t: 400 }));
      out.up = domenico({ C0: 1, v, R: 1, ax, ay: .1, az: 0, k: 0, ks: 0, Y: 10, Z: 3, x: -5, y: 0, z: 0, t: 800 });
      out.src = domenico({ C0: 7, v, R: 1, ax, ay: .1, az: 0, k: 0, ks: 0, Y: 10, Z: 3, x: 1e-6, y: 0, z: 1, t: 8000 });
      out.below = domenico({ C0: 1, v, R: 1, ax, ay: .1, az: 0, k: 0, ks: 0, Y: 10, Z: 3, x: 20, y: 0, z: 4, t: 800 });
      // BIOSCREEN User's Manual (EPA/600/R-96/087), Example 1, Keesler AFB: plume length 280 ft gives alpha x 13.3 ft and alpha y 1.3 ft (Xu and Eckstein 1995);
      // Koc 38 L/kg, foc 0.0057 %, bulk density 1.7 kg/L, porosity 0.3 give R = 1.0
      const a = xuEckstein(280 * .3048) / .3048; out.ax = +a.toFixed(1); out.ay = +(a / 10).toFixed(1); out.R = +retardation(38, .000057, 1.7, .3).toFixed(1);
      return out;
    })()`);
    expect(r.erfc.every(e => e < 2e-7), 'erfc against A&S Table 7.1: ' + JSON.stringify(r.erfc));
    expect(r.obN >= 10 && r.ob < .01, 'Domenico within 1 % of the Ogata–Banks first term in the 1-D limit: ' + r.ob + ' over ' + r.obN);
    expect(Math.abs(r.front.gap - r.front.est) / r.front.est < .05, 'the dropped second term matches its asymptotic size at the front: ' + JSON.stringify(r.front));
    expect(r.ss.every(e => e < 1e-6), 'steady state with decay: ' + JSON.stringify(r.ss));
    expect(r.ret < 1e-12 && r.up === 0 && Math.abs(r.src - 7) < 1e-6 && r.below < 1e-9, 'retardation, upgradient, source, below the source: ' + JSON.stringify(r));
    expect(r.ax === 13.3 && r.ay === 1.3 && r.R === 1.0, 'BIOSCREEN Example 1 printed values: ' + JSON.stringify(r));
  });

  await check('model: soil-to-groundwater source', async run => {
    const r = await run(`(() => {
      // US EPA (1996) Soil Screening Guidance User's Guide, EPA/540/R-96/018, Equations 10–12. Hand calculation:
      // Kd = 58.9 × 0.002 = 0.1178 L/kg; Kd + (0.30 + 0.13 × 0.228)/1.5 = 0.33756; Cw = 10 / 0.33756 = 29.624 mg/L
      // d = (0.0112 × 20²)^0.5 + 5{1 − exp[−(20 × 0.18)/(300 × 0.005 × 5)]} = 2.11660 + 1.90608 = 4.02268 m
      // DF = 1 + (300 × 0.005 × 4.02268)/(0.18 × 20) = 2.67612; Cgw = 29.624 / 2.67612 = 11.070 mg/L
      const base = { Cs: 10, koc: 58.9, foc: .002, H: .228, thw: .30, tha: .13, rhob: 1.5, K: 300, i: .005, I: .18, L: 20, da: 5, sol: 1750 };
      const a = leachSource(base), b = leachSource({ ...base, I: .36 }), m = leachSource({ ...base, foc: null }), big = leachSource({ ...base, Cs: 1e5 });
      return { a, b: b.Cgw, m, big: { capped: big.aboveSol, note: big.note } };
    })()`);
    const sig = (x, n) => +x.toPrecision(n);
    expect(sig(r.a.Kd, 4) === .1178 && sig(r.a.Cw, 5) === 29.624 && sig(r.a.d, 5) === 4.0227 && sig(r.a.DF, 5) === 2.6761 && sig(r.a.Cgw, 5) === 11.07, 'hand calculation: ' + JSON.stringify(r.a));
    expect(r.b > r.a.Cgw, 'more recharge leaches more into the mixing zone here: ' + r.b);
    expect(r.m.missing && r.m.missing.includes('foc'), 'missing foc reported: ' + JSON.stringify(r.m));
    expect(r.big.capped && /solubility/i.test(r.big.note || ''), 'above solubility flagged: ' + JSON.stringify(r.big));
  });

  await check('model: drawn on the section', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)); loadLloydExample(); await w(150);   // has slug tests, so a hydraulic conductivity
      const list = sectionList(), wells = list.filter(b => b.well?.installed && b.easting != null), src = wells[0];
      src.gwSamples = [{ id: 'g1', date: '2026-09-15', sid: 'x', res: { benzene: { v: .5, lt: false } } }];
      setSite({ ...siteOf(), gwGuide: { benzene: .005 }, model: { param: 'benzene', src: 'gw', srcBh: src.id } });
      S.secIds = new Set(); S.xs = { ...S.xs, date: '', medium: 'groundwater', param: 'benzene', plume: false, model: true }; goTab('xsec'); await w(300);
      const out = {}, txt = document.querySelector('#xs-draw').textContent;
      out.label = txt.includes('Model, not measured'); out.panel = !!document.querySelector('[data-mdl="Y"]'); out.panelOk = !/Not drawn yet/.test(document.querySelector('#xs-model-sec')?.textContent || '') && document.querySelector('[data-mdl="Y"]')?.placeholder === '10';
      const run0 = modelRun(''); out.ok = run0.ok; out.missing = run0.missing; out.C0 = run0.P?.C0; out.srcNote = run0.P?.src?.C0; out.az = run0.P?.az; out.flowAz = run0.P?.flowAz; out.flowDir = gwFlow().az;
      const g8 = modelGrid('', 8), g4 = modelGrid('', 4); out.reach = [g8.reach, g4.reach]; out.len = g8.len;
      out.up = g4.cells.filter(c => c.xd < 0 && c.c != null).every(c => c.c === 0); out.nUp = g4.cells.filter(c => c.xd < 0).length;
      out.contour = document.querySelectorAll('#xs-draw svg [data-model-contour]').length;
      // RF1: no elevations: the forecast refuses and says why
      for (const n of ['OD1', 'OD2', 'OD3']) { const b = blankBorehole(n); Object.assign(b, { project: 'No elev', date: '2026-05-05', layers: [{ id: uid('l'), top: 0, bottom: 4, uscs: 'sm' }] }); const nb = normalize(b); S.bh.set(nb.id, nb); S.sel = nb.id; }
      S.secIds = new Set(); renderView(true); await w(150); out.noElev = document.querySelector('#xs-draw').textContent;
      return out;
    })()`);
    expect(r.ok && r.C0 === .5 && /measured/.test(r.srcNote || ''), 'model runs from the measured source: ' + JSON.stringify(r));
    expect(r.az === 0 && r.flowAz === r.flowDir, 'vertical dispersivity stays the default 0, flow azimuth kept separately: ' + JSON.stringify({ az: r.az, flowAz: r.flowAz, flowDir: r.flowDir }));
    expect(r.label && r.panel && r.panelOk && r.contour > 0, 'forecast drawn, labelled, with inputs panel: ' + JSON.stringify(r));
    expect(r.reach[0] > 0 && Math.abs(r.reach[0] - r.reach[1]) < .01 * r.len, 'halving the grid moves the ×1 reach < 1 % of the section: ' + JSON.stringify(r));
    expect(r.nUp > 0 && r.up, 'upgradient of the source is clean: ' + JSON.stringify(r));
    expect(/forecast needs ground elevations/i.test(r.noElev), 'no-elevation project refuses: ' + r.noElev.slice(0, 200));
  });

  await check('model: checks', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)); loadLloydExample(); await w(150);
      const wells = sectionList().filter(b => b.well?.installed && b.easting != null), src = wells[0];
      src.gwSamples = [{ id: 'g1', date: '2026-09-15', sid: 'x', res: { benzene: { v: .5, lt: false } } }];
      wells.slice(1, 4).forEach((b, i) => { b.gwSamples = [{ id: 'l' + i, date: '2026-12-01', sid: 'y', res: { benzene: { v: [.02, .004, .001][i], lt: i === 2 } } }]; });
      setSite({ ...siteOf(), gwGuide: { benzene: .005 }, model: { param: 'benzene', src: 'gw', srcBh: src.id } });
      S.secIds = new Set(); S.xs = { ...S.xs, model: true, plume: false }; goTab('xsec'); await w(300);
      const C = modelChecks(modelRun(''));
      return { names: C.checks.map(c => c.name), okTypes: C.checks.every(c => typeof c.ok === 'boolean' && (c.detail || '').length > 10), res: C.residuals.map(x => ({ b: x.b.name, date: x.date, meas: x.meas, pred: x.pred, nd: x.nd, dlog: x.dlog })), ndText: [...(document.querySelector('#xs-checks')?.closest('.scroll-x')?.nextElementSibling?.querySelectorAll('tbody tr') || [])].map(t => t.textContent).find(t => t.includes('<')), limitPill: [...document.querySelectorAll('#xs-checks tbody tr')].find(t => /Stated limits/.test(t.textContent))?.querySelector('.pill')?.textContent,
        ob: C.checks.find(c => /Ogata/.test(c.name))?.ok, limits: C.checks.find(c => c.name === 'Stated limits')?.detail, shown: !!document.querySelector('#xs-checks') && document.querySelectorAll('#xs-checks tbody tr').length };
    })()`);
    expect(r.okTypes && r.names.length >= 5, 'every check has ok and a detail: ' + JSON.stringify(r.names));
    expect(r.res.length === 3 && r.res.every(x => x.date === '2026-12-01' && x.pred != null && x.meas != null) && r.res.some(x => x.nd), 'one residual row per well in the later round: ' + JSON.stringify(r.res));
    expect(r.ob === true && /West et al/.test(r.limits || '') && /uniform/.test(r.limits || ''), 'live Ogata–Banks check and stated limits: ' + JSON.stringify(r));
    expect(r.shown >= 5, 'checks panel shown: ' + r.shown);
    expect(r.res.filter(x => x.nd && x.pred <= x.meas).every(x => x.dlog == null) && /below the detection limit/.test(r.ndText || '') && r.limitPill === 'Noted', 'non-detect agreement worded, limits noted: ' + JSON.stringify({ nd: r.ndText, pill: r.limitPill }));
  });

  await check('cross-section review fixes', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [];
      const want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
      // C1: Greek mu, ng/L, unknown per-litre units
      const mu = parseLabTable([['Sample ID', 'Analyte', 'Result', 'Units'], ['MW-1', 'Benzene', '12', 'μg/L']]).samples[0];
      want(mu && mu.water && mu.res.benzene.v === .012, 'C1 greek mu: ' + JSON.stringify(mu));
      const ng = parseLabTable([['Sample ID', 'Analyte', 'Result', 'Units'], ['MW-1', 'Benzene', '12', 'ng/L']]).samples[0];
      want(ng && ng.res.benzene.v === .000012, 'C1 ng/L: ' + JSON.stringify(ng));
      const mm = parseLabTable([['Sample ID', 'Analyte', 'Result', 'Units'], ['MW-1', 'Benzene', '12', 'mmol/L'], ['MW-1', 'Toluene', '3', 'mg/L']]);
      want(!mm.samples[0]?.res.benzene && mm.unknown.some(u => u.includes("mmol/L")), 'C1 unknown unit refused: ' + JSON.stringify(mm));
      // I3: dates parsed to ISO
      want(typeof isoDate === 'function' && isoDate(46327) === '2026-11-01' && isoDate('15/10/2026') === '2026-10-15' && isoDate('03/04/2026') === '' && isoDate('15-Oct-2026') === '2026-10-15' && isoDate('2026-10-15T08:00') === '2026-10-15', 'I3 isoDate missing or wrong');
      // I5: crosstab with a units column in ug/L is water
      const ct = parseLabTable([['Parameter', 'Units', 'MW-1'], ['Benzene', 'ug/L', '40'], ['Toluene', 'ug/L', '<1']]).samples[0];
      want(ct && ct.water && ct.res.benzene.v === .04, 'I5 crosstab water: ' + JSON.stringify(ct));
      loadLloydExample(); await w(150);
      const wells = sectionList().filter(b => b.well?.installed && b.easting != null && b.elevation != null), src = wells[0];
      // I2: an undated groundwater result stays undated; a new row is not dated today
      await importLabFile(new File(['Sample ID,Analyte,Result,Units\\n' + src.name + ',Benzene,7,mg/L\\n'], 'gw.csv', { type: 'text/csv' })); await w(100); importLabGo(); await w(100);
      const und = src.gwSamples.find(s => s.res.benzene?.v === 7); want(und && und.date === '', 'I2 undated import: ' + JSON.stringify(und));
      S.sel = src.id; S.dtab = 'ww'; goTab('edit'); await w(200); document.querySelector('[data-act="gw-new"]')?.click(); await w(100); want(src.gwSamples[src.gwSamples.length - 1].date === '', 'I2 new row dated: ' + src.gwSamples[src.gwSamples.length - 1].date);
      // I1: a non-detect above the guideline does not make a contour
      setSite({ ...siteOf(), gwGuide: { benzene: .005 } }); const tri = wells.slice(0, 3);
      tri.forEach((b, i) => { b.gwSamples = [{ id: 'n' + i, date: '2026-09-15', sid: 'x', res: { benzene: i === 1 ? { v: .01, lt: true } : { v: [.001, 0, .002][i], lt: false } } }]; });
      S.secIds = new Set(tri.map(b => b.id)); S.xs = { ...S.xs, date: '', medium: 'groundwater', param: 'benzene', plume: true, model: false, round: false }; goTab('xsec'); await w(250);
      const d1 = document.querySelector('#xs-draw'); want(!d1.querySelector('path[data-contour]') && /left out of the contours/.test(d1.textContent), 'I1 high-DL non-detect: contours ' + d1.querySelectorAll('path[data-contour]').length);
      want(!!d1.querySelector('g[clip-path] [data-pt]') || !!d1.querySelector('g[clip-path]'), 'P5 plume clipped to the ground');
      // I4: undated soil borehole included with no date; counted when a date is set
      const nb = blankBorehole('UD1'); Object.assign(nb, { project: src.project, easting: src.easting + 5, northing: src.northing, elevation: src.elevation, crs: src.crs, layers: [{ id: uid('l'), top: 0, bottom: 4, uscs: 'sm' }], samples: [{ id: uid('s'), no: 1, depth: 1, lab: { benzene: { v: 3, lt: false } } }] }); const un = normalize(nb); un.date = ''; un.dateEnd = ''; S.bh.set(un.id, un);
      const pos = secPos([un]); const p0 = plumePoints(pos, 'soil', 'benzene', '', false), p1 = plumePoints(pos, 'soil', 'benzene', '2026-12-31', false);
      want(p0.length === 1 && p1.length === 0 && p1.undated === 1, 'I4 undated soil: ' + p0.length + '/' + p1.length + '/' + p1.undated); S.bh.delete(un.id);
      // forecast cases
      src.gwSamples = [{ id: 'g1', date: '2026-09-15', sid: 'x', res: { benzene: { v: .5, lt: false }, toluene: { v: .3, lt: false } } }];
      tri.slice(1).forEach(b => b.gwSamples = []);
      setSite({ ...siteOf(), model: { src: 'gw', srcBh: src.id } }); S.secIds = new Set(); S.xs = { ...S.xs, plume: false, model: true, param: 'benzene' }; goTab('xsec'); await w(250);
      // I9: a legend for the forecast on the drawing
      want(!!document.querySelector('#xs-draw svg [data-model-legend]'), 'I9 model legend');
      // P3: the self-check is named as one
      want(modelChecks(modelRun('')).checks.some(c => /self-check/i.test(c.name)) && !modelChecks(modelRun('')).checks.some(c => c.name === 'Ogata–Banks (1961) agreement'), 'P3 self-check name');
      // I8: the front error is the exact dropped term at the front u·t
      setSite({ ...siteOf(), model: { src: 'gw', srcBh: src.id, start: '2016-09-15', at: '2026-09-15' } }); drawXsec();
      { const run0 = modelRun(''), P = run0.P, t = (Date.parse('2026-09-15') - Date.parse('2016-09-15')) / 864e5, x = P.v / P.R * t, exact = ogataBanks({ C0: 1, v: P.v, D: P.ax * P.v, R: P.R, x, t }) - domenico({ C0: 1, v: P.v, R: P.R, ax: P.ax, ay: 0, az: 0, Y: 1e9, Z: 1e9, x, t });
        const c = modelChecks(run0).checks.find(c => /front/i.test(c.name)); want(c && Math.abs(c.value - exact) < 1e-9 && c.detail.includes((exact * 100).toFixed(1)), 'I8 front error: ' + JSON.stringify({ c, exact, x })); }
      // P1: a report item keeps its own compound
      { const it = { ...newItem('section'), o: { xs: { ...S.xs, model: true, param: 'toluene', plume: false } } }; setSite({ ...siteOf(), model: { src: 'gw', srcBh: src.id } }); S.xs = { ...S.xs, param: 'benzene' };
        const svg = itemInner(it, 900, 420); want(/Model, not measured: Toluene/.test(svg), 'P1 report item compound: ' + (svg.match(/Model, not measured: [A-Za-z]+/) || [])[0]); }
      goTab('xsec'); await w(150);
      // P2: no source result on or before the forecast date: refuse, not use later data
      setSite({ ...siteOf(), model: { src: 'gw', srcBh: src.id, at: '2026-01-01' } }); drawXsec(); want(modelRun('').missing.some(m => /on or before 2026-01-01/.test(m)), 'P2 future source: ' + modelRun('').missing);
      // I1b: a non-detect source is refused
      src.gwSamples = [{ id: 'g2', date: '2026-09-15', sid: 'x', res: { benzene: { v: .01, lt: true } } }]; setSite({ ...siteOf(), model: { src: 'gw', srcBh: src.id } }); drawXsec(); want(modelRun('').missing.some(m => /not detected/.test(m)), 'I1 non-detect source: ' + modelRun('').missing);
      src.gwSamples = [{ id: 'g1', date: '2026-09-15', sid: 'x', res: { benzene: { v: .5, lt: false } } }];
      // I7: a source half-life needs a release date
      setSite({ ...siteOf(), model: { src: 'gw', srcBh: src.id, srcHl: 365 } }); drawXsec(); want(modelRun('').missing.some(m => /release date/i.test(m)), 'I7 source half-life: ' + modelRun('').missing);
      // P4: leachate above solubility is refused
      src.samples[0].lab = { benzene: { v: 1e6, lt: false } }; setSite({ ...siteOf(), model: { src: 'soil', srcBh: src.id } }); drawXsec(); want(modelRun('').missing.some(m => /solubility/i.test(m)), 'P4 solubility: ' + modelRun('').missing);
      // I6: a flat water table has no flow direction
      for (const b of projList()) if (b.well?.installed && b.elevation != null) b.water = [{ id: uid('w'), date: '2026-09-01', depth: b.elevation - 640, measured: b.elevation - 640, ref: 'gs', kind: 'static' }];
      setSite({ ...siteOf(), model: { src: 'gw', srcBh: src.id } }); drawXsec(); want(modelRun('').missing.some(m => /flat/i.test(m)), 'I6 flat: ' + modelRun('').missing);
      } catch (e) { F.push('THREW: ' + String(e.stack).slice(0, 400)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  });

  await check('example: cross-section shows every feature', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        document.querySelector('[data-act="load-xs"]') ? document.querySelector('[data-act="load-xs"]').click() : loadXsExample(); await w(400);
        want(S.tab === 'xsec', 'opens on the Cross-section page: ' + S.tab);
        const d = document.querySelector('#xs-draw'), txt = d?.textContent || '', svg = d?.querySelector('svg');
        want(svg && [...svg.querySelectorAll('text title')].filter(t => /projected onto it/.test(t.textContent)).length >= 2, 'offsets of off-line boreholes');
        want(Object.keys(siteOf()?.xsec?.alias || {}).length >= 1 && svg.querySelectorAll('path[data-unit="join"]').length > 0 && svg.querySelectorAll('path[data-unit="pinch"]').length > 0, 'layer pairing, joins and a pinch-out');
        want(svg.querySelector('[data-ground] title') && svg.querySelectorAll('[data-wtick]').length >= 6 && svg.querySelectorAll('[data-wjoin]').length >= 3, 'ground and dated water');
        want(xsDates(sectionList()).length >= 6 && document.querySelector('#xs-play') && !document.querySelector('#xs-play').disabled, 'timeline with play');
        want(svg.querySelectorAll('[data-pt]').length >= 5 && svg.querySelectorAll('path[data-contour]').length >= 1, 'measured plume with contours');
        const run0 = modelRun(S.xs.date); want(run0.ok, 'forecast runs: ' + run0.missing);
        want(svg.querySelector('[data-model-legend]') && svg.querySelectorAll('[data-model-contour]').length >= 1 && /Model, not measured/.test(txt), 'forecast drawn and labelled');
        const C = modelChecks(run0); want(C.residuals.length >= 6 && C.checks.filter(c => !c.info && !/front/i.test(c.name)).every(c => c.ok), 'checks pass with later rounds: ' + JSON.stringify(C.checks.map(c => [c.name, c.ok])) + ' residuals ' + C.residuals.length);
        want(projList().filter(b => (b.slug || []).length).length >= 3 && projList().some(b => (b.water || []).some(x => x.kind === 'strike')), 'slug tests and strikes');
        want(projList().some(b => b.samples.some(sm => exceeds(labVal(sm, 'benzene'), 'benzene'))) && projList().some(b => b.gwSamples.some(s => gwExceeds(gwVal(s, 'benzene'), 'benzene'))), 'soil and groundwater exceedances');
        want(repLayout().pages.some(p => p.items?.some(it => it.t === 'section' && it.o?.xs?.model)), 'report page with the section and forecast');
        setXs('round', false); setXs('medium', 'vapour'); await w(100); want(document.querySelectorAll('#xs-draw svg [data-pt]').length >= 20, 'vapour plume');
        setXs('medium', 'soil'); setXs('param', 'benzene'); await w(100); want(document.querySelectorAll('#xs-draw svg [data-pt]').length >= 10, 'soil plume');
        const last = xsDates(sectionList()).pop(); setXs('medium', 'groundwater'); setXs('round', false); xsSetDate(last); await w(150); want(/left out of the contours/.test(document.querySelector('#xs-draw').textContent), 'high detection limit note on the latest round');
        want(!(window.__errs || []).length, 'page errors: ' + (window.__errs || []).join(' | '));
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 300)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  });

  await check('plumes: forecast on the dated water table', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        loadXsExample(); await w(400);
        setModel('az', '');   // the example enters its own value; test the defaults
        const date = '2024-05-14', mw1 = sectionList().find(b => b.name === 'MW-1'), lvl = mw1.elevation - waterAt(mw1, date).depth;
        const run1 = modelRun(date); want(run1.ok, 'runs: ' + run1.missing);
        const fit = run1.P.fit({ e: mw1.easting, n: mw1.northing });
        want(Math.abs(fit - lvl) < .08, 'water table from the round on or before the date: fit ' + fit.toFixed(2) + ' vs measured ' + lvl.toFixed(2));
        want(run1.P.az === 0 && /BIOSCREEN/.test(run1.P.src.az), 'vertical dispersivity defaults to 0 (BIOSCREEN): ' + run1.P.az + ' ' + run1.P.src.az);
        want(document.querySelector('#mdl-azrule'), 'a vertical spreading choice in the inputs');
        setModel('azRule', 'astm'); let P = modelRun(date).P;
        want(Math.abs(P.az - .05 * P.ax) < 1e-9 && /ASTM/.test(P.src.az), 'ASTM 1995: az = 0.05 ax: ' + P.az + ' ' + P.src.az);
        setModel('azRule', 'epa'); P = modelRun(date).P;
        want(Math.abs(P.az - .025 * P.ax) < 1e-9 && /EPA/.test(P.src.az), 'EPA 1986 low end: az = 0.025 ax');
        setModel('azRule', ''); setModel('az', 0.3); P = modelRun(date).P; want(P.az === .3 && P.src.az === 'entered', 'a typed value wins');
        setModel('az', '');
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 300)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  });
  await check('plumes: field honours the data', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        loadXsExample(); await w(400);
        const G = XS_GEOM, pts = plumePoints(G.pos, 'groundwater', 'benzene', S.xs.date, true).filter(p => !p.lt);
        const elev = p => p.b.elevation - (p.top + p.bot) / 2;
        const g = plumeField(G.pos, { ...S.xs, shape: 'guided' }, G, 4);
        want(g.method === 'guided', 'guided when the forecast runs: ' + g.method + ' ' + g.note);
        for (const p of pts) { const [c] = g.at(p.d, elev(p)); want(Math.abs(Math.log10(c) - Math.log10(p.v)) < .005, 'guided equals ' + p.b.name + ': ' + c + ' vs ' + p.v); }
        want(g.c.every(Number.isFinite) && g.a.every(Number.isFinite), 'guided grid finite');
        const d = plumeField(G.pos, { ...S.xs, shape: 'data' }, G, 4), p0 = pts[1];
        want(d.method === 'data', 'data method');
        const [c0] = d.at(p0.d, elev(p0)); want(Math.abs(Math.log10(c0) - Math.log10(p0.v)) < .005, 'data equals the result at the screen');
        want(d.at(p0.d, p0.b.elevation - p0.bot - .5)[1] === 0, 'data: nothing 0.5 m below the screen');
        want(d.at(p0.d, p0.b.elevation - p0.top + .5)[1] === 0, 'data: nothing above the water table or screen');
        const flat = { ...S.xs, shape: 'guided' }, sav = gwFlow; window.gwFlow = () => ({ error: 'test: no flow' });
        const fb = plumeField(G.pos, flat, G, 4); window.gwFlow = sav;
        want(fb.method === 'data' && /forecast/i.test(fb.note) && /no flow/.test(fb.note), 'falls back to data with the reason: ' + fb.method + ' ' + fb.note);
        const one = plumeField([G.pos[0], G.pos[0]], { ...S.xs, shape: 'data' }, G, 4); want(one.c.every(Number.isFinite) && one.a.every(Number.isFinite), 'same-position wells give a finite grid');
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 300)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  });
  await check('plumes: three styles', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        loadXsExample(); await w(400); setXs('model', false); await w(100);
        const svg = () => document.querySelector('#xs-draw svg');
        setXs('style', 'graded'); await w(150);
        want(svg().querySelectorAll('path[data-contour="1"]').length >= 1, 'graded: a guideline contour');
        want(svg().querySelectorAll('rect[data-cell]').length > 0 && !svg().querySelector('[data-band]'), 'graded: shaded cells, no bands');
        setXs('style', 'bands'); await w(150);
        want(svg().querySelectorAll('[data-band]').length > 0 && !svg().querySelector('rect[data-cell]'), 'bands: bands, no shaded cells');
        setXs('style', 'lines'); await w(150);
        want([...svg().querySelectorAll('text[data-clabel]')].some(t => /0\.005/.test(t.textContent)), 'lines: a labelled guideline contour');
        want(svg().querySelector('text').textContent !== undefined && svg().textContent.includes('Interpreted: forecast shape matched to measured results'), 'guided label on the drawing');
        const d = svg().querySelector('path[data-contour]').getAttribute('d'); want((d.match(/M/g) || []).length < (d.match(/L/g) || []).length / 3, 'contours are joined into continuous lines');
        // halving the grid barely moves the guideline contour's furthest point
        const G = XS_GEOM, far = cell => { const g = plumeField(G.pos, S.xs, G, cell), s = fieldContours(g, g.lv[0].v); return Math.max(...s.flatMap(l => l.map(p => p[0]))); };
        const a = far(4), b = far(2), len = G.X(G.maxD) - G.X(0); want(Math.abs(a - b) < .01 * len, 'grid halving moves the contour < 1 % of the length: ' + (a - b).toFixed(2) + ' px of ' + len.toFixed(0));
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 300)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  });
  await check('plumes: compare and markers', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        loadXsExample(); await w(400);
        for (const id of ['xs-shape', 'xs-style', 'xs-layer', 'xs-soilcol']) want(document.querySelector('#' + id), 'control #' + id);
        const pick = async (id, v) => { const el = document.querySelector('#' + id); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); await w(200); };
        await pick('xs-layer', 'both'); let svg = document.querySelector('#xs-draw svg');
        const mc = [...svg.querySelectorAll('[data-model-contour]')];
        want(mc.length && mc.every(p => p.getAttribute('stroke-dasharray')) && !svg.querySelector('[data-model-fill]'), 'compare: forecast as dashed lines only');
        want(svg.querySelector('[data-contour]') && svg.querySelector('rect[data-cell]'), 'compare: measured plume in its style');
        await pick('xs-layer', 'model'); svg = document.querySelector('#xs-draw svg');
        want(svg.querySelector('[data-model-fill]') && !svg.querySelector('[data-contour]'), 'forecast only: filled, no measured plume');
        await pick('xs-layer', 'meas'); svg = document.querySelector('#xs-draw svg');
        want(!svg.querySelector('[data-model-contour]') && svg.querySelector('[data-contour]'), 'measured only');
        want(svg.querySelector('g[data-soil]')?.getAttribute('style')?.includes('grayscale'), 'soil turns grey under a plume');
        document.querySelector('#xs-soilcol').click(); await w(200); svg = document.querySelector('#xs-draw svg');
        want(!svg.querySelector('g[data-soil]')?.getAttribute('style')?.includes('grayscale'), 'keep soil colours');
        const G = XS_GEOM, cols = G.pos.map(p => G.X(p.d));
        const pts = [...svg.querySelectorAll('[data-pt]')]; want(pts.length >= 5, 'markers drawn');
        want(pts.every(c => cols.some(x => Math.abs(+c.getAttribute('cx') - x) < 1)), 'markers sit on the borehole column');
        const order = [...svg.children], firstCell = order.findIndex(e => e.querySelector?.('rect[data-cell]')), lastCol = order.map((e, i) => e.matches('g[data-col]') ? i : -1).filter(i => i >= 0).pop();
        want(firstCell >= 0 && lastCol > firstCell, 'columns are drawn over the plume shading');
        await pick('xs-shape', 'data'); svg = document.querySelector('#xs-draw svg');
        want(svg.textContent.includes('No data above or below the well screens'), 'data only labelled');
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 300)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  });
  await check('plumes: report and water labels', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        loadXsExample(); await w(400);
        const d = document.querySelector('#xs-draw'); d.style.width = '700px'; drawXsec(); await w(150);
        const boxes = [...d.querySelectorAll('svg text.wl')].map(t => [t.textContent, t.getBBox()]);
        want(boxes.length >= 6, 'water labels drawn: ' + boxes.length);
        for (let a = 0; a < boxes.length; a++) for (let c = a + 1; c < boxes.length; c++) { const p = boxes[a][1], q = boxes[c][1];
          if (p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height) want(false, boxes[a][0] + ' overlaps ' + boxes[c][0]); }
        d.style.width = '';
        goTab('compose'); await w(200);
        const L = repLayout(), pi = L.pages.findIndex(p => p.items.some(x => x.t === 'section' && x.o?.xs)), it = L.pages[pi].items.find(x => x.t === 'section' && x.o?.xs);
        it.o = { ...it.o, xs: { ...it.o.xs, style: 'bands', shape: 'data' } }; S.cpage = pi; rerenderCompose(); await w(300);
        const html = document.querySelector('.cmp-paper')?.innerHTML || '';
        want(/data-band/.test(html), 'report section item draws its own style (bands)');
        want(html.includes('No data above or below the well screens'), 'report item keeps its shape label');
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 300)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  });
  await check('plumes: review fixes', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        const fresh = async () => { loadXsExample(); await w(400); };
        const byName = n => sectionList().find(b => b.name === n), mid = (b, p) => b.elevation - (p.top + p.bot) / 2;
        const ptOf = (n, G) => plumePoints(G.pos, 'groundwater', 'benzene', S.xs.date, true).find(p => p.b.name === n);
        // C1: forecast 0 at a measured exceedance (default az = 0, screen below the source depth) -> data only, naming the well
        await fresh(); setModel('az', ''); const m3 = byName('MW-3'); m3.well.screenTop = 5.0; m3.well.screenBottom = 6.2; drawXsec(); await w(100);
        let G = XS_GEOM, g = plumeField(G.pos, { ...S.xs, shape: 'guided' }, G, 4);
        want(g.method === 'data' && /MW-3/.test(g.note), 'C1: falls back to data only naming MW-3: ' + g.method + ' / ' + g.note);
        // I1: a non-detect caps the guided field at its detection limit
        await fresh(); const m4 = byName('MW-4'), s4 = (m4.gwSamples || []).filter(s => s.date <= S.xs.date).sort((a, c) => a.date < c.date ? -1 : 1).pop();
        s4.res.benzene = { v: .001, lt: true }; drawXsec(); await w(100); G = XS_GEOM;
        g = plumeField(G.pos, { ...S.xs, shape: 'guided' }, G, 4); const p4 = ptOf('MW-4', G);
        want(g.method === 'guided' && g.at(p4.d, mid(m4, p4))[0] <= .00101, 'I1: field at the non-detect is at or below its DL: ' + g.at(p4.d, mid(m4, p4))[0]);
        // I2: a nested well at the same spot keeps its own result in both shapes
        await fresh(); const base = byName('MW-3'), nb = structuredClone(base); Object.assign(nb, { id: uid('bh-'), name: 'MW-3D' });
        base.well = { ...base.well, screenTop: 2.0, screenBottom: 3.5 }; nb.well = { ...nb.well, screenTop: 4.5, screenBottom: 6.0 }; /* nested: separate screens */ nb.gwSamples = nb.gwSamples.map(s => ({ ...s, id: uid('g'), res: { ...s.res, benzene: { v: .02, lt: false } } }));
        S.bh.set(nb.id, normalize(nb)); S.secIds = new Set(); drawXsec(); await w(150); G = XS_GEOM;
        for (const shape of ['guided', 'data']) { g = plumeField(G.pos, { ...S.xs, shape }, G, 4);
          const pd = ptOf('MW-3D', G), ps = ptOf('MW-3', G), b3 = byName('MW-3');
          want(pd && Math.abs(Math.log10(g.at(pd.d, mid(nb, pd))[0]) - Math.log10(.02)) < .01, 'I2 ' + shape + ': nested MW-3D keeps 0.02: ' + (pd && g.at(pd.d, mid(nb, pd))[0]) + ' ' + JSON.stringify(pd && [pd.d, pd.top, pd.bot, pd.v, nb.elevation, mid(nb, pd)]));
          want(Math.abs(Math.log10(g.at(ps.d, mid(b3, ps))[0]) - Math.log10(ps.v)) < .01, 'I2 ' + shape + ': MW-3 still matched'); }
        // I3: shaded cells do not overlap (no doubled stripes in print)
        await fresh(); let svg = document.querySelector('#xs-draw svg'); const cells = [...svg.querySelectorAll('rect[data-cell]')];
        const ys = [...new Set(cells.map(c => +c.getAttribute('y')))].sort((a, b) => a - b), h = +cells[0].getAttribute('height');
        want(ys.length > 2 && ys[1] - ys[0] >= h - 1e-6 && cells[0].closest('g').getAttribute('shape-rendering') === 'crispEdges', 'I3: rows abut without overlap');
        // I4: the shape note fits the drawing and touches no other text, at report width
        const d = document.querySelector('#xs-draw'); d.style.width = '700px'; drawXsec(); await w(150); svg = d.querySelector('svg');
        const note = svg.querySelector('[data-fnote]'), nb2 = note.getBBox(), sw = +svg.getAttribute('width');
        want(nb2.x >= 0 && nb2.x + nb2.width <= sw + .5, 'I4: note inside the drawing: ' + nb2.x.toFixed(0) + '–' + (nb2.x + nb2.width).toFixed(0) + ' of ' + sw);
        for (const t of svg.querySelectorAll('text')) { if (t === note || !t.textContent.trim()) continue; const q = t.getBBox(); if (nb2.x < q.x + q.width && q.x < nb2.x + nb2.width && nb2.y < q.y + q.height && q.y < nb2.y + nb2.height) want(false, 'I4: note overlaps "' + t.textContent.slice(0, 30) + '"'); }
        d.style.width = '';
        // I5: a detection below the guideline is not drawn like a non-detect
        drawXsec(); await w(100); svg = document.querySelector('#xs-draw svg');
        const det = [...svg.querySelectorAll('[data-pt][data-lt="0"]')], nd = [...svg.querySelectorAll('[data-pt][data-lt="1"]')];
        want(det.every(c => c.getAttribute('fill') !== '#fff') && nd.length && nd.every(c => c.getAttribute('stroke-dasharray')), 'I5: detections filled, non-detects dashed and hollow');
        // I6: soil below the water table is tinted
        want(svg.querySelector('[data-sat]'), 'I6: saturated zone tinted');
        // I7 (changed at the user's request): a report item saved before the plume shapes gets today's model-guided look
        goTab('compose'); await w(200); const L = repLayout(), pi = L.pages.findIndex(p => p.items.some(x => x.t === 'section' && x.o?.xs)), it = L.pages[pi].items.find(x => x.t === 'section' && x.o?.xs);
        const old = { ...it.o.xs }; delete old.shape; it.o = { ...it.o, xs: old }; S.cpage = pi; rerenderCompose(); await w(300);
        want(!(document.querySelector('.cmp-paper')?.innerHTML || '').includes('No data above or below the well screens'), 'I7: older report items get the model-guided look');
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 300)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  });
  await check('mf6: bridge runs a model', async run => {
    const r = await run(`(async () => {
      const F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        want(typeof window.desktop?.mf6Run === 'function', 'bridge present');
        const files = {
          'mfsim.nam': 'BEGIN options\\nEND options\\nBEGIN timing\\n  TDIS6 sim.tdis\\nEND timing\\nBEGIN models\\n  gwf6 gwf.nam gwf\\nEND models\\nBEGIN exchanges\\nEND exchanges\\nBEGIN solutiongroup 1\\n  ims6 sim.ims gwf\\nEND solutiongroup\\n',
          'sim.tdis': 'BEGIN options\\n  TIME_UNITS days\\nEND options\\nBEGIN dimensions\\n  NPER 1\\nEND dimensions\\nBEGIN perioddata\\n  1.0 1 1.0\\nEND perioddata\\n',
          'sim.ims': 'BEGIN nonlinear\\n  OUTER_DVCLOSE 1e-6\\nEND nonlinear\\nBEGIN linear\\n  INNER_DVCLOSE 1e-8\\n  INNER_RCLOSE 1e-6\\nEND linear\\n',
          'gwf.nam': 'BEGIN packages\\n  DIS6 gwf.dis\\n  NPF6 gwf.npf\\n  IC6 gwf.ic\\n  CHD6 gwf.chd\\n  OC6 gwf.oc\\nEND packages\\n',
          'gwf.dis': 'BEGIN dimensions\\n  NLAY 1\\n  NROW 1\\n  NCOL 5\\nEND dimensions\\nBEGIN griddata\\n  DELR\\n    CONSTANT 10\\n  DELC\\n    CONSTANT 10\\n  TOP\\n    CONSTANT 10\\n  BOTM\\n    CONSTANT 0\\nEND griddata\\n',
          'gwf.npf': 'BEGIN griddata\\n  ICELLTYPE\\n    CONSTANT 0\\n  K\\n    CONSTANT 1\\nEND griddata\\n',
          'gwf.ic': 'BEGIN griddata\\n  STRT\\n    CONSTANT 5\\nEND griddata\\n',
          'gwf.chd': 'BEGIN dimensions\\n  MAXBOUND 2\\nEND dimensions\\nBEGIN period 1\\n  1 1 1 6\\n  1 1 5 4\\nEND period 1\\n',
          'gwf.oc': 'BEGIN options\\n  HEAD FILEOUT gwf.hds\\nEND options\\nBEGIN period 1\\n  SAVE HEAD ALL\\nEND period 1\\n' };
        const res = await window.desktop.mf6Run({ files, outputs: ['gwf.hds', 'gwf.lst'] });
        want(res.ok, 'runs: ' + res.error);
        want(/Normal termination/.test(res.stdout), 'normal termination');
        want(res.files['gwf.hds'] instanceof Uint8Array && res.files['gwf.hds'].length === 24 + 16 + 12 + 5 * 8, 'head file returned: ' + res.files['gwf.hds']?.length);
        const bad = await window.desktop.mf6Run({ files: { ...files, '../x': 'no' } });
        want(!bad.ok && /plain names/.test(bad.error), 'refuses paths: ' + bad.error);
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 300)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  }, { mf6: true });
  await check('mf6: flow against the analytical solution', async run => {
    const r = await run(`(async () => {
      const F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        // confined strip, fixed heads 16 and 14 m at cell centres 100 m apart, recharge R: h = h1 + (h2 - h1)x/L + R x(L - x)/(2T)
        const n = 101, K = 2, b = 10, R = 4e-4, T = K * b, L = 100;
        const spec = { nper: 1, periods: [[1, 1, 1]], steady: [true],
          dis: { nlay: 1, nrow: 1, ncol: n, delr: 1, delc: 1, top: 10, botm: [0] },
          npf: { icelltype: [0], k: [K], k33: [K] }, ic: 15,
          chd: [[[0, 0, 0, 16], [0, 0, n - 1, 14]]], rch: [R],
          obs: [['a', 0, 0, 25], ['b', 0, 0, 50], ['c', 0, 0, 80]] };
        const { files, outputs } = mf6Files(spec);
        const res = await window.desktop.mf6Run({ files, outputs });
        want(res.ok, 'runs: ' + res.error);
        const H = mf6ReadHeads(res.files['gwf.hds']), h = H[H.length - 1].data, obs = mf6ReadObs(new TextDecoder().decode(res.files['gwf.obs.csv']));
        let worst = 0; for (let c = 0; c < n; c++) { const x = c, exact = 16 + (14 - 16) * x / L + R * x * (L - x) / (2 * T); worst = Math.max(worst, Math.abs(h[c] - exact)); }
        want(worst < .001, 'matches the analytical solution within 1 mm: worst ' + worst.toExponential(2) + ' m');
        for (const [nm, , , c] of spec.obs) want(Math.abs(obs[nm.toUpperCase()][0] - h[c]) < 1e-9, 'head file equals the observation output at ' + nm);
        const disc = mf6Discrepancy(new TextDecoder().decode(res.files['gwf.lst']));
        want(disc != null && Math.abs(disc) < 1, 'mass balance discrepancy under 1 %: ' + disc);
        const Q = mf6ReadBudget(res.files['gwf.cbc'], 'DATA-SPDIS'); want(Q.length && Q[0].list.length === n && Math.abs(Q[0].list[50].aux[0] - K * .02) < 1e-3, 'specific discharge at the middle is K·Δh/L: ' + Q[0]?.list[50]?.aux);
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 300)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  }, { mf6: true });
  await check('mf6: site model from the example', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        loadXsExample(); await w(400);
        const M = gwModelSpec(sectionList(), siteOf());
        want(!M.error, 'builds: ' + M.error);
        const units = [...new Set(sectionList().flatMap(b => xsUnits(b).map(u => u.u)))];
        want(M.units.length === units.length && M.spec.dis.nlay === units.length, 'one layer per correlated unit: ' + M.units.map(u => u.u) + ' vs ' + units);
        want(M.spec.dis.idomain.some(L => Array.from(L).some(v => v === -1)), 'a pinched-out unit becomes pass-through cells');
        const chd = M.spec.chd[0], nc = M.spec.dis.ncol; want(chd.length && chd.every(q => q[2] === 0 || q[2] === nc - 1), 'fixed heads on the upgradient and downgradient faces only');
        const up = chd.filter(q => q[2] === 0).map(q => q[3]), dn = chd.filter(q => q[2] === nc - 1).map(q => q[3]); want(Math.min(...up) > Math.max(...dn), 'heads fall in the flow direction');
        const wells = gwHeads(sectionList(), M.round).wells; want(M.obs.length === wells.length && M.obs.length >= 6, 'one head observation per well read in the round: ' + M.obs.length + ' / ' + wells.length);
        want(M.units.some(u => /slug/.test(u.kSrc)) && M.units.every(u => u.kSrc), 'K sources: slug tests or calibration');
        want(Math.abs(M.grid.angrot - Math.atan2(M.F.f[1], M.F.f[0]) * 180 / Math.PI) < 1e-6, 'grid columns run along the flow direction');
        const res = await gwRun(M); want(res.ok, 'runs: ' + res.error);
        want(Math.abs(res.discrepancy) < 1, 'mass balance under 1 %: ' + res.discrepancy);
        want(res.sim.every(v => Number.isFinite(v)), 'simulated heads at every well');
        const top = M.grid.cellCentre(0, 0); want(Number.isFinite(top[0]) && Number.isFinite(top[1]), 'cell centres in world coordinates');
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 400)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  }, { mf6: true });
  await check('mf6: calibration recovers known parameters', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        loadXsExample(); await w(400);
        const M = gwModelSpec(sectionList(), siteOf()), aq = M.units.find(u => u.prior != null);
        // twin experiment: heads made by the model with known values, then calibrated from a start three times off
        const truth = { rch: 3.2e-4 }, t = await gwRun(M, truth); want(t.ok, 'truth run: ' + t.error);
        M.obs.forEach((o, i) => { o.h = t.sim[i]; });
        const C = await gwCalibrate(M, { keys: ['rch'], start: { rch: truth.rch * 3 }, prior: false });
        want(C.ok, 'calibrates: ' + C.error);
        want(Math.abs(C.pv.rch / truth.rch - 1) < .05, 'recovers recharge within 5 %: ' + C.pv.rch + ' vs ' + truth.rch);
        for (const k of ['n', 'me', 'mae', 'rmse', 'range', 'srms', 'disc']) want(Number.isFinite(C.stats[k]), 'statistic ' + k + ': ' + C.stats[k]);
        want(C.stats.rmse < .005, 'fits the twin heads: RMSE ' + C.stats.rmse);
        want(C.residuals.length === M.obs.length && C.residuals.every(x => x.name && Number.isFinite(x.res)), 'residual per well');
        want(Number.isFinite(C.css.rch) && C.params[0].lo95 < C.pv.rch && C.params[0].hi95 > C.pv.rch, 'sensitivity and 95 % interval');
        // every K and the recharge together, no prior: with fixed-head boundaries, scaling them all leaves the heads unchanged
        const C2 = await gwCalibrate(M, { keys: [...M.units.map(u => 'k:' + u.u), 'rch'], prior: false, maxIter: 2 });
        want(C2.ok && C2.warnings.some(x => /cannot be separated/.test(x)), 'warns that every K and recharge cannot be separated: ' + C2.warnings);
        // with the slug-test prior the aquifer K stays near its measured value
        const C3 = await gwCalibrate(M, { keys: ['k:' + aq.u, 'rch'], prior: true, maxIter: 6 });
        want(C3.ok && Math.abs(Math.log10(C3.pv['k:' + aq.u]) - aq.prior) < .3, 'prior keeps K near the slug tests: ' + C3.pv['k:' + aq.u] + ' vs 10^' + aq.prior);
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 400)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  }, { mf6: true });
  await check('mf6: transient rounds', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        loadXsExample(); await w(400);
        const M = gwModelSpec(sectionList(), siteOf()), T = gwTransientSetup(M);
        want(T.rounds.length >= 6 && T.periods.length === T.rounds.length, 'one stress period per round: ' + T.rounds.length + ' rounds, ' + T.periods.length + ' periods');
        want(M.obsT.length >= T.rounds.length * 5 && new Set(M.obsT.map(o => o.date)).size === T.rounds.length, 'observations in every round');
        const res = await gwRunTransient(M, {}); want(res.ok, 'runs: ' + res.error);
        want(Math.abs(res.discrepancy) < 1, 'mass balance under 1 %: ' + res.discrepancy);
        const mw = M.obsT.filter(o => o.b.name === 'MW-3'), sims = mw.map(o => res.sim[M.obsT.indexOf(o)]), meas = mw.map(o => o.h);
        const k = meas.indexOf(Math.max(...meas)); want(k > 0 && sims[k] > sims[k - 1], 'the modelled head rises into the high round, as measured: ' + sims.map(v => v.toFixed(2)) + ' vs ' + meas.map(v => v.toFixed(2)));
        const C = await gwCalibrate(M, { transient: true, keys: ['sy'], maxIter: 3 }); want(C.ok && C.residuals.length === M.obsT.length, 'transient calibration with a residual for every well and round: ' + C.error);
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 400)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  }, { mf6: true });
  await check('mf6: transport against Ogata-Banks and at the site', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        // 1-D column: constant concentration 1 at the inflow cell, uniform flow, dispersivity 1 m
        const n = 240, dx = .5, K = 10, ne = .3, h1 = 10, h2 = 9, L = (n - 1) * dx, v = K * (h1 - h2) / L / ne, al = 1, t = 100;
        for (const kd of [0, .1]) {
          const rhob = 1.7, R = 1 + rhob * kd / ne;
          const spec = { nper: 1, periods: [[t, 200, 1]], steady: [true], dis: { nlay: 1, nrow: 1, ncol: n, delr: dx, delc: 1, top: 20, botm: [0] },
            npf: { icelltype: [0], k: [K], k33: [K] }, ic: 10, chd: [[[0, 0, 0, h1], [0, 0, n - 1, h2]]], rch: [null],
            gwt: { porosity: [ne], rhob, kd, al, ath: 0, atv: 0, cnc: [[[0, 0, 0, 1]]], saveAll: true } };
          const { files, outputs } = mf6Files(spec), res = await window.desktop.mf6Run({ files, outputs });
          want(res.ok, 'column runs: ' + res.error); if (!res.ok) continue;
          const C = mf6ReadHeads(res.files['gwt.ucn']), last = C[C.length - 1].data; let worst = 0, at = 0;
          for (let c = 1; c < n - 20; c++) { const x = c * dx, ob = ogataBanks({ C0: 1, v, D: al * v, R, x, t }); if (Math.abs(last[c] - ob) > worst) { worst = Math.abs(last[c] - ob); at = x; } }
          want(worst < .03, 'Kd ' + kd + ': matches Ogata-Banks within 0.03 (worst ' + worst.toFixed(4) + ' at ' + at + ' m; front at ' + (v * t / R).toFixed(1) + ' m)');
          const disc = mf6Discrepancy(new TextDecoder().decode(res.files['gwt.lst'])); want(disc != null && Math.abs(disc) < 1, 'transport mass balance under 1 %: ' + disc);
        }
        // site transport from the example's forecast set-up
        loadXsExample(); await w(400);
        const M = gwModelSpec(sectionList(), siteOf()), T = await gwTransport(M, {});
        want(T.ok, 'site transport runs: ' + T.error);
        const rounds = [...new Set(sectionList().flatMap(b => (b.gwSamples || []).map(s => s.date)).filter(d => d && d >= siteOf().model.start))];
        want(rounds.every(d => T.times.some(x => x.date === d)), 'a concentration at every sampling round');
        want(T.obs.length >= 10 && T.obs.every(o => Number.isFinite(o.sim)), 'compared with measured results: ' + T.obs.length);
        want(T.times[T.times.length - 1].layers.some(L => L.some(v => v > .005)), 'a plume above the guideline exists');
        want(Number.isFinite(T.fit.rmsLog) && Number.isFinite(T.disc), 'fit and mass balance reported');
        const Tc = await gwTransport(M, {}, { calibrate: true }); want(Tc.ok && Tc.fit.rmsLog <= T.fit.rmsLog + 1e-9 && Tc.c0 > 0, 'source calibration improves or keeps the fit: ' + Tc.fit.rmsLog + ' vs ' + T.fit.rmsLog);
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 400)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  }, { mf6: true });
  await check('mf6: pathlines follow flow', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        // uniform strip: travel time from x0 to the outflow boundary is distance / v
        const n = 101, nr = 3, cell = 1, K = 10, ne = .3, L = (n - 1) * cell, v = K * 1 / L / ne;
        const G = gwGrid({ xorigin: 500, yorigin: 800, ang: Math.PI / 6, cell, nrow: nr, ncol: n, top: new Float64Array(n * nr).fill(20), botm: [new Float64Array(n * nr).fill(0)], idomain: [new Int32Array(n * nr).fill(1)] });
        const chd = []; for (let r = 0; r < nr; r++) chd.push([0, r, 0, 10], [0, r, n - 1, 9]);
        const spec = { nper: 1, periods: [[1, 1, 1]], steady: [true], dis: { nlay: 1, nrow: nr, ncol: n, delr: cell, delc: cell, top: 20, botm: [0], xorigin: 500, yorigin: 800, angrot: 30 }, npf: { icelltype: [0], k: [K], k33: [K] }, ic: 10, chd: [chd], rch: [null] };
        const { files, outputs } = mf6Files(spec), res = await window.desktop.mf6Run({ files, outputs }); want(res.ok, 'runs: ' + res.error);
        const q = mf6ReadBudget(res.files['gwf.cbc'], 'DATA-SPDIS').pop(), [E, N] = G.toWorld(10.5, 1.5);
        const path = gwPathline(G, q.list, [ne], E, N, 10, { tmax: 1e6 });
        want(path.length > 5, 'a path: ' + path.length);
        const end = path[path.length - 1], dist = G.toLocal(end.E, end.N)[0] - 10.5, tExact = dist / v;
        want(dist > 80, 'moves downgradient to the outflow: ' + dist.toFixed(1) + ' m');
        want(Math.abs(end.t / tExact - 1) < .05, 'travel time = distance / v within 5 %: ' + end.t.toFixed(1) + ' vs ' + tExact.toFixed(1) + ' days');
        want(path.every(p => Math.abs(G.toLocal(p.E, p.N)[1] - 1.5) < .01), 'stays on its row in uniform flow');
        // at the site, from the source well
        loadXsExample(); await w(400);
        const M = gwModelSpec(sectionList(), siteOf()), runS = await gwRun(M); want(runS.ok, 'site runs');
        const paths = gwSourcePaths(M, runS); want(paths.length >= 1 && paths[0].length > 3, 'site paths from the source');
        const p0 = paths[0], a = M.grid.toLocal(p0[0].E, p0[0].N)[0], b = M.grid.toLocal(p0[p0.length - 1].E, p0[p0.length - 1].N)[0];
        want(b > a + 10, 'site path moves along the flow direction: ' + a.toFixed(1) + ' → ' + b.toFixed(1));
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 400)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  }, { mf6: true });
  await check('mf6: model page', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      const until = async (f, ms = 120000) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await w(250); return f(); };
      try {
        loadXsExample(); await w(400);
        want(document.querySelector('#prail [data-tab="gwm"]'), 'a Model page on the rail');
        goTab('gwm'); await w(300); const v = () => document.querySelector('#view') || document.body;
        want(/MODFLOW 6/.test(v().textContent), 'names the engine');
        for (const a of ['gw-run', 'gw-cal', 'gw-calt', 'gw-trans', 'gw-export', 'gw-feat-add']) want(document.querySelector('[data-act="' + a + '"]'), 'button ' + a);
        want(document.querySelectorAll('#gwm-units tbody tr').length === gwModelSpec(projList(), siteOf()).units.length, 'a row per unit with its K source');
        want([...document.querySelectorAll('#gwm-units tbody tr')].every(tr => /slug|calibration|entered/.test(tr.textContent)), 'every K has a source');
        document.querySelector('[data-act="gw-feat-add"]').click(); await w(200);
        want((siteOf().gwModel?.features || []).length === 1 && document.querySelectorAll('#gwm-feat tbody tr').length === 1, 'a boundary feature row');
        const ft = document.querySelector('#gwm-feat tbody tr [data-gwft$="|type"]'); ft.value = 'drn'; ft.dispatchEvent(new Event('change', { bubbles: true })); await w(100);
        want(siteOf().gwModel.features[0].type === 'drn', 'feature type saved');
        document.querySelector('#gwm-feat [data-act="gw-feat-del"]').click(); await w(150); want(!(siteOf().gwModel.features || []).length, 'feature removed');
        document.querySelector('[data-act="gw-cal"]').click();
        await until(() => siteOf().gwModel?.calib && !S.gwm?.busy, 180000);
        const c = siteOf().gwModel.calib; want(c && Number.isFinite(c.stats.rmse), 'calibration stored with its statistics');
        await w(300);
        want(document.querySelectorAll('#gwm-res tbody tr').length === c.residuals.length && document.querySelector('#gwm-scatter svg'), 'residual table and measured-vs-simulated plot');
        want(/RMSE/.test(v().textContent) && /discrepancy/i.test(v().textContent), 'statistics shown');
        document.querySelector('[data-act="gw-trans"]').click(); await until(() => S.gwm?.trans && !S.gwm?.busy, 180000);
        want(S.gwm.trans?.ok && document.querySelector('#gwm-trans tbody tr'), 'transport results shown: ' + S.gwm.trans?.error);
        let saved = null; window.saveFile = (name, data) => { saved = { name, size: data.size ?? data.length ?? data.byteLength }; };
        document.querySelector('[data-act="gw-export"]').click(); await until(() => saved, 20000); want(saved && /\\.zip$/.test(saved.name) && saved.size > 1000, 'exports the model files: ' + JSON.stringify(saved));
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 400)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  }, { mf6: true });
  await check('mf6: web version explains the model needs the desktop app', async run => {
    const r = await run(`(async () => { const w = ms => new Promise(r => setTimeout(r, ms)); loadXsExample(); await w(300); goTab('gwm'); await w(300);
      return { msg: /needs the desktop app/.test(document.body.textContent), disabled: document.querySelector('[data-act="gw-run"]')?.disabled }; })()`);
    expect(r.msg && r.disabled, 'web message and disabled buttons: ' + JSON.stringify(r));
  });
  await check('mf6: drawn on the section', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        loadXsExample(); await w(400);
        // without a model run: the Domenico forecast
        let svg = document.querySelector('#xs-draw svg'); want(!svg.querySelector('[data-gw-wt]') && /Model, not measured/.test(svg.textContent) && !/MODFLOW/.test(svg.textContent), 'without a run: Domenico, no model flow');
        const M = gwModel(), C = await gwCalibrate(M, { maxIter: 4 }); want(C.ok, 'calibrates: ' + C.error);
        setGwm({ calib: { mode: 'steady', pv: C.pv, params: C.params, stats: C.stats, residuals: C.residuals, css: C.css, corr: C.corr, warnings: C.warnings, round: M.round, rounds: [M.round], at: new Date().toISOString(), runs: C.runs, iterations: C.iterations, key: gwInputsKey(gwModel()) }, transport: { on: true } });
        await gwEnsure(true); want(S.gwm.run?.ok && S.gwm.trans?.ok, 'model and transport ran: ' + (S.gwm.err || S.gwm.trans?.error));
        drawXsec(); await w(200); svg = document.querySelector('#xs-draw svg');
        want(svg.querySelector('path[data-gw-wt]'), 'model water table drawn');
        want(svg.querySelectorAll('path[data-gw-head]').length >= 2 && svg.querySelector('text[data-gw-hlabel]'), 'head contours with labels');
        want(svg.querySelectorAll('[data-gw-arrow]').length >= 4, 'flow arrows: ' + svg.querySelectorAll('[data-gw-arrow]').length);
        want(/MODFLOW 6/.test(svg.querySelector('[data-model-caption]')?.textContent || ''), 'forecast caption names MODFLOW 6: ' + svg.querySelector('[data-model-caption]')?.textContent);
        want(svg.querySelector('[data-model-contour]'), 'the MODFLOW 6 plume is contoured');
        const g = plumeField(XS_GEOM.pos, { ...S.xs, shape: 'guided' }, XS_GEOM, 4); want(g.method === 'guided' && /MODFLOW 6/.test(g.note), 'model-guided shape comes from MODFLOW 6: ' + g.note);
        const p = plumePoints(XS_GEOM.pos, 'groundwater', 'benzene', S.xs.date, true).filter(q => !q.lt)[1];
        want(Math.abs(Math.log10(g.at(p.d, p.b.elevation - (p.top + p.bot) / 2)[0]) - Math.log10(p.v)) < .01, 'still equals the measured result at the well');
        want(/MODFLOW 6/.test(svg.textContent) && /calibrated/.test(svg.textContent), 'legend says MODFLOW 6 and calibrated');
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 400)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  }, { mf6: true });
  await check('report: section pages show the current plume and model', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        loadXsExample(); await w(400); setGwm({ transport: { on: true } });
        await gwEnsure(true); want(S.gwm.run?.ok && S.gwm.trans?.ok, 'model ran: ' + (S.gwm.err || S.gwm.trans?.error));
        const has = (svg, what) => { const d = document.createElement('div'); d.innerHTML = svg; return { wt: !!d.querySelector('[data-gw-wt]'), plume: !!d.querySelector('[data-band],[data-contour],[data-model-contour]'), note: d.querySelector('[data-fnote]')?.textContent || '' }; };
        /* a preset page's section item has no saved view: it follows the Cross-section page */
        const a = has(itemInner({ t: 'section', o: {} }, 900, 420)); want(a.wt && a.plume, 'preset section item shows model and plume: ' + JSON.stringify(a));
        /* a view saved before the plume shapes existed gets today's look */
        const { shape, style, ...old } = S.xs; const b = has(itemInner({ t: 'section', o: { xs: old } }, 900, 420));
        want(b.plume && /MODFLOW 6/.test(b.note), 'older saved view draws the model-guided plume: ' + JSON.stringify(b));
        const c = has('<svg>' + secPageBody() + '</svg>'); want(c.wt && c.plume, 'PDF preview section page shows model and plume: ' + JSON.stringify(c));
        /* the Reports page runs the model when it has none yet, then redraws */
        S.gwm.run = null; S.gwm.trans = null; S.gwm.key = '';
        goTab('compose'); await w(150); const L = repLayout(); L.pages.push(xsecPage()); S.cpage = L.pages.length - 1; rerenderCompose();
        for (let i = 0; i < 450 && !(S.gwm.run?.ok && !S.gwm.busy); i++) await w(200); await w(300);
        want(S.gwm.run?.ok, 'Reports page started the model run: ' + S.gwm.err);
        want(document.querySelector('#view [data-gw-wt]'), 'Reports page redrew with the model');
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 400)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  }, { mf6: true });
  await check('pdf log: test column headings and scale numbers do not clash', async run => {
    const r = await run(`(async () => {
      loadDlExample(); await new Promise(r => setTimeout(r, 300));
      const b = projList().find(b => (b.samples || []).some(s => s.lab)); S.sel = b.id;
      const keep = S.co.graphs; S.co.graphs = Object.keys(graphSeries()).filter(k => k.startsWith('lab:')).slice(0, 3).map(series => ({ series, type: 'points' }));
      const host = document.createElement('div'); host.style.cssText = 'position:absolute;left:0;top:0'; document.body.appendChild(host);
      const keepL = S.co.layout; S.co.layout = { ...(keepL || {}), graph: 'narrow' };
      host.innerHTML = pageSVG(b, 0, 1); S.co.graphs = keep; S.co.layout = keepL;
      const svg = host.querySelector('svg'), bands = [...svg.querySelectorAll('rect')].filter(x => x.getAttribute('style')?.includes('#e8ecf0')), hy = +bands[0].getAttribute('y'), by0 = hy + +bands[0].getAttribute('height');
      const T = [...svg.querySelectorAll('text')].filter(t => { const y = +t.getAttribute('y'); return y > hy && y < by0 && t.textContent.trim(); }).map(t => ({ t: t.textContent, b: t.getBoundingClientRect() }));
      /* the small key symbols (dots, squares, triangles) count too */
      T.push(...[...svg.querySelectorAll('circle,rect,path')].map(e => ({ t: e.tagName, b: e.getBoundingClientRect() })).filter(e => e.b.y > hy && e.b.y + e.b.height < by0 && e.b.width < 14 && e.b.height < 9 && e.b.width > 0));
      const hit = [];
      for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) { const a = T[i].b, c = T[j].b; if (a.x < c.x + c.width + 2 && c.x < a.x + a.width + 2 && a.y < c.y + c.height - .3 && c.y < a.y + a.height - .3) hit.push(T[i].t + ' / ' + T[j].t); }
      host.remove(); return { n: T.length, hit };
    })()`);
    expect(r.n > 10 && !r.hit.length, 'header text overlaps: ' + JSON.stringify(r));
  });
  await check('tutorial: button in the top bar', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        loadXsExample(); await w(300); const btn = document.querySelector('.topbar [data-act="tut"], header [data-act="tut"]') || document.querySelector('[data-act="tut"].tb');
        want(btn && /Tutorial/.test(btn.textContent), 'top bar has a Tutorial button');
        goTab('xsec'); await w(200); btn?.click(); await w(200); want(S.tut?.k === 'xsec' && document.querySelector('#tut'), 'on the Cross-section page it starts that tutorial: ' + S.tut?.k);
        tutClose(); goTab('v3d'); await w(200); btn?.click(); await w(200); want(S.tut?.k === 'gwm', '3D page starts the groundwater model tutorial: ' + S.tut?.k);
        tutClose(); goTab('home'); await w(200); btn?.click(); await w(200);
        const pick = [...document.querySelectorAll('#overlay [data-act^="tut-"]')].map(b => b.dataset.act); want(pick.includes('tut-xsec') && pick.includes('tut-gwm'), 'elsewhere it offers the tutorials: ' + pick);
        document.querySelector('#overlay [data-act="tut-gwm"]')?.click(); await w(300); want(S.tut?.k === 'gwm' && !document.querySelector('#overlay:not([hidden]) [data-act="tut-xsec"]'), 'choosing one starts it and closes the choice');
        tutClose();
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 300)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  });
  await check('ui: settings panel and collapsible list', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      const keep = CTL.xsec;
      try {
        loadXsExample(); await w(300); localStorage.removeItem('bhlog.ui'); S.ui = { ctlOpen: true, ctlW: 300, sideOpen: true, fold: {} };
        CTL.xsec = () => [{ id: 'ta', title: 'Group A', html: '<p id="ta-body">A</p>' }, { id: 'tb', title: 'Group B', html: '<p id="tb-body">B</p>' }];
        goTab('xsec'); await w(300);
        const ctl = document.querySelector('#ctl'), wd = () => ctl.getBoundingClientRect().width;
        want(ctl && !ctl.hidden && ctl.querySelectorAll('.ctl-g').length === 2 && Math.abs(wd() - 300) < 3, 'panel open with two groups at 300 px: ' + (ctl && wd()));
        ctl.querySelector('[data-act="ctl-toggle"]').click(); await w(150);
        want(Math.abs(wd() - 40) < 3 && ctl.querySelectorAll('[data-ctlgo]').length === 2, 'collapses to a 40 px strip of group icons: ' + wd());
        ctl.querySelector('[data-ctlgo="tb"]').click(); await w(150);
        want(wd() > 250 && document.querySelector('#tb-body') && !document.querySelector('[data-ctlg="tb"] .ctl-gb').hidden, 'icon reopens the panel at that group');
        document.querySelector('[data-ctlfold="ta"]').click(); await w(100);
        want(document.querySelector('[data-ctlg="ta"] .ctl-gb').hidden, 'a group folds');
        renderView(true); await w(150);
        want(document.querySelector('[data-ctlg="ta"] .ctl-gb').hidden && JSON.parse(localStorage.getItem('bhlog.ui') || '{}').fold?.ta === true, 'fold survives a redraw and is saved');
        /* resize by dragging the left edge, clamped */
        const x0 = ctl.getBoundingClientRect().left + 1, ev = (t, x) => (t === 'pointerdown' ? ctl.querySelector('[data-ctlrz]') : window).dispatchEvent(new PointerEvent(t, { clientX: x, clientY: 300, bubbles: true, pointerId: 1 }));
        ev('pointerdown', x0); ev('pointermove', x0 - 600); ev('pointerup', x0 - 600); await w(150);
        want(Math.abs(wd() - 480) < 3, 'drag wider is clamped at 480: ' + wd());
        const x1 = ctl.getBoundingClientRect().left + 1; ev('pointerdown', x1); ev('pointermove', x1 + 600); ev('pointerup', x1 + 600); await w(150);
        want(Math.abs(wd() - 240) < 3 && JSON.parse(localStorage.getItem('bhlog.ui')).ctlW === 240, 'drag narrower is clamped at 240 and saved: ' + wd());
        goTab('home'); await w(200); want(ctl.hidden, 'no panel on a page without settings');
        const mw = document.querySelector('#main').getBoundingClientRect().width;
        document.querySelector('[data-act="side-toggle"]').click(); await w(200);
        want(Math.abs(document.querySelector('.side').getBoundingClientRect().width - 36) < 3 && document.querySelector('#main').getBoundingClientRect().width > mw + 150, 'borehole list collapses to 36 px and the work area grows');
        document.querySelector('[data-act="side-toggle"]').click(); await w(200);
        want(document.querySelector('.side').getBoundingClientRect().width > 200 && document.querySelector('#bl-q'), 'and opens again');
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 300)); }
      finally { CTL.xsec = keep; S.ui = { ctlOpen: true, ctlW: 300, sideOpen: true, fold: {} }; localStorage.removeItem('bhlog.ui'); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  });
  await check('ui: cross-section settings live in the panel', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        loadXsExample(); await w(300); S.ui = { ctlOpen: true, ctlW: 300, sideOpen: true, fold: {} }; goTab('xsec'); await w(400);
        const inCtl = s => !!document.querySelector('#ctl ' + s), inView = s => !!document.querySelector('#view ' + s);
        for (const s of ['#xs-plume', '#xs-medium', '#xs-style', '#sec-tools', '#xs-model-sec', '#xs-corr-sec']) { want(inCtl(s), s + ' is in the panel'); want(!inView(s), s + ' is not above the drawing'); }
        for (const s of ['#xs-draw svg', '#xs-asof', '#xs-date']) want(inView(s), s + ' stays with the drawing');
        const v = document.querySelector('#view').getBoundingClientRect().top, d = document.querySelector('#xs-draw').getBoundingClientRect().top;
        want(d - v < 260, 'drawing starts near the top: ' + Math.round(d - v));
        const before = document.querySelector('#xs-draw').innerHTML, m = document.querySelector('#ctl #xs-medium'); m.value = 'soil'; m.dispatchEvent(new Event('change', { bubbles: true })); await w(300);
        want(document.querySelector('#xs-draw').innerHTML !== before && document.querySelector('#ctl #xs-medium').value === 'soil', 'changing a panel control redraws the section');
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 300)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  });
  await check('ui: log graphs are one tick list', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      const keepCo = structuredClone({ cols: S.co.cols, graphs: S.co.graphs, labGraph: S.co.labGraph, layout: S.co.layout });
      try {
        loadDlExample(); await w(300); const b = projList().find(b => (b.samples || []).some(s => s.lab)); S.sel = b.id;
        S.co.cols = { lab: 'on' }; S.co.labGraph = 'benzene'; S.co.graphs = []; S.ui = { ctlOpen: true, ctlW: 300, sideOpen: true, fold: {} };
        goTab('report'); await w(400);
        const ticks = [...document.querySelectorAll('#ctl input[data-gtick]')], keys = ticks.map(t => t.dataset.gtick);
        want(keys.includes('col:nplot') && keys.includes('lab:benzene') && keys.includes('lab:toluene'), 'Graphs group lists field and lab graphs: ' + keys);
        want(!document.querySelector('#view #lab-graph') && !document.querySelector('#view [data-act="graph-add"]') && !document.querySelector('#view [data-repcol]'), 'old graph controls are gone from the page');
        want(document.querySelector('#ctl input[data-gtick="lab:benzene"]')?.checked, 'old lab column setting shows Benzene ticked');
        const tick = (k, on) => { const el = document.querySelector('#ctl input[data-gtick="' + k + '"]'); el.checked = on; el.dispatchEvent(new Event('change', { bubbles: true })); };
        const heads = () => { const d = document.createElement('div'); d.innerHTML = pageSVG(b, 0, 1); return d.textContent; };
        tick('lab:toluene', true); await w(300); want(/Toluene/.test(heads()), 'ticking Toluene adds its column');
        tick('lab:toluene', false); await w(300); want(!/Toluene/.test(heads()), 'unticking removes it');
        tick('lab:benzene', false); await w(300); want(!/Benzene/.test(heads()), 'unticking the old lab column removes it');
        tick('col:nplot', true); await w(300); want(!pdfCols(b).dropped.includes('nplot') && pdfCols(b).on.has('nplot'), 'a ticked field graph is never left out');
        for (const k of ['lab:benzene', 'lab:toluene', 'lab:ethylbenzene', 'lab:xylenes', 'col:su', 'col:w', 'col:cvc']) if (document.querySelector('#ctl input[data-gtick="' + k + '"]')) { tick(k, true); await w(250); }
        want(/don.t fit|do not fit/i.test(document.querySelector('#ctl [data-ctlg="log-graphs"]')?.textContent || ''), 'too many graphs: the group says they do not fit');
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 300)); }
      finally { Object.assign(S.co, keepCo); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  });
  await check('ui: 3D, model and map settings in the panel', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        loadXsExample(); await w(300); S.ui = { ctlOpen: true, ctlW: 300, sideOpen: true, fold: {} };
        const inCtl = s => !!document.querySelector('#ctl ' + s), inView = s => !!document.querySelector('#view ' + s);
        goTab('v3d'); await w(800);
        want(inCtl('#v3d-ve') && inCtl('#v3d-lyr-boreholes') && inCtl('[data-act="v3d-vtk"]') && !inView('#v3d-ve'), '3D settings in the panel');
        want(document.querySelector('#v3d').getBoundingClientRect().width > .85 * document.querySelector('#view').getBoundingClientRect().width, '3D canvas fills the work area');
        goTab('gwm'); await w(500);
        for (const s of ['#gwm-setup', '#gwm-units', '#gwm-feat', '[data-act="gw-run"]', '[data-act="gw-cal"]']) { want(inCtl(s), s + ' in the panel'); want(!inView(s), s + ' not in the page'); }
        want(inView('#gwm-cal-sec') && inView('#gwm-trans-sec'), 'results stay in the page');
        document.querySelector('#ctl [data-act="gw-run"]').click(); for (let i = 0; i < 60 && (S.gwm.busy || !S.gwm.run); i++) await w(200);
        want(S.gwm.run?.ok, 'Run model from the panel works: ' + S.gwm.err);
        goTab('site'); await w(400); want(inCtl('#sec-tools') && !inView('#sec-tools'), 'Map & sections: section tools in the panel');
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 300)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  }, { mf6: true });
  await check('tutorial: opens the panel at the step control', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        loadXsExample(); await w(300); S.ui = { ctlOpen: false, ctlW: 300, sideOpen: true, fold: { 'xs-plume': true } }; goTab('xsec'); await w(300);
        tutStart('xsec'); await w(400);
        const i = TUTORIALS.xsec.steps.findIndex(st => st.sel === '#xs-style'); S.tut.i = i; tutShow(); await w(500);
        const el = document.querySelector('#xs-style'), r1 = el?.getBoundingClientRect(), h = document.querySelector('#tut-hole')?.getBoundingClientRect();
        want(S.ui.ctlOpen && !el.closest('.ctl-gb').hidden && r1.width > 0, 'panel opened and the group unfolded for the step');
        want(h && h.left <= r1.left + 1 && h.right >= r1.right - 1 && h.top <= r1.top + 1 && h.bottom >= r1.bottom - 1, 'highlight covers the control: ' + JSON.stringify({ h, r1 }));
        tutClose();
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 300)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  });
  await check('ui: settings panel review fixes', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      const keepCo = structuredClone({ cols: S.co.cols, graphs: S.co.graphs, labGraph: S.co.labGraph });
      try {
        loadXsExample(); await w(300); S.ui = { ctlOpen: true, ctlW: 300, sideOpen: true, fold: {} };
        /* 1: drawings are sized to the work area as it is with the panel */
        goTab('home'); await w(200); goTab('xsec'); await w(400);
        const fit = () => { const d = document.querySelector('#xs-draw'), sv = d.querySelector('svg'); return Math.abs(+sv.getAttribute('width') - d.clientWidth); };
        want(fit() < 3, 'section fits after the panel appears: off by ' + fit());
        document.querySelector('#ctl [data-act="ctl-toggle"]').click(); await w(300); want(fit() < 3, 'section fits after collapsing: off by ' + fit());
        document.querySelector('#ctl [data-act="ctl-toggle"]').click(); await w(300); want(fit() < 3, 'section fits after expanding: off by ' + fit());
        /* 2: every saved graph has a row, so it can be removed; graphs without data in this project are not drawn */
        loadDlExample(); await w(300); const b = projList().find(b => (b.samples || []).some(s => s.lab)); S.sel = b.id;
        S.co.cols = {}; S.co.graphs = [{ series: 'cvc', type: 'heat' }, { series: 'clay', type: 'points' }]; goTab('report'); await w(400);
        want(document.querySelector('#ctl input[data-gtick="cvc"]')?.checked, 'old vapour colour-band graph has its own ticked row');
        const ck = document.querySelector('#ctl input[data-gtick="clay"]'); want(ck?.checked && /no data/i.test(ck.closest('.gr-row').textContent), 'graph with no data in this project is listed and says so');
        want(!graphsOf().some(g => g.series === 'clay'), 'a graph with no data in this project is not drawn');
        const t1 = document.querySelector('#ctl input[data-gtick="cvc"]'); t1.checked = false; t1.dispatchEvent(new Event('change', { bubbles: true })); await w(300);
        want(!(S.co.graphs || []).some(g => g.series === 'cvc'), 'unticking removes the old graph');
        /* 3: ticking the legacy lab parameter switches its column on instead of drawing it twice */
        S.co.graphs = []; S.co.cols = {}; S.co.labGraph = 'benzene'; renderView(true); await w(200);
        const t2 = document.querySelector('#ctl input[data-gtick="lab:benzene"]'); t2.checked = true; t2.dispatchEvent(new Event('change', { bubbles: true })); await w(300);
        want(S.co.cols.lab === 'on' && !(S.co.graphs || []).some(g => g.series === 'lab:benzene'), 'Benzene ticked once: ' + JSON.stringify({ c: S.co.cols, g: S.co.graphs }));
        want(!/in this order/.test(document.querySelector('#ctl [data-ctlg="log-graphs"]').textContent), 'the note does not claim an order');
        /* 5: the edit drawer does not take its width on top of the panel */
        goTab('log'); await w(300); const m0 = document.querySelector('#main').getBoundingClientRect().width;
        document.body.classList.add('drawer-open'); await w(100); const m1 = document.querySelector('#main').getBoundingClientRect().width; document.body.classList.remove('drawer-open');
        want(m0 - m1 < 140, 'drawer takes at most what the panel does not already: ' + Math.round(m0 - m1));
        /* 4: no borehole selected: no stale panel */
        goTab('xsec'); await w(200); const keepBh = S.bh, keepSel = S.sel; S.bh = new Map(); S.sel = null; render(); await w(200); const startShown = !!document.querySelector('#main .start');
        want(startShown && document.querySelector('#ctl').hidden, 'no panel on the start screen: ' + startShown);
        S.bh = keepBh; S.sel = keepSel; render(); await w(200);
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 300)); }
      finally { Object.assign(S.co, keepCo); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  });
  await check('3d: surface nets and the measured plume field', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        /* isosurface of a sphere of radius 5 cells */
        const n = 16, v = new Float32Array(n * n * n); for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) v[i + n * (j + n * k)] = 5 - Math.hypot(i - 7.5, j - 7.5, k - 7.5);
        const S1 = isoSurface({ nx: n, ny: n, nz: n, v }, 0), nv = S1.positions.length / 3;
        let worst = 0; for (let q = 0; q < nv; q++) worst = Math.max(worst, Math.abs(Math.hypot(S1.positions[3 * q] - 7.5, S1.positions[3 * q + 1] - 7.5, S1.positions[3 * q + 2] - 7.5) - 5));
        want(nv > 100 && S1.indices.length > 300 && worst < .6, 'sphere isosurface: ' + nv + ' vertices, worst ' + worst.toFixed(2));
        /* the field interpolated from measured results */
        loadXsExample(); await w(300); const date = '2024-05-14', list = mapList(), F3 = plumeField3d(list, date, 'benzene');
        want(F3 && F3.src === 'interpreted', 'source is interpreted: ' + F3?.src);
        const b = list.find(b => b.well?.screenTop != null && (b.gwSamples || []).some(s => s.date <= date && gwVal(s, 'benzene') && !gwVal(s, 'benzene').lt && gwVal(s, 'benzene').v > .01));
        const s = (b.gwSamples || []).filter(s => s.date <= date && gwVal(s, 'benzene')).sort(byDate).pop(), meas = gwVal(s, 'benzene').v;
        const got = F3.at(b.easting, b.northing, b.elevation - (b.well.screenTop + b.well.screenBottom) / 2);
        want(got > 0 && Math.abs(Math.log10(got) - Math.log10(meas)) < .01, 'equals the measured result at the well: ' + got + ' vs ' + meas);
        const xs = list.map(b => b.easting), far = F3.at(Math.max(...xs) + 6, list[0].northing, list[0].elevation - 4);
        want(far === 0, 'nothing more than 5 m beyond the wells: ' + far);
        want(plumeField3d(list, '1990-01-01', 'benzene') === null, 'no results by the date: no field');
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 300)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  });
  await check('3d: plume shells', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        loadXsExample(); await w(300); S.gwm.key = ''; S.gwm.run = null; S.gwm.trans = null; S.v3dOff = {};
        goTab('v3d'); for (let i = 0; i < 40 && !S.v3d?.ok; i++) await w(200); await w(300);
        const shells = () => (S.v3d.groups?.plume?.children || []).filter(m => /^plume-/.test(m.name) && m.geometry.attributes.position.count > 0);
        want(S.v3d.plume?.src === 'interpreted' && shells().some(m => m.name === 'plume-1x'), 'interpreted shells without a model: ' + JSON.stringify({ src: S.v3d.plume?.src, n: shells().map(m => m.name) }));
        want(/Interpreted from measured results/.test(document.querySelector('#v3d-legend').textContent), 'legend says interpreted');
        const gr = S.v3d.groups.ground.children[0]; want(gr && gr.material.opacity <= .15, 'ground fades while shells show: ' + gr?.material.opacity);
        /* with a transport model set up, the 3D page runs it and draws its plume */
        setGwm({ transport: { on: true } }); S.gwm.key = ''; S.gwm.run = null; S.gwm.trans = null; goTab('home'); await w(100); goTab('v3d');
        for (let i = 0; i < 450 && S.v3d?.plume?.src !== 'mf6'; i++) await w(200);
        want(S.v3d.plume?.src === 'mf6' && shells().length, 'the 3D page ran the model and draws its shells: ' + (S.gwm.err || S.v3d.plume?.src));
        want(/Model \\(MODFLOW 6\\), not measured/.test(document.querySelector('#v3d-legend').textContent), 'legend names MODFLOW 6');
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 300)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  }, { mf6: true });
  await check('3d: cut along the section line', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        loadXsExample(); await w(300); S.v3dCut = { on: false, pos: 50 }; S.ui = { ctlOpen: true, ctlW: 300, sideOpen: true, fold: {} };
        goTab('v3d'); for (let i = 0; i < 40 && !S.v3d?.ok; i++) await w(200); await w(300);
        const cut = document.querySelector('#ctl #v3d-cut'), pos = () => document.querySelector('#ctl #v3d-cutpos');
        want(cut && pos(), 'panel has the cut controls');
        cut.checked = true; cut.dispatchEvent(new Event('change', { bubbles: true })); await w(400);
        const pl = S.v3d.renderer.clippingPlanes; want(pl.length === 1 && S.v3d.scene.getObjectByName('cut-face'), 'cut sets a clipping plane and a coloured cut face');
        const c0 = pl[0]?.constant; pos().value = '20'; pos().dispatchEvent(new Event('input', { bubbles: true })); await w(300);
        want(S.v3d.renderer.clippingPlanes[0] && Math.abs(S.v3d.renderer.clippingPlanes[0].constant - c0) > .5, 'moving the slider moves the cut');
        const c2 = document.querySelector('#ctl #v3d-cut'); c2.checked = false; c2.dispatchEvent(new Event('change', { bubbles: true })); await w(300);
        want(!S.v3d.renderer.clippingPlanes.length && !S.v3d.scene.getObjectByName('cut-face'), 'unticking removes the cut');
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 300)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  });
  await check('3d: plume review fixes', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        loadXsExample(); await w(300); const g = gwGuide().benzene, D = '2024-01-01';
        const well = (id, E, N, st, sb, v, lt, wd = 1) => ({ id, name: id, easting: E, northing: N, elevation: 100, layers: [], well: { installed: true, screenTop: st, screenBottom: sb }, water: [{ date: D, depth: wd }], gwSamples: [{ date: D, res: { benzene: { v, lt } } }] });
        /* C1: one well with a result */
        let F1; try { F1 = plumeField3d([well('A', 0, 0, 2, 4, 1, false)], D, 'benzene'); } catch (e) { F.push('one well throws: ' + e.message); }
        if (F1) { want(F1.at(0, 0, 97) > .9 && F1.at(6, 0, 97) === 0 && F1.at(3, 0, 97) > 0, 'one well: value at the well, gone 5 m away: ' + [F1.at(0, 0, 97), F1.at(3, 0, 97), F1.at(6, 0, 97)]); }
        /* I1: non-detects at or above the guideline draw nothing */
        const nd = plumeField3d([well('A', 0, 0, 2, 4, g * 2, true), well('B', 10, 0, 2, 4, g * 2, true), well('C', 0, 10, 2, 4, g * 2, true)], D, 'benzene');
        want(!nd || nd.at(3, 3, 97) < g, 'non-detects above the guideline make no plume: ' + nd?.at(3, 3, 97));
        /* I2: nested wells keep both screens and no band between them */
        const ns = plumeField3d([well('S', 0, 0, 2, 4, 1, false), well('Dp', 0.2, 0, 10, 12, 1, false), well('X', 12, 0, 2, 4, 1, false)], D, 'benzene');
        want(ns.at(0, 0, 89) > .9 && ns.at(0, 0, 97) > .9, 'both nested screens honoured at the well: ' + [ns.at(0, 0, 97), ns.at(0, 0, 89)]);
        want(ns.at(4, 0, 93) === 0, 'no invented band between the screens: ' + ns.at(4, 0, 93));
        /* I3: nothing above the water table */
        const wt = plumeField3d([well('A', 0, 0, 1, 4, 1, false, 2.5)], D, 'benzene'); want(wt.at(0, 0, 98.3) === 0 && wt.at(0, 0, 97) > .9, 'band starts at the water level: ' + [wt.at(0, 0, 98.3), wt.at(0, 0, 97)]);
        /* I4, I5: captions and legend match what is drawn */
        S.v3dOff = {}; goTab('v3d'); for (let i = 0; i < 40 && !S.v3d?.ok; i++) await w(200); await w(300);
        const cap = v3dCaptionText(); want(/interpreted from measured results/i.test(cap) && !/purple = model/.test(cap), 'saved image caption names the interpreted shells: ' + cap);
        const lg = document.querySelector('#v3d-legend').textContent; want(S.v3d.plume.levels.every(l => lg.includes(l)) && S.v3d.plume.levels.length, 'legend lists the levels drawn: ' + lg.slice(-300));
        const keepD = S.xs.date; S.xs.date = '2010-01-01'; v3dBuild(); await w(800);
        want(!/shells at/.test(document.querySelector('#v3d-legend').textContent), 'no shells claimed when none are drawn'); S.xs.date = keepD;
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 300)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  });
  await check('report editor: delete on the item, settings in the panel, more room', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        loadXsExample(); await w(300); S.ui = { ctlOpen: true, ctlW: 300, sideOpen: true, fold: {} }; S.csort = false;
        goTab('compose'); await w(300); const L = repLayout(); L.pages.push(newPage('free', { orient: 'port', items: [] })); S.cpage = L.pages.length - 1; rerenderCompose(); await w(200);
        const side = document.querySelector('.side').getBoundingClientRect().width; want(side < 2, 'borehole list hidden on Reports: ' + side);
        want(document.querySelector('#cmp-stage').getBoundingClientRect().width > 850, 'page area is wide: ' + Math.round(document.querySelector('#cmp-stage').getBoundingClientRect().width));
        /* one Add menu instead of a wall of buttons */
        const menu = document.querySelector('#view .cmp-addmenu'), btn = document.querySelector('#view [data-act="cmp-addmenu"]');
        want(btn && menu && menu.hidden && menu.querySelector('[data-cadd="text"]'), 'Add item menu, closed until clicked');
        btn.click(); await w(50); want(!document.querySelector('#view .cmp-addmenu').hidden, 'Add item opens the menu');
        document.querySelector('#view .cmp-addmenu [data-cadd="text"]').click(); await w(200);
        document.querySelector('#view [data-act="cmp-addmenu"]').click(); await w(50); document.querySelector('#view .cmp-addmenu [data-cadd="north"]').click(); await w(200);
        want(curPage().items.length === 2 && document.querySelector('#view .cmp-addmenu').hidden, 'items added and the menu closes');
        /* settings in the panel */
        const it = curPage().items[1]; S.csel = it.id; rerenderCompose(); await w(200);
        for (const sel of ['#cmp-props [data-cprop="cap"]', '#cmp-paper-size', '#cmp-title', '#cmp-tpl']) want(document.querySelector('#ctl ' + sel) && !document.querySelector('#view ' + sel), sel + ' is in the panel');
        /* delete from the item itself */
        const del = document.querySelector('.cmp-box[aria-selected="true"] .cmp-bar [data-act="cmp-del"]'); want(del, 'selected item has a Delete button on its frame');
        del?.click(); await w(200); want(curPage().items.length === 1 && !curPage().items.includes(it), 'Delete on the frame removes it');
        /* several selected: one Delete removes them all */
        document.querySelector('#view [data-act="cmp-addmenu"]').click(); await w(50); document.querySelector('#view .cmp-addmenu [data-cadd="legend"]').click(); await w(200);
        S.cmulti = new Set(curPage().items.map(x => x.id)); S.csel = curPage().items[0].id; rerenderCompose(); await w(200);
        document.querySelector('.cmp-box[aria-selected="true"] .cmp-bar [data-act="cmp-del"]').click(); await w(200);
        want(!curPage().items.length, 'Delete removes every selected item: ' + curPage().items.length);
        goTab('xsec'); await w(200); want(document.querySelector('.side').getBoundingClientRect().width > 200, 'borehole list back on other pages');
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 300)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  });
  await check('mf6: drawn on the map', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        loadXsExample(); await w(400); goTab('site'); await w(300);
        want(!document.querySelector('#plan svg [data-gw-area]'), 'no model layers before a run');
        await gwEnsure(true); goTab('site'); await w(300); const svg = document.querySelector('#plan svg');
        want(svg.querySelector('[data-gw-area]'), 'model area outlined');
        want(svg.querySelectorAll('path[data-gw-plan-wt]').length >= 2, 'model water-table contours');
        want(svg.querySelectorAll('[data-gw-path]').length >= 1 && svg.querySelector('[data-gw-tt]'), 'flow paths with travel-time marks');
        want(/MODFLOW 6/.test(svg.innerHTML), 'labelled MODFLOW 6');
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 400)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  }, { mf6: true });
  await check('tutorial: cross-section and groundwater model', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        want(MENUS.some(([n, items]) => n === 'Help' && items.some(x => x[1] === 'tut-xsec') && items.some(x => x[1] === 'tut-gwm')), 'Help menu lists both tutorials');
        for (const k of ['xsec', 'gwm']) {
          tutStart(k); await w(700);
          const N = TUTORIALS[k].steps.length; want(N >= 8, k + ': at least 8 steps: ' + N);
          for (let i = 0; i < N; i++) {
            const card = document.querySelector('#tut'), st = TUTORIALS[k].steps[i];
            want(card && card.textContent.includes('Step ' + (i + 1) + ' of ' + N) && card.textContent.includes(st.title), k + ' step ' + (i + 1) + ' card');
            if (st.sel) { const el = document.querySelector(st.sel), hole = document.querySelector('#tut-hole');
              want(el, k + ' step ' + (i + 1) + ': target ' + st.sel + ' exists');
              if (el && hole) { const a = el.getBoundingClientRect(), b = hole.getBoundingClientRect(); want(b.left <= a.left + 1 && b.top <= a.top + 1 && b.width >= Math.min(a.width, innerWidth - 40) - 2, k + ' step ' + (i + 1) + ': highlight covers the target'); } }
            if (i < N - 1) { document.querySelector('#tut [data-act="tut-next"]').click(); await w(500); }
          }
          document.querySelector('#tut [data-act="tut-back"]').click(); await w(400); want(document.querySelector('#tut').textContent.includes('Step ' + (N - 1) + ' of ' + N), k + ': back');
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await w(200); want(!document.querySelector('#tut') && !document.querySelector('#tut-hole'), k + ': Esc closes');
        }
        goTab('xsec'); await w(300); want(document.querySelector('#view [data-act="tut-xsec"]'), 'Tutorial button on the Section page');
        goTab('gwm'); await w(300); want(document.querySelector('#view [data-act="tut-gwm"]'), 'Tutorial button on the Model page');
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 400)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  });
  await check('mf6: review fixes', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        loadXsExample(); await w(400);
        // C1: the Water page's plot mode and the model state are separate
        want(S.gw === 'elev' || S.gw === 'depth', 'Water plot mode intact: ' + typeof S.gw);
        S.gw = 'depth'; goTab('gwm'); await w(300); want(/Groundwater model/.test(document.querySelector('#view').textContent) && gwModel() && !gwModel().error, 'Model page works after the Water toggle');
        // C2: lab table edits are not caught by the model's feature inputs
        const b = sectionList().find(x => (x.gwSamples || []).length); S.sel = b.id; goTab('gw'); await w(300);
        const inp = document.querySelector('[data-gwf$="|sid"]'); if (inp) { inp.value = 'PROBE-ID'; inp.dispatchEvent(new Event('change', { bubbles: true })); await w(150); }
        want(!inp || S.bh.get(b.id).gwSamples.some(s => s.sid === 'PROBE-ID'), 'groundwater lab edits are kept');
        want(!(siteOf().gwModel?.features || []).length, 'no stray model features');
        // C3: switching project drops the cached model
        const M1 = gwModel(); const other = blankBorehole('OTHER-1'); other.project = 'Another project'; S.bh.set(other.id, normalize(other)); store.save(other); S.sel = other.id; render(); await w(200);
        want(gwModel() !== M1 && (gwModel().error || gwModel().list.every(x => x.project === 'Another project')), 'the model belongs to the open project');
        S.sel = sectionList().length ? S.sel : S.sel; loadXsExample(); await w(300);
        // I1, I2: features in the right layer, fixed heads honoured, incomplete ones skipped with a note
        const M = gwModel(), mw = M.list.find(x => x.name === 'MW-5'), wt = M.F.fit({ e: mw.easting, n: mw.northing });
        setGwm({ features: [{ type: 'riv', name: 'Creek', pts: [[mw.easting, mw.northing]], stage: wt - .3, cond: 50, rbot: wt - 1 }, { type: 'chd', name: 'Pond', pts: [[mw.easting + 8, mw.northing]], stage: wt + .2, head: wt + .2 }, { type: 'drn', name: 'Half done', pts: [] }] });
        const M2 = gwModel(), sp = gwSpec(M2), rv = sp.riv?.[0]?.[0], ch = sp.chd[0].filter(q => Math.abs(q[3] - (wt + .2)) < 1e-6);
        want(rv && M2.grid.botm[rv[0]][rv[1] * M2.grid.ncol + rv[2]] < wt - 1 + 1e-9, 'river in the layer holding its bed bottom');
        want(ch.length >= 1, 'fixed-head feature written');
        want(M2.notes.some(n => /Half done/.test(n)), 'incomplete feature skipped with a note: ' + M2.notes);
        const run1 = await gwRun(M2); want(run1.ok, 'runs with the features: ' + run1.error);
        setGwm({ features: [] });
        // I3: vertical transverse dispersivity is ATH2
        const f = mf6Files({ ...gwSpec(gwModel()), gwt: { porosity: [.25, .25, .25, .25], rhob: 1.7, kd: .1, al: 2, ath: .2, atv: .01, cnc: [null] } }).files['gwt.dsp'];
        want((f.split('ATH2')[1] || '').trim().startsWith('CONSTANT 0.01'), 'ATH2 carries the vertical dispersivity: ' + f);
        // I4: the bridge refuses paths and directives inside model files
        const bad = await window.desktop.mf6Run({ files: { 'mfsim.nam': 'BEGIN options\\nEND options\\n', 'gwf.oc': 'BEGIN options\\n  HEAD FILEOUT /tmp/x.hds\\nEND options\\n' } });
        want(!bad.ok && /path/i.test(bad.error), 'refuses a path inside a model file: ' + bad.error);
        const dots = await window.desktop.mf6Run({ files: { 'mfsim.nam': 'x', '..': 'y' } }); want(!dots.ok, 'refuses ..');
        // I5: an entered K or recharge wins over the stored calibration
        const M3 = gwModel(), u = M3.units.find(x => x.calib);
        setGwm({ calib: { pv: { ['k:' + u.u]: 9.9, rch: 1e-4 }, params: [], stats: {}, residuals: [], css: {}, corr: [], warnings: [], round: M3.round, at: new Date().toISOString(), key: '' } });
        setGwm({ units: { [u.u]: { k: 3.3 } }, rch: 2e-4 }); const pv = gwPv();
        want(pv['k:' + u.u] == null && pv.rch == null, 'entered values drop the calibrated ones: ' + JSON.stringify(pv));
        want(gwSpec(gwModel(), pv).npf.k[gwModel().units.findIndex(x => x.u === u.u)] === 3.3, 'entered K used');
        setGwm({ units: {}, rch: null, calib: null });
        // I6: the default calibration includes every unit's K (slug units with their prior) and the boundary shift
        const keys = gwDefaultKeys(gwModel()); want(gwModel().units.every(x => keys.includes('k:' + x.u)) && keys.includes('rch') && keys.includes('shift'), 'default keys: ' + keys);
        // I7: no source well, no flow paths
        const keepSrc = siteOf().model.srcBh; setSite({ ...siteOf(), model: { ...siteOf().model, srcBh: '' } });
        const r7 = await gwRun(gwModel()); want(gwSourcePaths(gwModel(), r7).length === 0, 'no paths without a source well');
        setSite({ ...siteOf(), model: { ...siteOf().model, srcBh: keepSrc } });
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 400)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  }, { mf6: true });
  await check('3d: view of boreholes, wells, layers and water', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        loadXsExample(); await w(400);
        want(document.querySelector('#prail [data-tab="v3d"]'), 'a 3D page on the rail');
        goTab('v3d'); await w(800);
        const V = S.v3d; want(V && V.ok, '3D scene built: ' + (V && V.error));
        if (V && V.ok) {
          const located = projList().filter(b => b.easting != null && b.elevation != null);
          want(V.groups.boreholes.children.length === located.length, 'one column per located borehole: ' + V.groups.boreholes.children.length + ' / ' + located.length);
          want(V.groups.wells.children.length === located.filter(b => b.well?.installed).length, 'a casing and screen per well');
          want(V.groups.layers.children.length === gwModel().units.length && V.groups.ground.children.length === 1, 'interpolated unit surfaces and ground');
          want(V.groups.water.children.length >= 1 && V.groups.samples.children.length >= 5, 'water table and results');
          want(document.querySelector('#v3d canvas'), 'a canvas');
          const leg = document.querySelector('#v3d-legend').textContent; want(/interpolated/i.test(leg) && /exaggeration/i.test(leg), 'legend labels interpolation and exaggeration');
          const t = document.querySelector('#v3d-lyr-layers'); t.click(); await w(150); want(!V.groups.layers.visible, 'layer switch hides surfaces');
          const ve = document.querySelector('#v3d-ve'); ve.value = '10'; ve.dispatchEvent(new Event('change', { bubbles: true })); await w(400);
          want(S.v3d.ve === 10 && /×10/.test(document.querySelector('#v3d-legend').textContent), 'exaggeration ×10 applied and stated');
          let saved = null; window.saveFile = (n, d) => { saved = { n, size: d.size ?? d.length }; }; document.querySelector('[data-act="v3d-png"]').click(); await w(400);
          want(saved && /\\.png$/.test(saved.n) && saved.size > 1000, 'saves a PNG: ' + JSON.stringify(saved));
        }
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 400)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  });
  await check('3d: model layers and ParaView export', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        loadXsExample(); await w(400); setGwm({ transport: { on: true } }); await gwEnsure(true);
        want(S.gwm.run?.ok && S.gwm.trans?.ok, 'model and transport ran');
        goTab('v3d'); await w(900); const V = S.v3d;
        want(V.ok && V.groups.plume.children.length >= 1 && V.groups.paths.children.length >= 1, '3D shows the MODFLOW 6 plume and flow paths');
        want(/MODFLOW 6/.test(document.querySelector('#v3d-legend').textContent), 'legend names MODFLOW 6');
        const files = gwVtkFiles(), names = Object.keys(files);
        for (const n of ['boreholes.vtp', 'wells.vtp', 'samples.vtp', 'surfaces.vtp', 'model.vtu', 'paths.vtp', 'concentration.pvd', 'README.txt']) want(names.includes(n), 'file ' + n);
        for (const [n, t] of Object.entries(files)) if (/\\.(vtp|vtu|pvd)$/.test(n)) { const x = new DOMParser().parseFromString(t, 'application/xml'); want(!x.querySelector('parsererror') && x.documentElement.nodeName === 'VTKFile', n + ' is valid VTK XML'); }
        const mx = new DOMParser().parseFromString(files['model.vtu'], 'application/xml'), cells = +mx.querySelector('Piece').getAttribute('NumberOfCells');
        const g = gwModel().grid, active = g.idomain.reduce((t, L) => t + Array.from(L).filter(v => v === 1).length, 0); want(cells === active, 'model.vtu has every active cell: ' + cells + ' / ' + active);
        const bx = new DOMParser().parseFromString(files['boreholes.vtp'], 'application/xml'), pts = bx.querySelector('Points DataArray').textContent.trim().split(/\\s+/).map(Number);
        const b0 = gwModel().list[0]; want(pts.some((v, i) => i % 3 === 0 && Math.abs(v - b0.easting) < .01), 'real UTM coordinates, no exaggeration');
        const pvd = new DOMParser().parseFromString(files['concentration.pvd'], 'application/xml'); want(pvd.querySelectorAll('DataSet').length === S.gwm.trans.times.length, 'a time step per transport output');
        let saved = null; window.saveFile = (n, d) => { saved = { n, size: d.size ?? d.length }; }; document.querySelector('[data-act="v3d-vtk"]').click(); await w(500);
        want(saved && /\\.zip$/.test(saved.n), 'exports the zip');
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 400)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  }, { mf6: true });
  await check('report: groundwater model output', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        loadXsExample(); await w(400);
        for (const k of ['gwsum', 'gwcal', 'gwpar', 'gwlim']) want(RITEMS[k], 'report item ' + k);
        want(REPORT_PRESETS.gwm, 'a groundwater model report preset');
        // not calibrated yet: the summary says so
        let svg = itemInner(newItem('gwsum'), 700, 900); want(/MODFLOW 6/.test(svg) && /not calibrated/i.test(svg), 'summary before calibration says not calibrated');
        const M = gwModel(), C = await gwCalibrate(M, { maxIter: 3 });
        setGwm({ calib: { mode: 'steady', pv: C.pv, params: C.params, stats: C.stats, residuals: C.residuals, css: C.css, corr: C.corr, warnings: C.warnings, round: M.round, rounds: [M.round], at: new Date().toISOString(), runs: C.runs, iterations: C.iterations, key: gwInputsKey(gwModel()) }, transport: { on: true } });
        await gwEnsure(true);
        svg = itemInner(newItem('gwsum'), 700, 900);
        for (const t of ['MODFLOW 6', 'not measured', 'RMSE', 'Calibration round', M.units[0].u, 'How to read', 'Transport']) want(svg.includes(t), 'summary includes ' + t);
        const cal = itemInner(newItem('gwcal'), 700, 600); want(/<circle/.test(cal) && /Residual/.test(cal) && C.residuals.every(q => cal.includes(q.b)), 'calibration plot and residual table with every well');
        const par = itemInner(newItem('gwpar'), 700, 400); want(/95 %/.test(par) && C.params.every(p => par.includes(p.label)), 'parameter table');
        const lim = itemInner(newItem('gwlim'), RITEMS.gwlim[1], RITEMS.gwlim[2]); want(/Langevin/.test(lim) && /Tiedeman/.test(lim), 'limits with references');
        // the Model page appends the model pages; the section and plan in them show the model
        goTab('gwm'); await w(300); const before = repLayout().pages.length; document.querySelector('[data-act="gw-report"]').click(); await w(200);
        const L = repLayout(), added = L.pages.slice(before); want(added.length >= 4 && added.some(p => p.items.some(x => x.t === 'gwsum')) && added.some(p => p.items.some(x => x.t === 'section')) && added.some(p => p.items.some(x => x.t === 'plan')), 'model pages appended: ' + added.map(p => p.title));
        const secIt = added.flatMap(p => p.items).find(x => x.t === 'section'); want(/data-gw-wt/.test(itemInner(secIt, secIt.w, secIt.h)) && /MODFLOW 6/.test(itemInner(secIt, secIt.w, secIt.h)), 'report cross-section carries the model results');
        const planIt = added.flatMap(p => p.items).find(x => x.t === 'plan'); want(/data-gw-path/.test(itemInner(planIt, planIt.w, planIt.h)), 'report plan carries the flow paths');
        // 3D view to the report as a dated picture with its legend
        goTab('v3d'); await w(900); const n0 = repLayout().pages.length; document.querySelector('[data-act="v3d-report"]').click(); await w(400);
        const pg = repLayout().pages[n0]; want(pg && pg.items.some(x => x.t === 'image' && /^data:image\\/jpeg/.test(x.o.img)) && pg.items.some(x => x.t === 'text' && /exaggeration/.test(x.o.text)), '3D view added as a picture with its legend');
        // export runs the model first if needed and produces the PDF
        S.gwm.run = null; const bytes = await buildReportBytes(); want(bytes && bytes.length > 10000 && S.gwm.run?.ok, 'report exports with fresh model results: ' + (bytes && bytes.length));
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 400)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  }, { mf6: true });
  await check('3d and report review fixes', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        loadXsExample(); await w(400);
        // C1: measured values keep their decimals whatever comes first
        const x = vtkPoly([[0, 0, 0], [1, 0, 0], [2, 0, 0]], { verts: [[0], [1], [2]] }, { concentration: [120, .005, 2.5] });
        want(/type="Float64" Name="concentration"/.test(x) && x.includes('0.005') && x.includes('2.5'), 'concentration stays Float64: ' + x.match(/Name="concentration"[^<]*/)?.[0]);
        const f = gwVtkFiles(); want(/type="Float64" Name="concentration"/.test(f['samples.vtp']) && /type="Float64" Name="K_m_per_day"/.test(f['model.vtu']), 'export arrays typed by meaning');
        // I6: no nan text anywhere
        want(Object.entries(f).every(([n, t]) => !/\\.(vtp|vtu)$/.test(n) || !/\\bnan\\b|NaN/.test(t)), 'no NaN written');
        // M7: large numbers kept
        want(vtkArr('a', 'Float64', [123000000, 5712345.678]).includes('123000000') && vtkArr('a', 'Float64', [5712345.678]).includes('5712345.678'), 'large numbers kept');
        // I4: results carry their date
        want(/Name="date_days"/.test(f['samples.vtp']) && /date_days/.test(f['README.txt']), 'results carry a date');
        // I5: boreholes unticked on the maps are left out of 3D and the export
        const hide = projList().find(b => b.name === 'MW-0'); S.offMap.add(hide.id); goTab('v3d'); await w(900);
        want(S.v3d.ok && S.v3d.groups.boreholes.children.every(g => g.name !== 'MW-0'), '3D leaves out an unticked borehole');
        want(!gwVtkFiles()['README.txt'].includes('MW-0'), 'export leaves it out too'); S.offMap.delete(hide.id); goTab('v3d'); await w(900);
        // I2: captured images carry the exaggeration and a north arrow
        const cap = v3dCapture(); want(cap && cap.caption.includes('Vertical exaggeration ×' + S.v3d.ve) && Number.isFinite(cap.north), 'capture states exaggeration and north: ' + JSON.stringify(cap && { c: cap.caption, n: cap.north }));
        // M6: changing the exaggeration re-frames the view
        const before = S.v3d.orbit.ty; const ve = document.querySelector('#v3d-ve'); ve.value = S.v3d.ve === 10 ? '1' : '10'; ve.dispatchEvent(new Event('change', { bubbles: true })); await w(900);
        want(Math.abs(S.v3d.orbit.ty - S.v3d.target.y) < 1e-6 && S.v3d.orbit.ty !== before, 'view re-framed for the new exaggeration');
        // I1: figures without model results say so in the summary
        const M = gwModel(); setGwm({ calib: { mode: 'steady', pv: {}, params: [], stats: { n: 1, me: 0, mae: 0, rmse: 0, range: 1, srms: 0, disc: 0 }, residuals: [], css: {}, corr: [], warnings: [], round: M.round, rounds: [M.round], at: new Date().toISOString(), runs: 1, iterations: 1, key: gwInputsKey(gwModel()) } });
        gwModel(); S.gwm.run = null; S.gwm.err = 'test failure'; const sum = itemInner(newItem('gwsum'), 700, 900);
        want(/No MODFLOW 6 results are drawn/.test(sum) && /test failure/.test(sum), 'summary says the figures have no model results and why');
        // M1: a cut warning recolours only its own lines
        const b = gwBlocksSVG([{ h: 'Heading A' }, { p: 'normal text' }, { p: Array(80).fill('warning words').join(' '), warn: true }], 400, 90);
        want(!/fill:#b4451a">Heading A/.test(b) && !/fill:#b4451a">normal text/.test(b), 'heading and normal text keep their colour');
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 400)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  });
  await check('cross-section: borehole names never overlap', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        loadXsExample(); await w(400);
        for (const width of [0, 640]) {
          const d = document.querySelector('#xs-draw'); if (width) d.style.width = width + 'px'; drawXsec(); await w(100);
          const svg = d.querySelector('svg'), names = [...svg.querySelectorAll('text[data-bhname]')];
          want(names.length === sectionList().length, width + ': one name per borehole: ' + names.length);
          const bb = names.map(t => t.getBBox());
          for (let a = 0; a < bb.length; a++) for (let c = a + 1; c < bb.length; c++) { const p = bb[a], q = bb[c];
            if (p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height) want(false, width + ': ' + names[a].textContent + ' overlaps ' + names[c].textContent); }
          const others = [...svg.querySelectorAll('text:not([data-bhname])')].filter(t => t.textContent.trim()).map(t => [t.textContent.slice(0, 30), t.getBBox()]);
          bb.forEach((p, a) => others.forEach(([lab, q]) => { if (p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height) want(false, width + ': ' + names[a].textContent + ' overlaps text "' + lab + '"'); }));
          const lowest = Math.max(...bb.map(b => b.y + b.height)), colTop = Math.min(...[...svg.querySelectorAll('g > rect')].map(r => r.getBBox().y));
          want(lowest <= colTop, width + ': names sit above every column and casing: ' + lowest.toFixed(1) + ' > ' + colTop.toFixed(1));
        }
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 300)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  });
  await check('example: cross-section in the project picker and menu', async run => {
    const r = await run(`(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), F = [], want = (ok, msg) => { if (!ok) F.push(msg); };
      try {
        for (const b of [...S.bh.values()].filter(b => b.project === XS_PROJ)) { S.bh.delete(b.id); await store.del?.(b.id); }
        S.sel = null; render(); await w(200);
        const sel = document.querySelector('#proj');
        const opt = [...sel.querySelectorAll('optgroup[label="Examples"] option')].find(o => o.textContent.includes('cross-section'));
        want(opt, 'the project picker lists the cross-section example');
        want(document.querySelector('.ribbon [data-act="load-xs"]'), 'the Data tools hold the cross-section example');
        if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); await w(400); }
        want(sortedList().some(b => b.project === XS_PROJ) && S.tab === 'xsec', 'choosing it loads the example on the Section page');
        want(document.querySelector('#proj').value === XS_PROJ, 'the picker then shows the example as the open project');
        want(![...document.querySelectorAll('#proj optgroup[label="Examples"] option')].some(o => o.textContent.includes('cross-section')), 'once loaded it is listed as a project, not as an example to load');
      } catch (e) { F.push('THREW ' + String(e.stack).slice(0, 300)); }
      return F;
    })()`);
    expect(!r.length, r.join(' || '));
  });
  await check('dates are local, not UTC', async run => {
    const r = await run(`(() => { const d = new Date(); return [today(), d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')]; })()`);
    expect(r[0] === r[1], `today() ${r[0]}, local date ${r[1]}`);
  });

  await check('Dawn Lake example: 10 boreholes, 9 wells with bentonite over sand, about 5 m deep', async run => {
    const r = await run(`(() => { loadDlExample(); const l = sortedList().filter(b => b.project === DL_PROJ), w = l.filter(b => b.well.installed);
      return { n: l.length, wells: w.length, ann: w.every(b => b.well.annulus.map(a => a.mat).join() === 'bentonite,sand'), depth: w.every(b => b.well.depth >= 4.8 && b.well.depth <= 5.5), vapour: l.every(b => b.samples.some(s => s.cvc != null)) }; })()`);
    expect(r.n === 19 && r.wells === 9 && r.ann && r.depth && r.vapour, JSON.stringify(r));
  });

  const failed = results.filter(r => r[1]).length;
  const text = results.map(([name, err]) => `${err ? 'FAIL' : 'ok  '}  ${name}${err ? '\n      ' + err : ''}`).join('\n') + `\n\n${results.length - failed} passed, ${failed} failed\n`;
  await new Promise(r => process.stdout.write(text, r));   // app.exit does not wait for output to reach the terminal
  app.exit(failed ? 1 : 0);
});
