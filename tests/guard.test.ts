import { describe, expect, it } from 'vitest';
import { fileGuard } from '../src/main/guard.mjs';

describe('saving without a dialog', () => {
  it('only to a project file the person opened or saved here', () => {
    const g = fileGuard('linux');
    expect(g.canWrite('/work/site.bhp')).toBe(false);
    g.remember('/work/site.bhp');
    expect(g.canWrite('/work/site.bhp')).toBe(true);
    expect(g.canWrite('/work/other.bhp')).toBe(false);
    expect(g.canWrite('/work/x/../site.bhp')).toBe(true);
  });

  it('never to anything but a project or workspace file', () => {
    const g = fileGuard('linux');
    g.remember('/home/me/.bashrc'); g.remember('/work/notes.txt');
    expect(g.canWrite('/home/me/.bashrc')).toBe(false);
    expect(g.canWrite('/work/notes.txt')).toBe(false);
    g.remember('/work/all.bhlog');
    expect(g.canWrite('/work/all.bhlog')).toBe(true);
  });

  it('nothing that is not a full path', () => {
    const g = fileGuard('linux');
    g.remember('site.bhp');
    expect(g.canWrite('site.bhp')).toBe(false);
    expect(g.canWrite(null)).toBe(false);
    expect(g.canWrite({ toString: () => '/work/site.bhp' } as unknown as string)).toBe(false);
  });

  it('ignores letter case where the file system does', () => {
    const mac = fileGuard('darwin'); mac.remember('/Users/me/Site.bhp');
    expect(mac.canWrite('/users/me/site.BHP')).toBe(true);
    const lin = fileGuard('linux'); lin.remember('/home/me/Site.bhp');
    expect(lin.canWrite('/home/me/site.bhp')).toBe(false);
  });

  it('remembers across restarts, from the list the shell keeps itself', () => {
    const g = fileGuard('linux'); g.remember('/work/site.bhp'); g.remember('/work/all.bhlog');
    const again = fileGuard('linux', g.list());
    expect(again.canWrite('/work/site.bhp') && again.canWrite('/work/all.bhlog')).toBe(true);
    expect(fileGuard('linux', ['/etc/passwd', 'site.bhp', 42 as unknown as string]).list()).toEqual([]);
  });

  it('keeps the most recent 500', () => {
    const g = fileGuard('linux');
    for (let i = 0; i < 520; i++) g.remember(`/work/p${i}.bhp`);
    expect(g.list().length).toBe(500);
    expect(g.canWrite('/work/p519.bhp')).toBe(true);
    expect(g.canWrite('/work/p0.bhp')).toBe(false);
  });

  it('says whether a file was new, so the list is only saved when it changes', () => {
    const g = fileGuard('linux');
    expect(g.remember('/work/a.bhp')).toBe(true);
    expect(g.remember('/work/a.bhp')).toBe(false);
    expect(g.remember('/work/a.txt')).toBe(false);
  });
});
