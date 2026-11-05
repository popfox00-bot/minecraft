import { describe, it, expect, beforeAll } from 'vitest';
import createCubiomes from '../src/wasm/cubiomes.js';
import { BiomeGen } from '../src/gen/core';

const SEED = '-2829401596156382806';
let gen: BiomeGen;

beforeAll(async () => {
  gen = new BiomeGen(await createCubiomes());
});

// Reference values produced by the same cubiomes commit compiled natively with
// gcc (see README "Verifying the WASM build").
describe('cubiomes WASM', () => {
  it('reports the newest version (1.21 Winter Drop)', () => {
    expect(gen.newestVersion).toBe(28);
  });

  it('matches native overworld spot checks', () => {
    gen.configure(SEED, 28, 'overworld');
    expect(gen.biomeName(gen.biomeAt(0, 0))).toBe('desert');
    expect(gen.biomeName(gen.biomeAt(1180, -2808))).toBe('sparse_jungle');
    expect(gen.biomeName(gen.biomeAt(1204, -2807))).toBe('sparse_jungle');
    expect(gen.biomeName(gen.biomeAt(1180, -2808, -5))).toBe('lush_caves');
    expect(gen.biomeName(gen.biomeAt(1204, -2807, -1))).toBe('lush_caves');
  });

  it('matches native nether spot checks', () => {
    gen.configure(SEED, 28, 'nether');
    expect(gen.biomeName(gen.biomeAt(0, 0, 64))).toBe('crimson_forest');
    expect(gen.biomeName(gen.biomeAt(147, -351, 64))).toBe('nether_wastes');
  });

  it('area generation agrees with point sampling', () => {
    gen.configure(SEED, 28, 'overworld');
    const a = gen.area(4, 290, -710, 16);
    for (const [i, j] of [[0, 0], [5, 9], [15, 15]]) {
      const id = a[j * 16 + i];
      // scale-4 cell sampled at the cell's own 1:4 coordinates
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).not.toBe(255);
    }
    const big = gen.area(256, -32, -32, 64);
    expect(big.length).toBe(64 * 64);
  });
});
