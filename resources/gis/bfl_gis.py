"""Borehole Field Log: runs real GIS tools on one job and returns the result.

Called by the desktop app as  python bfl_gis.py job.json result.json  inside the optional "GIS engines" environment
(conda-forge: GDAL, GRASS GIS, PyKrige, GSTools). The app never builds a command line: it writes a job file naming one
of the methods below, with the points and the grid to fill, and reads the result file back.

Every method is the library's own implementation, called with its documented options:
  GDAL       gdal.Grid (gdal_grid): invdist, invdistnn, average, nearest, linear; gdal.ContourGenerate (gdal_contour)
  GRASS GIS  v.surf.rst, v.surf.bspline, v.surf.idw (2D); v.vol.rst (3D); their own cross-validation (-c)
  PyKrige    OrdinaryKriging, UniversalKriging, OrdinaryKriging3D
  GSTools    vario_estimate + fit_variogram, krige.Ordinary (2D and 3D)
Values come in as log10 (the app interpolates concentrations on a log scale) and go back the same way.
"""
import json, math, os, sys, subprocess, tempfile, shutil, base64

def versions():
    out = {}
    try:
        from osgeo import gdal; out['gdal'] = gdal.__version__
    except Exception as e: out['gdal_error'] = str(e)
    for m in ('pykrige', 'gstools', 'numpy', 'scipy'):
        try: out[m] = __import__(m).__version__
        except Exception as e: out[m + '_error'] = str(e)
    g = grass_exe()
    if g:
        try:
            r = subprocess.run([g, '--version'], capture_output=True, text=True, timeout=60)
            line = (r.stdout + r.stderr).strip().splitlines()
            out['grass'] = next((l.split()[1] for l in line if l.startswith('GRASS ') and len(l.split()) > 1), '') or (line[0] if line else '')
        except Exception as e: out['grass_error'] = str(e)
    else: out['grass_error'] = 'GRASS GIS is not in this environment.'
    out['python'] = sys.version.split()[0]
    return out

def grass_exe():
    pre = sys.prefix
    for c in (os.path.join(pre, 'Library', 'bin', 'grass.bat'), os.path.join(pre, 'Library', 'bin', 'grass'), os.path.join(pre, 'Scripts', 'grass.bat'), os.path.join(pre, 'bin', 'grass')):
        if os.path.exists(c): return c
    return shutil.which('grass')

# ---------- helpers ----------
def prog(p, msg=None):
    """a progress line for the app's progress bar (the share done, 0 to 1, and what is happening)"""
    d = {'p': round(max(0.0, min(1.0, p)), 4)}
    if msg: d['msg'] = msg
    print('@@' + json.dumps(d), flush=True)

def grid_axes(job):
    x0, y0, x1, y1 = job['box']; nx, ny = int(job['nx']), int(job['ny'])
    dx, dy = (x1 - x0) / nx, (y1 - y0) / ny
    xs = [x0 + dx * (i + .5) for i in range(nx)]; ys = [y1 - dy * (j + .5) for j in range(ny)]   # row 0 is north
    return xs, ys, dx, dy, nx, ny

def as_list(a):
    import numpy as np
    a = np.asarray(a, dtype=float)
    return [None if not math.isfinite(v) else round(float(v), 6) for v in a.ravel()]

def loo_rmse(P, fit_pred, report=None):
    """leave-one-out: each point predicted from the others with the same method and settings"""
    se, n = 0.0, 0
    for i in range(len(P)):
        if report: report(i, len(P))
        rest = P[:i] + P[i + 1:]
        try: v = fit_pred(rest, P[i])
        except Exception: return None
        if v is None or not math.isfinite(v): return None
        se += (v - P[i][-1]) ** 2; n += 1
    return math.sqrt(se / n) if n else None

# ---------- GDAL ----------
GDAL_ALG = {
    'gdal_invdist': 'invdist:power={power}:smoothing={smoothing}',
    'gdal_invdistnn': 'invdistnn:power={power}:smoothing={smoothing}:radius={radius}:max_points={max_points}',
    'gdal_average': 'average:radius1={radius}:radius2={radius}:min_points=1',
    'gdal_nearest': 'nearest:radius1={radius}:radius2={radius}',
    'gdal_linear': 'linear:radius=-1',
}
GDAL_DEF = {'power': 2.0, 'smoothing': 0.0, 'radius': 0.0, 'max_points': 12}

def gdal_points_ds(P):
    from osgeo import gdal
    fc = {'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {'v': p[-1]}, 'geometry': {'type': 'Point', 'coordinates': [p[0], p[1]]}} for p in P]}
    name = '/vsimem/bfl_pts_%d.geojson' % id(P)
    gdal.FileFromMemBuffer(name, json.dumps(fc).encode())
    return name

def gdal_grid(P, method, prm, box, nx, ny):
    from osgeo import gdal
    gdal.UseExceptions()
    o = {**GDAL_DEF, **{k: v for k, v in prm.items() if k in GDAL_DEF}}
    if not o['radius'] and method in ('gdal_invdistnn', 'gdal_average'):   # every reading within reach: from the readings' own extent, not the grid's
        xs_, ys_ = [p[0] for p in P], [p[1] for p in P]; o['radius'] = 2 * math.hypot(max(xs_) - min(xs_), max(ys_) - min(ys_)) + 1
    alg = GDAL_ALG[method].format(**o)
    src = gdal_points_ds(P)
    x0, y0, x1, y1 = box
    out = gdal.Grid('/vsimem/bfl_grid.tif', src, format='GTiff', outputType=gdal.GDT_Float64, width=nx, height=ny,
                    outputBounds=[x0, y1, x1, y0], zfield='v', algorithm=alg)
    arr = out.GetRasterBand(1).ReadAsArray(); nd = out.GetRasterBand(1).GetNoDataValue()
    out = None; gdal.Unlink('/vsimem/bfl_grid.tif'); gdal.Unlink(src)
    import numpy as np
    arr = arr.astype(float)
    if nd is not None: arr[arr == nd] = np.nan
    return arr, alg

def gdal_surface(job):
    P, m, prm = job['pts'], job['method'], job.get('params', {})
    xs, ys, dx, dy, nx, ny = grid_axes(job)
    prog(0.05, 'gdal_grid: %d points onto %d × %d cells' % (len(P), nx, ny))
    arr, alg = gdal_grid(P, m, prm, job['box'], nx, ny)
    prog(0.3, 'Grid made; checking it: each point left out in turn')
    def pred(rest, p):   # a one-cell grid on the point itself, from the others
        a, _ = gdal_grid(rest, m, prm, [p[0] - .5, p[1] - .5, p[0] + .5, p[1] + .5], 1, 1); return float(a[0, 0])
    from osgeo import gdal
    loo = loo_rmse(P, pred, lambda i, n: prog(0.3 + 0.65 * i / n, 'Leave-one-out %d of %d' % (i + 1, n)))
    prog(0.98, 'Writing the result')
    return {'values': as_list(arr), 'loo': loo, 'tool': 'GDAL %s gdal_grid' % gdal.__version__, 'detail': '-a ' + alg}

# ---------- PyKrige ----------
VARIO = ('spherical', 'exponential', 'gaussian')

def vario_grid(A, dim):
    """candidate variograms for PyKrige: each model at ranges from the typical spacing to the site's size, nugget 0-30 %
    of the sill (the sample variance); the one whose kriging best predicts each point from the others is used"""
    import numpy as np
    from scipy.spatial.distance import pdist
    D = pdist(A[:, :dim]); D = D[D > 0]
    if not len(D): return []
    nn, big = float(np.percentile(D, 10)), float(D.max())
    sill = float(np.var(A[:, dim])) or 1.0
    ranges = [float(r) for r in np.geomspace(max(nn, big / 50), big * 1.5, 6)]
    return [(m, {'sill': sill, 'range': r, 'nugget': nf * sill}) for m in VARIO for r in ranges for nf in (0.0, 0.1, 0.3)]

def pykrige_best(P, make, predict, dim, prm):
    import numpy as np
    A = np.array(P, float); cands = vario_grid(A, dim)
    if prm.get('model') in VARIO: cands = [c for c in cands if c[0] == prm['model']]
    elif prm.get('models'): cands = [c for c in cands if c[0] in prm['models']]
    if len(P) > 80 or prm.get('coarse'): cands = cands[::3]   # many points (or a block model): a coarser search keeps it quick
    best = None
    for c, (model, vp) in enumerate(cands):
        prog(0.05 + 0.85 * c / len(cands), 'Variogram %d of %d: %s, range %.3g m (each point left out in turn)' % (c + 1, len(cands), model, vp['range']))
        def pred(rest, p): r = np.array(rest, float); return predict(make(r, model, vp), p)
        e = loo_rmse(P, pred)
        if e is not None and (best is None or e < best[2]): best = (model, vp, e)
    if not best: raise RuntimeError('PyKrige could not fit a variogram to these points.')
    return best, len(cands)

def pykrige_surface(job):
    import numpy as np, pykrige
    from pykrige.ok import OrdinaryKriging
    from pykrige.uk import UniversalKriging
    P, m, prm = job['pts'], job['method'], job.get('params', {})
    xs, ys, dx, dy, nx, ny = grid_axes(job)
    def make(r, model, vp):
        if m == 'pykrige_uk': return UniversalKriging(r[:, 0], r[:, 1], r[:, 2], variogram_model=model, variogram_parameters=vp, drift_terms=['regional_linear'])
        return OrdinaryKriging(r[:, 0], r[:, 1], r[:, 2], variogram_model=model, variogram_parameters=vp)
    def predict(k, p): z, _ = k.execute('points', np.array([p[0]], float), np.array([p[1]], float)); return float(np.asarray(z)[0])
    (model, vp, e), n = pykrige_best(P, make, predict, 2, prm)
    prog(0.92, 'Kriging the grid with the %s variogram' % model)
    k = make(np.array(P, float), model, vp); z, ss = k.execute('grid', np.array(xs, float), np.array(ys[::-1], float))
    z, ss = np.asarray(z)[::-1], np.asarray(ss)[::-1]
    return {'values': as_list(z), 'var': as_list(ss), 'loo': e, 'loo_by': 'leave-one-out', 'sill': vp['sill'],
            'tool': 'PyKrige %s %s' % (pykrige.__version__, 'UniversalKriging (linear drift)' if m == 'pykrige_uk' else 'OrdinaryKriging'),
            'detail': '%s variogram, range %.3g m, nugget %d %% (the best of %d variograms by leave-one-out)' % (model, vp['range'], round(100 * vp['nugget'] / vp['sill']), n)}

def pykrige_points3d(job):
    import numpy as np, pykrige
    from pykrige.ok3d import OrdinaryKriging3D
    P, T, prm = job['pts'], job['targets'], job.get('params', {})
    def make(r, model, vp): return OrdinaryKriging3D(r[:, 0], r[:, 1], r[:, 2], r[:, 3], variogram_model=model, variogram_parameters=vp)
    def predict(k, p): z, _ = k.execute('points', np.array([p[0]], float), np.array([p[1]], float), np.array([p[2]], float)); return float(np.asarray(z)[0])
    (model, vp, e), n = pykrige_best(P, make, predict, 3, prm)
    prog(0.92, 'Kriging %d section points with the %s variogram' % (len(T), model))
    Tt = np.array(T, float); k = make(np.array(P, float), model, vp); z, ss = k.execute('points', Tt[:, 0], Tt[:, 1], Tt[:, 2])
    return {'values': as_list(z), 'var': as_list(ss), 'loo': e, 'loo_by': 'leave-one-out', 'sill': vp['sill'],
            'tool': 'PyKrige %s OrdinaryKriging3D' % pykrige.__version__,
            'detail': '%s variogram, range %.3g m (layered), nugget %d %% (the best of %d variograms by leave-one-out)' % (model, vp['range'], round(100 * vp['nugget'] / vp['sill']), n)}

# ---------- GSTools ----------
def gstools_fit(pos, val, dim):
    import numpy as np, gstools as gs
    bins = gs.standard_bins(pos, dim=dim, bin_no=8) if hasattr(gs, 'standard_bins') else None
    bc, gam = gs.vario_estimate(pos, val, bins) if bins is not None else gs.vario_estimate(pos, val)
    best = None
    for M in (gs.Exponential, gs.Spherical, gs.Gaussian):
        mod = M(dim=dim)
        try: _, _, r2 = mod.fit_variogram(bc, gam, nugget=True, return_r2=True)
        except Exception: continue
        if best is None or r2 > best[1]: best = (mod, r2)
    if not best: raise RuntimeError('GSTools could not fit a variogram to these points.')
    return best

def gstools_krige(P, targets, dim):
    import numpy as np, gstools as gs
    A = np.array(P, float); pos = [A[:, i] for i in range(dim)]; val = A[:, dim]
    mod, r2 = gstools_fit(pos, val, dim)
    k = gs.krige.Ordinary(mod, cond_pos=pos, cond_val=val)
    T = np.array(targets, float); fld, var = k([T[:, i] for i in range(dim)], return_var=True)
    return fld, var, mod, r2

def gstools_job(job, dim):
    import numpy as np, gstools as gs
    P = job['pts']
    if dim == 2:
        xs, ys, dx, dy, nx, ny = grid_axes(job); T = [[x, y] for y in ys for x in xs]
    else: T = job['targets']
    prog(0.05, 'Fitting the variogram (GSTools vario_estimate, fit_variogram)')
    fld, var, mod, r2 = gstools_krige(P, T, dim)
    prog(0.3, 'Kriged with a %s variogram; checking it: each point left out in turn' % type(mod).__name__)
    def pred(rest, p): f, _, _, _ = gstools_krige(rest, [p[:dim]], dim); return float(f[0])
    loo = loo_rmse(P, pred, lambda i, n: prog(0.3 + 0.65 * i / n, 'Leave-one-out %d of %d' % (i + 1, n)))
    return {'values': as_list(fld), 'var': as_list(var), 'loo': loo, 'sill': float(mod.sill) or 1.0,
            'tool': 'GSTools %s krige.Ordinary%s' % (gs.__version__, ' (3D)' if dim == 3 else ''),
            'detail': '%s variogram fitted to the experimental variogram (r² %.2f): variance %.4g, length scale %.4g, nugget %.4g' % (type(mod).__name__, r2, mod.var, mod.len_scale, mod.nugget)}

# ---------- GRASS GIS (run inside a temporary GRASS project) ----------
def grass_run(job):
    """re-run this script inside GRASS: grass --tmp-project XY --exec python bfl_gis.py --in-grass job result"""
    g = grass_exe()
    if not g: raise RuntimeError('GRASS GIS is not installed in the GIS engines.')
    tmp = tempfile.mkdtemp(prefix='bfl-grass-')
    try:
        jf, rf = os.path.join(tmp, 'job.json'), os.path.join(tmp, 'res.json')
        with open(jf, 'w') as f: json.dump(job, f)
        prog(0.02, 'Starting GRASS GIS in a temporary project')
        pr = subprocess.Popen([g, '--tmp-project', 'XY', '--exec', sys.executable, os.path.abspath(__file__), '--in-grass', jf, rf], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors='replace')
        out = []
        for line in pr.stdout:
            if line.startswith('@@'): print(line.rstrip(), flush=True)
            else: out.append(line)
        pr.wait(timeout=int(job.get('timeout', 600)))
        class R: stdout = ''.join(out)[-20000:]; stderr = ''
        r = R()
        if not os.path.exists(rf): raise RuntimeError('GRASS GIS stopped: ' + r.stdout[-1500:])
        with open(rf) as f: res = json.load(f)
        if not res.get('ok', True) and 'db_open_database' in (r.stdout + r.stderr):
            raise RuntimeError('This GRASS tool needs GRASS\'s attribute database, which does not open in the Windows build of GRASS 8.5 from conda-forge. v.surf.rst and v.surf.idw work without it; for 3D, use PyKrige or GSTools.')
        return res
    finally: shutil.rmtree(tmp, ignore_errors=True)

def in_grass_hydro(job, gs, tmp):
    """groundwater tools on a water-table surface made with v.surf.rst; no attribute database is used"""
    m, P, prm = job['method'], job['pts'], job.get('params', {})
    xs, ys, dx, dy, nx, ny = grid_axes(job); x0, y0, x1, y1 = job['box']
    ver = gs.version().get('version', '')
    gs.run_command('g.region', w=x0, e=x1, s=y0, n=y1, cols=nx, rows=ny, quiet=True)
    ten, smo = float(prm.get('tension', 40)), float(prm.get('smooth', 0.1))
    def surf(points, name, what):
        f = os.path.join(tmp, name + '.csv')
        with open(f, 'w') as fh:
            for p in points: fh.write('%.6f,%.6f,%.6f\n' % (p[0], p[1], p[2]))
        prog(0.15 if name == 'h' else 0.4, 'v.surf.rst: the %s from %d points' % (what, len(points)))
        gs.run_command('v.in.ascii', input=f, output=name, separator='comma', x=1, y=2, z=3, flags='zt', overwrite=True, quiet=True)
        gs.run_command('v.surf.rst', input=name, elevation=name + '_r', tension=ten, smooth=smo, overwrite=True, quiet=True)
    def read(r):
        return [None if t in ('nan', '*') else float(t) for t in gs.read_command('r.out.ascii', input=r, null_value='nan', flags='h', precision=8).split()]
    if m == 'terrain':
        surf(P, 'h', 'ground surface')
        prog(0.5, 'r.out.gdal: the surface to GDAL for hillshade, slope and contours')
        tif = os.path.join(tmp, 'ground.tif')
        gs.run_command('r.out.gdal', input='h_r', output=tif, format='GTiff', type='Float32', flags='c', overwrite=True, quiet=True)
        from osgeo import gdal
        gdal.UseExceptions(); ds = gdal.Open(tif); out = terrain_products(ds, ds.GetRasterBand(1), prm); ds = None
        return {**out, 'tool': 'GRASS GIS %s v.surf.rst; GDAL %s gdaldem, gdal_contour' % (ver, gdal.__version__), 'detail': 'ground surface from %d points, ' % len(P) + 'v.surf.rst (tension %g, smoothing %g)' % (ten, smo)}
    surf(P, 'h', 'water table')
    base = 'v.surf.rst (tension %g, smoothing %g)' % (ten, smo)
    if m == 'gw_gradient':
        prog(0.6, 'r.slope.aspect: gradient and the direction it falls')
        # -n: aspect as a compass bearing (0 = north, clockwise); the aspect of a surface is the way it faces, i.e. downhill
        gs.run_command('r.slope.aspect', elevation='h_r', slope='sl', aspect='asp', format='percent', flags='n', overwrite=True, quiet=True)
        prog(0.9, 'Reading the grids')
        return {'head': read('h_r'), 'slope': read('sl'), 'aspect': read('asp'), 'tool': 'GRASS GIS %s r.slope.aspect' % ver, 'detail': 'on the water table from ' + base}
    if m == 'gw_drain':
        sx, sy = job['start']
        prog(0.6, 'r.drain: steepest descent on the water table from %.1f E, %.1f N' % (sx, sy))
        src, filled = 'h_r', ''
        if str(prm.get('up', 'no')) == 'yes':   # upgradient: the same steepest descent on the water table turned upside down
            gs.run_command('r.mapcalc', expression='hu = -h_r', overwrite=True, quiet=True); src = 'hu'
        if str(prm.get('fill', 'yes')) != 'no':   # small hollows in the surface would stop the path: r.fill.dir fills them first
            prog(0.5, 'r.fill.dir: filling local lows in the water table so the path is not trapped')
            gs.run_command('r.fill.dir', input=src, output='h_f', direction='h_dir', overwrite=True, quiet=True); src, filled = 'h_f', ', local lows filled (r.fill.dir)'
        gs.run_command('r.drain', input=src, output='path', start_coordinates='%.6f,%.6f' % (sx, sy), flags='n', overwrite=True, quiet=True)
        cells = []
        for line in gs.read_command('r.out.xyz', input='path', separator=',').strip().splitlines():
            x, y, n = (float(v) for v in line.split(',')[:3]); cells.append((n, x, y))
        cells.sort()
        prog(0.85, 'Heads along the path (r.what)')
        pts = [[c[1], c[2]] for c in cells]
        heads = []
        for i in range(0, len(pts), 200):
            chunk = pts[i:i + 200]
            out = gs.read_command('r.what', map='h_r', coordinates=','.join('%.6f,%.6f' % (a, b) for a, b in chunk), null_value='nan')
            heads += [float(l.split('|')[-1]) if l.split('|')[-1] not in ('nan', '*') else None for l in out.strip().splitlines()]
        return {'path': pts, 'heads': heads, 'tool': 'GRASS GIS %s r.drain' % ver, 'detail': 'steepest descent on the water table from ' + base + filled}
    if m == 'gw_change':
        surf(job['pts2'], 'g', 'later water table')
        prog(0.7, 'r.mapcalc: change = later minus earlier water table')
        gs.run_command('r.mapcalc', expression='d = g_r - h_r', overwrite=True, quiet=True)
        return {'values': read('d'), 'tool': 'GRASS GIS %s r.mapcalc' % ver, 'detail': 'each round of water levels made into a surface with ' + base}
    if m == 'gw_depth':
        surf(job['ground'], 'g', 'ground surface')
        prog(0.7, 'r.mapcalc: depth = ground surface − water table')
        gs.run_command('r.mapcalc', expression='d = g_r - h_r', overwrite=True, quiet=True)
        prog(0.9, 'Reading the grid')
        return {'values': read('d'), 'head': read('h_r'), 'tool': 'GRASS GIS %s r.mapcalc' % ver, 'detail': 'ground surface and water table each from ' + base}
    raise RuntimeError('Unknown groundwater tool ' + m)

def in_grass_demfix(job, gs, tmp):
    """fix bad spots in an elevation grid: spikes and pits against the local median (GRASS r.neighbors, a robust MAD test),
    spots the user marked, holes in the data; refilled from the good ground around them (GDAL FillNodata); optionally false
    depressions filled (GRASS r.fill.dir) and light smoothing (r.neighbors average). Codes: 1 spike, 2 pit, 3 hole, 4 sink, 5 marked"""
    import numpy as np
    from osgeo import gdal
    gdal.UseExceptions()
    prm = job.get('params', {}); nx, ny = int(job['nx']), int(job['ny']); x0, y0, x1, y1 = job['box']; dx, dy = (x1 - x0) / nx, (y1 - y0) / ny
    ver = gs.version().get('version', '')
    a = np.frombuffer(base64.b64decode(job['values_b64']), dtype='<f4').astype(float).reshape(ny, nx)
    def write(arr, name):
        f = os.path.join(tmp, name + '.tif'); ds = gdal.GetDriverByName('GTiff').Create(f, nx, ny, 1, gdal.GDT_Float32)
        ds.SetGeoTransform([x0, dx, 0, y1, 0, -dy]); b = ds.GetRasterBand(1); b.SetNoDataValue(-99999); b.WriteArray(np.where(np.isfinite(arr), arr, -99999)); ds = None; return f
    def to_grass(arr, name): gs.run_command('r.in.gdal', input=write(arr, name), output=name, flags='o', overwrite=True, quiet=True)
    def read(name):
        f = os.path.join(tmp, name + '_out.tif'); gs.run_command('r.out.gdal', input=name, output=f, format='GTiff', type='Float32', flags='cf', nodata=-99999, overwrite=True, quiet=True)
        ds = gdal.Open(f); r = ds.GetRasterBand(1).ReadAsArray().astype(float); ds = None; r[r <= -99998] = np.nan; return r
    prog(0.05, 'r.in.gdal: the elevation grid into GRASS, %d × %d cells' % (nx, ny))
    to_grass(a, 'z'); gs.run_command('g.region', raster='z', quiet=True)
    code = np.zeros((ny, nx), np.uint8); notes = []
    win = int(prm.get('window', 5)); win += (win + 1) % 2
    if str(prm.get('spikes', 'yes')) != 'no':
        prog(0.15, 'r.neighbors: the median of every %d × %d window' % (win, win))
        gs.run_command('r.neighbors', input='z', output='med', method='median', size=win, overwrite=True, quiet=True)
        gs.run_command('r.mapcalc', expression='dev = z - med', overwrite=True, quiet=True)
        gs.run_command('r.mapcalc', expression='adev = abs(dev)', overwrite=True, quiet=True)
        prog(0.3, 'r.neighbors: the local variation (median absolute deviation)')
        gs.run_command('r.neighbors', input='adev', output='mad', method='median', size=max(win, 7) + (max(win, 7) + 1) % 2, overwrite=True, quiet=True)
        dev, mad = read('dev'), read('mad')
        k = {'low': 8.0, 'medium': 5.0, 'high': 3.5}.get(str(prm.get('sense', 'medium')), 5.0)
        floor = float(prm.get('height') or 0) or 0.2
        lim = np.maximum(floor, k * 1.4826 * np.nan_to_num(mad))
        ok = np.isfinite(a) & np.isfinite(dev)
        code[ok & (dev > lim)] = 1; code[ok & (dev < -lim)] = 2
        notes.append('spikes and pits: more than %.2f m, or %g× the local variation, from the median of %d × %d cells' % (floor, k, win, win))
    for sx, sy, sr in job.get('spots') or []:   # spots marked on the map
        X, Y = np.meshgrid(x0 + dx * (np.arange(nx) + .5), y1 - dy * (np.arange(ny) + .5))
        code[(np.hypot(X - sx, Y - sy) <= sr) & np.isfinite(a)] = 5
    b = a.copy(); b[(code == 1) | (code == 2) | (code == 5)] = np.nan
    holes0 = ~np.isfinite(a)
    # only holes inside the data are filled: no-data that reaches the edge of the grid is where the file stops, not a gap in it
    from scipy import ndimage
    labs, nl = ndimage.label(holes0)
    edge = set(np.unique(np.concatenate([labs[0, :], labs[-1, :], labs[:, 0], labs[:, -1]]))) - {0}
    outside = np.isin(labs, list(edge)) if edge else np.zeros(holes0.shape, bool)
    holes0 = holes0 & ~outside
    fill = str(prm.get('holes', 'yes')) != 'no'
    prog(0.5, 'GDAL FillNodata: refilling %d cells from the ground around them' % int(np.isnan(b).sum() - (0 if fill else holes0.sum())))
    ds = gdal.GetDriverByName('MEM').Create('', nx, ny, 1, gdal.GDT_Float32); ds.SetGeoTransform([x0, dx, 0, y1, 0, -dy]); bd = ds.GetRasterBand(1); bd.SetNoDataValue(-99999)
    bd.WriteArray(np.where(np.isfinite(b), b, -99999))
    maxd = float(prm.get('maxfill') or 0) or max(10, round(max(nx, ny) / 10))
    gdal.FillNodata(targetBand=bd, maskBand=None, maxSearchDist=maxd, smoothingIterations=int(prm.get('smoothit', 1)))
    c = bd.ReadAsArray().astype(float); c[c <= -99998] = np.nan
    if not fill: c[holes0] = np.nan
    c[outside] = np.nan   # beyond the file stays empty
    code[holes0 & np.isfinite(c)] = 3
    still = (np.isnan(c) & ((code == 1) | (code == 2) | (code == 5)))
    if still.any(): c[still] = a[still]; code[still] = 0; notes.append('%d flagged cells were too far from good ground to refill and were left' % int(still.sum()))
    if str(prm.get('sinks', 'no')) == 'yes':
        prog(0.7, 'r.fill.dir: filling false depressions')
        to_grass(c, 'c1'); gs.run_command('r.fill.dir', input='c1', output='c2', direction='cdir', overwrite=True, quiet=True)
        c2 = read('c2'); ch = np.isfinite(c2) & np.isfinite(c) & (c2 - c > 1e-4); code[ch & (code == 0)] = 4; c = np.where(np.isfinite(c2), c2, c)
    sm = int(prm.get('smooth', 0) or 0)
    if sm in (3, 5, 7):
        prog(0.78, 'r.neighbors: light smoothing (average of %d × %d)' % (sm, sm))
        to_grass(c, 'c3'); gs.run_command('r.neighbors', input='c3', output='c4', method='average', size=sm, overwrite=True, quiet=True)
        c4 = read('c4'); c = np.where(np.isfinite(c4) & np.isfinite(c), c4, c); notes.append('smoothed with a %d × %d average' % (sm, sm))
    ds2 = gdal.GetDriverByName('MEM').Create('', nx, ny, 1, gdal.GDT_Float32); ds2.SetGeoTransform([x0, dx, 0, y1, 0, -dy]); b2 = ds2.GetRasterBand(1); b2.SetNoDataValue(-99999); b2.WriteArray(np.where(np.isfinite(c), c, -99999))
    out = terrain_products(ds2, b2, prm)
    both = np.isfinite(a) & np.isfinite(c); chg = np.abs(c - a)[both]
    cnt = {k: int((code == v).sum()) for k, v in (('spikes', 1), ('pits', 2), ('holes', 3), ('sinks', 4), ('marked', 5))}
    return {**out, 'code_b64': b64u8(code), 'counts': cnt, 'cell_area': dx * dy, 'maxchange': float(chg.max()) if chg.size else 0.0, 'notes': notes,
            'tool': 'GRASS GIS %s r.neighbors%s; GDAL %s FillNodata, gdaldem' % (ver, ', r.fill.dir' if str(prm.get('sinks', 'no')) == 'yes' else '', gdal.__version__), 'detail': '; '.join(notes)}

# ---------- trees in a surface model ----------
def units_of(job, cx, cy):
    """metres per unit of a layer's x and y, metres per unit of its heights, and whether it is in degrees: from the project's
    coordinate system when the app sends it, else degrees if the numbers look like longitude and latitude"""
    import math
    sr = None
    if job.get('epsg'):
        try: sr = srs_of(job['epsg'])
        except Exception: sr = None
    if sr is not None and sr.IsGeographic() or sr is None and abs(cx) <= 180 and abs(cy) <= 90:
        return 111320.0 * max(.05, math.cos(math.radians(cy))), 110574.0, 1.0, True
    if sr is not None and sr.IsProjected():
        u = sr.GetLinearUnits() or 1.0; return u, u, u, False
    return 1.0, 1.0, 1.0, False

def find_trees(job):
    """trees in a surface model (lidar first returns, a photogrammetry DSM): the bare ground under them, and each tree's top,
    height and crown. 1. ground: a morphological opening (SciPy grey_opening, a disc wider than the widest crown) keeps the ground's
    shape and removes what stands on it; cells more than a threshold above it are vegetation, taken out and refilled from the ground
    around (GDAL FillNodata), then lightly smoothed. 2. canopy height model = surface - ground. 3. treetops: local maxima of the
    smoothed canopy with a window that grows with the tree's height (the variable-window filter of Popescu & Wynne 2004), with a
    crown-width rule for jack pine. 4. crowns: a marker-controlled watershed (SciPy watershed_ift) from the tops down the canopy,
    cut where it falls below half the tree's height; the crown radius is that of a circle of the same area."""
    import numpy as np
    import scipy
    from scipy import ndimage
    from osgeo import gdal
    gdal.UseExceptions()
    prm = job.get('params', {}); nx, ny = int(job['nx']), int(job['ny']); x0, y0, x1, y1 = job['box']; dx, dy = (x1 - x0) / nx, (y1 - y0) / ny
    ux, uy, zf, geo = units_of(job, (x0 + x1) / 2, (y0 + y1) / 2); dxm, dym = dx * ux, dy * uy; cell = (dxm * dym) ** .5; nd = 8 if geo else 3   # metres a cell, each way
    a = np.frombuffer(base64.b64decode(job['values_b64']), dtype='<f4').astype(float).reshape(ny, nx) * zf; fin = np.isfinite(a)
    if not fin.any(): raise RuntimeError('The elevation layer has no values.')
    hmin = float(prm.get('hmin') or 2); gwin = float(prm.get('ground') or 12); notes = []
    if cell > 2.5: notes.append('the cells are %.1f m: single trees need cells of about 1 m or finer, so crowns run together and fewer trees are found' % cell)
    def disc(m):   # a disc m metres across in radius, in cells (an ellipse where the cells are not square, as in degrees)
        ry, rx = max(1, int(round(m / dym))), max(1, int(round(m / dxm))); yy, xx = np.mgrid[-ry:ry + 1, -rx:rx + 1]; return (xx / rx) ** 2 + (yy / ry) ** 2 <= 1
    sig = lambda m, lo: (max(lo, m / dym), max(lo, m / dxm))
    # 1. the bare ground
    prog(0.1, 'SciPy grey_opening: the ground under the trees (a %.0f m disc)' % gwin)
    f = np.where(fin, a, np.nanmax(a))
    op = ndimage.grey_opening(f, footprint=disc(gwin / 2))
    op = ndimage.uniform_filter(op, size=(max(3, int(round(gwin / 2 / dym)) | 1), max(3, int(round(gwin / 2 / dxm)) | 1)))   # the opening's flat steps rounded off
    thr = max(0.3, min(1.0, hmin * 0.4))
    veg = fin & (a - op > thr)
    prog(0.35, 'GDAL FillNodata: refilling %d vegetation cells from the ground around them' % int(veg.sum()))
    ds = gdal.GetDriverByName('MEM').Create('', nx, ny, 1, gdal.GDT_Float32); ds.SetGeoTransform([x0, dx, 0, y1, 0, -dy]); bd = ds.GetRasterBand(1); bd.SetNoDataValue(-99999)
    bd.WriteArray(np.where(fin & ~veg, a, -99999))
    gdal.FillNodata(targetBand=bd, maskBand=None, maxSearchDist=max(10, int(gwin * 2 / cell)), smoothingIterations=2)
    g = bd.ReadAsArray().astype(float); g[g <= -99998] = np.nan; g = np.where(np.isfinite(g), g, op)
    gsm = ndimage.gaussian_filter(g, sigma=sig(1.0, 1))
    g = np.where(veg, np.minimum(gsm, a), np.minimum(g, a)); g[~fin] = np.nan
    # 2. the canopy height model
    chm = np.where(fin, np.maximum(a - np.nan_to_num(g), 0), 0)
    sm = {'fine': 0.35, 'medium': 0.6, 'coarse': 1.0}.get(str(prm.get('separate', 'medium')), 0.6)
    cs = ndimage.gaussian_filter(chm, sigma=sig(sm, .5))
    # 3. treetops: a variable window; jack pine crown width (m) about 1 + 0.17 x height, searched over half of it
    prog(0.55, 'Local maxima of the canopy with a window sized to each tree\'s height')
    cw = lambda h: 1.0 + 0.17 * h
    top = np.zeros(cs.shape, bool)
    if (cs >= hmin).any():
        rc = np.maximum(1, np.rint(cw(cs) / 2 / cell)).astype(int)
        for r in sorted(set(rc[cs >= hmin].tolist())):
            mx = ndimage.maximum_filter(cs, footprint=disc(r * cell))
            top |= (rc == r) & (cs >= hmin) & (cs >= mx - 1e-6)
    # a flat top gives a cluster of equal cells: one tree at its middle
    lab, n = ndimage.label(top, structure=np.ones((3, 3)))
    if n > 200000: raise RuntimeError('More than 200,000 trees: use a smaller area.')
    cen = np.array(ndimage.center_of_mass(top, lab, range(1, n + 1))).reshape(-1, 2)
    tops = np.clip(np.rint(cen).astype(int), 0, [ny - 1, nx - 1]) if n else np.zeros((0, 2), int)
    # 4. crowns: a watershed from the tops down the canopy
    prog(0.75, 'SciPy watershed_ift: each crown from its top (%d trees)' % n)
    trees = []
    if n:
        mk = np.zeros(cs.shape, np.int32); mk[tops[:, 0], tops[:, 1]] = np.arange(1, n + 1)
        low = cs < max(0.5, hmin * 0.5)
        img = np.where(low, 65535, np.clip((cs.max() - cs) / (cs.max() or 1) * 60000, 0, 60000)).astype(np.uint16)   # no background markers: SciPy's IFT lets them flood the crowns; the ground is flooded last and cut off below
        seg = ndimage.watershed_ift(img, mk, structure=np.ones((3, 3), int)); seg = np.where((seg > 0) & ~low, seg, 0)
        hh = ndimage.maximum_filter(chm, size=3)[tops[:, 0], tops[:, 1]].astype(float)   # the height at the top itself
        h_of = np.concatenate([[np.inf], hh])[seg]
        seg2 = np.where((seg > 0) & (cs >= 0.5 * h_of), seg, 0)
        area = np.array(ndimage.sum(np.ones(cs.shape), seg2, range(1, n + 1)), float) * dxm * dym
        for k in range(n):
            r_, c_ = tops[k]; h = float(hh[k])
            if not np.isfinite(h) or h < hmin or not np.isfinite(g[r_, c_]): continue
            rad = float(np.sqrt(max(area[k], cell * cell) / np.pi)); rad = min(max(rad, 0.35 * cw(h) / 2), 1.6 * cw(h) / 2)
            trees.append([round(x0 + dx * (c_ + .5), nd), round(y1 - dy * (r_ + .5), nd), round(float(g[r_, c_]) / zf, 3), round(h / zf, 3), round(rad / ux, nd)])   # back in the layer's units
    prog(0.9, 'gdaldem: hillshade, slope and contours of the bare ground')
    ds2 = gdal.GetDriverByName('MEM').Create('', nx, ny, 1, gdal.GDT_Float32); ds2.SetGeoTransform([x0, dx, 0, y1, 0, -dy]); b2 = ds2.GetRasterBand(1); b2.SetNoDataValue(-99999); b2.WriteArray(np.where(np.isfinite(g), g / zf, -99999))
    out = terrain_products(ds2, b2, prm)
    can = fin & (chm >= hmin)
    return {**out, 'trees': trees, 'veg_cells': int(veg.sum()), 'canopy_area': float(can.sum() * dxm * dym), 'area': float(fin.sum() * dxm * dym), 'cell': cell, 'notes': notes + (['the layer is in latitude and longitude: worked in metres at this latitude' ] if geo else []),
            'tool': 'SciPy %s ndimage (grey_opening, maximum_filter, watershed_ift); GDAL %s FillNodata, gdaldem' % (scipy.__version__, gdal.__version__),
            'detail': 'ground: opening with a %.0f m disc, cells more than %.2f m above it refilled; trees: tops at least %.1f m tall, window from crown width 1 + 0.17 x height (jack pine)' % (gwin, thr, hmin)}

def ortho_trees(job):
    """tree crowns in an orthophoto, and the trees lined up with them. Crowns: the excess-green index on chromatic coordinates
    ((2G - R - B) / (R + G + B)), smoothed, split from the ground at Otsu's threshold, opened and cleaned of specks; crowns that touch
    are separated by a marker-controlled watershed (SciPy watershed_ift) on the smoothed distance to the crown's edge. The markers are
    the trees already found (each snapped to the nearest crown pixel), so each tree claims its own crown, plus the photo's own crown
    centres (maxima of that distance) where no tree is near. Each tree moves to the middle of its crown and takes its size and colour;
    crowns with no tree become trees, their height from the crown size scaled to the trees that matched; trees with no crown are marked.
    Optionally the ground is painted in where the crowns were (GDAL FillNodata, with the ground's grain added back)."""
    import numpy as np
    from scipy import ndimage
    from scipy.spatial import cKDTree
    from osgeo import gdal
    gdal.UseExceptions()
    prm = job.get('params', {}); notes = []
    fn = '/vsimem/bfl_o.' + ('webp' if job.get('mime') == 'image/webp' else 'png'); gdal.FileFromMemBuffer(fn, base64.b64decode(job['image_b64'])); ds = gdal.Open(fn)
    W0, H0 = ds.RasterXSize, ds.RasterYSize; x0, y0, x1, y1 = job['ibox']; ux, uy, zf, geo = units_of(job, (x0 + x1) / 2, (y0 + y1) / 2); px0 = (x1 - x0) / W0 * ux; nd = 8 if geo else 3
    sc = min(1.0, 4000.0 / max(W0, H0), px0 / 0.06)   # analysed at 6 cm at the finest and 4,000 px at the most
    W, H = max(8, int(W0 * sc)), max(8, int(H0 * sc)); px, py = (x1 - x0) / W, (y1 - y0) / H; pxm, pym = px * ux, py * uy; cell = (pxm * pym) ** .5
    prog(0.08, 'Reading the orthophoto: %d × %d px at %.2f m' % (W, H, cell))
    bands = [ds.GetRasterBand(i + 1).ReadAsArray(buf_xsize=W, buf_ysize=H, resample_alg=gdal.GRIORA_Average).astype(float) for i in range(min(4, ds.RasterCount))]
    ds = None; gdal.Unlink(fn)
    if len(bands) < 3: raise RuntimeError('The orthophoto needs colour (red, green and blue) to tell crowns from the ground.')
    R, G, B = bands[:3]; A = bands[3] if len(bands) > 3 else np.full(R.shape, 255.0); valid = A > 127
    if valid.sum() < 100: raise RuntimeError('The orthophoto is empty.')
    def disc(m):   # m metres in radius, in pixels (an ellipse where they are not square)
        ry, rx = max(1, int(round(m / pym))), max(1, int(round(m / pxm))); yy, xx = np.mgrid[-ry:ry + 1, -rx:rx + 1]; return (xx / rx) ** 2 + (yy / ry) ** 2 <= 1
    sig = lambda m: (max(.5, m / pym), max(.5, m / pxm))
    # 1. crowns: excess green, Otsu
    prog(0.18, 'Excess-green index and Otsu threshold')
    s = R + G + B + 1e-6; exg = np.where(valid, (2 * G - R - B) / s, np.nan)
    exs = ndimage.gaussian_filter(np.nan_to_num(exg, nan=np.nanmin(exg)), sig(.15))
    v = exs[valid]; hist, ed = np.histogram(v, 256); c = (ed[:-1] + ed[1:]) / 2; w = np.cumsum(hist).astype(float); m = np.cumsum(hist * c); wt, mt = w[-1], m[-1]
    bv = (mt * w / wt - m) ** 2 / np.maximum(w * (wt - w), 1); t = float(c[np.argmax(bv)]) + {'more': -.03, 'less': .03}.get(str(prm.get('sense', 'auto')), 0)
    veg = valid & (exs > t)
    rmin = float(prm.get('rmin') or .6)
    veg = ndimage.binary_opening(veg, structure=disc(.2))
    lab0, n0 = ndimage.label(veg)
    if n0:
        sizes = np.asarray(ndimage.sum(np.ones(veg.shape), lab0, range(1, n0 + 1))); tiny = np.where(sizes * pxm * pym < np.pi * (rmin * .6) ** 2)[0] + 1
        if tiny.size: veg &= ~np.isin(lab0, tiny)
    frac = veg.sum() / valid.sum()
    if frac > .8: notes.append('%.0f%% of the photo reads as crown: the ground may be as green as the trees (grass, leaves), so crowns run together; try Green threshold: Higher' % (100 * frac))
    if frac < .005: notes.append('almost nothing in the photo reads as crown; try Green threshold: Lower')
    # 2. the distance to the crown's edge, and the photo's own crown centres
    prog(0.32, 'Distance transform and crown centres')
    dist = ndimage.distance_transform_edt(veg, sampling=(pym, pxm))   # metres
    sd = ndimage.gaussian_filter(dist, sig(.25))
    mx = ndimage.maximum_filter(sd, footprint=disc(rmin))
    pk = veg & (sd >= mx - 1e-9) & (dist >= rmin * .5)
    plab, npk = ndimage.label(pk, structure=np.ones((3, 3)))
    pc = np.array(ndimage.center_of_mass(pk, plab, range(1, npk + 1))).reshape(-1, 2)
    # 3. markers: the trees (snapped to the nearest crown pixel), then the photo's crowns with no tree near
    T = [list(map(float, q[:5])) for q in (job.get('trees') or [])]; nT = len(T)
    _, (ir, ic) = ndimage.distance_transform_edt(~veg, return_indices=True)
    mk = np.zeros(veg.shape, np.int32); seeded = np.zeros(nT, bool)
    claim = {}   # each tree's seed on the crown centre (deepest point) within its radius; a centre two trees reach goes to the nearer
    for k, (E, N, gz, h, r) in enumerate(T):
        rr_, cc_ = (y1 - N) / py, (E - x0) / px; rs = max(1.0, .9 * r * ux)   # metres
        if not (0 <= rr_ < H and 0 <= cc_ < W): continue
        i0, i1, j0, j1 = max(0, int(rr_ - rs / pym)), min(H, int(rr_ + rs / pym) + 2), max(0, int(cc_ - rs / pxm)), min(W, int(cc_ + rs / pxm) + 2)
        yy, xx = np.mgrid[i0:i1, j0:j1]; dd = np.hypot((yy + .5 - rr_) * pym, (xx + .5 - cc_) * pxm); win = np.where(veg[i0:i1, j0:j1] & (dd <= rs), sd[i0:i1, j0:j1], -1)
        if win.max() <= 0: continue
        a, b = np.unravel_index(np.argmax(win), win.shape); a, b, d0 = a + i0, b + j0, dd[a, b]
        if (a, b) not in claim or d0 < claim[(a, b)][1]: claim[(a, b)] = (k, d0)
    for (a, b), (k, _) in claim.items(): mk[a, b] = k + 1; seeded[k] = True
    extra = []
    if npk:
        far = np.ones(npk, bool)
        if nT:
            xy = np.array([[q[0] * ux, q[1] * uy] for q in T]); kd = cKDTree(xy); pE, pN = (x0 + (pc[:, 1] + .5) * px) * ux, (y1 - (pc[:, 0] + .5) * py) * uy   # metres
            dd, ii = kd.query(np.c_[pE, pN]); far = dd > np.array([T[i][4] * ux for i in ii]) + .5
        for j in np.where(far)[0]:
            a, b = int(round(pc[j, 0])), int(round(pc[j, 1]))
            if veg[a, b] and mk[a, b] == 0: extra.append(j); mk[a, b] = nT + len(extra)
    nm = nT + len(extra)
    prog(0.5, 'Watershed: each crown from its tree (%d trees, %d crowns only in the photo)' % (int(seeded.sum()), len(extra)))
    img = np.where(veg, np.clip((sd.max() - sd) / (sd.max() or 1) * 60000, 0, 60000), 65535).astype(np.uint16)   # the ground last
    seg = ndimage.watershed_ift(img, mk, structure=np.ones((3, 3), int)); seg = np.where(veg & (seg > 0), seg, 0)
    vl, nvl = ndimage.label(veg); has = np.zeros(nvl + 1, bool); has[np.unique(vl[mk > 0])] = True; seg[~has[vl]] = 0   # a crown with no tree and no centre of its own is left out
    idx = range(1, nm + 1)
    area = np.asarray(ndimage.sum(np.ones(veg.shape), seg, idx), float) * pxm * pym
    cen = np.array(ndimage.center_of_mass(veg, seg, idx)).reshape(-1, 2) if nm else np.zeros((0, 2))
    mrgb = [np.asarray(ndimage.mean(X, seg, idx), float) for X in (R, G, B)] if nm else [np.zeros(0)] * 3
    allc = [float(X[seg > 0].mean()) if (seg > 0).any() else 1.0 for X in (R, G, B)]
    # the ground under each tree from the elevation layer
    gx0, gy0, gx1, gy1 = job['box']; gnx, gny = int(job['nx']), int(job['ny']); Gz = np.frombuffer(base64.b64decode(job['values_b64']), dtype='<f4').reshape(gny, gnx)
    def ground(E, N, fb):
        i, j = int((gy1 - N) / (gy1 - gy0) * gny), int((E - gx0) / (gx1 - gx0) * gnx)
        if 0 <= i < gny and 0 <= j < gnx and np.isfinite(Gz[i, j]): return float(Gz[i, j])
        return fb
    def col(k): return [round(float(min(1.3, max(.7, (mrgb[q][k] / allc[q]) if np.isfinite(mrgb[q][k]) and allc[q] else 1))), 2) for q in range(3)]
    amin = np.pi * (rmin * .6) ** 2
    out, shifts, ratio = [], [], []
    for k, (E, N, gz, h, r) in enumerate(T):
        if seeded[k] and area[k] >= amin and np.all(np.isfinite(cen[k])):
            cE, cN = x0 + (cen[k, 1] + .5) * px, y1 - (cen[k, 0] + .5) * py; rp = float(np.sqrt(area[k] / np.pi)) / ux   # in the layer's units
            if np.hypot((cE - E) * ux, (cN - N) * uy) <= max(2.0, 2 * r * ux):
                shifts.append([(cE - E) * ux, (cN - N) * uy]); ratio.append(h / max(rp, .3 / ux))
                out.append([round(cE, nd), round(cN, nd), round(ground(cE, cN, gz), 3), round(h, 3), round(min(2 * r, max(.5 * r, rp)), nd), 1] + col(k)); continue
        out.append([round(E, nd), round(N, nd), round(gz, 3), round(h, 3), round(r, nd), 0, 1, 1, 1])
    n_none = sum(1 for q in out if q[5] == 0); drop = str(prm.get('nocrown', 'keep')) == 'drop'
    if drop: out = [q for q in out if q[5] == 1]
    hr = float(np.median(ratio)) if ratio else None; hmax = max([q[3] for q in T], default=25.0); added = 0
    if str(prm.get('added', 'yes')) != 'no':
        for e, j in enumerate(extra):
            k = nT + e
            if area[k] < np.pi * rmin * rmin or not np.all(np.isfinite(cen[k])): continue
            rpm = float(np.sqrt(area[k] / np.pi)); rp = rpm / ux; cE, cN = x0 + (cen[k, 1] + .5) * px, y1 - (cen[k, 0] + .5) * py
            h = rp * hr if hr else (2 * rpm - 1) / .17 / zf; h = float(min(max(h, 2.0 / zf), hmax * 1.05))
            out.append([round(cE, nd), round(cN, nd), round(ground(cE, cN, float(np.nanmedian(Gz))), 3), round(h, 3), round(rp, nd), 2] + col(k)); added += 1
    sh = np.array(shifts) if shifts else np.zeros((0, 2))
    res = {'trees': out, 'matched': len(shifts), 'added': added, 'nocrown': n_none, 'dropped': n_none if drop else 0,
           'shift_median': float(np.median(np.hypot(sh[:, 0], sh[:, 1]))) if len(sh) else 0.0, 'shift_max': float(np.hypot(sh[:, 0], sh[:, 1]).max()) if len(sh) else 0.0,
           'offset': [float(np.median(sh[:, 0])), float(np.median(sh[:, 1]))] if len(sh) else [0.0, 0.0], 'crown_frac': float(frac), 'threshold': t, 'cell': cell, 'w': W, 'h': H, 'h_per_r': hr, 'notes': notes,
           'tool': 'SciPy %s ndimage (excess green, Otsu, distance transform, watershed_ift)%s' % (__import__('scipy').__version__, '; GDAL %s FillNodata' % gdal.__version__ if str(prm.get('fill', 'yes')) == 'yes' else ''),
           'detail': 'crowns: excess green above %.3f (Otsu), analysed at %.2f m a pixel; each tree seeded its own crown' % (t, cell)}
    # 4. the ground painted in where the crowns were
    if str(prm.get('fill', 'yes')) == 'yes':
        prog(0.75, 'GDAL FillNodata: painting the ground in under the crowns')
        hole = ndimage.binary_dilation(seg > 0, structure=disc(.3)) & valid
        md = gdal.GetDriverByName('MEM').Create('', W, H, 1, gdal.GDT_Byte); md.GetRasterBand(1).WriteArray((~hole).astype(np.uint8))
        rng = np.random.default_rng(1); grain = []
        for X in (R, G, B):
            hf = X - ndimage.gaussian_filter(X, 2); grain.append(float(np.std(hf[valid & ~hole])) if (valid & ~hole).any() else 0.0)
        noise = ndimage.gaussian_filter(rng.normal(0, 1, (H, W)), .8); noise /= (noise.std() or 1)
        outb = []
        for q, X in enumerate((R, G, B)):
            dsb = gdal.GetDriverByName('MEM').Create('', W, H, 1, gdal.GDT_Float32); bb = dsb.GetRasterBand(1); bb.WriteArray(X)
            gdal.FillNodata(targetBand=bb, maskBand=md.GetRasterBand(1), maxSearchDist=int(max(10, 6 / cell)), smoothingIterations=3)
            f = bb.ReadAsArray().astype(float); outb.append(np.where(hole, f + noise * grain[q], X))
        rgba = np.dstack([np.clip(b_, 0, 255) for b_ in outb] + [A]).astype(np.uint8)
        res['image'], res['mime'] = pic_b64(rgba)
    return res

# ---------- raster tools on the app's layers (in a temporary GRASS project) ----------
def grid_of(r):
    """a layer sent by the app: {b64, nx, ny, box} -> (array north-first, geotransform)"""
    import numpy as np
    nx, ny = int(r['nx']), int(r['ny']); x0, y0, x1, y1 = r['box']
    a = np.frombuffer(base64.b64decode(r['b64']), dtype='<f4').astype(float).reshape(ny, nx)
    return a, [x0, (x1 - x0) / nx, 0, y1, 0, -(y1 - y0) / ny]

def mem_ds(a, gt):
    from osgeo import gdal
    import numpy as np
    ny, nx = a.shape; ds = gdal.GetDriverByName('MEM').Create('', nx, ny, 1, gdal.GDT_Float32); ds.SetGeoTransform(gt)
    b = ds.GetRasterBand(1); b.SetNoDataValue(-99999); b.WriteArray(np.where(np.isfinite(a), a, -99999)); return ds

def rasterize_polys(polys, gt, nx, ny):
    """polygons [[ring, ...], ...] burnt onto a grid (GDAL Rasterize): 1 inside"""
    from osgeo import gdal, ogr
    import numpy as np
    ds = gdal.GetDriverByName('MEM').Create('', nx, ny, 1, gdal.GDT_Byte); ds.SetGeoTransform(gt)
    vd = ogr.GetDriverByName('Memory').CreateDataSource('m'); ly = vd.CreateLayer('m', None, ogr.wkbPolygon)
    for rings in polys:
        g = ogr.Geometry(ogr.wkbPolygon)
        for r in rings:
            lr = ogr.Geometry(ogr.wkbLinearRing)
            for x, y in r: lr.AddPoint_2D(x, y)
            lr.CloseRings(); g.AddGeometry(lr)
        f = ogr.Feature(ly.GetLayerDefn()); f.SetGeometry(g); ly.CreateFeature(f)
    gdal.RasterizeLayer(ds, [1], ly, burn_values=[1])
    return ds.GetRasterBand(1).ReadAsArray().astype(bool)

def in_grass_rast(job, gs, tmp):
    import numpy as np
    from osgeo import gdal
    gdal.UseExceptions()
    m, prm = job['method'], job.get('params', {}); ver = gs.version().get('version', '')
    A, gt = grid_of(job['rasters']['a']); ny, nx = A.shape; cell = abs(gt[1] * gt[5])
    def to_grass(arr, name, g=gt):
        f = os.path.join(tmp, name + '.tif'); d = gdal.GetDriverByName('GTiff').CreateCopy(f, mem_ds(arr, g)); d = None
        gs.run_command('r.in.gdal', input=f, output=name, flags='o', overwrite=True, quiet=True)
    def read(name):
        f = os.path.join(tmp, name + '_o.tif'); gs.run_command('r.out.gdal', input=name, output=f, format='GTiff', type='Float32', flags='cf', nodata=-99999, overwrite=True, quiet=True)
        d = gdal.Open(f); r = d.GetRasterBand(1).ReadAsArray().astype(float); d = None; r[r <= -99998] = np.nan; return r
    def univar(name):
        out, r = gs.parse_command('r.univar', map=name, flags='g'), {}
        for k, v in out.items():   # an empty map reports nan (on Windows '-nan(ind)'): left out
            try:
                f = float(v)
                if math.isfinite(f): r[k] = f
            except (TypeError, ValueError): pass
        return r
    prog(0.05, 'r.in.gdal: the layer into GRASS, %d × %d cells' % (nx, ny))
    to_grass(A, 'a'); gs.run_command('g.region', raster='a', quiet=True)
    if m == 'profile':
        pts = job['line']; res = float(prm.get('step') or 0) or abs(gt[1])
        prog(0.4, 'r.profile: %d points along the line every %.2f m' % (len(pts), res))
        txt = gs.read_command('r.profile', input='a', coordinates=','.join('%.3f,%.3f' % (x, y) for x, y in pts), resolution=res, null_value='nan', flags='g')
        rows = []
        for l in txt.strip().splitlines():
            q = l.split()
            if len(q) >= 4:
                try: rows.append([float(q[2]), None if q[3] in ('nan', '*') else float(q[3]), float(q[0]), float(q[1])])
                except ValueError: pass
        return {'profile': rows, 'tool': 'GRASS GIS %s r.profile' % ver, 'detail': 'every %.2f m along %d points' % (res, len(pts))}
    if m == 'cutfill':
        if job['rasters'].get('b'):   # a second surface, resampled onto the first's grid (gdalwarp)
            B, gb = grid_of(job['rasters']['b']); w = gdal.Warp('', mem_ds(B, gb), format='MEM', outputBounds=[gt[0], gt[3] + gt[5] * ny, gt[0] + gt[1] * nx, gt[3]], width=nx, height=ny, resampleAlg='bilinear', srcNodata=-99999, dstNodata=-99999)
            Bw = w.GetRasterBand(1).ReadAsArray().astype(float); Bw[Bw <= -99998] = np.nan; to_grass(Bw, 'b'); base = 'b'; what = 'the second surface'
        else:
            lv = float(prm['level']); gs.run_command('r.mapcalc', expression='b = %.6f' % lv, overwrite=True, quiet=True); base = 'b'; what = 'a level of %.3f m' % lv
        mask = rasterize_polys(job['polys'], gt, nx, ny) if job.get('polys') else np.ones((ny, nx), bool)
        to_grass(np.where(mask, 1.0, np.nan), 'mk')
        prog(0.4, 'r.mapcalc: the surface minus %s, inside the area' % what)
        gs.run_command('r.mapcalc', expression='d = if(isnull(mk), null(), a - %s)' % base, overwrite=True, quiet=True)
        gs.run_command('r.mapcalc', expression='cut = if(d > 0, d, null())', overwrite=True, quiet=True)
        gs.run_command('r.mapcalc', expression='fill = if(d < 0, -d, null())', overwrite=True, quiet=True)
        prog(0.7, 'r.univar: volumes')
        uc, uf = univar('cut'), univar('fill')
        return {'values_b64': b64f(read('d')), 'cut': uc.get('sum', 0) * cell, 'fill': uf.get('sum', 0) * cell, 'cut_area': uc.get('n', 0) * cell, 'fill_area': uf.get('n', 0) * cell, 'cut_max': uc.get('max', 0), 'fill_max': uf.get('max', 0),
                'tool': 'GRASS GIS %s r.mapcalc, r.univar' % ver, 'detail': 'the surface against %s, %.2f × %.2f m cells' % (what, abs(gt[1]), abs(gt[5]))}
    if m == 'watershed':
        thr = int(prm.get('threshold') or 0) or max(20, int(nx * ny / 400))
        prog(0.3, 'r.watershed: flow directions and accumulation (multiple flow directions), streams from %d cells' % thr)
        gs.run_command('r.watershed', elevation='a', accumulation='acc', stream='str', threshold=thr, overwrite=True, quiet=True)
        acc = np.abs(read('acc')); st = read('str')
        return {'values_b64': b64f(np.log10(np.maximum(acc, 1))), 'stream_b64': b64u8(np.where(np.isfinite(st), 255, 0)), 'threshold': thr, 'max_area': float(np.nanmax(acc)) * cell,
                'tool': 'GRASS GIS %s r.watershed' % ver, 'detail': 'multiple flow directions; streams where more than %d cells (%.0f m²) drain' % (thr, thr * cell)}
    if m == 'diff':
        B, gb = grid_of(job['rasters']['b'])
        prog(0.3, 'gdalwarp: the second layer onto the first one\'s cells')
        w = gdal.Warp('', mem_ds(B, gb), format='MEM', outputBounds=[gt[0], gt[3] + gt[5] * ny, gt[0] + gt[1] * nx, gt[3]], width=nx, height=ny, resampleAlg='bilinear', srcNodata=-99999, dstNodata=-99999)
        Bw = w.GetRasterBand(1).ReadAsArray().astype(float); Bw[Bw <= -99998] = np.nan; to_grass(Bw, 'b')
        gs.run_command('r.mapcalc', expression='d = a - b', overwrite=True, quiet=True)
        u = univar('d')
        return {'values_b64': b64f(read('d')), 'stats': u, 'tool': 'GRASS GIS %s r.mapcalc; GDAL gdalwarp' % ver, 'detail': 'first minus second, on the first layer\'s %.2f m cells' % abs(gt[1])}
    if m == 'calc':
        # the user's expression, in r.mapcalc's own language, on layers A, B and C (already checked: only names, numbers, operators and functions)
        for nm in ('b', 'c'):
            if job['rasters'].get(nm):
                R, gr = grid_of(job['rasters'][nm]); w = gdal.Warp('', mem_ds(R, gr), format='MEM', outputBounds=[gt[0], gt[3] + gt[5] * ny, gt[0] + gt[1] * nx, gt[3]], width=nx, height=ny, resampleAlg='bilinear', srcNodata=-99999, dstNodata=-99999)
                Rw = w.GetRasterBand(1).ReadAsArray().astype(float); Rw[Rw <= -99998] = np.nan; to_grass(Rw, nm)
        expr = job['expr'].replace('A', 'a').replace('B', 'b').replace('C', 'c')
        prog(0.4, 'r.mapcalc: out = ' + job['expr'])
        gs.run_command('r.mapcalc', expression='out = ' + expr, overwrite=True, quiet=True)
        u = univar('out')
        return {'values_b64': b64f(read('out')), 'stats': u, 'tool': 'GRASS GIS %s r.mapcalc' % ver, 'detail': 'out = ' + job['expr']}
    if m == 'reclass':
        br = sorted(float(v) for v in job['breaks']); rules = os.path.join(tmp, 'rules.txt')
        u0 = univar('a'); lo, hi = u0.get('min', 0) - 1, u0.get('max', 0) + 1
        edges = [lo] + br + [hi]
        with open(rules, 'w') as f:
            for i in range(len(edges) - 1): f.write('%.10g:%.10g:%d\n' % (edges[i], edges[i + 1], i + 1))
        prog(0.4, 'r.recode: %d classes' % (len(edges) - 1))
        gs.run_command('r.recode', input='a', output='cls', rules=rules, overwrite=True, quiet=True)
        prog(0.7, 'r.stats: the area of each class')
        cnt = {}
        for l in gs.read_command('r.stats', input='cls', flags='cn').strip().splitlines():
            q = l.split()
            if len(q) == 2 and q[0] != '*': cnt[int(float(q[0]))] = int(q[1])
        return {'values_b64': b64f(read('cls')), 'classes': [{'k': i + 1, 'from': edges[i] if i else None, 'to': edges[i + 1] if i + 1 < len(edges) - 1 else None, 'area': cnt.get(i + 1, 0) * cell} for i in range(len(edges) - 1)],
                'tool': 'GRASS GIS %s r.recode, r.stats' % ver, 'detail': '%d classes at %s' % (len(edges) - 1, ', '.join('%g' % v for v in br))}
    if m == 'zonal':
        Z = np.full((ny, nx), np.nan)
        for i, rings in enumerate(job['polys']):
            mk = rasterize_polys([rings], gt, nx, ny); Z[mk & np.isnan(Z)] = i + 1
        to_grass(Z, 'z'); gs.run_command('r.mapcalc', expression='zi = int(z)', overwrite=True, quiet=True)
        prog(0.5, 'r.univar -t: statistics of the layer in each of %d areas' % len(job['polys']))
        txt = gs.read_command('r.univar', map='a', zones='zi', flags='t', separator='|')
        lines = [l.split('|') for l in txt.strip().splitlines()]
        hdr = lines[0] if lines else []; rows = []
        for q in lines[1:]:
            d = dict(zip(hdr, q))
            try: rows.append({'zone': int(float(d.get('zone', 0))), 'n': int(float(d.get('non_null_cells', 0))), 'min': float(d['min']), 'max': float(d['max']), 'mean': float(d['mean']), 'sum': float(d['sum']), 'stddev': float(d.get('stddev', 'nan'))})
            except (KeyError, ValueError): pass
        return {'rows': rows, 'cell_area': cell, 'tool': 'GRASS GIS %s r.univar (zones)' % ver, 'detail': '%d areas' % len(job['polys'])}
    if m == 'filter':
        meth, size = str(prm.get('method', 'average')), int(prm.get('size', 3)); size += (size + 1) % 2
        prog(0.4, 'r.neighbors: %s of every %d × %d window' % (meth, size, size))
        gs.run_command('r.neighbors', input='a', output='f', method=meth, size=size, flags='c' if prm.get('circle') == 'yes' else '', overwrite=True, quiet=True)
        return {'values_b64': b64f(read('f')), 'tool': 'GRASS GIS %s r.neighbors' % ver, 'detail': '%s of %d × %d cells%s' % (meth, size, size, ', circular' if prm.get('circle') == 'yes' else '')}
    if m == 'griddist':
        P = np.zeros((ny, nx)); P[:] = np.nan
        for x, y in job['points']:
            i, j = int((x - gt[0]) / gt[1]), int((y - gt[3]) / gt[5])
            if 0 <= i < nx and 0 <= j < ny: P[j, i] = 1
        to_grass(P, 'p')
        prog(0.4, 'r.grow.distance: the distance from every cell to the nearest borehole')
        gs.run_command('r.grow.distance', input='p', distance='dist', metric='euclidean', overwrite=True, quiet=True)
        return {'values_b64': b64f(read('dist')), 'tool': 'GRASS GIS %s r.grow.distance' % ver, 'detail': 'straight-line distance on %.2f m cells' % abs(gt[1])}
    raise RuntimeError('Unknown raster tool ' + m)

# ---------- vector tools (SciPy, OGR) ----------
def thiessen(job):
    """the area each borehole represents: Voronoi cells (SciPy) clipped to an outline (OGR), with their areas"""
    import numpy as np
    from scipy.spatial import Voronoi
    from osgeo import ogr
    ogr.UseExceptions()
    pts = np.array([p[:2] for p in job['points']], float); names = [p[2] if len(p) > 2 else str(i + 1) for i, p in enumerate(job['points'])]
    clip = ogr.Geometry(ogr.wkbPolygon); lr = ogr.Geometry(ogr.wkbLinearRing)
    for x, y in job['outline']: lr.AddPoint_2D(x, y)
    lr.CloseRings(); clip.AddGeometry(lr)
    prog(0.3, 'scipy.spatial.Voronoi: %d boreholes' % len(pts))
    span = float(np.ptp(pts, axis=0).max()) * 20 + 1000; c = pts.mean(axis=0)
    far = np.array([[c[0] - span, c[1] - span], [c[0] + span, c[1] - span], [c[0] + span, c[1] + span], [c[0] - span, c[1] + span]])
    vor = Voronoi(np.vstack([pts, far]))
    cells = []
    for i in range(len(pts)):
        reg = vor.regions[vor.point_region[i]]
        if -1 in reg or not reg: continue
        g = ogr.Geometry(ogr.wkbPolygon); r = ogr.Geometry(ogr.wkbLinearRing)
        for v in reg: r.AddPoint_2D(*vor.vertices[v])
        r.CloseRings(); g.AddGeometry(r); g = g.Intersection(clip)
        if g is None or g.IsEmpty(): continue
        rings = []
        for k in range(g.GetGeometryCount()):
            sub = g.GetGeometryRef(k)
            if sub.GetGeometryName() == 'POLYGON': sub = sub.GetGeometryRef(0)
            rings.append([[round(sub.GetX(n), 3), round(sub.GetY(n), 3)] for n in range(sub.GetPointCount())])
        cells.append({'name': names[i], 'area': g.GetArea(), 'rings': rings, 'x': float(pts[i][0]), 'y': float(pts[i][1])})
    return {'cells': cells, 'total': clip.GetArea(), 'tool': 'SciPy Voronoi; GDAL %s OGR Intersection' % __import__('osgeo').__version__, 'detail': '%d cells clipped to the outline' % len(cells)}

def ogr_geom(f):
    from osgeo import ogr
    t, P = f['type'], f['pts']
    if t == 'point': g = ogr.Geometry(ogr.wkbPoint); g.AddPoint_2D(*P[0]); return g
    if t == 'line': g = ogr.Geometry(ogr.wkbLineString); [g.AddPoint_2D(x, y) for x, y in P]; return g
    g = ogr.Geometry(ogr.wkbPolygon)
    for ring in (P if P and isinstance(P[0][0], (list, tuple)) else [P]):
        r = ogr.Geometry(ogr.wkbLinearRing); [r.AddPoint_2D(x, y) for x, y in ring]; r.CloseRings(); g.AddGeometry(r)
    return g

def rings_of(g):
    out = []
    if g is None or g.IsEmpty(): return out
    gs_ = [g.GetGeometryRef(i) for i in range(g.GetGeometryCount())] if g.GetGeometryName() == 'MULTIPOLYGON' else [g]
    for poly in gs_:
        out.append([[[round(r.GetX(n), 3), round(r.GetY(n), 3)] for n in range(r.GetPointCount())] for r in (poly.GetGeometryRef(k) for k in range(poly.GetGeometryCount()))])
    return out

def setback(job):
    """buffers around the chosen things (OGR Buffer), and the shortest distance from each to each site feature (OGR Distance)"""
    from osgeo import ogr
    ogr.UseExceptions()
    src = [ogr_geom(f) for f in job['from']]; d = float(job['distance'])
    prog(0.3, 'OGR Buffer: %.1f m around %d shape%s' % (d, len(src), '' if len(src) == 1 else 's'))
    u = None
    for g in src: b = g.Buffer(d, 16); u = b if u is None else u.Union(b)
    rows = []
    for f in job.get('to') or []:
        tg = ogr_geom(f); best = min((g.Distance(tg) for g in src), default=None)
        rows.append({'name': f.get('name') or f.get('kind') or 'feature', 'kind': f.get('kind', ''), 'dist': best, 'inside': bool(u.Intersects(tg)) if u else False})
    rows.sort(key=lambda r: r['dist'] if r['dist'] is not None else 1e18)
    return {'polys': rings_of(u), 'area': u.GetArea() if u else 0, 'rows': rows, 'tool': 'GDAL %s OGR Buffer, Distance' % __import__('osgeo').__version__, 'detail': '%.1f m buffer' % d}

def export_layer(job):
    """a layer as GIS files (GDAL/OGR): a grid as GeoTIFF; lines, areas and points as GeoPackage, Shapefile, KML or DXF"""
    from osgeo import gdal, ogr, osr
    import numpy as np
    gdal.UseExceptions(); ogr.UseExceptions()
    srs = srs_of(job['epsg']); fmt = job.get('format', 'GPKG'); name = job.get('name', 'layer')
    outc = job.get('out') or job['epsg']; osrs = srs_of(outc)
    tr = None if osrs.IsSame(srs) else osr.CoordinateTransformation(srs, osrs)
    tmp = tempfile.mkdtemp(prefix='bfl-ex-'); files = {}
    try:
        if job.get('raster'):
            a, gt = grid_of(job['raster']); f = os.path.join(tmp, name + '.tif')
            m0 = mem_ds(a, gt); m0.SetProjection(srs.ExportToWkt())
            if tr is not None: m0 = gdal.Warp('', m0, format='MEM', dstSRS=osrs.ExportToWkt(), resampleAlg='bilinear', srcNodata=-99999, dstNodata=-99999)
            d = gdal.GetDriverByName('GTiff').CreateCopy(f, m0, options=['COMPRESS=DEFLATE', 'TILED=YES']); d.GetRasterBand(1).SetDescription(job.get('band', name)); d = None
            prog(0.4, 'GeoTIFF written')
        drv = {'GPKG': ('GPKG', '.gpkg'), 'SHP': ('ESRI Shapefile', '.shp'), 'KML': ('KML', '.kml'), 'DXF': ('DXF', '.dxf')}[fmt]
        feats = job.get('features') or []
        if feats:
            prog(0.6, 'Writing %d feature%s as %s' % (len(feats), '' if len(feats) == 1 else 's', drv[0]))
            out_srs = srs_of(4326) if fmt == 'KML' else osrs
            ct = None if out_srs.IsSame(srs) else osr.CoordinateTransformation(srs, out_srs)
            by = {}
            for f in feats: by.setdefault(f['type'], []).append(f)
            for t, fs in by.items():
                fn = os.path.join(tmp, (name + ('' if len(by) == 1 else '_' + t + 's')) + drv[1])
                ds = ogr.GetDriverByName(drv[0]).CreateDataSource(fn)
                ly = ds.CreateLayer(name if fmt != 'DXF' else 'entities', out_srs if fmt != 'DXF' else None, {'point': ogr.wkbPoint, 'line': ogr.wkbLineString, 'polygon': ogr.wkbPolygon}[t])
                if fmt != 'DXF':
                    ly.CreateField(ogr.FieldDefn('name', ogr.OFTString)); fv = ogr.FieldDefn('value', ogr.OFTReal); ly.CreateField(fv)
                for f in fs:
                    g = ogr_geom(f)
                    if ct: g.Transform(ct)
                    o = ogr.Feature(ly.GetLayerDefn()); o.SetGeometry(g)
                    if fmt != 'DXF':
                        o.SetField('name', str(f.get('name', ''))[:250])
                        if f.get('value') is not None: o.SetField('value', float(f['value']))
                    else:
                        o.SetField('Layer', str(f.get('layer', name))[:60])
                    ly.CreateFeature(o)
                ds = None
        for fn in sorted(os.listdir(tmp)):
            with open(os.path.join(tmp, fn), 'rb') as fh: files[fn] = base64.b64encode(fh.read()).decode()
        return {'files': files, 'tool': 'GDAL %s' % gdal.__version__, 'detail': ', '.join(files)}
    finally: shutil.rmtree(tmp, ignore_errors=True)

# ---------- coordinate systems (PROJ through GDAL/OGR) ----------
def srs_of(code):
    """'EPSG:2956', 2956 or 'ESRI:102001' -> an osr.SpatialReference in x/y (easting/northing, longitude/latitude) order"""
    from osgeo import osr
    osr.UseExceptions()
    c = str(code).strip(); c = c if ':' in c else 'EPSG:' + c
    r = osr.SpatialReference(); r.SetFromUserInput(c); r.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER); return r

def proj_db():
    import sqlite3
    from osgeo import osr
    for d in [os.environ.get('PROJ_DATA', ''), os.path.join(sys.prefix, 'Library', 'share', 'proj'), os.path.join(sys.prefix, 'share', 'proj')]:
        f = os.path.join(d, 'proj.db')
        if d and os.path.exists(f): return sqlite3.connect('file:' + f + '?mode=ro', uri=True)
    raise RuntimeError('The PROJ database was not found.')

def crs_search(q, limit=60):
    """systems in PROJ's database whose name or code matches, with where they are meant for"""
    db = proj_db(); q = q.strip(); words = [w for w in q.replace(',', ' ').split() if w]
    sql = """select c.auth_name, c.code, c.name, c.type, (select e.name from usage u join extent e on e.auth_name = u.extent_auth_name and e.code = u.extent_code
             where u.object_table_name = c.table_name and u.object_auth_name = c.auth_name and u.object_code = c.code limit 1)
             from crs_view c where c.deprecated = 0 and c.type in ('projected', 'geographic 2D', 'compound', 'vertical', 'geographic 3D')"""
    args = []
    if q.isdigit(): sql += ' and c.code = ?'; args.append(q)
    else:
        for w in words: sql += ' and c.name like ?'; args.append('%' + w + '%')
    sql += " order by (c.auth_name = 'EPSG') desc, (c.type = 'projected') desc, length(c.name) limit %d" % limit
    return [{'code': '%s:%s' % (a, c), 'name': n, 'type': t, 'area': ar or ''} for a, c, n, t, ar in db.execute(sql, args)]

def crs_info(code):
    r = srs_of(code)
    au = r.GetAreaOfUse()
    return {'code': str(code), 'name': r.GetName(), 'projected': bool(r.IsProjected()), 'geographic': bool(r.IsGeographic()), 'units': r.GetLinearUnitsName() if r.IsProjected() else 'degree',
            'datum': r.GetAttrValue('DATUM') or '', 'area': au.name if au else '', 'bounds': [au.west_lon_degree, au.south_lat_degree, au.east_lon_degree, au.north_lat_degree] if au else None}

def crs_ops(src, dst):
    """the transformations PROJ knows between two systems (projinfo), and the one it will use with the grids at hand"""
    exe = shutil.which('projinfo')
    if not exe: return {'used': None, 'best': None}
    def run(check):
        r = subprocess.run([exe, '-s', str(src), '-t', str(dst), '--summary', '--spatial-test', 'intersects', '--grid-check', check], capture_output=True, text=True, timeout=60)
        out = []
        for l in r.stdout.splitlines():
            q = [x.strip() for x in l.split(',')]
            if len(q) >= 3 and (':' in q[0] or q[0].startswith('unknown')): out.append({'id': q[0], 'name': q[1], 'accuracy': q[2], 'area': ', '.join(q[3:])})
        return out
    avail, every = run('known_available'), run('none')
    return {'used': avail[0] if avail else None, 'best': every[0] if every else None, 'n': len(every)}

def crs_transform(job):
    from osgeo import osr
    osr.UseExceptions()
    a, b = srs_of(job['from']), srs_of(job['to'])
    ct = osr.CoordinateTransformation(a, b)
    out = []
    for p in job['points']:
        try:
            q = ct.TransformPoint(float(p[0]), float(p[1]), float(p[2]) if len(p) > 2 and p[2] is not None else 0.0)
            out.append([q[0], q[1], q[2] if len(p) > 2 and p[2] is not None else None])
        except Exception: out.append(None)
    ops = crs_ops(job['from'], job['to'])
    return {'points': out, 'from': crs_info(job['from']), 'to': crs_info(job['to']), 'ops': ops, 'tool': 'PROJ %d.%d through GDAL %s' % (osr.GetPROJVersionMajor(), osr.GetPROJVersionMinor(), __import__('osgeo').__version__)}

def crs_job(job):
    m = job['method']
    if m == 'search': return {'rows': crs_search(job['q'])}
    if m == 'info': return crs_info(job['code'])
    if m == 'transform': return crs_transform(job)
    if m == 'ops': return crs_ops(job['from'], job['to'])
    raise RuntimeError('Unknown coordinate job')

def import_vector(job):
    """a GIS file (Shapefile, GeoPackage, KML, GeoJSON, DXF, CSV, …) in any coordinate system, reprojected to the project (OGR)"""
    from osgeo import gdal, ogr, osr
    gdal.UseExceptions(); ogr.UseExceptions(); osr.UseExceptions()
    path = job['path']; dst = srs_of(job['epsg']); over = job.get('src')
    oo = ['X_POSSIBLE_NAMES=x,easting,east,e,lon*,long*', 'Y_POSSIBLE_NAMES=y,northing,north,n,lat*', 'KEEP_GEOM_COLUMNS=NO'] if path.lower().endswith('.csv') else []
    prog(0.1, 'Opening the file with OGR')
    ds = gdal.OpenEx(path, gdal.OF_VECTOR, open_options=oo)
    if ds is None: raise RuntimeError('OGR could not read shapes from this file.')
    feats, layers, srcs, n_all, skipped = [], [], set(), 0, 0
    for li in range(ds.GetLayerCount()):
        ly = ds.GetLayer(li); s0 = ly.GetSpatialRef()
        if over: src = srs_of(over); sname = src.GetName() + ' (chosen)'
        elif s0 is not None: src = s0.Clone(); src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER); sname = src.GetName()
        else: src = srs_of(job['epsg']); sname = 'none in the file: taken as the project\'s'
        ct = osr.CoordinateTransformation(src, dst); srcs.add(sname)
        defn = ly.GetLayerDefn(); namef = next((defn.GetFieldDefn(i).GetName() for i in range(defn.GetFieldCount()) if defn.GetFieldDefn(i).GetName().lower() in ('name', 'label', 'id', 'text', 'title', 'bh', 'borehole', 'well')), None)
        if namef is None and defn.GetFieldCount(): namef = next((defn.GetFieldDefn(i).GetName() for i in range(defn.GetFieldCount()) if defn.GetFieldDefn(i).GetType() == ogr.OFTString), None)
        cnt = 0
        for f in ly:
            n_all += 1
            g = f.GetGeometryRef()
            if g is None: skipped += 1; continue
            g = g.Clone(); g.FlattenTo2D()
            try: g.Transform(ct)
            except Exception: skipped += 1; continue
            nm = str(f.GetField(namef)) if namef and f.GetField(namef) is not None else ''
            def add(gg):
                t = gg.GetGeometryName()
                if t == 'POINT': feats.append({'type': 'point', 'pts': [[gg.GetX(), gg.GetY()]], 'name': nm, 'layer': ly.GetName()})
                elif t in ('LINESTRING', 'LINEARRING'): feats.append({'type': 'line', 'pts': [[gg.GetX(i), gg.GetY(i)] for i in range(gg.GetPointCount())], 'name': nm, 'layer': ly.GetName()})
                elif t == 'POLYGON': feats.append({'type': 'polygon', 'pts': [[[r.GetX(i), r.GetY(i)] for i in range(r.GetPointCount())] for r in (gg.GetGeometryRef(k) for k in range(gg.GetGeometryCount()))], 'name': nm, 'layer': ly.GetName()})
                elif gg.GetGeometryCount():
                    for k in range(gg.GetGeometryCount()): add(gg.GetGeometryRef(k))
            add(g); cnt += 1
            if len(feats) > 20000: break
        layers.append({'name': ly.GetName(), 'n': cnt, 'crs': sname})
        prog(0.2 + 0.7 * (li + 1) / ds.GetLayerCount(), 'Layer %s: %d shapes' % (ly.GetName(), cnt))
    if not feats: raise RuntimeError('No shapes with coordinates were found in the file.')
    xs = [q[0] for f in feats for q in (f['pts'] if f['type'] != 'polygon' else f['pts'][0])]; ys = [q[1] for f in feats for q in (f['pts'] if f['type'] != 'polygon' else f['pts'][0])]
    return {'features': feats[:20000], 'layers': layers, 'srcs': sorted(srcs), 'skipped': skipped, 'truncated': len(feats) > 20000, 'bounds': [min(xs), min(ys), max(xs), max(ys)],
            'driver': ds.GetDriver().ShortName, 'tool': 'GDAL %s OGR, PROJ %d.%d' % (gdal.__version__, osr.GetPROJVersionMajor(), osr.GetPROJVersionMinor())}

def rast_gdal(job):
    """GDAL on a layer the app sends: gdalwarp (reproject, resample, clip to an area), gdaldem (terrain indices), gdal_contour"""
    from osgeo import gdal, ogr, osr
    import numpy as np
    gdal.UseExceptions(); ogr.UseExceptions()
    m, prm = job['method'], job.get('params', {})
    A, gt = grid_of(job['raster']); ny, nx = A.shape; src = mem_ds(A, gt); src.SetProjection(srs_of(job['epsg']).ExportToWkt())
    def back(ds, extra):
        b = ds.GetRasterBand(1); a = b.ReadAsArray().astype(float); nd = b.GetNoDataValue()
        if nd is not None: a[a == nd] = np.nan
        a[a <= -99998] = np.nan; g = ds.GetGeoTransform(); h, w = a.shape
        return {'values_b64': b64f(a), 'nx': w, 'ny': h, 'box': [g[0], g[3] + g[5] * h, g[0] + g[1] * w, g[3]], **extra}
    if m == 'warp':
        to = job.get('to') or job['epsg']; res = float(prm.get('cell') or 0) or None; alg = str(prm.get('resample', 'bilinear'))
        prog(0.3, 'gdalwarp: to %s%s, %s' % (to, ' at %.3g m' % res if res else '', alg))
        w = gdal.Warp('', src, format='MEM', dstSRS=srs_of(to).ExportToWkt(), xRes=res, yRes=res, resampleAlg=alg, srcNodata=-99999, dstNodata=-99999)
        out = back(w, {'tool': 'GDAL %s gdalwarp' % gdal.__version__, 'detail': 'to %s, %s cells, %s' % (to, '%.3g m' % abs(w.GetGeoTransform()[1]) if srs_of(to).IsProjected() else '%.3g°' % abs(w.GetGeoTransform()[1]), alg)})
        if job.get('save'):
            f = os.path.join(tempfile.mkdtemp(prefix='bfl-w-'), job.get('name', 'layer') + '.tif'); d = gdal.GetDriverByName('GTiff').CreateCopy(f, w, options=['COMPRESS=DEFLATE', 'TILED=YES']); d = None
            with open(f, 'rb') as fh: out['files'] = {os.path.basename(f): base64.b64encode(fh.read()).decode()}
            shutil.rmtree(os.path.dirname(f), ignore_errors=True)
        return out
    if m == 'clip':
        prog(0.3, 'gdalwarp -cutline: keeping the layer inside %d area%s' % (len(job['polys']), '' if len(job['polys']) == 1 else 's'))
        vd = ogr.GetDriverByName('Memory').CreateDataSource('c'); ly = vd.CreateLayer('c', srs_of(job['epsg']), ogr.wkbPolygon)
        for rings in job['polys']:
            g = ogr.Geometry(ogr.wkbPolygon)
            for r in rings:
                lr = ogr.Geometry(ogr.wkbLinearRing); [lr.AddPoint_2D(x, y) for x, y in r]; lr.CloseRings(); g.AddGeometry(lr)
            f = ogr.Feature(ly.GetLayerDefn()); f.SetGeometry(g); ly.CreateFeature(f)
        fn = '/vsimem/bfl_cut.gpkg'; gdal.VectorTranslate(fn, vd, format='GPKG')
        w = gdal.Warp('', src, format='MEM', cutlineDSName=fn, cropToCutline=prm.get('crop', 'yes') == 'yes', srcNodata=-99999, dstNodata=-99999)
        gdal.Unlink(fn)
        return back(w, {'tool': 'GDAL %s gdalwarp (cutline)' % gdal.__version__, 'detail': 'inside the area%s' % (', cropped to it' if prm.get('crop', 'yes') == 'yes' else '')})
    if m == 'dem':
        what = str(prm.get('index', 'aspect')); opts = {'computeEdges': True}
        if what == 'aspect': opts['zeroForFlat'] = True
        prog(0.4, 'gdaldem %s' % what)
        d = gdal.DEMProcessing('/vsimem/bfl_ix.tif', src, {'tri': 'TRI', 'tpi': 'TPI', 'roughness': 'Roughness', 'aspect': 'aspect', 'slope': 'slope'}[what], **opts)
        out = back(d, {'tool': 'GDAL %s gdaldem %s' % (gdal.__version__, what), 'detail': {'aspect': 'the compass direction each slope faces (0 north, clockwise)', 'slope': 'slope in degrees', 'tri': 'terrain ruggedness index: mean difference to the 8 neighbours', 'tpi': 'topographic position: higher than the neighbours (ridges, mounds) above 0, lower (hollows, channels) below', 'roughness': 'the largest difference within each 3 × 3 window'}[what]})
        d = None; gdal.Unlink('/vsimem/bfl_ix.tif'); return out
    if m == 'contour':
        b = src.GetRasterBand(1); fin = A[np.isfinite(A)]; lo, hi = float(fin.min()), float(fin.max())
        step = float(prm.get('interval') or 0) or nice_step(hi - lo, 8); base = float(prm.get('base') or 0)
        levels = [round(v, 6) for v in np.arange(math.ceil((lo - base) / step) * step + base, hi + 1e-9, step)][:600]
        prog(0.4, 'gdal_contour: every %g from %g' % (step, base))
        vd = ogr.GetDriverByName('Memory').CreateDataSource('c'); cl = vd.CreateLayer('c', None, ogr.wkbLineString)
        cl.CreateField(ogr.FieldDefn('ID', ogr.OFTInteger)); cl.CreateField(ogr.FieldDefn('v', ogr.OFTReal))
        gdal.ContourGenerateEx(b, cl, options=['FIXED_LEVELS=' + ','.join(str(v) for v in levels), 'ID_FIELD=0', 'ELEV_FIELD=1'])
        lines = []
        for f in cl:
            g = f.GetGeometryRef(); lines.append([round(f.GetField('v'), 6), [[round(g.GetX(i), 2), round(g.GetY(i), 2)] for i in range(g.GetPointCount())]])
        return {'lines': lines, 'step': step, 'tool': 'GDAL %s gdal_contour' % gdal.__version__, 'detail': 'every %g' % step}
    raise RuntimeError('Unknown raster tool')

def png_b64(rgba):
    """an RGBA array (h, w, 4) as PNG in base64, written by GDAL"""
    from osgeo import gdal
    import numpy as np
    h, w = rgba.shape[:2]; m = gdal.GetDriverByName('MEM').Create('', w, h, 4, gdal.GDT_Byte)
    for i in range(4): m.GetRasterBand(i + 1).WriteArray(rgba[:, :, i])
    gdal.GetDriverByName('PNG').CreateCopy('/vsimem/bfl.png', m); f = gdal.VSIFOpenL('/vsimem/bfl.png', 'rb'); gdal.VSIFSeekL(f, 0, 2); n = gdal.VSIFTellL(f); gdal.VSIFSeekL(f, 0, 0)
    data = gdal.VSIFReadL(1, n, f); gdal.VSIFCloseL(f); gdal.Unlink('/vsimem/bfl.png'); return base64.b64encode(data).decode()

def pic_b64(rgba):
    """a picture for the app: PNG when small, else WebP (quality 88, alpha kept); (base64, mime type)"""
    from osgeo import gdal
    h, w = rgba.shape[:2]
    if w * h <= 1500000 or gdal.GetDriverByName('WEBP') is None or max(w, h) > 16383: return png_b64(rgba), 'image/png'
    m = gdal.GetDriverByName('MEM').Create('', w, h, 4, gdal.GDT_Byte)
    for i in range(4): m.GetRasterBand(i + 1).WriteArray(rgba[:, :, i])
    gdal.GetDriverByName('WEBP').CreateCopy('/vsimem/bfl.webp', m, options=['QUALITY=88']); f = gdal.VSIFOpenL('/vsimem/bfl.webp', 'rb'); gdal.VSIFSeekL(f, 0, 2); n = gdal.VSIFTellL(f); gdal.VSIFSeekL(f, 0, 0)
    data = gdal.VSIFReadL(1, n, f); gdal.VSIFCloseL(f); gdal.Unlink('/vsimem/bfl.webp'); return base64.b64encode(data).decode(), 'image/webp'

def rgba_of(ds, maxpx=None):
    """a raster's picture as RGBA (8-bit): RGB(A) bands as they are, one band stretched to grey, a palette expanded"""
    from osgeo import gdal
    import numpy as np
    n = ds.RasterCount; w, h = ds.RasterXSize, ds.RasterYSize
    sc = min(1.0, (maxpx or max(w, h)) / max(w, h)); W, H = max(1, int(w * sc)), max(1, int(h * sc))
    rd = lambda b: b.ReadAsArray(buf_xsize=W, buf_ysize=H).astype(float)
    b1 = ds.GetRasterBand(1); ct = b1.GetColorTable()
    out = np.zeros((H, W, 4), np.uint8); out[:, :, 3] = 255
    if ct is not None and n == 1:
        a = rd(b1).astype(int); lut = np.array([ct.GetColorEntry(i) if i < ct.GetCount() else (0, 0, 0, 0) for i in range(256)], np.uint8); out = lut[np.clip(a, 0, 255)]
    elif n >= 3:
        for i in range(3):
            a = rd(ds.GetRasterBand(i + 1)); lo, hi = (0, 255) if ds.GetRasterBand(i + 1).DataType == gdal.GDT_Byte else np.nanpercentile(a, [1, 99]); out[:, :, i] = np.clip((a - lo) / ((hi - lo) or 1) * 255, 0, 255)
        if n >= 4: out[:, :, 3] = rd(ds.GetRasterBand(4)).astype(np.uint8)
    else:
        a = rd(b1); nd = b1.GetNoDataValue(); ok = np.isfinite(a) & (a != nd if nd is not None else True)
        lo, hi = np.nanpercentile(a[ok], [1, 99]) if ok.any() else (0, 1); g = np.clip((a - lo) / ((hi - lo) or 1) * 255, 0, 255)
        for i in range(3): out[:, :, i] = g
        out[:, :, 3] = np.where(ok, 255, 0)
    for k in range(1, n + 1):
        nd = ds.GetRasterBand(k).GetNoDataValue()
        if nd is not None and n >= 3 and k <= 3: pass
    return out, sc

def import_raster(job):
    """any raster GDAL reads, in any coordinate system: a grid of values (one band) back as values, or an image (photo,
    orthophoto, scanned map already georeferenced) back as a picture, reprojected to the project"""
    from osgeo import gdal, osr
    import numpy as np
    gdal.UseExceptions()
    prm = job.get('params', {}); src = gdal.Open(job['path'])
    if src is None: raise RuntimeError('GDAL could not read this file.')
    wkt = src.GetProjection(); gt = src.GetGeoTransform(can_return_null=True)
    if prm.get('srcepsg'): src = gdal.Translate('/vsimem/bfl_s.vrt', src, format='VRT', outputSRS=srs_of(prm['srcepsg']).ExportToWkt()); wkt = src.GetProjection()
    if not wkt or gt is None: raise RuntimeError('The file has no position on the ground: it is not georeferenced. Use Georeference an image to place it, or set its coordinate system if only that is missing.')
    image = src.RasterCount >= 3 or src.GetRasterBand(1).GetColorTable() is not None or str(prm.get('as', 'auto')) == 'image'
    maxpx = max(200, min(8192, int(prm.get('maxpx') or 2000)))
    prog(0.2, 'gdalwarp: to EPSG:%s' % job['epsg'])
    v = gdal.Warp('', src, format='VRT', dstSRS=srs_of(job['epsg']).ExportToWkt(), dstAlpha=image and src.RasterCount in (1, 3))
    VW, VH = v.RasterXSize, v.RasterYSize; s2 = min(1.0, maxpx / max(VW, VH))
    prog(0.4, 'gdalwarp: %d × %d px%s' % (max(1, int(VW * s2)), max(1, int(VH * s2)), ' (from %d × %d)' % (VW, VH) if s2 < 1 else ''))
    w = gdal.Warp('', v, format='MEM', width=max(1, int(VW * s2)), height=max(1, int(VH * s2)), resampleAlg=('average' if s2 < .7 else 'cubic') if image else 'bilinear', multithread=True)
    v = None
    g = w.GetGeoTransform(); W, H = w.RasterXSize, w.RasterYSize; box = [g[0], g[3] + g[5] * H, g[0] + g[1] * W, g[3]]
    if image:
        rgba, sc = rgba_of(w, maxpx); pic, mime = pic_b64(rgba); prog(0.9, 'Sending the picture (%s)' % mime); return {'image': pic, 'mime': mime, 'box': box, 'w': rgba.shape[1], 'h': rgba.shape[0], 'tool': 'GDAL %s gdalwarp' % gdal.__version__, 'detail': '%s, %d × %d px from %s' % (src.GetDriver().ShortName, W, H, osr.SpatialReference(wkt=wkt).GetName())}
    b = w.GetRasterBand(1); sc = min(1.0, maxpx / max(W, H)); W2, H2 = max(2, int(W * sc)), max(2, int(H * sc))
    a = b.ReadAsArray(buf_xsize=W2, buf_ysize=H2).astype(float); nd = b.GetNoDataValue()
    if nd is not None: a[a == nd] = np.nan
    fin = a[np.isfinite(a)]
    return {'values_b64': b64f(a), 'nx': W2, 'ny': H2, 'box': box, 'min': float(fin.min()) if fin.size else 0, 'max': float(fin.max()) if fin.size else 1, 'band': b.GetDescription() or '', 'tool': 'GDAL %s gdalwarp' % gdal.__version__, 'detail': '%s band 1 of %d, from %s' % (src.GetDriver().ShortName, src.RasterCount, osr.SpatialReference(wkt=wkt).GetName())}

def img_preview(job):
    """a picture of an image file to place control points on: at most maxpx across, and its full size"""
    from osgeo import gdal
    gdal.UseExceptions(); ds = gdal.Open(job['path'])
    if ds is None: raise RuntimeError('GDAL could not read this image.')
    rgba, sc = rgba_of(ds, int(job.get('maxpx') or 1800))
    return {'image': png_b64(rgba), 'w': ds.RasterXSize, 'h': ds.RasterYSize, 'pw': rgba.shape[1], 'ph': rgba.shape[0], 'tool': 'GDAL %s' % gdal.__version__}

def georef(job):
    """an image placed by control points (pixel -> map): GCPs on the image (gdal_translate), warped to the project (gdalwarp)
    with an affine, 2nd-order polynomial or thin-plate-spline fit; each point's error from the fit"""
    from osgeo import gdal, osr
    import numpy as np
    gdal.UseExceptions()
    ds = gdal.Open(job['path']); P = job['gcps']; how = str(job.get('method', 'affine'))
    gcps = [gdal.GCP(float(q[2]), float(q[3]), 0, float(q[0]), float(q[1])) for q in P]   # x, y on the map; pixel, line on the image
    wkt = srs_of(job['epsg']).ExportToWkt()
    prog(0.2, 'gdal_translate: %d control points on the image' % len(gcps))
    t = gdal.Translate('/vsimem/bfl_g.vrt', ds, format='VRT', GCPs=gcps, outputSRS=wkt)
    # each point's error: the fit made from all the points, evaluated at each (in metres)
    px = np.array([[q[0], q[1]] for q in P], float); xy = np.array([[q[2], q[3]] for q in P], float)
    def design(u, order): return np.c_[np.ones(len(u)), u] if order == 1 else np.c_[np.ones(len(u)), u, u[:, 0] ** 2, u[:, 0] * u[:, 1], u[:, 1] ** 2]
    order = 2 if how == 'poly2' else 1
    if how != 'tps':
        D = design(px, order); cf, *_ = np.linalg.lstsq(D, xy, rcond=None); res = np.hypot(*(D @ cf - xy).T)
    else: res = np.zeros(len(P))
    prog(0.5, 'gdalwarp: %s to EPSG:%s' % ({'affine': 'affine', 'poly2': '2nd-order polynomial', 'tps': 'thin-plate spline'}[how], job['epsg']))
    opts = dict(format='MEM', dstSRS=wkt, resampleAlg='cubic', dstAlpha=True)
    if how == 'tps': opts['tps'] = True
    else: opts['polynomialOrder'] = order
    try: w = gdal.Warp('', t, **opts)
    except RuntimeError as e:
        raise RuntimeError('The control points cannot fit a %s: %s Spread them over the whole picture (not along one line), or use the affine fit.' % ({'affine': 'flat transformation', 'poly2': '2nd-order polynomial', 'tps': 'thin-plate spline'}[how], str(e).split(':')[-1].strip().rstrip('.') + '.'))
    g = w.GetGeoTransform(); W, H = w.RasterXSize, w.RasterYSize; box = [g[0], g[3] + g[5] * H, g[0] + g[1] * W, g[3]]
    rgba, sc = rgba_of(w, int(job.get('maxpx') or 2400))
    out = {'image': png_b64(rgba), 'box': box, 'w': rgba.shape[1], 'h': rgba.shape[0], 'residuals': [float(r) for r in res], 'rms': float(np.sqrt(np.mean(res ** 2))) if len(res) else 0.0, 'cell': abs(g[1]),
           'tool': 'GDAL %s gdal_translate (GCPs), gdalwarp' % gdal.__version__, 'detail': '%d control points, %s' % (len(P), {'affine': 'affine (shift, scale, rotation, skew)', 'poly2': '2nd-order polynomial', 'tps': 'thin-plate spline (passes through every point)'}[how])}
    if job.get('save'):
        f = os.path.join(tempfile.mkdtemp(prefix='bfl-g-'), job.get('name', 'georeferenced') + '.tif'); d = gdal.Warp(f, t, format='GTiff', creationOptions=['COMPRESS=DEFLATE', 'TILED=YES'], **{k: v for k, v in opts.items() if k != 'format'}); d = None
        with open(f, 'rb') as fh: out['files'] = {os.path.basename(f): base64.b64encode(fh.read()).decode()}
        shutil.rmtree(os.path.dirname(f), ignore_errors=True)
    gdal.Unlink('/vsimem/bfl_g.vrt'); return out

def in_grass(job):
    job = floats(job)
    if job.get('kind') == 'rast':
        import grass.script as gs
        tmp = tempfile.mkdtemp(prefix='bfl-gin-')
        try: return in_grass_rast(job, gs, tmp)
        finally: shutil.rmtree(tmp, ignore_errors=True)
    if job.get('kind') == 'demfix':
        import grass.script as gs
        tmp = tempfile.mkdtemp(prefix='bfl-gin-')
        try: return in_grass_demfix(job, gs, tmp)
        finally: shutil.rmtree(tmp, ignore_errors=True)
    if job.get('kind') == 'hydro':
        import grass.script as gs
        tmp = tempfile.mkdtemp(prefix='bfl-gin-')
        try: return in_grass_hydro(job, gs, tmp)
        finally: shutil.rmtree(tmp, ignore_errors=True)
    import grass.script as gs
    m, P, prm = job['method'], job['pts'], job.get('params', {})
    tmp = tempfile.mkdtemp(prefix='bfl-gin-')
    ver = gs.version().get('version', '')
    three = m == 'grass_vol_rst'
    pf = os.path.join(tmp, 'pts.csv')
    with open(pf, 'w') as f:
        for p in P: f.write(','.join('%.6f' % v for v in p) + '\n')
    if three:   # v.vol.rst reads the value from an attribute column
        gs.run_command('v.in.ascii', input=pf, output='pts', separator='comma', columns='x double precision, y double precision, z double precision, v double precision', x=1, y=2, z=3, flags='z', overwrite=True, quiet=True)
    else:   # the 2D tools read the value from each point's z, so no attribute database is needed
        gs.run_command('v.in.ascii', input=pf, output='pts', separator='comma', x=1, y=2, z=3, flags='zt', overwrite=True, quiet=True)
    cv, cv_by = None, 'GRASS cross-validation (-c)'
    if three:
        x0, y0, z0, x1, y1, z1 = job['box3']; nx, ny, nz = int(job['nx']), int(job['ny']), int(job['nz'])
        gs.run_command('g.region', w=x0, e=x1, s=y0, n=y1, b=z0, t=z1, cols=nx, rows=ny, depths=nz, quiet=True)
        ten, smo = float(prm.get('tension', 40)), float(prm.get('smooth', 0.1))
        prog(0.1, 'Running v.vol.rst on %d samples, %d × %d × %d cells' % (len(P), nx, ny, nz))
        gs.run_command('v.vol.rst', input='pts', wcolumn='v', elevation='out', tension=ten, smooth=smo, overwrite=True, quiet=True)
        try:   # GRASS's own cross-validation: each point left out in turn
            gs.run_command('v.vol.rst', input='pts', wcolumn='v', cvdev='cv', tension=ten, smooth=smo, flags='c', overwrite=True, quiet=True)
            cv = [float(l.split('|')[-1]) for l in gs.read_command('v.out.ascii', input='cv', format='point', separator='|').strip().splitlines() if l.strip()]
        except Exception: cv = None
        txt = gs.read_command('r3.out.ascii', input='out', null='nan', flags='h', precision=8)
        nums = [float(t) for t in txt.split()]
        # r3.out.ascii without -r: depth by depth from the bottom, rows north to south, columns west to east
        import numpy as np
        A = np.array(nums, float).reshape(nz, ny, nx)
        T = np.array(job['targets'], float); dx, dy, dz = (x1 - x0) / nx, (y1 - y0) / ny, (z1 - z0) / nz
        fi = np.clip((T[:, 0] - x0) / dx - .5, 0, nx - 1); fj = np.clip((y1 - T[:, 1]) / dy - .5, 0, ny - 1); fk = np.clip((T[:, 2] - z0) / dz - .5, 0, nz - 1)
        i0, j0, k0 = (np.minimum(np.floor(a).astype(int), n - 2 if n > 1 else 0) for a, n in ((fi, nx), (fj, ny), (fk, nz)))
        u, w, t = fi - i0, fj - j0, fk - k0
        i1, j1, k1 = np.minimum(i0 + 1, nx - 1), np.minimum(j0 + 1, ny - 1), np.minimum(k0 + 1, nz - 1)
        c = lambda k, j, i: A[k, j, i]
        val = ((c(k0, j0, i0) * (1 - u) + c(k0, j0, i1) * u) * (1 - w) + (c(k0, j1, i0) * (1 - u) + c(k0, j1, i1) * u) * w) * (1 - t) + ((c(k1, j0, i0) * (1 - u) + c(k1, j0, i1) * u) * (1 - w) + (c(k1, j1, i0) * (1 - u) + c(k1, j1, i1) * u) * w) * t
        res = {'values': as_list(val), 'detail': 'tension %g, smoothing %g; 3D grid %d × %d × %d' % (ten, smo, nx, ny, nz), 'tool': 'GRASS GIS %s v.vol.rst' % ver}
    else:
        xs, ys, dx, dy, nx, ny = grid_axes(job); x0, y0, x1, y1 = job['box']
        gs.run_command('g.region', w=x0, e=x1, s=y0, n=y1, cols=nx, rows=ny, quiet=True)
        def surf(src, out):
            if m == 'grass_rst':
                ten, smo = float(prm.get('tension', 40)), float(prm.get('smooth', 0.1))
                gs.run_command('v.surf.rst', input=src, elevation=out, tension=ten, smooth=smo, overwrite=True, quiet=True); return 'tension %g, smoothing %g' % (ten, smo)
            if m == 'grass_bspline':
                step = float(prm.get('step', max(dx, dy) * 4)); lam = float(prm.get('lambda', 0.01))
                gs.run_command('v.surf.bspline', input=src, raster_output=out, ew_step=step, ns_step=step, method=prm.get('spline', 'bicubic'), lambda_i=lam, overwrite=True, quiet=True); return '%s splines, step %g m, Tykhonov λ %g' % (prm.get('spline', 'bicubic'), step, lam)
            if m == 'grass_idw':
                npts, pw = int(prm.get('npoints', 12)), float(prm.get('power', 2))
                gs.run_command('v.surf.idw', input=src, output=out, npoints=min(npts, len(P) - 1), power=pw, overwrite=True, quiet=True); return '%d nearest points, power %g' % (npts, pw)
            raise RuntimeError('Unknown GRASS method ' + m)
        prog(0.08, 'Running %s on %d points, %d × %d cells' % ({'grass_rst': 'v.surf.rst', 'grass_bspline': 'v.surf.bspline', 'grass_idw': 'v.surf.idw'}[m], len(P), nx, ny))
        detail = surf('pts', 'out')
        prog(0.25, 'Surface made; checking it: each point left out in turn')
        if job.get('loo', True) and len(P) <= 120:   # each point left out in turn, the same tool rerun, read back at the point (r.what)
            dev = []
            for i in range(len(P)):
                prog(0.25 + 0.7 * i / len(P), 'Leave-one-out %d of %d (the same GRASS tool rerun)' % (i + 1, len(P)))
                sf = os.path.join(tmp, 'loo.csv')
                with open(sf, 'w') as f:
                    for j, p in enumerate(P):
                        if j != i: f.write(','.join('%.6f' % v for v in p) + '\n')
                gs.run_command('v.in.ascii', input=sf, output='loo', separator='comma', x=1, y=2, z=3, flags='zt', overwrite=True, quiet=True)
                surf('loo', 'loo_r')
                v = gs.read_command('r.what', map='loo_r', coordinates='%.6f,%.6f' % (P[i][0], P[i][1]), null_value='nan').strip().split('|')[-1]
                try: dev.append(float(v) - P[i][2])
                except ValueError: dev = None; break
            if dev: cv = [abs(d) for d in dev]; cv_by = 'leave-one-out, %s rerun in the same GRASS session' % {'grass_rst': 'v.surf.rst', 'grass_bspline': 'v.surf.bspline', 'grass_idw': 'v.surf.idw'}[m]
        txt = gs.read_command('r.out.ascii', input='out', null_value='nan', flags='h', precision=8)
        res = {'values': [None if t == 'nan' else float(t) for t in txt.split()], 'detail': detail, 'tool': 'GRASS GIS %s %s' % (ver, {'grass_rst': 'v.surf.rst', 'grass_bspline': 'v.surf.bspline', 'grass_idw': 'v.surf.idw'}[m])}
    if cv: res['loo'] = math.sqrt(sum(d * d for d in cv) / len(cv)); res['loo_by'] = cv_by
    shutil.rmtree(tmp, ignore_errors=True)
    return res

def grass_job(job):
    return grass_run(job)

# ---------- contours and files (GDAL) ----------
def export(job):
    """GeoTIFF of the surface, GeoPackage of contours, points and lines; in the project's coordinate system"""
    from osgeo import gdal, ogr, osr
    import numpy as np
    gdal.UseExceptions(); ogr.UseExceptions()
    xs, ys, dx, dy, nx, ny = grid_axes(job); x0, y0, x1, y1 = job['box']
    srs = osr.SpatialReference(); srs.ImportFromEPSG(int(job['epsg']))
    tmp = tempfile.mkdtemp(prefix='bfl-exp-'); files = {}
    prog(0.1, 'Writing the GeoTIFF (EPSG:%s)' % job['epsg'])
    try:
        tif = os.path.join(tmp, job.get('name', 'surface') + '.tif')
        ds = gdal.GetDriverByName('GTiff').Create(tif, nx, ny, 1, gdal.GDT_Float32, ['COMPRESS=DEFLATE', 'TILED=YES'])
        ds.SetGeoTransform([x0, dx, 0, y1, 0, -dy]); ds.SetProjection(srs.ExportToWkt())
        b = ds.GetRasterBand(1); b.SetNoDataValue(-9999)
        a = np.array([(-9999 if v is None else v) for v in job['values']], float).reshape(ny, nx)
        if job.get('unlog'): a = np.where(a == -9999, -9999, 10 ** a)
        b.WriteArray(a); b.SetDescription(job.get('band', 'value')); ds.SetMetadataItem('SOURCE', job.get('source', ''))
        prog(0.5, 'Contours (gdal_contour) and the GeoPackage')
        gpkg = os.path.join(tmp, job.get('name', 'surface') + '.gpkg')
        vd = ogr.GetDriverByName('GPKG').CreateDataSource(gpkg)
        cl = vd.CreateLayer('contours', srs, ogr.wkbLineString); cl.CreateField(ogr.FieldDefn('ID', ogr.OFTInteger)); cl.CreateField(ogr.FieldDefn('value', ogr.OFTReal))
        gdal.ContourGenerateEx(b, cl, options=['FIXED_LEVELS=' + ','.join(str(v) for v in job.get('levels', [])), 'ID_FIELD=0', 'ELEV_FIELD=1'])
        pl = vd.CreateLayer('boreholes', srs, ogr.wkbPoint)
        for k, t in (('name', ogr.OFTString), ('value', ogr.OFTReal), ('used', ogr.OFTInteger)): pl.CreateField(ogr.FieldDefn(k, t))
        for p in job.get('points', []):
            f = ogr.Feature(pl.GetLayerDefn()); f.SetField('name', p.get('name', '')); f.SetField('value', p.get('value')); f.SetField('used', 1 if p.get('used', True) else 0)
            g = ogr.Geometry(ogr.wkbPoint); g.AddPoint_2D(p['x'], p['y']); f.SetGeometry(g); pl.CreateFeature(f)
        for nm, lines in (job.get('lines') or {}).items():
            ll = vd.CreateLayer(nm, srs, ogr.wkbLineString); ll.CreateField(ogr.FieldDefn('name', ogr.OFTString))
            for ln in lines:
                f = ogr.Feature(ll.GetLayerDefn()); f.SetField('name', ln.get('name', '')); g = ogr.Geometry(ogr.wkbLineString)
                for x, y in ln['pts']: g.AddPoint_2D(x, y)
                f.SetGeometry(g); ll.CreateFeature(f)
        vd = None; b = None; ds = None
        for p in (tif, gpkg):
            with open(p, 'rb') as f: files[os.path.basename(p)] = base64.b64encode(f.read()).decode()
        return {'files': files, 'tool': 'GDAL %s' % gdal.__version__}
    finally: shutil.rmtree(tmp, ignore_errors=True)

def contours(job):
    """contour lines of a grid by gdal_contour's algorithm, as [[level, [[x, y], ...]], ...]"""
    from osgeo import gdal, ogr
    import numpy as np
    gdal.UseExceptions()
    xs, ys, dx, dy, nx, ny = grid_axes(job); x0, y0, x1, y1 = job['box']
    ds = gdal.GetDriverByName('MEM').Create('', nx, ny, 1, gdal.GDT_Float64); ds.SetGeoTransform([x0, dx, 0, y1, 0, -dy])
    b = ds.GetRasterBand(1); b.SetNoDataValue(-9999); b.WriteArray(np.array([(-9999 if v is None else v) for v in job['values']], float).reshape(ny, nx))
    vd = ogr.GetDriverByName('Memory').CreateDataSource('c'); cl = vd.CreateLayer('c', None, ogr.wkbLineString)
    cl.CreateField(ogr.FieldDefn('ID', ogr.OFTInteger)); cl.CreateField(ogr.FieldDefn('v', ogr.OFTReal))
    gdal.ContourGenerateEx(b, cl, options=['FIXED_LEVELS=' + ','.join(str(v) for v in job['levels']), 'ID_FIELD=0', 'ELEV_FIELD=1'])
    out = []
    for f in cl:
        g = f.GetGeometryRef(); out.append([f.GetField('v'), [[round(g.GetX(i), 3), round(g.GetY(i), 3)] for i in range(g.GetPointCount())]])
    return {'lines': out, 'tool': 'GDAL %s gdal_contour' % gdal.__version__}

def floats(job):
    for k in ('pts', 'targets', 'ground', 'pts2'):
        if k in job: job[k] = [[float(v) for v in p] for p in job[k]]
    return job


# ---------- contamination and sampling tools (PyKrige) ----------
def in_poly(x, y, poly):
    """points (arrays) inside a polygon [[x, y], ...], by ray casting"""
    import numpy as np
    x, y = np.asarray(x, float), np.asarray(y, float); inside = np.zeros(x.shape, bool)
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]; x2, y2 = poly[(i + 1) % n]
        cross = ((y1 > y) != (y2 > y)) & (x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1)
        inside ^= cross
    return inside

def soil_volume(job):
    """3D ordinary kriging (PyKrige OrdinaryKriging3D) of the samples on a block grid; the app counts the blocks over the level"""
    import numpy as np, pykrige
    from pykrige.ok3d import OrdinaryKriging3D
    P, prm = job['pts'], dict(job.get('params', {}), coarse=1, models=('spherical', 'exponential'))
    def make(r, model, vp): return OrdinaryKriging3D(r[:, 0], r[:, 1], r[:, 2], r[:, 3], variogram_model=model, variogram_parameters=vp)
    def predict(k, p): z, _ = k.execute('points', np.array([p[0]], float), np.array([p[1]], float), np.array([p[2]], float)); return float(np.asarray(z)[0])
    (model, vp, e), n = pykrige_best(P, make, predict, 3, prm)
    x0, y0, z0, x1, y1, z1 = job['box3']; nx, ny, nz = int(job['nx']), int(job['ny']), int(job['nz'])
    gx = np.array([x0 + (x1 - x0) / nx * (i + .5) for i in range(nx)]); gy = np.array([y0 + (y1 - y0) / ny * (j + .5) for j in range(ny)]); gz = np.array([z0 + (z1 - z0) / nz * (k + .5) for k in range(nz)])
    prog(0.92, 'Kriging %d blocks with the %s variogram' % (nx * ny * nz, model))
    k = make(np.array(P, float), model, vp); z, ss = k.execute('grid', gx, gy, gz)
    z, ss = np.asarray(z)[:, ::-1, :], np.asarray(ss)[:, ::-1, :]   # depth slices from the top, rows north first
    vals = np.array(P, float)[:, 3]; z = np.clip(z, vals.min(), vals.max())   # held between the lowest and highest sample
    return {'values': as_list(z), 'var': as_list(ss), 'loo': e, 'loo_by': 'leave-one-out', 'sill': vp['sill'], 'tool': 'PyKrige %s OrdinaryKriging3D' % pykrige.__version__,
            'detail': '%s variogram, range %.3g m (layered), nugget %d %% (the best of %d spherical and exponential variograms by leave-one-out); estimates held between the lowest and highest sample' % (model, vp['range'], round(100 * vp['nugget'] / vp['sill']), n)}

def ok2d_fit(P, prm):
    import numpy as np
    from pykrige.ok import OrdinaryKriging
    def make(r, model, vp): return OrdinaryKriging(r[:, 0], r[:, 1], r[:, 2], variogram_model=model, variogram_parameters=vp)
    def predict(k, p): z, _ = k.execute('points', np.array([p[0]], float), np.array([p[1]], float)); return float(np.asarray(z)[0])
    return pykrige_best(P, make, predict, 2, prm), make

def drill_next(job):
    """where the kriging estimate is least certain: the kriging standard error, and the next places to drill picked one at a
    time, each added before the next is chosen (the kriging variance depends on where samples are, not on their values)"""
    import numpy as np, pykrige
    P, prm = job['pts'], job.get('params', {})
    ((model, vp, e), n), make = ok2d_fit(P, prm)
    xs, ys, dx, dy, nx, ny = grid_axes(job); X, Y = np.meshgrid(np.array(xs), np.array(ys))
    mask = in_poly(X, Y, job['hull']) if job.get('hull') else np.ones(X.shape, bool)
    pts = np.array(P, float); picks, first, N = [], None, int(job.get('n', 3))
    from scipy.spatial.distance import cdist
    nn = np.sort(cdist(pts[:, :2], pts[:, :2]), axis=1)[:, 1] if len(pts) > 1 else np.array([10.0])
    gap = float(prm.get('gap', 0)) or 0.5 * float(np.median(nn))   # at least half the typical spacing from any borehole or other suggestion
    for t in range(N + 1):
        prog(0.6 + 0.35 * t / (N + 1), 'Kriging variance with %d samples' % len(pts))
        k = make(pts, model, vp); _, ss = k.execute('grid', np.array(xs, float), np.array(ys[::-1], float)); ss = np.asarray(ss)[::-1]
        if first is None: first = ss.copy()
        if t == N: break
        far = cdist(np.c_[X.ravel(), Y.ravel()], pts[:, :2]).min(axis=1).reshape(X.shape) >= gap
        c = np.where(mask & far, ss, -np.inf)
        if not np.isfinite(c).any(): break
        j, i = np.unravel_index(np.argmax(c), c.shape)
        picks.append([float(X[j, i]), float(Y[j, i]), float(np.sqrt(max(0, ss[j, i])))])
        pts = np.vstack([pts, [X[j, i], Y[j, i], float(np.mean(pts[:, 2]))]])
    return {'values': as_list(np.sqrt(np.maximum(first, 0))), 'after': as_list(np.sqrt(np.maximum(ss, 0))), 'picks': picks, 'loo': e, 'tool': 'PyKrige %s OrdinaryKriging (kriging variance)' % pykrige.__version__,
            'gap': gap, 'detail': '%s variogram, range %.3g m, nugget %d %% (the best of %d by leave-one-out); suggestions at least %.0f m from any borehole and each other' % (model, vp['range'], round(100 * vp['nugget'] / vp['sill']), n, gap)}

def prob_over(job):
    """indicator kriging: 1 where a reading is at or over the level, 0 below; kriged, the chance of being over at each place"""
    import numpy as np, pykrige
    lv = float(job['level']); I = [[p[0], p[1], 1.0 if p[2] >= lv else 0.0] for p in job['pts']]
    xs, ys, dx, dy, nx, ny = grid_axes(job)
    n1 = int(sum(p[2] for p in I))
    if n1 in (0, len(I)):
        return {'values': [float(n1 > 0)] * (nx * ny), 'tool': 'PyKrige %s (indicator)' % pykrige.__version__, 'detail': 'every reading is on the same side of the level', 'constant': True}
    ((model, vp, e), n), make = ok2d_fit(I, job.get('params', {}))
    prog(0.92, 'Kriging the indicator with the %s variogram' % model)
    k = make(np.array(I, float), model, vp); z, _ = k.execute('grid', np.array(xs, float), np.array(ys[::-1], float))
    z = np.clip(np.asarray(z)[::-1], 0, 1)
    return {'values': as_list(z), 'loo': e, 'n_over': n1, 'tool': 'PyKrige %s OrdinaryKriging of indicators' % pykrige.__version__,
            'detail': 'indicator kriging: %d of %d readings at or over the level; %s variogram, range %.3g m (the best of %d by leave-one-out)' % (n1, len(I), model, vp['range'], n)}


# ---------- terrain ----------
# ---------- terrain ----------
def b64f(a):
    """a grid as little-endian float32 in base64 (NaN for no data): compact for large grids"""
    import numpy as np
    return base64.b64encode(np.ascontiguousarray(np.asarray(a, dtype='<f4')).tobytes()).decode()

def b64u8(a):
    import numpy as np
    return base64.b64encode(np.ascontiguousarray(np.nan_to_num(np.clip(np.asarray(a, float), 0, 255), nan=0).astype(np.uint8)).tobytes()).decode()

def nice_step(rng, n=8):
    raw = max(rng, 1e-6) / n; p = 10 ** math.floor(math.log10(raw)); m = raw / p
    return (1 if m < 1.5 else 2 if m < 3.5 else 5 if m < 7.5 else 10) * p

def terrain_products(ds, band, prm, P_contours=True):
    """hillshade, slope and contours of an elevation grid (gdaldem, gdal_contour), with the options chosen"""
    from osgeo import gdal, ogr
    import numpy as np
    a = band.ReadAsArray().astype(float); nd = band.GetNoDataValue()
    if nd is not None: a[a == nd] = np.nan
    z = float(prm.get('zfactor', 1) or 1)
    opts = dict(computeEdges=True, zFactor=z)
    if str(prm.get('shade', 'single')) == 'multi': opts['multiDirectional'] = True
    else: opts.update(azimuth=float(prm.get('azimuth', 315)), altitude=float(prm.get('altitude', 45)))
    prog(0.6, 'gdaldem hillshade%s, slope' % (' (multidirectional)' if opts.get('multiDirectional') else ' (sun %g°, %g° high)' % (opts['azimuth'], opts['altitude'])))
    hds = gdal.DEMProcessing('/vsimem/bfl_hs.tif', ds, 'hillshade', **opts); h = hds.GetRasterBand(1).ReadAsArray().astype(float); hds = None
    sds = gdal.DEMProcessing('/vsimem/bfl_sl.tif', ds, 'slope', computeEdges=True); sl = sds.GetRasterBand(1).ReadAsArray().astype(float); sds = None
    gdal.Unlink('/vsimem/bfl_hs.tif'); gdal.Unlink('/vsimem/bfl_sl.tif')
    fin = a[np.isfinite(a)]; lo, hi = float(fin.min()), float(fin.max())
    step = float(prm.get('interval') or 0) or nice_step(hi - lo, 8)
    levels = [round(v, 6) for v in np.arange(math.ceil(lo / step) * step, hi + 1e-9, step)][:500]
    lines = []
    if levels:
        prog(0.8, 'gdal_contour: every %g m' % step)
        vd = ogr.GetDriverByName('Memory').CreateDataSource('c'); cl = vd.CreateLayer('c', None, ogr.wkbLineString)
        cl.CreateField(ogr.FieldDefn('ID', ogr.OFTInteger)); cl.CreateField(ogr.FieldDefn('v', ogr.OFTReal))
        gdal.ContourGenerateEx(band, cl, options=['FIXED_LEVELS=' + ','.join(str(v) for v in levels), 'ID_FIELD=0', 'ELEV_FIELD=1'])
        for f in cl:
            g = f.GetGeometryRef(); lines.append([round(f.GetField('v'), 6), [[round(g.GetX(i), 2), round(g.GetY(i), 2)] for i in range(g.GetPointCount())]])
    m = np.isfinite(a)
    return {'values_b64': b64f(a), 'hill_b64': b64u8(np.where(m, h, 0)), 'slope_b64': b64f(np.where(m, sl, np.nan)), 'lines': lines, 'step': step, 'min': lo, 'max': hi}

def dem(job):
    """an elevation model from a file (GeoTIFF, ASCII grid, …): reprojected to the project (gdalwarp: averaging when it is made
    coarser, bilinear when finer), clipped to the area, with hillshade and slope (gdaldem) and contours (gdal_contour)"""
    from osgeo import gdal, osr
    import numpy as np
    gdal.UseExceptions(); osr.UseExceptions()
    prm = job.get('params', {})
    prog(0.05, 'Opening the file with GDAL')
    src = gdal.Open(job['path'])
    if src is None or src.RasterCount < 1: raise RuntimeError('GDAL could not read an elevation grid from this file.')
    drv = src.GetDriver().ShortName; gt = src.GetGeoTransform(); wkt = src.GetProjection(); assumed = not wkt
    if prm.get('srcepsg'): wkt = srs_of(prm['srcepsg']).ExportToWkt(); assumed = False; src = gdal.Translate('/vsimem/bfl_src.vrt', src, format='VRT', outputSRS=wkt)
    sr = osr.SpatialReference(wkt=wkt) if wkt else None; sname = sr.GetName() if sr else 'none in the file: taken as the project coordinate system'
    # the file's own cell size in metres (for a geographic file, at this latitude)
    x0, y0, x1, y1 = job['box']
    if sr is None: sres = abs(gt[1])
    elif sr.IsProjected(): sres = abs(gt[1]) * sr.GetLinearUnits()
    else:   # geographic (degrees): measure a cell once warped to the project's coordinates
        tmp = gdal.Warp('/vsimem/bfl_probe.vrt', src, format='VRT', dstSRS='EPSG:%d' % job['epsg']); sres = abs(tmp.GetGeoTransform()[1]); tmp = None; gdal.Unlink('/vsimem/bfl_probe.vrt')
    span = max(x1 - x0, y1 - y0)
    if prm.get('cellsize'): res = float(prm['cellsize'])
    elif str(prm.get('cells', '400')) == 'source': res = sres
    else: res = span / float(prm.get('cells', 400))
    capped = False
    while (x1 - x0) / res * (y1 - y0) / res > 4.2e6: res *= 1.25; capped = True
    alg = 'average' if res > sres * 1.05 else 'bilinear'
    prog(0.2, 'gdalwarp: to EPSG:%d at %.2f m (%s; the file is %.2f m)' % (job['epsg'], res, alg, sres))
    w = gdal.Warp('/vsimem/bfl_dem.tif', src, format='GTiff', dstSRS='EPSG:%d' % job['epsg'], srcSRS=('EPSG:%d' % job['epsg']) if assumed else None, outputBounds=[x0, y0, x1, y1], xRes=res, yRes=res, resampleAlg=alg, dstNodata=-99999, outputType=gdal.GDT_Float32)
    b = w.GetRasterBand(1)
    shift = float(prm.get('shift') or 0)
    if shift:   # onto the boreholes' datum
        a = b.ReadAsArray().astype(float); a[a > -99998] += shift; b.WriteArray(a)
    a = b.ReadAsArray()
    if not (a > -99998).any(): w = None; gdal.Unlink('/vsimem/bfl_dem.tif'); raise RuntimeError('The file does not cover this area (after reprojecting it to EPSG:%d).' % job['epsg'])
    ny, nx = a.shape; gt2 = w.GetGeoTransform()
    out = terrain_products(w, b, prm)
    w = None; gdal.Unlink('/vsimem/bfl_dem.tif')
    return {**out, 'box': [gt2[0], gt2[3] + gt2[5] * ny, gt2[0] + gt2[1] * nx, gt2[3]], 'nx': nx, 'ny': ny, 'res': res, 'src_res': sres, 'capped': capped, 'resample': alg, 'shift': shift,
            'tool': 'GDAL %s gdalwarp, gdaldem, gdal_contour' % gdal.__version__,
            'detail': '%s file, %s, %.2f m cells; reprojected to EPSG:%d at %.2f m (%s)%s' % (drv, sname, sres, job['epsg'], res, 'averaged' if alg == 'average' else 'bilinear', ', shifted %+.2f m onto the boreholes\' datum' % shift if shift else ''), 'assumed': assumed}

def area_over(job):
    """the part of a surface at or over a level: a mask polygonized by GDAL (gdal.Polygonize), its area from OGR"""
    from osgeo import gdal, ogr
    import numpy as np
    gdal.UseExceptions(); ogr.UseExceptions()
    xs, ys, dx, dy, nx, ny = grid_axes(job); x0, y0, x1, y1 = job['box']
    prog(0.2, 'Marking the cells at or over the level')
    a = np.array([(np.nan if v is None else v) for v in job['values']], float).reshape(ny, nx)
    mk = np.where(np.isfinite(a) & (a >= float(job['level'])), 1, 0).astype(np.uint8)
    ds = gdal.GetDriverByName('MEM').Create('', nx, ny, 1, gdal.GDT_Byte); ds.SetGeoTransform([x0, dx, 0, y1, 0, -dy])
    b = ds.GetRasterBand(1); b.WriteArray(mk); b.SetNoDataValue(0)
    prog(0.5, 'gdal.Polygonize')
    vd = ogr.GetDriverByName('Memory').CreateDataSource('a'); ly = vd.CreateLayer('a', None, ogr.wkbPolygon); ly.CreateField(ogr.FieldDefn('v', ogr.OFTInteger))
    gdal.Polygonize(b, b, ly, 0, [], callback=None)
    polys, tot = [], 0.0
    for f in ly:
        g = f.GetGeometryRef(); tot += g.GetArea()
        rings = []
        for i in range(g.GetGeometryCount()):
            r = g.GetGeometryRef(i); rings.append([[round(r.GetX(k), 3), round(r.GetY(k), 3)] for k in range(r.GetPointCount())])
        polys.append(rings)
    return {'polys': polys, 'area': tot, 'cells': int(mk.sum()), 'tool': 'GDAL %s Polygonize' % gdal.__version__, 'detail': '%d cells of %.3g × %.3g m' % (int(mk.sum()), dx, dy)}

def run(job):
    job = floats(job)
    if job.get('network'):
        os.environ['PROJ_NETWORK'] = 'ON'
        cache = os.path.join(os.path.dirname(sys.prefix), 'proj-grids'); os.makedirs(cache, exist_ok=True); os.environ['PROJ_USER_WRITABLE_DIRECTORY'] = cache
    if job.get('kind') == 'crs': return crs_job(job)
    if job.get('kind') == 'importvec': return import_vector(job)
    if job.get('kind') == 'rgdal': return rast_gdal(job)
    if job.get('kind') == 'importrast': return import_raster(job)
    if job.get('kind') == 'imgprev': return img_preview(job)
    if job.get('kind') == 'georef': return georef(job)
    if job.get('kind') in ('hydro', 'demfix', 'rast'): return grass_run(job)
    if job.get('kind') == 'trees': return find_trees(job)
    if job.get('kind') == 'otrees': return ortho_trees(job)
    if job.get('kind') == 'thiessen': return thiessen(job)
    if job.get('kind') == 'setback': return setback(job)
    if job.get('kind') == 'exportlayer': return export_layer(job)
    if job.get('kind') == 'area': return area_over(job)
    if job.get('kind') == 'dem': return dem(job)
    if job.get('kind') == 'volume': return soil_volume(job)
    if job.get('kind') == 'drillnext': return drill_next(job)
    if job.get('kind') == 'prob': return prob_over(job)
    k, m = job.get('kind'), job.get('method', '')
    if k == 'versions': return versions()
    if k == 'export': return export(job)
    if k == 'contours': return contours(job)
    if k == 'surface':
        if m.startswith('gdal_'): return gdal_surface(job)
        if m.startswith('pykrige_'): return pykrige_surface(job)
        if m == 'gstools_ok': return gstools_job(job, 2)
        if m.startswith('grass_'): return grass_job(job)
    if k == 'points3d':
        if m == 'pykrige_ok3d': return pykrige_points3d(job)
        if m == 'gstools_ok3d': return gstools_job(job, 3)
        if m == 'grass_vol_rst': return grass_job(job)
    raise RuntimeError('Unknown job: %s %s' % (k, m))

if __name__ == '__main__':
    a = sys.argv[1:]
    inside = a[:1] == ['--in-grass']
    if inside: a = a[1:]
    with open(a[0]) as f: job = json.load(f)
    try: res = {'ok': True, **(in_grass(job) if inside else run(job))}
    except Exception as e: res = {'ok': False, 'error': '%s: %s' % (type(e).__name__, e)}
    with open(a[1], 'w') as f: json.dump(res, f)
