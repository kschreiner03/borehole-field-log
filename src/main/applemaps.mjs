/* Apple Maps satellite imagery through Apple's Web Snapshots service, for the site plan, location plans and reports. Each request
   is signed on this computer with the Maps key from the user's Apple Developer account. The key is kept in the app's own folder,
   never in a project file, and the window never sees it: it only asks for a picture of an area. Shared by the main process and the tests. */
import { createPrivateKey, sign } from 'node:crypto';
import { readFile, writeFile, rm } from 'node:fs/promises';

const HOST = 'https://snapshot.apple-mapkit.com', ID = /^[A-Z0-9]{10}$/;

/* the request for one picture: centre, whole zoom level (3–20), size in points (up to 640 × 640) and pixel scale */
export function snapshotPath({ lat, lon, z, w, h, scale = 2 }, { teamId, keyId }) {
  const ok = Number.isFinite(lat) && Math.abs(lat) <= 85 && Number.isFinite(lon) && Math.abs(lon) <= 180 && Number.isInteger(z) && z >= 3 && z <= 20
    && Number.isInteger(w) && Number.isInteger(h) && w >= 50 && h >= 50 && w <= 640 && h <= 640 && [1, 2, 3].includes(scale);
  if (!ok) return null;
  return `/api/v1/snapshot?center=${lat.toFixed(7)},${lon.toFixed(7)}&z=${z}&size=${w}x${h}&scale=${scale}&t=satellite&teamId=${teamId}&keyId=${keyId}`;
}
/* ES256 signature of the path and query, base64url. der: Apple's samples sign with Node's default (DER) encoding; the raw r‖s
   form is tried if the server refuses that, and whichever works is remembered. */
export function signPath(path, pem, der = true) {
  const s = sign('sha256', Buffer.from(path), der ? createPrivateKey(pem) : { key: createPrivateKey(pem), dsaEncoding: 'ieee-p1363' });
  return s.toString('base64url');
}
export function checkCreds(c) {
  if (!c || !ID.test(String(c.teamId || ''))) return 'The Team ID is 10 letters and digits, as shown in your Apple Developer account.';
  if (!ID.test(String(c.keyId || ''))) return 'The Key ID is 10 letters and digits, as shown beside the key in your Apple Developer account.';
  try { if (createPrivateKey(String(c.key || '')).asymmetricKeyType !== 'ec') throw 0; } catch { return 'That is not a MapKit key file (.p8).'; }
  return '';
}
export async function loadCreds(file) { try { const c = JSON.parse(await readFile(file, 'utf8')); return checkCreds(c) ? null : c; } catch { return null; } }
export async function saveCreds(file, c) {
  const bad = checkCreds(c); if (bad) return { ok: false, error: bad };
  await writeFile(file, JSON.stringify({ teamId: c.teamId, keyId: c.keyId, key: String(c.key).trim() }), { mode: 0o600 });
  return { ok: true };
}
export const clearCreds = file => rm(file, { force: true });

let der = true;
/* one picture as a data URL, or { ok: false, status, error } */
export async function fetchSnapshot(q, c, fetchImpl = fetch) {
  const path = c && snapshotPath(q || {}, c); if (!path) return { ok: false, error: c ? 'Not a valid area.' : 'Apple Maps is not set up.' };
  for (const enc of [der, !der]) {
    const r = await fetchImpl(`${HOST}${path}&signature=${signPath(path, c.key, enc)}`);
    if (r.ok) { der = enc; const b = Buffer.from(await r.arrayBuffer()); return { ok: true, data: `data:${r.headers.get('content-type') || 'image/png'};base64,${b.toString('base64')}` }; }
    if (r.status !== 401 && r.status !== 403) return { ok: false, status: r.status, error: `Apple Maps answered ${r.status}.` };
  }
  return { ok: false, status: 401, error: 'Apple Maps refused the key. Check the Team ID and Key ID, and that the key has MapKit JS enabled.' };
}
