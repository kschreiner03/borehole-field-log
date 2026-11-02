/* Runs MODFLOW 6 on a set of input files in a fresh temporary folder and returns the requested outputs. Shared by the
   desktop main process and the app tests. Only plain file names are accepted: no paths, no shell, no arguments. */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// a plain file name with a letter, digit or underscore in it (so never . or ..)
const NAME = /^(?=.*\w)[\w.-]{1,64}$/, MAX_IN = 64e6, MAX_OUT = 256e6;
export function mf6Binary(root) {
  const dir = join(root, 'resources', 'mf6', `${process.platform}-${process.arch}`), bin = join(dir, process.platform === 'win32' ? 'mf6.exe' : 'mf6');
  // a packaged app keeps executables outside the asar archive
  const unpacked = bin.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  return existsSync(unpacked) ? unpacked : existsSync(bin) ? bin : null;
}
export async function runMf6({ bin, files, outputs = [], timeoutMs = 120000 }) {
  if (!bin) return { ok: false, error: `MODFLOW 6 is not installed for ${process.platform}-${process.arch}.` };
  if (!files || typeof files !== 'object' || !files['mfsim.nam']) return { ok: false, error: 'No simulation name file (mfsim.nam).' };
  const names = Object.keys(files);
  if (names.length > 200 || names.some(n => !NAME.test(n)) || outputs.some(n => !NAME.test(n))) return { ok: false, error: 'Model file names must be plain names.' };
  if (names.some(n => typeof files[n] !== 'string')) return { ok: false, error: 'Model files must be text.' };
  if (names.reduce((t, n) => t + files[n].length, 0) > MAX_IN) return { ok: false, error: 'The model files are too large.' };
  // MODFLOW reads and writes whatever paths its input names (FILEOUT, OPEN/CLOSE): model files may not contain any path at all
  if (names.some(n => /[\\/:]/.test(files[n]))) return { ok: false, error: 'Model files may not contain a path.' };
  const dir = await mkdtemp(join(tmpdir(), 'bhlog-mf6-'));
  try {
    for (const n of names) await writeFile(join(dir, n), files[n]);
    const t0 = Date.now();
    const { code, out, timedOut } = await new Promise(resolve => {
      const p = spawn(bin, [], { cwd: dir, windowsHide: true }); let out = '', timedOut = false;
      const kill = setTimeout(() => { timedOut = true; p.kill(); }, timeoutMs);
      p.stdout.on('data', d => { out = (out + d).slice(-20000); }); p.stderr.on('data', d => { out = (out + d).slice(-20000); });
      p.on('error', e => { clearTimeout(kill); resolve({ code: -1, out: String(e.message), timedOut }); });
      p.on('close', code => { clearTimeout(kill); resolve({ code, out, timedOut }); });
    });
    const res = {};
    for (const n of new Set([...outputs, 'mfsim.lst'])) { const f = join(dir, n); if (existsSync(f) && (await stat(f)).isFile() && (await stat(f)).size <= MAX_OUT) res[n] = new Uint8Array(await readFile(f)); }
    const ok = code === 0 && /Normal termination/.test(out);
    return { ok, code, seconds: (Date.now() - t0) / 1000, stdout: out.slice(-4000), files: res, error: ok ? '' : timedOut ? `MODFLOW 6 did not finish within ${timeoutMs / 1000} s.` : (out.match(/ERROR REPORT:([\s\S]{0,800})/)?.[1].replace(/\s+/g, ' ').trim() || `MODFLOW 6 stopped (exit code ${code}).`) };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
