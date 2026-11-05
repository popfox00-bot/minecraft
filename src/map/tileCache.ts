// Biome tile cache: small in-memory LRU in front of IndexedDB.
// Tiles are stored as raw biome ids (Uint8Array, cells x cells) rather than
// pixels, so palette/theme changes never invalidate the cache.

import * as db from '../db';

export interface CachedTile {
  cells: number;
  ids: Uint8Array;
}

const MEM_MAX = 600;
const mem = new Map<string, CachedTile>();

export function tileKey(seed: string, mc: number, dim: string, zoom: number, x: number, y: number): string {
  return `${seed}|${mc}|${dim}|${zoom}|${x}|${y}`;
}

function remember(key: string, t: CachedTile): void {
  mem.delete(key);
  mem.set(key, t);
  if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value!);
}

export function peekTile(key: string): CachedTile | undefined {
  return mem.get(key);
}

export async function getTile(key: string): Promise<CachedTile | undefined> {
  const m = mem.get(key);
  if (m) return m;
  try {
    const t = await db.get<CachedTile>('tiles', key);
    if (t) remember(key, t);
    return t;
  } catch {
    return undefined;
  }
}

export function putTile(key: string, t: CachedTile): void {
  remember(key, t);
  db.put('tiles', t, key).catch(() => {
    /* quota or private mode: memory cache still works */
  });
}

export async function clearTileCache(): Promise<void> {
  mem.clear();
  await db.clear('tiles');
}
