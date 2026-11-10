export function fileGuard(platform?: string, initial?: unknown[]): { remember(path: unknown): boolean; canWrite(path: unknown): boolean; list(): string[] };
