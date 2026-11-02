#!/usr/bin/env python3
"""Builds 'Borehole Log.html' — a standalone copy of index.html that runs offline from this folder (uses ./lib)."""
import pathlib, re
here = pathlib.Path(__file__).parent
src = (here / 'index.html').read_text(encoding='utf-8')
src = src.replace('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', 'lib/xlsx.full.min.js')
src = src.replace('https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js', 'lib/exceljs.min.js')
src = src.replace('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'lib/jspdf.umd.min.js')
src = src.replace('https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js', 'lib/geotiff.js')
src = src.replace('https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js', 'lib/three.min.js')
src = src.replace('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'lib/pdf.min.js')
src = src.replace('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js', 'lib/pdf.worker.min.js')
src = src.replace('https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js', 'lib/pdf-lib.min.js')
# integrity checks are for the CDN copies; a page opened from disk cannot verify local files
src = re.sub(r' integrity="sha384-[^"]+" crossorigin="anonymous"', '', src)
left = re.findall(r'https://(?:cdnjs\.|cdn\.jsdelivr\.|fonts\.g)\S+', src)
assert not left, f'the offline build still loads {left}'
head = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<style>body{margin:0}[hidden]{display:none!important}img{max-width:100%}</style>\n</head>\n<body>\n'
(here / 'Borehole Log.html').write_text(head + src + '\n</body>\n</html>\n', encoding='utf-8')
print('wrote', here / 'Borehole Log.html')
# same app and the same saved data, but it opens straight into Quick log (for tablets)
quick = head.replace('<head>\n', '<head>\n<title>Quick Log</title>\n<script>window.QUICK_LOG_ONLY = true;</script>\n', 1)
(here / 'Quick Log.html').write_text(quick + src + '\n</body>\n</html>\n', encoding='utf-8')
print('wrote', here / 'Quick Log.html')
