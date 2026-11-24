export function hostOf(u: unknown): string | null;
export function webMaps(file: string): { list(): string[]; has(h: string): boolean; allow(h: string): boolean; forget(h: string): void; get(url: unknown): Promise<{ ok: boolean; type?: string; data?: string; status?: number; error?: string; host?: string }> };
