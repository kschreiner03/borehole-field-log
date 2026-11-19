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

def in_grass(job):
    job = floats(job)
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
    if job.get('kind') == 'hydro': return grass_run(job)
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
