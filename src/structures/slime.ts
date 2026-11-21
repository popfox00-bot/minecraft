// Bedrock slime chunks. Bedrock seeds the chunk's random with (chunkX * 0x1f1f1f1f) ^ chunkZ (32-bit) and
// takes MT19937's first output: a slime chunk when it is a multiple of 10 (nextInt(10) == 0). The world seed
// plays no part, so every Bedrock world has the same slime chunks. Source: Earthcomputer/bedrockified
// (SharedSeedRandom.seedSlimeChunk → new BedrockRandom((x * 522133279) ^ z); 522133279 = 0x1f1f1f1f).
// Slimes spawn there below Y 40, in the dark or light, in any biome but mushroom fields.

import { mtFirst } from './bedrock';

/** Whether chunk (cx, cz) is a Bedrock slime chunk. */
export function isSlimeChunk(cx: number, cz: number): boolean {
  const seed = (Math.imul(cx, 0x1f1f1f1f) ^ cz) >>> 0;
  return mtFirst(seed, 1)[0] % 10 === 0;
}

/** The slime chunks nearest a block position, nearest first: { cx, cz, x, z (the chunk's middle), dist }. */
export function nearestSlimeChunks(x: number, z: number, count = 5, maxRadius = 40): { cx: number; cz: number; x: number; z: number; dist: number }[] {
  const ox = Math.floor(x / 16); const oz = Math.floor(z / 16);
  const out: { cx: number; cz: number; x: number; z: number; dist: number }[] = [];
  for (let r = 0; r <= maxRadius; r++) {
    for (let cz = oz - r; cz <= oz + r; cz++)
      for (let cx = ox - r; cx <= ox + r; cx++) {
        if (Math.max(Math.abs(cx - ox), Math.abs(cz - oz)) !== r || !isSlimeChunk(cx, cz)) continue;
        const mx = cx * 16 + 8; const mz = cz * 16 + 8;
        out.push({ cx, cz, x: mx, z: mz, dist: Math.hypot(mx - x, mz - z) });
      }
    // (Done once the ring is past the count-th nearest.)
    const sorted = [...out].sort((a, b) => a.dist - b.dist);
    if (sorted.length >= count && sorted[count - 1].dist <= r * 16) return sorted.slice(0, count);
  }
  return out.sort((a, b) => a.dist - b.dist).slice(0, count);
}
