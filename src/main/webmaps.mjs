// Map services the person adds: the page may ask only for pictures and service descriptions, only over https, and only from hosts
// allowed here in a dialog of the shell's own (the list is the shell's, in its profile folder). Nothing is sent but the request itself.
import { readFileSync, writeFileSync } from 'node:fs';
const TYPES = /^(image\/(png|jpeg|jpg|gif|webp)|application\/(json|geo\+json|xml|vnd\.ogc\.[\w.+-]+)|text\/(xml|plain|json))\b/i, MAX = 12e6;
export const hostOf = u => { try { const x = new URL(String(u)); if (x.protocol !== 'https:' || x.username || x.password || (x.port && x.port !== '443')) return null; const h = x.hostname.toLowerCase(); return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) && !/(^|\.)(localhost|local|internal|lan|home|corp)$/.test(h) ? h : null; } catch { return null; } };
export function webMaps(file) {
  let list = []; try { list = JSON.parse(readFileSync(file, 'utf8')); } catch { /* none yet */ } const hosts = new Set((Array.isArray(list) ? list : []).filter(h => typeof h === 'string' && hostOf('https://' + h + '/') === h).slice(0, 60));
  const save = () => { try { writeFileSync(file, JSON.stringify([...hosts])); } catch { /* kept for this session */ } };
  return {
    list: () => [...hosts], has: h => hosts.has(h), allow(h) { if (hostOf('https://' + h + '/') !== h) return false; hosts.add(h); save(); return true; }, forget(h) { hosts.delete(h); save(); },
    async get(url, f = fetch) {
      let u = String(url); if (u.length > 4000) return { ok: false, status: 400, error: 'The address is too long.' };
      for (let i = 0; i < 4; i++) {
        const h = hostOf(u); if (!h) return { ok: false, status: 400, error: 'Only https addresses on the internet are used.' }; if (!hosts.has(h)) return { ok: false, status: 403, host: h, error: h + ' is not allowed on this computer.' };
        let r; try { r = await f(u, { redirect: 'manual', headers: { 'User-Agent': 'map-client', Accept: 'image/png,image/*,application/json,text/xml;q=0.9,*/*;q=0.5' }, signal: AbortSignal.timeout(25000), credentials: 'omit', referrerPolicy: 'no-referrer' }); } catch (e) { return { ok: false, status: 0, error: e?.name === 'TimeoutError' ? h + ' did not answer in time.' : h + ' could not be reached.' }; }
        if (r.status >= 300 && r.status < 400) { try { u = new URL(r.headers.get('location') || '', u).href; } catch { return { ok: false, status: 400, error: 'A bad redirect.' }; } continue; }
        if (!r.ok) return { ok: false, status: r.status, error: h + ' answered ' + r.status + '.' };
        const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(); if (!TYPES.test(type)) return { ok: false, status: 415, error: h + ' sent something that is not a map picture (' + (type || 'unknown') + ').' };
        if (+(r.headers.get('content-length') || 0) > MAX) return { ok: false, status: 413, error: 'The answer is too large.' };
        const parts = []; let n = 0; for await (const c of r.body) { n += c.length; if (n > MAX) return { ok: false, status: 413, error: 'The answer is too large.' }; parts.push(Buffer.from(c)); }
        return { ok: true, type, data: Buffer.concat(parts).toString('base64') };
      }
      return { ok: false, status: 400, error: 'Too many redirects.' };
    },
  };
}
