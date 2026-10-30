import type { Desktop } from '../../preload/index';

declare global {
  interface Window { desktop?: Desktop }
}
export {};
