export function mf6Binary(root: string): string | null;
export function runMf6(o: { bin: string | null; files?: Record<string, string>; outputs?: string[]; timeoutMs?: number }): Promise<{ ok: boolean; code?: number; seconds?: number; stdout?: string; error?: string; files?: Record<string, Uint8Array> }>;
