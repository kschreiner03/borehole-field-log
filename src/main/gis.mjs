/* The optional GIS engines: real GIS software (GDAL, GRASS GIS, PyKrige, GSTools from conda-forge) installed per user, on
   request, and run as separate programs. The window never sends a command line: it sends a job naming one known method, with
   numbers only; the job is written to a file and the shipped driver (resources/gis/bfl_gis.py) calls the tool and writes the
   result. GRASS GIS is GPL: it is downloaded from conda-forge as published and only ever run as its own program. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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
export const GIS_SPECS = ['grass=8.5', 'gdal=3.12', 'pykrige=1.7', 'gstools=1.7'];
export const GIS_METHODS = {
  surface: ['gdal_invdist', 'gdal_invdistnn', 'gdal_average', 'gdal_nearest', 'gdal_linear', 'pykrige_ok', 'pykrige_uk', 'gstools_ok', 'grass_rst', 'grass_bspline', 'grass_idw'],
  points3d: ['pykrige_ok3d', 'gstools_ok3d', 'grass_vol_rst'],
  hydro: ['gw_gradient', 'gw_drain', 'gw_depth'],
};

// a short folder of the user's own (Windows paths in the packages are long; 260 characters is the limit)
export function gisHome(userData) {
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
function run(cmd, args, { env, cwd, timeoutMs = 600000, onLine, onSpawn } = {}) {
  return new Promise(resolve => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, detached: process.platform !== 'win32' }); let out = '', timedOut = false, buf = '';
    onSpawn?.(p);
    const kill = setTimeout(() => { timedOut = true; killTree(p); }, timeoutMs);
    const take = d => { const s = String(d); out = (out + s).slice(-40000); if (onLine) { buf += s; const ls = buf.split(/\r?\n|\r/); buf = ls.pop(); for (const l of ls) if (l.trim()) onLine(l.trim()); } };
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
  if (!existsSync(py)) return { installed: false, home, supported: !!MAMBA[`${process.platform}-${process.arch}`] };
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

let installing = null;
export function gisInstall({ userData, onProgress = () => {} }) {
  if (installing) return installing;
  installing = (async () => {
    const plat = `${process.platform}-${process.arch}`, mm = MAMBA[plat];
    if (!mm) return { ok: false, error: `The GIS engines are not available for ${plat}.` };
    const home = gisHome(userData), exe = join(home, process.platform === 'win32' ? 'micromamba.exe' : 'micromamba');
    try {
      await mkdir(home, { recursive: true });
      if (!existsSync(exe)) { onProgress({ step: 'Downloading the installer (micromamba ' + MAMBA_TAG + ')' }); await download(`https://github.com/mamba-org/micromamba-releases/releases/download/${MAMBA_TAG}/${mm[0]}`, exe, mm[1]); }
      onProgress({ step: 'Installing GRASS GIS, GDAL, PyKrige and GSTools from conda-forge (about 350 MB)' });
      const env = { MAMBA_ROOT_PREFIX: join(home, 'root') };
      const r = await run(exe, ['create', '-y', '-p', envDir(home), '-c', 'conda-forge', '--override-channels', ...GIS_SPECS], { env, timeoutMs: 3600000, onLine: l => { if (/^(Linking|Transaction|Downloading|\s*\+)/.test(l) || /\d+(\.\d+)?\s?[kMG]B/.test(l)) onProgress({ line: l.slice(0, 160) }); } });
      if (r.code !== 0 || !existsSync(pythonOf(home))) return { ok: false, error: r.timedOut ? 'The install took over an hour and was stopped.' : (r.out.match(/critical[^\n]*/i)?.[0] || 'The install did not finish.').slice(0, 600) };
      onProgress({ step: 'Clearing the download cache' }); await run(exe, ['clean', '-a', '-y'], { env, timeoutMs: 600000 });
      statusCache = null; return { ok: true, home };
    } catch (e) { return { ok: false, error: String(e.message || e) }; } finally { installing = null; }
  })();
  return installing;
}

export async function gisRemove({ userData }) {
  const home = gisHome(userData); if (installing) return { ok: false, error: 'An install is running.' };
  await rm(home, { recursive: true, force: true }); statusCache = null; return { ok: true };
}

// a job from the window: one known kind and method, numbers only, sizes held to what a site needs
const isNum = v => typeof v === 'number' && Number.isFinite(v), nums = (a, k) => Array.isArray(a) && a.every(p => Array.isArray(p) && p.length === k && p.every(isNum));
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
    if (!nums([job.box], 4) || !(job.nx >= 2 && job.nx <= 1000 && job.ny >= 2 && job.ny <= 1000)) return 'Grid outside the limits.';
    if (method === 'gw_drain' && !nums([job.start], 2)) return 'A start point [x, y] is needed.';
    if (method === 'gw_depth' && (!nums(job.ground, 3) || job.ground.length < 3 || job.ground.length > 5000)) return 'Ground elevations must be 3 to 5000 [x, y, z].';
  } else if (kind === 'contours' || kind === 'export' || kind === 'area') {
    if (!nums([job.box], 4) || !Array.isArray(job.values) || job.values.length !== job.nx * job.ny || job.values.some(v => v !== null && !isNum(v))) return 'Grid does not match its size.';
    if (kind === 'area' && !isNum(job.level)) return 'A level is needed.';
    if (kind === 'export' && !(Number.isInteger(job.epsg) && job.epsg > 1000 && job.epsg < 100000)) return 'No coordinate system.';
    if (kind === 'export' && job.name && !/^[\w .-]{1,60}$/.test(job.name)) return 'A plain file name is needed.';
  } else return 'Unknown job.';
  if (job.params && (typeof job.params !== 'object' || Object.values(job.params).some(v => !isNum(v) && !/^[a-z]{1,20}$/.test(String(v))))) return 'Options must be numbers or plain words.';
  return '';
}

const running = new Map(), cancelled = new Set();
export function gisCancel(id) { const p = running.get(id); if (!p) return false; cancelled.add(id); killTree(p); return true; }
export async function gisRun({ userData, root, job, timeoutMs = 600000, onProgress }) {
  const bad = checkJob(job); if (bad) return { ok: false, error: bad };
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
    const res = JSON.parse(await readFile(rf, 'utf8')); res.seconds = (Date.now() - t0) / 1000; return res;
  } catch (e) { return { ok: false, error: String(e.message || e) }; } finally { await rm(dir, { recursive: true, force: true }); }
}
