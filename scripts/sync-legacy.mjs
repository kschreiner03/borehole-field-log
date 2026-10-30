// Copies the current single-file app (the classic interface) and its offline libraries into resources/legacy.
// Source: ../borehole-log, or the folder in LEGACY_SRC. Run before dev and build.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const src = resolve(process.env.LEGACY_SRC || '../borehole-log'), out = resolve('resources/legacy');
if (!existsSync(join(src, 'index.html'))) { console.error(`Classic interface not found in ${src}. Set LEGACY_SRC.`); process.exit(1); }
execFileSync('python3', [join(src, 'build-local.py')], { stdio: 'inherit' });
mkdirSync(out, { recursive: true });
cpSync(join(src, 'Borehole Log.html'), join(out, 'index.html'));
cpSync(join(src, 'lib'), join(out, 'lib'), { recursive: true });
console.log('classic interface copied to', out);
