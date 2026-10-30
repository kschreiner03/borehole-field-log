import { useEffect, useMemo, useState } from 'react';
import { utmToLl, zoneFromCrs } from '@core/geo';
import { flowPlane } from '@core/hydro';
import { labVal } from '@core/lab';
import { sptN } from '@core/soil';
import type { Borehole } from '@core/types';

/* New interface, first screen: open a project file and see its boreholes and groundwater, computed by the tested core. */
interface Project { name: string; path: string; title: string; boreholes: Borehole[] }

function parseProject(f: { name: string; path: string; text: string }): Project {
  const data = JSON.parse(f.text);
  const list: Borehole[] = Array.isArray(data) ? data : data.boreholes;
  if (!Array.isArray(list)) throw new Error('This file is not a borehole project.');
  for (const b of list) { b.layers ||= []; b.samples ||= []; b.water ||= []; }
  return { name: f.name, path: f.path, title: data.project || list[0]?.project || f.name, boreholes: list };
}
const depthOf = (b: Borehole) => Math.max(0, ...b.layers.map(l => l.bottom ?? 0), ...b.samples.map(s => s.depth ?? 0));
const latestWater = (b: Borehole) => b.water.filter(w => w.depth != null && w.kind !== 'strike').sort((x, y) => (x.date || '').localeCompare(y.date || '')).pop();
const fmt = (v: number | null | undefined, d = 2) => v == null ? '—' : v.toLocaleString('en-CA', { minimumFractionDigits: d, maximumFractionDigits: d });

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState('');
  const load = (f: { name: string; path: string; text: string } | null) => { if (!f) return; try { setProject(parseProject(f)); setError(''); } catch (e) { setError((e as Error).message); } };
  const open = async () => load(await window.desktop?.open() ?? null);
  useEffect(() => {
    window.desktop?.onOpenFile(load);
    window.desktop?.onMenu(act => { if (act === 'open-file') open(); });
    window.desktop?.ready();
  }, []);

  const rows = useMemo(() => (project?.boreholes || []).map(b => {
    const zone = zoneFromCrs(b.crs), ll = zone && b.easting != null && b.northing != null ? utmToLl(b.easting, b.northing, zone) : null;
    const vap = Math.max(-1, ...b.samples.map(s => s.cvc ?? -1));
    const f1b = Math.max(-1, ...b.samples.map(s => { const r = labVal(s, 'f1b'); return r && !r.lt ? r.v ?? -1 : -1; }));
    return { b, depth: depthOf(b), ll, vap: vap >= 0 ? vap : null, f1b: f1b >= 0 ? f1b : null, spt: b.samples.filter(s => sptN(s) != null).length, water: latestWater(b) };
  }), [project]);

  /* flow from one monitoring round of standpipe readings: the latest date that at least 3 wells were read (within 31 days),
     the same rule the classic interface uses; drilling and completion readings are not heads */
  const flow = useMemo(() => {
    const wells = rows.filter(r => (r.b as Borehole & { well?: { installed?: boolean } }).well?.installed && r.b.easting != null && r.b.northing != null && r.b.elevation != null);
    const reads = (b: Borehole) => b.water.filter(w => w.depth != null && w.date && !['strike', 'completion'].includes(w.kind || ''));
    const dates = [...new Set(wells.flatMap(r => reads(r.b).map(w => w.date!)))].sort().reverse();
    const near = (b: Borehole, d: string) => { let best: Borehole['water'][number] | null = null, bd = Infinity; for (const w of reads(b)) { const dd = Math.abs(Date.parse(w.date!) - Date.parse(d)); if (dd < bd) { bd = dd; best = w; } } return bd <= 31 * 864e5 ? best : null; };
    const round = dates.find(d => wells.filter(r => near(r.b, d)).length >= 3);
    if (!round) return null;
    const heads = wells.map(r => ({ r, w: near(r.b, round) })).filter(x => x.w).map(({ r, w }) => ({ e: r.b.easting!, n: r.b.northing!, h: r.b.elevation! - w!.depth! }));
    return { ...flowPlane(heads), round };
  }, [rows]);

  return (
    <div className="shell">
      <header className="bar">
        <span className="brand">Borehole Field Log</span>
        <span className="tag">New interface · preview</span>
        <span className="sp" />
        <button className="btn primary" onClick={open}>Open project…</button>
      </header>
      <main className="sheet">
        {!project ? (
          <section className="empty">
            <h1>Open a project to begin</h1>
            <p>Choose a <b>.bhp</b> project or <b>.bhlog</b> workspace saved from the classic interface. This preview lists the boreholes and works out the groundwater flow with the new, tested calculation engine.</p>
            <button className="btn primary" onClick={open}>Open project…</button>
            {error && <p className="err" role="alert">{error}</p>}
          </section>
        ) : (
          <>
            <p className="crumb">{project.name}</p>
            <h1>{project.title}</h1>
            <p className="facts">{project.boreholes.length} boreholes · {project.boreholes.filter(b => (b as Borehole & { well?: { installed?: boolean } }).well?.installed).length} wells</p>
            <section className="panel">
              <h2>Groundwater flow</h2>
              {!flow ? <p className="note">No water levels with coordinates and ground elevations yet.</p>
                : 'error' in flow ? <p className="note">{flow.error}</p>
                : <p className="finding">Flows toward <b>{Math.round(flow.az)}° ({flow.dir})</b> at a gradient of <b>{flow.i.toFixed(4)}</b>, from {flow.n} wells{flow.r2 != null ? ` (plane fit R² ${flow.r2.toFixed(3)})` : ' (three-point problem)'}, monitoring round {flow.round}.</p>}
            </section>
            <section className="panel">
              <h2>Boreholes</h2>
              <div className="scroll"><table>
                <thead><tr><th>Borehole</th><th className="r">Depth (m)</th><th className="r">Easting</th><th className="r">Northing</th><th className="r">Latitude</th><th className="r">Longitude</th><th className="r">Water (m)</th><th className="r">Max vapour (ppm)</th><th className="r">Max F1 − BTEX</th><th className="r">SPT tests</th></tr></thead>
                <tbody>{rows.map(r => <tr key={r.b.id}>
                  <td><b>{r.b.name}</b></td><td className="r">{fmt(r.depth)}</td><td className="r">{fmt(r.b.easting, 1)}</td><td className="r">{fmt(r.b.northing, 1)}</td>
                  <td className="r">{r.ll ? r.ll[0].toFixed(6) : '—'}</td><td className="r">{r.ll ? r.ll[1].toFixed(6) : '—'}</td>
                  <td className="r">{fmt(r.water?.depth)}</td><td className="r">{r.vap == null ? '—' : r.vap.toLocaleString('en-CA')}</td><td className="r">{r.f1b == null ? '—' : r.f1b.toLocaleString('en-CA')}</td><td className="r">{r.spt}</td>
                </tr>)}</tbody>
              </table></div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
