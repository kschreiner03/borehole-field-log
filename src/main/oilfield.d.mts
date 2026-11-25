export function oilJob(q: unknown): Record<string, unknown> | null;
export function oilfield(root: string, file: string): { run(q: unknown, onProgress?: (m: string) => void): Promise<{ ok: boolean; data?: unknown; error?: string; cancelled?: boolean }>; cancel(): Promise<boolean>; clear(): boolean };
