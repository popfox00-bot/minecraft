import type { Category, Marker } from '../model';

export interface SyncShared {
  seed: string;
  mc: number;
  updatedAt: string;
}

export interface SyncDoc {
  format: 'worldatlas-sync';
  version: 1;
  shared: SyncShared | null;
  markers: Marker[];
  categories: Category[];
  tombstones: { markers: Record<string, string>; categories: Record<string, string> };
}

export const WA_SYNC_FORMAT: 'worldatlas-sync';
export function waEmptyDoc(): SyncDoc;
export function waCanon(v: unknown): string;
export function waMerge(a: SyncDoc | null | undefined, b: SyncDoc | null | undefined): SyncDoc;
export function waSameDoc(a: unknown, b: unknown): boolean;
