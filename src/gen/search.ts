// "Find <biome> near me": nearest distinct locations of a biome around a point.
//
// The area is scanned in square rings of 1024-block chunks at 1:16 resolution,
// nearest ring first. Matches are picked greedily by distance, keeping results
// at least `separation` blocks apart so each result is a different patch.
// Scanning stops once k results are closer than the edge of the scanned square
// (so nothing unscanned could beat them), or at maxRadius.

export type AreaFn = (scale: number, cx: number, cz: number, cells: number, blockY: number) => Uint8Array;

export interface SearchOptions {
  biome: number;
  x: number;
  z: number;
  /** block Y to sample (surface by default; cave biomes need an underground Y) */
  y: number;
  k: number;
  maxRadius: number;
  separation: number;
}

export interface SearchHit {
  x: number;
  z: number;
  dist: number;
}

export interface SearchResult {
  hits: SearchHit[];
  /** radius (blocks) that was fully searched */
  searched: number;
  cells: number;
}

const SCALE = 16;
const CHUNK_CELLS = 64; // 64 * 16 = 1024 blocks per chunk side
const W = SCALE * CHUNK_CELLS;

function pick(matches: SearchHit[], limit: number, k: number, sep: number): SearchHit[] {
  const out: SearchHit[] = [];
  const sep2 = sep * sep;
  for (const m of matches) {
    if (m.dist > limit) break;
    if (out.every((o) => (o.x - m.x) ** 2 + (o.z - m.z) ** 2 >= sep2)) {
      out.push(m);
      if (out.length >= k) break;
    }
  }
  return out;
}

export function searchBiome(area: AreaFn, o: SearchOptions): SearchResult {
  const ox = Math.floor(o.x / W);
  const oz = Math.floor(o.z / W);
  const matches: SearchHit[] = [];
  let cells = 0;
  let searched = 0;

  for (let r = 0; ; r++) {
    // all chunks on the ring at Chebyshev distance r
    for (let j = oz - r; j <= oz + r; j++) {
      for (let i = ox - r; i <= ox + r; i++) {
        if (Math.max(Math.abs(i - ox), Math.abs(j - oz)) !== r) continue;
        const ids = area(SCALE, i * CHUNK_CELLS, j * CHUNK_CELLS, CHUNK_CELLS, o.y);
        cells += ids.length;
        for (let c = 0; c < ids.length; c++) {
          if (ids[c] !== o.biome) continue;
          const bx = (i * CHUNK_CELLS + (c % CHUNK_CELLS)) * SCALE + SCALE / 2;
          const bz = (j * CHUNK_CELLS + Math.floor(c / CHUNK_CELLS)) * SCALE + SCALE / 2;
          matches.push({ x: bx, z: bz, dist: Math.hypot(bx - o.x, bz - o.z) });
        }
      }
    }
    // distance from the origin to the nearest edge of the scanned square
    searched = Math.min(
      o.x - (ox - r) * W,
      (ox + r + 1) * W - o.x,
      o.z - (oz - r) * W,
      (oz + r + 1) * W - o.z,
    );
    matches.sort((a, b) => a.dist - b.dist);
    const limit = Math.min(searched, o.maxRadius);
    const hits = pick(matches, limit, o.k, o.separation);
    if (hits.length >= o.k || searched >= o.maxRadius) {
      return { hits, searched: Math.min(searched, o.maxRadius), cells };
    }
  }
}

/**
 * Moves a 1:16 hit to the matching 1:4 cell nearest the origin, so the
 * reported coordinate is inside the biome rather than on a coarse cell centre.
 */
export function refineHit(area: AreaFn, hit: SearchHit, o: SearchOptions): SearchHit {
  const cx = Math.floor((hit.x - SCALE / 2) / 4) - 2;
  const cz = Math.floor((hit.z - SCALE / 2) / 4) - 2;
  const n = 8; // 8x8 cells at 1:4 = 32 blocks around the hit
  const ids = area(4, cx, cz, n, o.y);
  let best: SearchHit | null = null;
  for (let c = 0; c < ids.length; c++) {
    if (ids[c] !== o.biome) continue;
    const x = (cx + (c % n)) * 4 + 2;
    const z = (cz + Math.floor(c / n)) * 4 + 2;
    const dist = Math.hypot(x - o.x, z - o.z);
    if (!best || dist < best.dist) best = { x, z, dist };
  }
  return best ?? hit;
}
