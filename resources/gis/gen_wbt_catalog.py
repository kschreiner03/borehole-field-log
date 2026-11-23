"""Builds wbt_catalog.json: every WhiteboxTools tool (name, category, description, parameters) as the installed program reports
them. Run with the GIS environment's Python after changing the pinned whitebox_tools version:
    python resources/gis/gen_wbt_catalog.py <path to whitebox_tools.exe>"""
import sys, json, re, subprocess, os
from concurrent.futures import ThreadPoolExecutor

exe = sys.argv[1]
run = lambda *a: subprocess.run([exe, *a], capture_output=True, text=True, encoding='utf-8', errors='replace').stdout
ver = re.search(r'v(\d+\.\d+\.\d+)', run('--version')).group(1)
names = []
for line in run('--listtools').splitlines():
    m = re.match(r'^(\w+): (.*)$', line.strip())
    if m: names.append((m.group(1), m.group(2)))

def one(item):
    name, desc = item
    try: params = json.loads(run('--toolparameters=' + name))['parameters']
    except Exception: params = None
    box = run('--toolbox=' + name).strip().splitlines()
    return {'name': name, 'toolbox': box[0].strip() if box else 'Other', 'desc': desc, 'params': params}

with ThreadPoolExecutor(8) as ex: tools = list(ex.map(one, names))
bad = [t['name'] for t in tools if t['params'] is None]
out = {'version': ver, 'tools': [t for t in tools if t['params'] is not None]}
here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, 'wbt_catalog.json'), 'w', encoding='utf-8') as f: json.dump(out, f, separators=(',', ':'))
print('WhiteboxTools %s: %d tools written, %d without parameters %s' % (ver, len(out['tools']), len(bad), bad[:10]))
