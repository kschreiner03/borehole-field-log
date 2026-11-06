export interface AppleCreds { teamId: string; keyId: string; key: string }
export interface SnapshotQuery { lat: number; lon: number; z: number; w: number; h: number; scale?: number }
export function snapshotPath(q: SnapshotQuery, c: { teamId: string; keyId: string }): string | null;
export function signPath(path: string, pem: string, der?: boolean): string;
export function checkCreds(c: unknown): string;
export function loadCreds(file: string): Promise<AppleCreds | null>;
export function saveCreds(file: string, c: unknown): Promise<{ ok: boolean; error?: string }>;
export function clearCreds(file: string): Promise<void>;
export function fetchSnapshot(q: SnapshotQuery, c: AppleCreds | null, fetchImpl?: typeof fetch): Promise<{ ok: boolean; data?: string; status?: number; error?: string }>;
