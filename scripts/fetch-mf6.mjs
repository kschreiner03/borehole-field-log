// Fetches the official USGS MODFLOW 6 binary (public domain, CC0-1.0) into resources/mf6/<platform>-<arch>/, checked against
// the SHA-256 the release publishes. Run once before building or testing: `node scripts/fetch-mf6.mjs [win32-x64 ...]`.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const VERSION = '6.8.1';
const BUILDS = {
  'darwin-arm64': { zip: `mf${VERSION}_macarm.zip`, sha256: '2167d553d8f0c57c6c356156cb158b14e60684199785a82031b5c6cccf0b1e4c', bin: 'mf6' },
  'win32-x64': { zip: `mf${VERSION}_win64.zip`, sha256: 'de54d0d78f2c3e5aa2104ec688c458e85ac4cbc770feff24015df4ba7d027837', bin: 'mf6.exe' },
  'linux-x64': { zip: `mf${VERSION}_linux.zip`, sha256: '439a29f3e60f8e88b0ac083db10c92e3474b203d18ca6583863d8464b811ba90', bin: 'mf6' },
};
const targets = process.argv.slice(2).length ? process.argv.slice(2) : [`${process.platform}-${process.arch}`];
for (const t of targets) {
  const b = BUILDS[t]; if (!b) { console.error(`No MODFLOW 6 build for ${t}`); process.exitCode = 1; continue; }
  const out = join('resources', 'mf6', t, b.bin);
  if (existsSync(out)) { console.log(`${out} already present`); continue; }
  const url = `https://github.com/MODFLOW-ORG/modflow6/releases/download/${VERSION}/${b.zip}`;
  console.log(`Downloading ${url}`);
  const res = await fetch(url); if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer()), sum = createHash('sha256').update(buf).digest('hex');
  if (sum !== b.sha256) throw new Error(`${b.zip}: checksum ${sum} does not match the release's ${b.sha256}`);
  const dir = join(tmpdir(), `mf6-${t}-${Date.now()}`); mkdirSync(dir, { recursive: true });
  const zip = join(dir, b.zip); writeFileSync(zip, buf);
  const member = `${b.zip.replace('.zip', '')}/bin/${b.bin}`;
  // bsdtar (macOS, Windows 10+) reads zip files; on Windows name it outright, as Git's GNU tar is often first on the PATH and cannot
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-xf', zip, '-C', dir, member]);
  mkdirSync(join('resources', 'mf6', t), { recursive: true }); copyFileSync(join(dir, member), out); if (!b.bin.endsWith('.exe')) chmodSync(out, 0o755);
  rmSync(dir, { recursive: true, force: true });
  console.log(`MODFLOW 6 ${VERSION} for ${t} -> ${out}`);
}
