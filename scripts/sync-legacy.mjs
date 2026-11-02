// Copies the current single-file app (the classic interface) and its offline libraries into resources/legacy.
// Source: app/ in this project, or the folder in LEGACY_SRC. Run before dev and build.
// The online library links become the bundled copies in lib/ (the same rewrite as app/build-local.py, without needing Python).
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const src = resolve(process.env.LEGACY_SRC || 'app'), out = resolve('resources/legacy');
if (!existsSync(join(src, 'index.html'))) { console.error(`Classic interface not found in ${src}. Set LEGACY_SRC.`); process.exit(1); }
const LIBS = {
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js': 'lib/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js': 'lib/exceljs.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js': 'lib/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js': 'lib/geotiff.js',
  'https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js': 'lib/three.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js': 'lib/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js': 'lib/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js': 'lib/pdf-lib.min.js',
};
let html = readFileSync(join(src, 'index.html'), 'utf8');
for (const [url, local] of Object.entries(LIBS)) html = html.split(url).join(local);
// integrity checks are for the CDN copies; a page opened from disk cannot verify local files
html = html.replace(/ integrity="sha384-[^"]+" crossorigin="anonymous"/g, '');
const left = html.match(/https:\/\/(?:cdnjs\.|cdn\.jsdelivr\.|fonts\.g)\S+/g);
if (left) { console.error('the offline build still loads', left); process.exit(1); }
const head = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<style>body{margin:0}[hidden]{display:none!important}img{max-width:100%}</style>\n</head>\n<body>\n';
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'index.html'), head + html + '\n</body>\n</html>\n');
cpSync(join(src, 'lib'), join(out, 'lib'), { recursive: true });
console.log('classic interface copied to', out);
