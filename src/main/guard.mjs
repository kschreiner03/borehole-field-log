// Which files the shell may write without asking: only project and workspace files the person opened or saved through the
// shell (the most recent 500, kept by the shell in its own folder across restarts). Anything else, or any path the window
// makes up, goes through the save dialog.
import { isAbsolute, resolve } from 'node:path';

const PROJECT = /\.(bhp|bhlog)$/i, MAX = 500;
export function fileGuard(platform = process.platform, initial = []) {
  const known = new Set(), fold = platform === 'darwin' || platform === 'win32';
  const key = p => typeof p === 'string' && isAbsolute(p) && PROJECT.test(p) ? (k => fold ? k.toLowerCase() : k)(resolve(p)) : null;
  const add = p => { const k = key(p); if (!k || known.has(k)) { if (k) { known.delete(k); known.add(k); } return false; } known.add(k); if (known.size > MAX) known.delete(known.values().next().value); return true; };
  for (const p of Array.isArray(initial) ? initial : []) add(p);
  return {
    remember: add,
    canWrite(p) { const k = key(p); return !!k && known.has(k); },
    list: () => [...known],
  };
}
