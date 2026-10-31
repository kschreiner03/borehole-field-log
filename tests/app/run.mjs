/* End-to-end checks of the classic interface (resources/legacy, the offline build) in a real Electron window, with the
   network blocked. Run with `npm run test:app`; exits non-zero when any check fails. Each check gets a fresh profile. */
import { app, BrowserWindow, session } from 'electron';
import { resolve } from 'node:path';

const PAGE = resolve('resources/legacy/index.html');
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [];
let n = 0;
app.on('window-all-closed', () => {});   // each check closes its window; without this Electron quits between checks

async function withPage(fn) {
  const ses = session.fromPartition('check-' + ++n);   // in memory: a fresh profile that survives reloads within the check
  ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: /^https?:/.test(d.url) }));   // offline: nothing from the internet
  const win = new BrowserWindow({ show: false, width: 1440, height: 920, webPreferences: { session: ses } });
  const load = async () => {
    await win.loadFile(PAGE); await wait(1500);
    await run(`window.__errs = []; addEventListener('error', e => __errs.push(e.message)); addEventListener('unhandledrejection', e => __errs.push(String(e.reason?.stack || e.reason))); window.confirm = () => true; 1`);
  };
  const run = js => win.webContents.executeJavaScript(js);
  try { await load(); return await fn(run, load); }
  finally { win.destroy(); }
}

async function check(name, fn) {
  try { await withPage(async (run, load) => { await fn(run, load); const errs = await run('window.__errs'); if (errs.length) throw new Error('page errors: ' + errs.join(' | ')); }); results.push([name, null]); }
  catch (e) { results.push([name, e.message || String(e)]); }
}
const expect = (ok, msg) => { if (!ok) throw new Error(msg); };

app.whenReady().then(async () => {
  await check('loads offline: libraries from lib/, the system UI font, no web fonts', async run => {
    const r = await run(`(async () => { await document.fonts.ready; return { xlsx: !!window.XLSX, excel: !!window.ExcelJS, pdf: !!window.jspdf, font: getComputedStyle(document.body).fontFamily, links: [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.href).filter(h => /^https?:/.test(h)), sync: document.querySelector('#sync').textContent }; })()`);
    expect(r.xlsx && r.excel && r.pdf, 'a library did not load: ' + JSON.stringify(r));
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
    expect(r.has.tree.join() === 'Overview,Borehole,Map,Tables,Water,Lab,Reports' && r.has.cur === 'Borehole' && r.has.rows === r.has.want, 'rail and list: ' + JSON.stringify(r.has));
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
