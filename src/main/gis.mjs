/* The optional GIS engines: real GIS software (GDAL, GRASS GIS, PyKrige, GSTools from conda-forge) installed per user, on
   request, and run as separate programs. The window never sends a command line: it sends a job naming one known method, with
   numbers only; the job is written to a file and the shipped driver (resources/gis/bfl_gis.py) calls the tool and writes the
   result. GRASS GIS is GPL: it is downloaded from conda-forge as published and only ever run as its own program. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, rmdir, stat, statfs, readdir, chmod } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

// micromamba, the conda-forge installer (BSD-3-Clause), pinned to one release and checked against its published SHA-256
const MAMBA_TAG = '2.10.0-0';
const MAMBA = {
  'win32-x64': ['micromamba-win-64', 'f8b4284bd4eb1134122eaf93b3ea6c7be567e596de5829e1a6f478e34e41974a'],
  'darwin-arm64': ['micromamba-osx-arm64', 'c547639f5caf742236641c362746abb4a3505774753ecd08fe341643670c4c01'],
  'darwin-x64': ['micromamba-osx-64', '8421462a1ef1df9f7acd114f9e2a24c1332ce4f4e29f44465b4acb44e2755172'],
};
// what is installed: versions held to the ones the driver was written and checked against
export const GIS_SPECS = ['grass=8.5', 'gdal=3.12', 'pykrige=1.7', 'gstools=1.7', 'whitebox_tools=2.4'];
export const GIS_METHODS = {
  surface: ['gdal_invdist', 'gdal_invdistnn', 'gdal_average', 'gdal_nearest', 'gdal_linear', 'pykrige_ok', 'pykrige_uk', 'gstools_ok', 'grass_rst', 'grass_bspline', 'grass_idw'],
  points3d: ['pykrige_ok3d', 'gstools_ok3d', 'grass_vol_rst'],
  hydro: ['gw_gradient', 'gw_drain', 'gw_depth', 'gw_change', 'terrain'],
};

// a short folder of the user's own (Windows paths in the packages are long; 260 characters is the limit)
const homeFile = userData => join(userData, 'gis-home.json');
export function gisHome(userData) {
  try { const h = JSON.parse(readFileSync(homeFile(userData), 'utf8')).home; if (typeof h === 'string' && existsSync(join(h, 'bflgis.json'))) return h; } catch { /* the usual place */ }
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'bflgis');
  return join(userData, 'gis');
}
const envDir = home => join(home, 'env');
const pythonOf = home => process.platform === 'win32' ? join(envDir(home), 'python.exe') : join(envDir(home), 'bin', 'python');
export function driverPath(root) {
  const p = join(root, 'resources', 'gis', 'bfl_gis.py'), un = p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  return existsSync(un) ? un : p;
}

// ends a process and everything it started (GRASS runs its modules as child processes)
export function killTree(p) {
  if (!p || p.exitCode != null) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }).on('error', () => p.kill());
  else { try { process.kill(-p.pid, 'SIGTERM'); } catch { p.kill(); } }
}
function run(cmd, args, { env, cwd, timeoutMs = 600000, onLine, onSpawn, keep = 40000 } = {}) {
  return new Promise(resolve => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, detached: process.platform !== 'win32' }); let out = '', timedOut = false, buf = '';
    onSpawn?.(p);
    const kill = setTimeout(() => { timedOut = true; killTree(p); }, timeoutMs);
    const take = d => { const s = String(d); out = (out + s).slice(-keep); if (onLine) { buf += s; const ls = buf.split(/\r?\n|\r/); buf = ls.pop(); for (const l of ls) if (l.trim()) onLine(l.trim()); } };
    p.stdout.on('data', take); p.stderr.on('data', take);
    p.on('error', e => { clearTimeout(kill); resolve({ code: -1, out: String(e.message), timedOut }); });
    p.on('close', code => { clearTimeout(kill); resolve({ code, out, timedOut }); });
  });
}

/* the environment as if activated: its own DLL and program folders first (Windows finds a package's DLLs only on PATH),
   and a plain temporary folder of its own (GRASS cannot use a temp path with a Windows short name in it) */
async function engineEnv(home) {
  const e = envDir(home), sep = process.platform === 'win32' ? ';' : ':', tmp = join(home, 'tmp'); await mkdir(tmp, { recursive: true });
  const dirs = process.platform === 'win32' ? [e, join(e, 'Library', 'mingw-w64', 'bin'), join(e, 'Library', 'usr', 'bin'), join(e, 'Library', 'bin'), join(e, 'Scripts'), join(e, 'bin')] : [join(e, 'bin')];
  const pathKey = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH') || 'PATH';
  return { [pathKey]: dirs.join(sep) + sep + (process.env[pathKey] || ''), CONDA_PREFIX: e, TEMP: tmp, TMP: tmp, TMPDIR: tmp, PYTHONNOUSERSITE: '1', PYTHONIOENCODING: 'utf-8', PROJ_DATA: process.platform === 'win32' ? join(e, 'Library', 'share', 'proj') : join(e, 'share', 'proj'), GDAL_DATA: process.platform === 'win32' ? join(e, 'Library', 'share', 'gdal') : join(e, 'share', 'gdal') };
}
let statusCache = null;
export async function gisStatus({ userData, root }) {
  const home = gisHome(userData), py = pythonOf(home);
  if (!gisPackState(home).engines) return { installed: false, home, supported: !!MAMBA[`${process.platform}-${process.arch}`] };
  if (statusCache && statusCache.home === home) return statusCache;
  const r = await gisRun({ userData, root, job: { kind: 'versions' }, timeoutMs: 120000 });
  statusCache = r.ok ? { installed: true, home, versions: r } : { installed: true, home, broken: r.error || 'The GIS engines did not start.' };
  return statusCache;
}

async function download(url, dest, sha) {
  const res = await fetch(url, { redirect: 'follow' }); if (!res.ok) throw new Error(`Download failed (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer()), got = createHash('sha256').update(buf).digest('hex');
  if (got !== sha) throw new Error('The installer download did not match its published checksum, so it was not used.');
  await writeFile(dest, buf); if (process.platform !== 'win32') await chmod(dest, 0o755);
}

/* packs: what Add-ons can install. Each is a fixed list of packages at fixed versions, from conda-forge only. An install can be
   paused (what was downloaded is kept) or cancelled; a half-made install never counts as installed and is cleared. */
export const GIS_PACKS = { engines: { specs: GIS_SPECS.filter(s => !s.startsWith('whitebox')), unpack: 4.3 }, wbt: { specs: GIS_SPECS.filter(s => s.startsWith('whitebox')), needs: 'engines', unpack: 4 } };
const MARGIN = 2e9;   // always left free on the drive
const metaDir = home => join(envDir(home), 'conda-meta'), partFile = home => join(home, 'installing.json'), ours = ['env', 'root', 'tmp', 'wbt_out', 'micromamba.exe', 'micromamba', 'installing.json', 'bflgis.json'];
const meta = home => { try { return readdirSync(metaDir(home)); } catch { return []; } };
export function gisPackState(home) {
  const m = meta(home), part = existsSync(partFile(home)) ? (() => { try { return JSON.parse(readFileSync(partFile(home), 'utf8')); } catch { return { pack: 'engines' }; } })() : null;
  const engines = existsSync(pythonOf(home)) && part?.pack !== 'engines';
  return { engines, wbt: engines && m.some(f => /^whitebox_tools-/.test(f)) && part?.pack !== 'wbt', paused: part && !inst ? part.pack : null };
}
export async function freeBytes(dir) { let d = dir; while (!existsSync(d)) { const up = join(d, '..'); if (up === d) return null; d = up; } try { const s = await statfs(d); return s.bavail * s.bsize; } catch { return null; } }
export async function gisPacks({ userData }) {
  const home = gisHome(userData);
  return { home, supported: !!MAMBA[process.platform + '-' + process.arch], free: await freeBytes(home), margin: MARGIN, ...gisPackState(home), running: inst ? inst.last : null };
}
async function dirBytes(dir) { let n = 0; const go = async d => { let l; try { l = await readdir(d, { withFileTypes: true }); } catch { return; } for (const e of l) { const p = join(d, e.name); if (e.isDirectory()) await go(p); else if (e.isFile()) { try { n += (await stat(p)).size; } catch { /* gone */ } } } }; await go(dir); return n; }
export const gisSize = async ({ userData }) => ({ engines: await dirBytes(envDir(gisHome(userData))) });
/* the folder the engines go in: chosen before anything is installed; they get a folder of their own inside it */
export async function gisSetHome({ userData, dir }) {
  if (inst) return { ok: false, error: 'An install is running.' };
  if (existsSync(pythonOf(gisHome(userData)))) return { ok: false, error: 'Remove the GIS engines first, then choose another folder.' };
  const home = join(dir, 'bflgis');
  if (process.platform === 'win32' && home.length > 60) return { ok: false, error: 'That folder’s path is too long for some of the engines’ files. Choose one nearer the top of the drive.' };
  if (process.platform === 'win32' && /[^\x20-\x7e]/.test(home)) return { ok: false, error: 'Choose a folder without accented or special letters in its path.' };
  if (existsSync(home) && !existsSync(join(home, 'bflgis.json')) && readdirSync(home).length) return { ok: false, error: 'There is already a folder named bflgis there that this app did not make.' };
  try { await mkdir(home, { recursive: true }); await writeFile(join(home, 'bflgis.json'), JSON.stringify({ app: 'Borehole Field Log' })); await writeFile(homeFile(userData), JSON.stringify({ home })); } catch (e) { return { ok: false, error: 'That folder cannot be written to (' + (e.code || e.message) + ').' }; }
  statusCache = null; return { ok: true, home };
}
/* a stop can come while a package is being unpacked: half-unpacked folders and part downloads go, whole downloads stay */
async function tidyPkgs(home, files) {
  const pk = join(home, 'root', 'pkgs');
  for (const f of files || []) { if (!/^[w.+-]+.(conda|tar.bz2)$/.test(f.fn) || !/^[w-]+$/.test(f.sub)) continue;
    for (const d of [pk, join(pk, 'https', 'conda.anaconda.org', 'conda-forge', f.sub)]) { const a = join(d, f.fn); await rm(a.replace(/.(conda|tar.bz2)$/, ''), { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => undefined); await rm(a + '.part', { force: true }).catch(() => undefined); try { if (f.size && statSync(a).size !== f.size) await rm(a, { force: true }); } catch { /* not there */ } } }
}
let inst = null;   // { pack, proc, stop, last }
export function gisStop(how) { if (!inst || inst.stop) return false; inst.stop = how === 'cancel' ? 'cancel' : 'pause'; killTree(inst.proc); return true; }
export const gisInstalling = () => !!inst;
const mambaEnv = home => ({ MAMBA_ROOT_PREFIX: join(home, 'root'), CONDA_OVERRIDE_CUDA: '', CI: '1' });
async function mamba(home, args, o = {}) { const exe = join(home, process.platform === 'win32' ? 'micromamba.exe' : 'micromamba'); return run(exe, args, { env: mambaEnv(home), timeoutMs: 3600000, onSpawn: p => { if (inst) { inst.proc = p; if (inst.stop) killTree(p); } }, ...o }); }
/* what would be downloaded, and whether it fits. Nothing is installed */
export async function gisPlan({ userData, pack, onProgress = () => {} }) {
  if (!GIS_PACKS[pack]) return { ok: false, error: 'Unknown pack.' }; if (inst) return { ok: false, error: 'Another install is running.' };
  inst = { pack, plan: true, last: { pack, stage: 'prepare' } };
  try { return await plan(userData, pack, onProgress); } catch (e) { return { ok: false, error: inst?.stop ? 'stopped' : String(e.message || e) }; } finally { inst = null; }
}
async function plan(userData, pack, onProgress) {
  const P = GIS_PACKS[pack], home = gisHome(userData), mm = MAMBA[process.platform + '-' + process.arch], exe = join(home, process.platform === 'win32' ? 'micromamba.exe' : 'micromamba');
  if (!mm) return { ok: false, error: 'The GIS engines are not available for ' + process.platform + '-' + process.arch + '.' };
  const free0 = await freeBytes(home); if (free0 != null && free0 < 600e6) return { ok: false, space: { free: free0, need: 600e6 }, error: 'The drive is almost full.' };
  await mkdir(home, { recursive: true }); if (!existsSync(join(home, 'bflgis.json'))) await writeFile(join(home, 'bflgis.json'), JSON.stringify({ app: 'Borehole Field Log' }));
  if (!existsSync(exe)) { onProgress({ pack, stage: 'prepare', label: 'Getting the installer' }); await download('https://github.com/mamba-org/micromamba-releases/releases/download/' + MAMBA_TAG + '/' + mm[0], exe, mm[1]); }
  onProgress({ pack, stage: 'prepare', label: 'Reading the package lists' });
  const st = gisPackState(home), fresh = pack === 'engines' && !st.engines;
  if (P.needs && !st[P.needs]) return { ok: false, error: 'Add the GIS engines first.' };
  const r = await mamba(home, [fresh ? 'create' : 'install', '-y', '--dry-run', '--json', '-p', fresh ? join(home, 'env') : envDir(home), '-c', 'conda-forge', '--override-channels', ...P.specs], { keep: 60e6 });
  if (inst?.stop) return { ok: false, error: 'stopped' };
  let j = null; try { j = JSON.parse(r.out.slice(r.out.indexOf('{'))); } catch { /* below */ }
  if (r.code !== 0 || !j) return { ok: false, error: /network|resolve host|timed? ?out|Connection|download/i.test(r.out) && !j ? 'conda-forge could not be reached. Check the connection, or whether the network blocks it.' : 'The package list could not be read. ' + r.out.slice(-300) };
  const fetch0 = j.actions?.FETCH || [], link = j.actions?.LINK || [], sum = a => a.reduce((n, p) => n + (p.size || 0), 0), dl = sum(fetch0), installed = Math.round(sum(link) * P.unpack), need = dl + installed + MARGIN, free = await freeBytes(home);
  return { ok: true, pack, home, fresh, download: dl, installed, need, free, fits: free == null || free >= need, margin: MARGIN, packages: link.length, files: fetch0.map(p => ({ fn: p.fn || String(p.url || '').split('/').pop(), sub: p.subdir || 'noarch', size: p.size || 0, name: p.name })), links: link.map(p => p.name) };
}
export async function gisInstall({ userData, pack = 'engines', onProgress = () => {} }) {
  if (!GIS_PACKS[pack]) return { ok: false, error: 'Unknown pack.' }; if (inst) return { ok: false, error: 'Another install is running.' };
  const home = gisHome(userData), say = o => { if (!inst) return; inst.last = { pack, ...o }; onProgress(inst.last); };
  inst = { pack, last: { pack, stage: 'prepare' } }; let tick = null, made = false, began = false, files = null;
  try {
    const p = await plan(userData, pack, say); if (inst.stop) throw new Error('stopped'); if (!p.ok) return p;
    files = p.files; if (!p.fits) return { ok: false, space: { free: p.free, need: p.need }, error: 'Not enough free space: ' + gb(p.need) + ' needed (with ' + gb(MARGIN) + ' kept free), ' + gb(p.free) + ' free.' };
    await writeFile(partFile(home), JSON.stringify({ pack, at: new Date().toISOString() })); began = true;
    if (p.fresh) { await rm(envDir(home), { recursive: true, force: true }); made = true; }   // what an earlier try left behind
    const pk = join(home, 'root', 'pkgs'), before = new Set(meta(home)), newN = p.links.length || 1; let t0 = 0, b0 = 0, speed = 0, lastT = 0, lastB = 0;
    const sizeOf = f => { for (const q of [join(pk, f.fn), join(pk, 'https', 'conda.anaconda.org', 'conda-forge', f.sub, f.fn)]) { try { return Math.min(statSync(q).size, f.size || Infinity); } catch { /* not here */ } try { return Math.min(statSync(q + '.part').size, f.size || Infinity); } catch { /* not started */ } } return 0; };
    const got = new Map();   // a file once seen whole stays counted (it is unpacked and may be removed)
    const measure = () => {
      let b = 0, cur = ''; for (const f of p.files) { const n = Math.max(sizeOf(f), got.get(f.fn) || 0); got.set(f.fn, n); b += n; if (!cur && n > 0 && n < f.size) cur = f.name; }
      const now = Date.now(); if (!t0) { t0 = lastT = now; b0 = lastB = b; } if (now - lastT > 900) { const v = (b - lastB) / ((now - lastT) / 1000); speed = speed ? speed * .7 + v * .3 : v; lastT = now; lastB = b; }
      const linked = meta(home).filter(f => f.endsWith('.json') && !before.has(f)).length, left = Math.max(0, p.download - b), dlF = p.download ? Math.min(1, b / p.download) : 1, inF = Math.min(1, linked / newN);
      const stage = linked > 0 || dlF > .999 ? 'install' : 'download';
      say({ stage, done: b, total: p.download, speed: stage === 'download' ? Math.max(0, speed) : 0, eta: stage === 'download' && speed > 2e4 ? left / speed : null, linked, packages: newN, p: stage === 'download' ? dlF * .72 : .72 + inF * .26, label: stage === 'download' ? cur : '' });
    };
    tick = setInterval(measure, 350); measure();
    const go = () => mamba(home, [p.fresh ? 'create' : 'install', '-y', '-p', envDir(home), '-c', 'conda-forge', '--override-channels', ...GIS_PACKS[pack].specs]);
    let r = await go(); if (r.code !== 0 && !inst.stop && /remove_all|Access is denied|being used by another/i.test(r.out)) { await tidyPkgs(home, files); r = await go(); }   // a virus scanner had a file open: once more
    clearInterval(tick); tick = null; if (inst.stop) throw new Error('stopped');
    const m = meta(home), okNow = existsSync(pythonOf(home)) && GIS_PACKS[pack].specs.every(s => m.some(f => f.startsWith(s.split('=')[0] + '-')));
    if (r.code !== 0 || !okNow) throw new Error(r.timedOut ? 'The install took over an hour and was stopped.' : (r.out.match(/critical[^\n]*/i)?.[0] || 'The install did not finish. ' + r.out.slice(-300)).slice(0, 600));
    say({ stage: 'finish', p: .985, label: 'Clearing the download cache' }); await mamba(home, ['clean', '-t', '-i', '-y']);
    await rm(partFile(home), { force: true }); began = false; statusCache = null; say({ stage: 'done', p: 1 }); return { ok: true, home };
  } catch (e) {
    const stop = inst.stop; if (tick) clearInterval(tick);
    if (began && stop) await tidyPkgs(home, files);
    if (began) {   // undo: a new environment is cleared; a package half added is taken out. A pause keeps the downloads and can go on
      if (made) await rm(envDir(home), { recursive: true, force: true, maxRetries: 4, retryDelay: 400 }).catch(() => undefined);
      else if (stop || !gisPackReady(home, pack)) { const st = inst; st.stop = null; await mamba(home, ['remove', '-y', '-p', envDir(home), ...GIS_PACKS[pack].specs.map(s => s.split('=')[0])]).catch(() => undefined); st.stop = stop; }
      if (stop !== 'pause') { await rm(partFile(home), { force: true }); if (stop === 'cancel') { const st = inst; st.stop = null; await mamba(home, ['clean', '-a', '-y']).catch(() => undefined); st.stop = stop; } }
    }
    say({ stage: stop === 'pause' ? 'paused' : stop ? 'cancelled' : 'failed', p: 0 });
    return { ok: false, paused: stop === 'pause', cancelled: stop === 'cancel', error: stop ? 'stopped' : String(e.message || e) };
  } finally { inst = null; statusCache = null; }
}
const gb = n => n == null ? 'unknown' : n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : Math.max(1, Math.round(n / 1e6)) + ' MB';
const gisPackReady = (home, pack) => GIS_PACKS[pack].specs.every(s => meta(home).some(f => f.startsWith(s.split('=')[0] + '-')));
export async function gisRemove({ userData, pack = 'engines' }) {
  const home = gisHome(userData); if (inst) return { ok: false, error: 'An install is running.' }; if (!GIS_PACKS[pack]) return { ok: false, error: 'Unknown pack.' };
  inst = { pack, last: { pack, stage: 'remove' } };
  try {
    if (pack !== 'engines') { const r = await mamba(home, ['remove', '-y', '-p', envDir(home), ...GIS_PACKS[pack].specs.map(s => s.split('=')[0])]); if (r.code !== 0) return { ok: false, error: r.out.slice(-300) }; }
    else { for (const n of ours) await rm(join(home, n), { recursive: true, force: true, maxRetries: 4, retryDelay: 400 }); try { await rmdir(home); } catch { /* other files are there: the folder stays */ } await rm(homeFile(userData), { force: true }); }
    statusCache = null; return { ok: true };
  } catch (e) { return { ok: false, error: 'Some files could not be removed (' + (e.code || e.message) + '). Close anything using them and try again.' }; } finally { inst = null; statusCache = null; }
}

// a job from the window: one known kind and method, numbers only, sizes held to what a site needs
const CRS_CODE = /^(EPSG|ESRI|IGNF|OGC|CRS):\w{1,12}$|^\d{4,6}$/;
const CALC_WORDS = new Set(['A', 'B', 'C', 'abs', 'sqrt', 'exp', 'log', 'if', 'isnull', 'null', 'min', 'max', 'round', 'int', 'float', 'double', 'pow', 'sin', 'cos', 'tan', 'atan', 'median', 'mode', 'not', 'eval', 'nmin', 'nmax', 'nmedian', 'xor']);
const isNum = v => typeof v === 'number' && Number.isFinite(v), nums = (a, k) => Array.isArray(a) && a.every(p => Array.isArray(p) && p.length === k && p.every(isNum));
const gridOk = g => g && typeof g.b64 === 'string' && g.b64.length <= 24e6 && Number.isInteger(g.nx) && Number.isInteger(g.ny) && g.nx >= 3 && g.ny >= 3 && g.nx * g.ny <= 4.5e6 && Math.ceil(g.nx * g.ny * 4 / 3) * 4 === g.b64.length && nums([g.box], 4);
export function checkJob(job) {
  if (!job || typeof job !== 'object') return 'No job.';
  if (job.id != null && !/^[\w-]{1,40}$/.test(String(job.id))) return 'A plain job id is needed.';
  const { kind, method } = job;
  if (kind === 'versions') return '';
  if (kind === 'surface') {
    if (!GIS_METHODS.surface.includes(method)) return 'Unknown method.';
    if (!nums(job.pts, 3) || job.pts.length < 3 || job.pts.length > 5000) return 'Points must be 3 to 5000 [x, y, value].';
    if (!nums([job.box], 4) || !(job.nx >= 2 && job.nx <= 1000 && job.ny >= 2 && job.ny <= 1000)) return 'Grid outside the limits.';
  } else if (kind === 'points3d') {
    if (!GIS_METHODS.points3d.includes(method)) return 'Unknown method.';
    if (!nums(job.pts, 4) || job.pts.length < 4 || job.pts.length > 2000) return 'Samples must be 4 to 2000 [x, y, z, value].';
    if (!nums(job.targets, 3) || job.targets.length > 200000) return 'Targets outside the limits.';
    if (method === 'grass_vol_rst' && (!nums([job.box3], 6) || !(job.nx * job.ny * job.nz <= 4e6))) return '3D grid outside the limits.';
  } else if (kind === 'hydro') {
    if (!GIS_METHODS.hydro.includes(method)) return 'Unknown method.';
    if (!nums(job.pts, 3) || job.pts.length < 3 || job.pts.length > 5000) return 'Water levels must be 3 to 5000 [x, y, head].';
    const lim = method === 'terrain' ? 2000 : 1000;
    if (!nums([job.box], 4) || !(job.nx >= 2 && job.nx <= lim && job.ny >= 2 && job.ny <= lim)) return 'Grid outside the limits.';
    if (method === 'gw_drain' && !nums([job.start], 2)) return 'A start point [x, y] is needed.';
    if (method === 'gw_depth' && (!nums(job.ground, 3) || job.ground.length < 3 || job.ground.length > 5000)) return 'Ground elevations must be 3 to 5000 [x, y, z].';
    if (method === 'gw_change' && (!nums(job.pts2, 3) || job.pts2.length < 3 || job.pts2.length > 5000)) return 'The later round needs 3 to 5000 [x, y, head].';
  } else if (kind === 'crs') {
    if (!['search', 'info', 'transform', 'ops'].includes(method)) return 'Unknown method.';
    if (method === 'search' && !(typeof job.q === 'string' && job.q.length >= 1 && job.q.length <= 80 && !/[;'"\\]/.test(job.q))) return 'Search for a name or code.';
    if (method === 'info' && !CRS_CODE.test(String(job.code))) return 'A coordinate-system code is needed.';
    if ((method === 'transform' || method === 'ops') && !(CRS_CODE.test(String(job.from)) && CRS_CODE.test(String(job.to)))) return 'Two coordinate-system codes are needed.';
    if (method === 'transform' && !(Array.isArray(job.points) && job.points.length >= 1 && job.points.length <= 20000 && job.points.every(p => Array.isArray(p) && p.length >= 2 && p.length <= 3 && p.every(v => v === null || isNum(v))))) return 'Points [x, y] or [x, y, z] are needed.';
  } else if (kind === 'importvec') {
    if (!/^f[0-9a-f]{20}$/.test(String(job.file))) return 'Choose a file.';
    if (!CRS_CODE.test(String(job.epsg)) || (job.src != null && !CRS_CODE.test(String(job.src)))) return 'Coordinate systems are needed.';
  } else if (kind === 'dem') {
    if (!/^f[0-9a-f]{20}$/.test(String(job.file))) return 'Choose an elevation model file.';
    if (!nums([job.box], 4) || !(Number.isInteger(job.epsg) && job.epsg > 1000 && job.epsg < 100000) || !(job.box[2] > job.box[0] && job.box[3] > job.box[1] && job.box[2] - job.box[0] < 50000 && job.box[3] - job.box[1] < 50000)) return 'Area outside the limits.';
    const pc = job.params?.cells, cs = job.params?.cellsize;
    if (pc != null && pc !== 'source' && !(+pc >= 25 && +pc <= 3000)) return 'Cells across must be 25 to 3000.';
    if (cs != null && !(+cs >= 0.05)) return 'The cell size must be 0.05 m or more.';
    if (job.levels != null && (!Array.isArray(job.levels) || job.levels.length > 400 || !job.levels.every(isNum))) return 'Contour levels must be numbers.';
  } else if (kind === 'rast') {
    if (!['profile', 'cutfill', 'watershed', 'diff', 'griddist', 'calc', 'reclass', 'zonal', 'filter', 'hyd'].includes(method)) return 'Unknown method.';
    if (method === 'hyd') { if (!['twi', 'dep', 'hand', 'flood', 'catch', 'trace', 'screen'].includes(job.params?.op)) return 'Unknown method.'; if (['catch', 'trace'].includes(job.params.op) && !(nums(job.points, 2) && job.points.length === 1)) return 'A point is needed.'; }
    if (!gridOk(job.rasters?.a) || (job.rasters.b != null && !gridOk(job.rasters.b)) || (job.rasters.c != null && !gridOk(job.rasters.c))) return 'A layer grid is missing or does not match its size.';
    if (method === 'calc') {   // r.mapcalc's language only: the layers A, B, C, numbers, operators and a fixed set of its functions
      const e = String(job.expr || ''), words = e.match(/[A-Za-z_]+/g) || [];
      if (!e || e.length > 500 || /[^\w\s+\-*/%^().,<>=!&|?:]/.test(e) || !words.every(w => CALC_WORDS.has(w))) return 'The expression may use A, B, C, numbers, + - * / ^ % ( ) < > = ! & | ? : and the functions ' + [...CALC_WORDS].filter(w => w.length > 1).join(', ') + '.';
    }
    if (method === 'reclass' && (!Array.isArray(job.breaks) || job.breaks.length < 1 || job.breaks.length > 30 || !job.breaks.every(isNum))) return 'Class breaks must be 1 to 30 numbers.';
    if (method === 'zonal' && (!Array.isArray(job.polys) || !job.polys.length)) return 'Areas are needed.';
    if (method === 'profile' && (!nums(job.line, 2) || job.line.length < 2 || job.line.length > 500)) return 'A line of 2 to 500 points is needed.';
    if (method === 'griddist' && (!nums(job.points, 2) || job.points.length < 1 || job.points.length > 5000)) return 'Points are needed.';
    if (job.polys != null && (!Array.isArray(job.polys) || job.polys.length > 500 || !job.polys.every(p => Array.isArray(p) && p.every(r => nums(r, 2))))) return 'Areas must be rings of [x, y].';
  } else if (kind === 'canada') {
    if (!['lidar', 'wetland', 'water'].includes(method)) return 'Unknown method.';
    if (!nums([job.box], 4) || !(Number.isInteger(job.epsg) && job.epsg > 1000 && job.epsg < 100000)) return 'An area and a coordinate system are needed.';
    const w = job.box[2] - job.box[0], h = job.box[3] - job.box[1], mx = method === 'lidar' ? 6000 : 30000; if (!(w > 5 && h > 5)) return 'The area is too small.'; if (w > mx || h > mx) return 'The area is too large: keep it under ' + mx / 1000 + ' km across.';
    if (job.params?.cell != null && !(job.params.cell >= 0.5 && job.params.cell <= 100)) return 'The cell size must be 0.5 to 100 m.';
  } else if (kind === 'rgdal') {
    if (!['warp', 'clip', 'dem', 'contour'].includes(method)) return 'Unknown method.';
    if (!gridOk(job.raster) || !CRS_CODE.test(String(job.epsg)) || (job.to != null && !CRS_CODE.test(String(job.to)))) return 'A layer grid and coordinate systems are needed.';
    if (method === 'clip' && (!Array.isArray(job.polys) || !job.polys.length || job.polys.length > 500 || !job.polys.every(p => Array.isArray(p) && p.every(r => nums(r, 2))))) return 'An area is needed.';
    if (job.name && !/^[\w .-]{1,60}$/.test(job.name)) return 'A plain file name is needed.';
  } else if (kind === 'importrast' || kind === 'imgprev' || kind === 'georef') {
    if (!/^f[0-9a-f]{20}$/.test(String(job.file))) return 'Choose a file.';
    if (kind !== 'imgprev' && !CRS_CODE.test(String(job.epsg))) return 'A coordinate system is needed.';
    if (kind === 'georef') {
      if (!(Array.isArray(job.gcps) && job.gcps.length >= 3 && job.gcps.length <= 200 && job.gcps.every(q => Array.isArray(q) && q.length === 4 && q.every(isNum)))) return 'Three or more control points [pixel, line, x, y] are needed.';
      if (!['affine', 'poly2', 'tps'].includes(job.method)) return 'Unknown fit.';
      if (job.method === 'poly2' && job.gcps.length < 6) return 'A 2nd-order polynomial needs six or more control points.';
      if (job.name && !/^[\w .-]{1,60}$/.test(job.name)) return 'A plain file name is needed.';
    }
  } else if (kind === 'thiessen') {
    if (!Array.isArray(job.points) || job.points.length < 2 || job.points.length > 5000 || !job.points.every(p => Array.isArray(p) && isNum(p[0]) && isNum(p[1]) && (p[2] == null || typeof p[2] === 'string'))) return 'Points [x, y, name] are needed.';
    if (!nums(job.outline, 2) || job.outline.length < 3) return 'An outline is needed.';
  } else if (kind === 'setback' || kind === 'exportlayer') {
    const feat = f => f && ['point', 'line', 'polygon'].includes(f.type) && Array.isArray(f.pts) && f.pts.length && f.pts.length <= 20000 && (nums(f.pts, 2) || f.pts.every(r => nums(r, 2))) && (f.name == null || typeof f.name === 'string');
    const list = (a, mx) => Array.isArray(a) && a.length <= mx && a.every(feat);
    if (kind === 'setback') { if (!list(job.from, 2000) || !job.from.length || (job.to != null && !list(job.to, 2000)) || !(job.distance >= 0 && job.distance <= 100000)) return 'Shapes and a distance are needed.'; }
    else {
      if (!(Number.isInteger(job.epsg) && job.epsg > 1000 && job.epsg < 100000) || !['GPKG', 'SHP', 'KML', 'DXF'].includes(job.format) || (job.name && !/^[\w .-]{1,60}$/.test(job.name))) return 'A format, a plain name and a coordinate system are needed.';
      if (job.features != null && !list(job.features, 50000)) return 'Features must be points, lines or areas.';
      if (job.raster != null && !(typeof job.raster.b64 === 'string' && Math.ceil(job.raster.nx * job.raster.ny * 4 / 3) * 4 === job.raster.b64.length && nums([job.raster.box], 4))) return 'The grid does not match its size.';
    }
  } else if (kind === 'demfix' || kind === 'trees') {
    if (job.epsg != null && !CRS_CODE.test(String(job.epsg))) return 'The coordinate system code is not valid.';
    if (typeof job.values_b64 !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(job.values_b64.slice(0, 200)) || job.values_b64.length > 24e6) return 'The elevation grid is missing or too large.';
    if (!(Number.isInteger(job.nx) && Number.isInteger(job.ny) && job.nx >= 3 && job.ny >= 3 && job.nx * job.ny <= 4.5e6) || Math.ceil(job.nx * job.ny * 4 / 3) * 4 !== job.values_b64.length) return 'The grid does not match its size.';
    if (!nums([job.box], 4)) return 'No area.';
    if (job.spots != null && (!nums(job.spots, 3) || job.spots.length > 300)) return 'Spots must be [x, y, radius].';
    if (job.keep != null && (!nums(job.keep, 3) || job.keep.length > 300)) return 'Kept areas must be [x, y, radius].';
    if (job.keep_polys != null && !(Array.isArray(job.keep_polys) && job.keep_polys.length <= 200 && job.keep_polys.every(p => Array.isArray(p) && p.length >= 1 && p.length <= 50 && p.every(r => nums(r, 2) && r.length >= 3 && r.length <= 20000)))) return 'Kept areas must be polygons.';
    if (job.foot_b64 != null && (typeof job.foot_b64 !== 'string' || Math.ceil(job.nx * job.ny / 3) * 4 !== job.foot_b64.length || !/^[A-Za-z0-9+/=]+$/.test(job.foot_b64.slice(0, 200)))) return 'The outline does not match the grid.';
  } else if (kind === 'wbt') {
    if (job.method === 'catalog') return '';
    if (job.method !== 'run' || !/^[A-Za-z0-9]{2,64}$/.test(String(job.tool))) return 'A WhiteboxTools tool is needed.';
    if (job.epsg != null && !CRS_CODE.test(String(job.epsg))) return 'The coordinate system code is not valid.';
    if (job.terrain != null && typeof job.terrain !== 'boolean') return 'Bad option.';
    if (!Array.isArray(job.args) || job.args.length > 60) return 'Too many settings.';
    const plain = s => typeof s === 'string' && !/[\\/:*?"<>|\u0000-\u001f]/.test(s);   // settings never name a file: files go by token
    const feat = f => f && ['point', 'line', 'polygon'].includes(f.type) && Array.isArray(f.pts) && f.pts.length && f.pts.length <= 20000 && (f.name == null || (typeof f.name === 'string' && f.name.length <= 200))
      && (f.attrs == null || (typeof f.attrs === 'object' && !Array.isArray(f.attrs) && Object.keys(f.attrs).length <= 30 && Object.entries(f.attrs).every(([a, x]) => /^[A-Za-z_][A-Za-z0-9_]{0,9}$/.test(a) && (x == null || isNum(x) || (typeof x === 'string' && x.length <= 80)))));
    const val = (v, inList) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
      if ('num' in v) return isNum(v.num); if ('bool' in v) return typeof v.bool === 'boolean';
      if ('str' in v) return plain(v.str) && v.str.length <= 200; if ('opt' in v) return plain(v.opt) && v.opt.length <= 80;
      if ('out' in v) return !inList && ['raster', 'vector', 'lidar', 'html', 'text', 'csv'].includes(v.out);
      if ('grid' in v) return gridOk(v.grid); if ('file' in v) return /^f[0-9a-f]{20}$/.test(String(v.file));
      if ('feats' in v) return Array.isArray(v.feats) && v.feats.length <= 50000 && (v.geom == null || ['Point', 'Line', 'Polygon', 'Any', 'LineOrPolygon'].includes(v.geom)) && v.feats.every(feat);
      if ('list' in v) return !inList && Array.isArray(v.list) && v.list.length >= 1 && v.list.length <= 50 && v.list.every(x => val(x, true));
      return false;
    };
    if (!job.args.every(a => a && /^--?[A-Za-z0-9_]{1,40}$/.test(String(a.flag)) && val(a.v))) return 'A setting is not valid.';
  } else if (kind === 'otrees') {
    if (job.epsg != null && !CRS_CODE.test(String(job.epsg))) return 'The coordinate system code is not valid.';
    if (typeof job.image_b64 !== 'string' || job.image_b64.length > 90e6 || !/^[A-Za-z0-9+/=]+$/.test(job.image_b64.slice(0, 200)) || !['image/png', 'image/webp'].includes(job.mime)) return 'The orthophoto is missing, too large, or not PNG or WebP.';
    if (!nums([job.ibox], 4) || !nums([job.box], 4)) return 'No area.';
    if (typeof job.values_b64 !== 'string' || !(Number.isInteger(job.nx) && Number.isInteger(job.ny) && job.nx >= 3 && job.ny >= 3 && job.nx * job.ny <= 4.5e6) || Math.ceil(job.nx * job.ny * 4 / 3) * 4 !== job.values_b64.length) return 'The ground grid does not match its size.';
    if (!Array.isArray(job.trees) || job.trees.length > 200000 || (job.trees.length && !nums(job.trees, 5))) return 'Trees must be [x, y, ground, height, radius].';
  } else if (kind === 'volume') {
    if (!nums(job.pts, 4) || job.pts.length < 4 || job.pts.length > 2000) return 'Samples must be 4 to 2000 [x, y, depth, value].';
    if (!nums([job.box3], 6) || !(job.nx >= 2 && job.ny >= 2 && job.nz >= 1 && job.nx * job.ny * job.nz <= 200000)) return 'Block grid outside the limits.';
  } else if (kind === 'drillnext' || kind === 'prob') {
    if (!nums(job.pts, 3) || job.pts.length < 3 || job.pts.length > 5000) return 'Points must be 3 to 5000 [x, y, value].';
    if (!nums([job.box], 4) || !(job.nx >= 2 && job.nx <= 400 && job.ny >= 2 && job.ny <= 400)) return 'Grid outside the limits.';
    if (job.hull != null && (!nums(job.hull, 2) || job.hull.length > 500)) return 'The outline must be [x, y] points.';
    if (kind === 'drillnext' && !(Number.isInteger(job.n) && job.n >= 1 && job.n <= 10)) return 'Choose 1 to 10 locations.';
    if (kind === 'prob' && !isNum(job.level)) return 'A level is needed.';
  } else if (kind === 'contours' || kind === 'export' || kind === 'area') {
    if (!nums([job.box], 4) || !Array.isArray(job.values) || job.values.length !== job.nx * job.ny || job.values.some(v => v !== null && !isNum(v))) return 'Grid does not match its size.';
    if (kind === 'area' && !isNum(job.level)) return 'A level is needed.';
    if (kind === 'export' && !(Number.isInteger(job.epsg) && job.epsg > 1000 && job.epsg < 100000)) return 'No coordinate system.';
    if (kind === 'export' && job.name && !/^[\w .-]{1,60}$/.test(job.name)) return 'A plain file name is needed.';
  } else return 'Unknown job.';
  if (job.params && (typeof job.params !== 'object' || Object.values(job.params).some(v => !isNum(v) && !/^[a-z]{1,20}$/.test(String(v)) && !CRS_CODE.test(String(v))))) return 'Options must be numbers, plain words or coordinate-system codes.';
  if (job.network != null && typeof job.network !== 'boolean') return 'Bad option.';
  if (job.out != null && !CRS_CODE.test(String(job.out))) return 'A coordinate-system code such as EPSG:2956 is needed.';
  return '';
}

const running = new Map(), cancelled = new Set();
export function gisCancel(id) { const p = running.get(id); if (!p) return false; cancelled.add(id); killTree(p); return true; }
/* files the user chose in an Open dialog (an elevation model): the window gets a token, never a path; a job names the token */
const picked = new Map();
export function gisFilePath(token) { const p = picked.get(String(token)); return p && existsSync(p) ? p : null; }
export function gisRegisterFile(path, name, size) { const token = 'f' + createHash('sha256').update(path + Date.now() + Math.random()).digest('hex').slice(0, 20); picked.set(token, path); return { token, name, size }; }
export async function gisRun({ userData, root, job, timeoutMs = 600000, onProgress }) {
  const bad = checkJob(job); if (bad) return { ok: false, error: bad };
  if (['dem', 'importvec', 'importrast', 'imgprev', 'georef'].includes(job.kind)) { const p = picked.get(job.file); if (!p || !existsSync(p)) return { ok: false, error: 'Choose the file again.' }; job = { ...job, path: p }; }
  if (job.kind === 'wbt' && job.method === 'run') {
    let miss = false; const res = v => v && v.file ? (picked.get(v.file) && existsSync(picked.get(v.file)) ? { file: picked.get(v.file) } : (miss = true, v)) : v && v.list ? { list: v.list.map(res) } : v;
    job = { ...job, args: job.args.map(a => ({ ...a, v: res(a.v) })) };
    if (miss) return { ok: false, error: 'Choose the file again: files are remembered only while the app is open.' };
  }
  const id = job.id;
  const home = gisHome(userData), py = pythonOf(home);
  if (!existsSync(py)) return { ok: false, error: 'The GIS engines are not installed. Install them under Settings › GIS engines.' };
  const dir = await mkdtemp(join(tmpdir(), 'bfl-gis-'));
  try {
    const jf = join(dir, 'job.json'), rf = join(dir, 'result.json'); await writeFile(jf, JSON.stringify({ ...job, timeout: Math.round(timeoutMs / 1000) }));
    const t0 = Date.now(), r = await run(py, ['-I', driverPath(root), jf, rf], { cwd: dir, timeoutMs, env: await engineEnv(home),
      onSpawn: p => { if (id) running.set(id, p); },
      onLine: l => { if (l.startsWith('@@') && onProgress) { try { onProgress({ id, ...JSON.parse(l.slice(2)) }); } catch { /* not a progress line */ } } } });
    if (id) running.delete(id);
    if (id && cancelled.delete(id)) return { ok: false, cancelled: true, error: 'Cancelled.' };
    if (!existsSync(rf) || (await stat(rf)).size > 256e6) return { ok: false, error: r.timedOut ? `The GIS tool did not finish within ${timeoutMs / 1000} s.` : 'The GIS tool stopped: ' + r.out.slice(-800) };
    const res = JSON.parse(await readFile(rf, 'utf8')); res.seconds = (Date.now() - t0) / 1000;
    if (job.kind === 'wbt' && Array.isArray(res.outputs)) for (const o of res.outputs) if (o && o.kind === 'file' && typeof o.path === 'string' && o.path.startsWith(join(home, 'wbt_out'))) { o.token = gisRegisterFile(o.path, o.fname || 'result', o.size || 0).token; delete o.path; }
    return res;
  } catch (e) { return { ok: false, error: String(e.message || e) }; } finally { await rm(dir, { recursive: true, force: true }); }
}
