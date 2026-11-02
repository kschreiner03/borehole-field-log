/* Runs MODFLOW 6 on a set of input files in a fresh temporary folder and returns the requested outputs. Shared by the
   desktop main process and the app tests. Only plain file names are accepted: no paths, no shell, no arguments. */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NAME = /^[\w.-]{1,64}$/;
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
    for (const n of new Set([...outputs, 'mfsim.lst'])) if (existsSync(join(dir, n))) res[n] = new Uint8Array(await readFile(join(dir, n)));
    const ok = code === 0 && /Normal termination/.test(out);
    return { ok, code, seconds: (Date.now() - t0) / 1000, stdout: out.slice(-4000), files: res, error: ok ? '' : timedOut ? `MODFLOW 6 did not finish within ${timeoutMs / 1000} s.` : (out.match(/ERROR[^\n]*(\n[^\n]+){0,6}/i)?.[0] || `MODFLOW 6 stopped (exit code ${code}).`).trim() };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
