import { describe, expect, it } from 'vitest';
import { newer, pickAsset, readRelease, checkForUpdate, withChecksum, HUB } from '../src/main/updates.mjs';

const release = {
  tag_name: 'v0.2.0', html_url: 'https://github.com/kschreiner03/borehole-field-log/releases/tag/v0.2.0', published_at: '2026-11-12T18:00:00Z',
  body: 'Thin layers keep their whole description.\n\n### Checksums (SHA-256)\n- `Borehole-Field-Log-0.2.0-arm64.dmg`: `aa11`\n',
  assets: [
    { name: 'Borehole-Field-Log-0.2.0-arm64.dmg', browser_download_url: 'https://example.test/mac.dmg', size: 1 },
    { name: 'Borehole-Field-Log-Setup-0.2.0.exe', browser_download_url: 'https://example.test/win.exe', size: 1 },
  ],
};

describe('update check', () => {
  it('compares versions number by number', () => {
    expect(newer('0.2.0', '0.1.0')).toBe(true);
    expect(newer('v0.10.0', '0.9.3')).toBe(true);
    expect(newer('0.1.0', '0.1.0')).toBe(false);
    expect(newer('0.1.0', '0.2.0')).toBe(false);
    expect(newer('1.0.0-beta.1', '0.9.0')).toBe(true);
    expect(newer('1.0.0-beta.1', '1.0.0')).toBe(false);
    expect(newer('nonsense', '0.1.0')).toBe(false);
  });

  it('picks the installer for this computer', () => {
    expect(pickAsset(release, 'darwin')?.name).toBe('Borehole-Field-Log-0.2.0-arm64.dmg');
    expect(pickAsset(release, 'win32')?.name).toBe('Borehole-Field-Log-Setup-0.2.0.exe');
    expect(pickAsset(release, 'linux')).toBeNull();
    expect(pickAsset({ ...release, assets: release.assets.slice(0, 1) }, 'win32')).toBeNull();
  });

  it('reads a release: notes without the checksum list, and whether it is newer', () => {
    const r = readRelease(release, 'darwin', '0.1.0');
    expect(r).toMatchObject({ ok: true, newer: true, version: '0.2.0', page: HUB, date: '2026-11-12' });
    expect(r.notes).toBe('Thin layers keep their whole description.');
    expect(readRelease(release, 'darwin', '0.2.0').newer).toBe(false);
  });

  it('a release without this computer’s installer is not offered yet', () => {
    const r = readRelease({ ...release, assets: release.assets.slice(0, 1) }, 'win32', '0.1.0');
    expect(r.newer).toBe(false);
    expect(r.version).toBe('0.2.0');
  });

  it('asks GitHub for the latest release and sends nothing about the user', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify(release), { status: 200 }); }) as unknown as typeof fetch;
    const r = await checkForUpdate({ current: '0.1.0', platform: 'win32', fetchImpl: fake });
    expect(r).toMatchObject({ ok: true, newer: true, version: '0.2.0' });
    expect(seen!.url).toBe('https://api.github.com/repos/kschreiner03/borehole-field-log/releases/latest');
    expect(seen!.init.method ?? 'GET').toBe('GET');
    expect(seen!.init.body).toBeUndefined();
  });

  it('offline, no releases yet or a bad reply: not ok, never throws', async () => {
    const offline = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    expect((await checkForUpdate({ current: '0.1.0', platform: 'darwin', fetchImpl: offline })).ok).toBe(false);
    const none = (async () => new Response('{"message":"Not Found"}', { status: 404 })) as unknown as typeof fetch;
    expect(await checkForUpdate({ current: '0.1.0', platform: 'darwin', fetchImpl: none })).toMatchObject({ ok: true, newer: false, none: true });
    const junk = (async () => new Response('not json', { status: 200 })) as unknown as typeof fetch;
    expect((await checkForUpdate({ current: '0.1.0', platform: 'darwin', fetchImpl: junk })).ok).toBe(false);
  });

  it('adds or replaces a file’s checksum in the release notes', () => {
    const once = withChecksum('Notes here.', 'a.dmg', 'aa');
    expect(once).toBe('Notes here.\n\n### Checksums (SHA-256)\n- `a.dmg`: `aa`\n');
    const twice = withChecksum(once, 'b.exe', 'bb');
    expect(twice).toBe('Notes here.\n\n### Checksums (SHA-256)\n- `a.dmg`: `aa`\n- `b.exe`: `bb`\n');
    expect(withChecksum(twice, 'a.dmg', 'cc')).toBe('Notes here.\n\n### Checksums (SHA-256)\n- `a.dmg`: `cc`\n- `b.exe`: `bb`\n');
  });
});
