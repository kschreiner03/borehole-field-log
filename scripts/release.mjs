// Publishes an update: builds this computer's installer and puts it on the GitHub release for this version, where the app's
// update check and the download page (docs/) find it. Run on the Mac for the signed, notarized .dmg and on Windows for the setup .exe.
//
//   npm run release -- 0.2.0 --notes "What is new"   new version: sets it, commits and pushes, builds, creates the release
//   npm run release -- 0.2.0 --notes-file notes.md   the same, notes from a file (a line starting "- " is a bullet)
//   npm run release                                   this version again: builds and adds this computer's installer
//   add --dry to see what it would do; --no-build publishes the installer already in dist/ (the one you tested)
//
// Needs the GitHub CLI (gh), signed in, and main in step with GitHub, so both computers release the same code.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newer, withChecksum, HUB } from '../src/main/updates.mjs';

const args = process.argv.slice(2), flag = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const dry = args.includes('--dry'), noBuild = args.includes('--no-build'), want = args.find(a => /^v?\d+\.\d+\.\d+/.test(a))?.replace(/^v/, '');
const notesArg = flag('--notes') ?? (flag('--notes-file') ? readFileSync(flag('--notes-file'), 'utf8') : undefined);
const stop = msg => { console.error(`\n${msg}\n`); process.exit(1); };
const out = (cmd, a) => execFileSync(cmd, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' }).trim();
const run = (cmd, a, env) => { console.log(`\n> ${cmd} ${a.join(' ')}`); if (!dry) execFileSync(cmd, a, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } }); };
const pkg = () => JSON.parse(readFileSync('package.json', 'utf8'));

// 1. ready: GitHub CLI signed in; on main, nothing uncommitted, the same as GitHub
try { out('gh', ['auth', 'status']); } catch { stop('The GitHub CLI (gh) is needed and must be signed in: install it from https://cli.github.com, then run "gh auth login".'); }
if (out('git', ['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') stop('Switch to main first (git checkout main).');
if (out('git', ['status', '--porcelain'])) stop('Commit or put aside your changes first: a release is built from what is on GitHub.');
out('git', ['fetch', 'origin', 'main']);
if (out('git', ['rev-parse', 'HEAD']) !== out('git', ['rev-parse', 'origin/main'])) stop('main is not the same as on GitHub. Pull (git pull) and push (git push) first, so both computers release the same code.');

// 2. a new version: set it, commit and push
let version = pkg().version;
if (want && want !== version) {
  if (!newer(want, version)) stop(`${want} is not newer than ${version}.`);
  if (!notesArg) stop('A new version needs its notes: --notes "What is new" or --notes-file notes.md');
  run('npm', ['version', want, '--no-git-tag-version']);
  run('git', ['commit', '-am', `Version ${want}`]);
  run('git', ['push', 'origin', 'main']);
  version = want;
}
const tag = `v${version}`;
let existing = null;
try { existing = JSON.parse(out('gh', ['release', 'view', tag, '--json', 'body,assets'])); } catch { /* not released yet */ }
if (!existing && !notesArg) stop(`There is no release ${tag} yet. Give its notes: npm run release -- ${version} --notes "What is new"`);

// 3. build this computer's installer (quick tests first)
const plat = process.platform;
if (plat !== 'darwin' && plat !== 'win32') stop('Releases are built on the Mac (signed and notarized .dmg) and on Windows (setup .exe).');
if (noBuild) console.log('\nUsing the installer already built in dist/.');
else {
  run('npm', ['test']);
  run('npm', ['run', 'typecheck']);
  if (plat === 'darwin') run('npm', ['run', 'package:mac'], { APPLE_KEYCHAIN_PROFILE: process.env.APPLE_KEYCHAIN_PROFILE || 'borehole-notary' });
  else run('npm', ['run', 'package:win']);
}
const name = plat === 'darwin' ? `Borehole-Field-Log-${version}-arm64.dmg` : `Borehole-Field-Log-Setup-${version}.exe`, file = join('dist', name);
if (dry) { console.log(`\nWould ${existing ? 'add' : 'create the release with'} ${name} on ${tag}. Nothing was changed.`); process.exit(0); }
if (!existsSync(file)) stop(`The build finished but ${file} is not there.`);

// 4. publish: the installer, and its checksum in the release notes
const sha = createHash('sha256').update(readFileSync(file)).digest('hex'), notesFile = join(mkdtempSync(join(tmpdir(), 'bfl-')), 'notes.md');
writeFileSync(notesFile, withChecksum(existing ? existing.body : notesArg, name, sha));
if (existing) { run('gh', ['release', 'upload', tag, file, '--clobber']); run('gh', ['release', 'edit', tag, '--notes-file', notesFile]); }
else run('gh', ['release', 'create', tag, file, '--title', `Borehole Field Log ${version}`, '--notes-file', notesFile, '--target', 'main', '--latest']);

const other = plat === 'darwin' ? 'Windows' : 'Mac', otherHas = (existing?.assets || []).some(a => (plat === 'darwin' ? /\.exe$/i : /\.dmg$/i).test(a.name));
console.log(`\nReleased ${name} as ${tag} (SHA-256 ${sha}).\nDownload page: ${HUB}`);
if (!otherHas) console.log(`The ${other} installer is not on this release yet: on the ${other === 'Mac' ? 'Mac' : 'Windows computer'}, pull main and run "npm run release". Until then, only ${plat === 'darwin' ? 'Mac' : 'Windows'} users are told about the update.`);
