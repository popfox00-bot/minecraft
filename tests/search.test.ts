import { describe, it, expect, beforeAll } from 'vitest';
import createCubiomes from '../src/wasm/cubiomes.js';
import { BiomeGen } from '../src/gen/core';
import { searchBiome, refineHit, type AreaFn } from '../src/gen/search';

const SEED = '-2829401596156382806';
let gen: BiomeGen;
let area: AreaFn;
beforeAll(async () => {
  gen = new BiomeGen(await createCubiomes());
  area = (s, cx, cz, n, y) => gen.area(s, cx, cz, n, y);
});

describe('biome search', () => {
  it('matches a brute-force scan on a synthetic map', () => {
    // fake world: biome 7 wherever (cx*7 + cz*13) % 23 == 0
    const fake: AreaFn = (s, cx, cz, n) => {
      const out = new Uint8Array(n * n);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out[j * n + i] = ((cx + i) * 7 + (cz + j) * 13) % 23 === 0 ? 7 : 1;
      return out;
    };
    const o = { biome: 7, x: 130, z: -77, y: 256, k: 5, maxRadius: 5000, separation: 300 };
    const r = searchBiome(fake, o);
    // brute force over a big square with the same greedy rule
    const all: { x: number; z: number; dist: number }[] = [];
    for (let cz = -400; cz < 400; cz++) for (let cx = -400; cx < 400; cx++)
      if ((cx * 7 + cz * 13) % 23 === 0) {
        const x = cx * 16 + 8, z = cz * 16 + 8;
        all.push({ x, z, dist: Math.hypot(x - o.x, z - o.z) });
      }
    all.sort((a, b) => a.dist - b.dist);
    const want: typeof all = [];
    for (const m of all) {
      if (want.every((w) => (w.x - m.x) ** 2 + (w.z - m.z) ** 2 >= 300 ** 2)) want.push(m);
      if (want.length === 5) break;
    }
    expect(r.hits).toEqual(want);
  });

  it('finds real cherry groves near the dungeons, nearest first', () => {
    gen.configure(SEED, 28, 'overworld');
    const o = { biome: 185, x: 1180, z: -2808, y: 256, k: 5, maxRadius: 12000, separation: 512 };
    const t = performance.now();
    const r = searchBiome(area, o);
    const hits = r.hits.map((h) => refineHit(area, h, o));
    console.log('cherry_grove', JSON.stringify(hits), `${Math.round(performance.now() - t)}ms`);
    expect(hits.length).toBe(5);
    for (let i = 1; i < r.hits.length; i++) expect(r.hits[i].dist).toBeGreaterThanOrEqual(r.hits[i - 1].dist);
    // refined points really are cherry grove at block level (allowing voronoi edge jitter)
    const ok = hits.filter((h) => gen.biomeName(gen.biomeAt(h.x, h.z)) === 'cherry_grove').length;
    expect(ok).toBeGreaterThanOrEqual(4);
  });

  it('finds End highlands and Nether warped forest', () => {
    gen.configure(SEED, 28, 'end');
    const e = searchBiome(area, { biome: 42, x: 0, z: 0, y: 256, k: 3, maxRadius: 6000, separation: 512 });
    expect(e.hits.length).toBe(3);
    expect(e.hits[0].dist).toBeGreaterThan(900); // outer islands start past the void ring
    gen.configure(SEED, 28, 'nether');
    const n = searchBiome(area, { biome: 172, x: 147, z: -351, y: 64, k: 3, maxRadius: 3000, separation: 128 });
    expect(n.hits.length).toBe(3);
  });
});
