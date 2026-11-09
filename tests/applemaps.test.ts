import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkCreds, fetchSnapshot, loadCreds, saveCreds, signPath, snapshotPath } from '../src/main/applemaps.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const creds = { teamId: 'ABCDE12345', keyId: 'KEY1234567', key: pem };
const q = { lat: 58.3096, lon: -103.9473, z: 18, w: 640, h: 400, scale: 2 };

describe('Apple Maps snapshots', () => {
  it('builds the request for an area and refuses anything outside the service limits', () => {
    expect(snapshotPath(q, creds)).toBe('/api/v1/snapshot?center=58.3096000,-103.9473000&z=18&size=640x400&scale=2&t=satellite&teamId=ABCDE12345&keyId=KEY1234567');
    for (const bad of [{ z: 21 }, { z: 17.5 }, { w: 641 }, { h: 10 }, { lat: 89 }, { scale: 4 }, { lon: NaN }]) expect(snapshotPath({ ...q, ...bad }, creds)).toBeNull();
  });
  it('signs the path with the key, in DER or raw r‖s form', () => {
    const path = snapshotPath(q, creds)!;
    expect(verify('sha256', Buffer.from(path), publicKey, Buffer.from(signPath(path, pem), 'base64url'))).toBe(true);
    expect(verify('sha256', Buffer.from(path), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signPath(path, pem, false), 'base64url'))).toBe(true);
    expect(signPath(path, pem)).not.toMatch(/[+/=]/);
  });
  it('checks the Team ID, Key ID and key file before saving, and keeps the file private', async () => {
    expect(checkCreds(creds)).toBe('');
    expect(checkCreds({ ...creds, teamId: 'abc' })).toMatch(/Team ID/);
    expect(checkCreds({ ...creds, key: 'not a key' })).toMatch(/\.p8/);
    const f = join(mkdtempSync(join(tmpdir(), 'bh-apple-')), 'apple-maps.json');
    expect((await saveCreds(f, { ...creds, keyId: 'x' })).ok).toBe(false);
    expect((await saveCreds(f, creds)).ok).toBe(true);
    // Windows has no Unix permission bits (the profile folder is the user's own there)
    if (process.platform !== 'win32') expect(statSync(f).mode & 0o077).toBe(0);
    expect(await loadCreds(f)).toEqual({ ...creds, key: pem.trim() });
  });
  it('returns the picture as a data URL, trying the other signature form once if the key is refused', async () => {
    const urls: string[] = [];
    const fake = (async (u: string) => {
      urls.push(u); const sig = Buffer.from(new URL(u).searchParams.get('signature')!, 'base64url');
      return sig.length === 64 ? new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } }) : new Response('', { status: 401 });
    }) as unknown as typeof fetch;
    const r = await fetchSnapshot(q, creds, fake);
    expect(r).toEqual({ ok: true, data: 'data:image/png;base64,iVBORw==' });
    expect(urls.length).toBe(2);
    expect(urls[0]).toMatch(/^https:\/\/snapshot\.apple-mapkit\.com\/api\/v1\/snapshot\?center=/);
    expect((await fetchSnapshot(q, null, fake)).ok).toBe(false);
    const refused = await fetchSnapshot(q, creds, (async () => new Response('', { status: 403 })) as unknown as typeof fetch);
    expect(refused).toMatchObject({ ok: false, status: 401 });
  });
});
