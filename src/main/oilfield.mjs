// Oilfield data: starts the worker (resources/oilfield/worker.mjs) with a checked job. One download or production job at a time.
import { Worker } from 'node:worker_threads';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
const KEYS = ['wells', 'pipelines', 'facilities', 'releases'], keys = k => Array.isArray(k) ? KEYS.filter(x => k.includes(x)) : [];
/* a job from the page, with nothing in it but what is expected; null when it is not one */
export function oilJob(q) {
  if (!q || typeof q !== 'object') return null; if (q.do === 'status') return { do: 'status' };
  if (q.do === 'search') { const b = Array.isArray(q.box) ? q.box.map(Number) : [], k = keys(q.keys); return b.length === 4 && b.every(Number.isFinite) && b[0] < b[2] && b[1] < b[3] && b[2] - b[0] <= 1.5 && b[3] - b[1] <= 1 && k.length ? { do: 'search', box: b, keys: k } : null; }
  if (q.do === 'get') { const k = keys(q.keys); return k.length ? { do: 'get', keys: k } : null; }
  if (q.do === 'prod') { const ids = Array.isArray(q.ids) ? q.ids.filter(x => typeof x === 'string' && /^(AB|SK)WI[0-9A-Z]{10,20}$/.test(x)).slice(0, 60) : [], m = Math.round(Number(q.months)); return ids.length && (q.prov === 'AB' || q.prov === 'SK') && m >= 1 && m <= 60 ? { do: 'prod', prov: q.prov, ids, months: m } : null; }
  return null;
}
export function oilfield(root, file) {
  let busy = null;
  return {
    run(q, onProgress) {
      const job = oilJob(q); if (!job) return Promise.resolve({ ok: false, error: 'That request could not be read.' }); const heavy = job.do === 'get' || job.do === 'prod'; if (heavy && busy) return Promise.resolve({ ok: false, error: 'Another oilfield job is still running.' });
      return new Promise(res => { let w, end = false; const fin = r => { if (end) return; end = true; if (busy === w) busy = null; w?.terminate?.(); res(r); }; try { w = new Worker(file, { workerData: { root, job }, resourceLimits: { maxOldGenerationSizeMb: 2500 } }); } catch (e) { fin({ ok: false, error: e.message }); return; } if (heavy) busy = w; w.cancelled = () => fin({ ok: false, cancelled: true });
        w.on('message', m => { if (m.progress) onProgress?.(String(m.progress)); else if (m.error) fin({ ok: false, error: String(m.error) }); else if ('done' in m) fin({ ok: true, data: m.done }); }); w.on('error', e => fin({ ok: false, error: e.message })); w.on('exit', () => fin({ ok: false, error: 'It stopped early.' })); });
    },
    async cancel() { const w = busy; if (w) { w.cancelled(); await w.terminate(); rmSync(join(root, 'tmp'), { recursive: true, force: true }); } return true; },
    clear() { if (busy) return false; rmSync(root, { recursive: true, force: true }); return true; },
  };
}
