// Update check: asks GitHub for the newest release of the app and says whether it is newer than this one. Nothing about the
// user, their computer or their projects is sent; the person downloads and installs the update themselves, from the download page.
export const REPO = 'kschreiner03/borehole-field-log';
export const HUB = 'https://kschreiner03.github.io/borehole-field-log/';
export const LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
const SUMS = '### Checksums (SHA-256)';

/* a is newer than b; numbers compared one by one, and a pre-release (1.0.0-beta.1) comes before its release */
export function newer(a, b) {
  const p = v => { const m = /^v?(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(String(v).trim()); return m ? { n: m.slice(1, 4).map(Number), pre: m[4] || '' } : null; };
  const x = p(a), y = p(b); if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] > y.n[i];
  return !x.pre !== !y.pre ? !x.pre : x.pre > y.pre;
}

/* the installer for this computer: the Mac disk image or the Windows setup program */
export function pickAsset(release, platform) {
  const re = platform === 'darwin' ? /\.dmg$/i : platform === 'win32' ? /setup.*\.exe$/i : null;
  return (re && (release?.assets || []).find(a => re.test(a.name))) || null;
}

/* what the window needs to know about a release; one without this computer's installer is not offered yet */
export function readRelease(release, platform, current) {
  const version = String(release.tag_name || '').replace(/^v/, ''), asset = pickAsset(release, platform);
  const notes = String(release.body || '').split(SUMS)[0].trim();
  return { ok: true, version, current, notes, date: String(release.published_at || '').slice(0, 10), page: HUB, release: release.html_url || '', newer: !!asset && newer(version, current) };
}

/* never throws: offline, a slow network or a bad reply is { ok: false }; no releases yet is { ok: true, none: true } */
export async function checkForUpdate({ current, platform, fetchImpl = fetch, timeout = 8000 }) {
  try {
    const res = await fetchImpl(LATEST, { method: 'GET', headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Borehole-Field-Log' }, signal: AbortSignal.timeout(timeout) });
    if (res.status === 404) return { ok: true, none: true, newer: false, current, page: HUB };
    if (!res.ok) return { ok: false, error: `GitHub replied ${res.status}` };
    return readRelease(await res.json(), platform, current);
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

/* release notes with this file's checksum added to (or replaced in) the list at the end */
export function withChecksum(body, name, sha) {
  const [notes, list = ''] = String(body || '').split(SUMS);
  const line = `- \`${name}\`: \`${sha}\``, lines = list.split('\n').filter(l => l.startsWith('- `')), at = lines.findIndex(l => l.startsWith(`- \`${name}\``));
  if (at >= 0) lines[at] = line; else lines.push(line);
  return `${notes.trim()}\n\n${SUMS}\n${lines.join('\n')}\n`;
}
