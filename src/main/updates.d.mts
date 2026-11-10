export interface ReleaseAsset { name: string; browser_download_url: string; size?: number }
export interface Release { tag_name?: string; body?: string; html_url?: string; published_at?: string; assets?: ReleaseAsset[] }
export interface UpdateInfo { ok: boolean; newer?: boolean; none?: boolean; version?: string; current?: string; notes?: string; date?: string; page?: string; release?: string; error?: string }
export const REPO: string;
export const HUB: string;
export const LATEST: string;
export function newer(a: string, b: string): boolean;
export function pickAsset(release: Release, platform: string): ReleaseAsset | null;
export function readRelease(release: Release, platform: string, current: string): UpdateInfo;
export function checkForUpdate(o: { current: string; platform: string; fetchImpl?: typeof fetch; timeout?: number }): Promise<UpdateInfo>;
export function withChecksum(body: string, name: string, sha: string): string;
