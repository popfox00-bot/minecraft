import { describe, it, expect } from 'vitest';
import {
  mtFirst, regionSeed, seedVariants, candidateChunk, candidateBlock, regionOfBlock, spawnBox,
  coreBox, checkFind, assess, chanceMatch, END_CITY,
} from '../src/structures/bedrock';

const SEED = '-2829401596156382806';

describe('Bedrock RNG + placement', () => {
  it('MT19937 first outputs match C++ std::mt19937', () => {
    // reference values from g++ std::mt19937 (see README "Structures")
    expect(mtFirst(0, 4)).toEqual([2357136044, 2546248239, 3071714933, 3626093760]);
    expect(mtFirst(5489, 4)).toEqual([3499211612, 581869302, 3890346734, 3586334585]);
    expect(mtFirst(0xdeadbeef, 4)).toEqual([956529277, 3842322136, 3319553134, 1843186657]);
    expect(mtFirst(4294967295, 4)).toEqual([419326371, 479346978, 3918654476, 2416749639]);
  });

  it('region seed equals the 64-bit Java formula truncated to 32 bits', () => {
    const low32 = seedVariants(SEED).find((v) => v.id === 'low32')!.seed32;
    // reference computed in C++ with int64 maths: (uint32)(rx*341873128712 + rz*132897987541 + seed + salt)
    expect(regionSeed(low32, 10387313, -3, 7)).toBe(75109590);
    const big = (rx: bigint, rz: bigint) => Number(BigInt.asUintN(32, rx * 341873128712n + rz * 132897987541n + BigInt(SEED) + 10387313n));
    for (const [rx, rz] of [[0, 0], [5, -9], [-120, 44], [1000, -1000]]) expect(regionSeed(low32, 10387313, rx, rz)).toBe(big(BigInt(rx), BigInt(rz)));
  });

  it('every candidate lies inside its region spawn box', () => {
    for (const v of seedVariants(SEED))
      for (let rz = -6; rz <= 6; rz++)
        for (let rx = -6; rx <= 6; rx++) {
          const { cx, cz } = candidateChunk(END_CITY, v.seed32, rx, rz);
          expect(cx - rx * 20).toBeGreaterThanOrEqual(0);
          expect(cx - rx * 20).toBeLessThan(9);
          expect(cz - rz * 20).toBeGreaterThanOrEqual(0);
          expect(cz - rz * 20).toBeLessThan(9);
          const p = candidateBlock(END_CITY, v.seed32, rx, rz);
          const b = spawnBox(END_CITY, rx, rz);
          expect(p.x >= b.x0 && p.x < b.x1 && p.z >= b.z0 && p.z < b.z1).toBe(true);
          expect(regionOfBlock(END_CITY, p.x, p.z)).toEqual({ rx, rz });
        }
  });

  it('core box probability for averaged 0..8 draws', () => {
    const c = coreBox(END_CITY);
    expect(c.inset).toBe(2);
    expect(c.probability).toBeCloseTo((65 / 81) ** 2, 6);
  });
});

describe('verification', () => {
  const low = seedVariants(SEED)[0].seed32;
  const real = [ [3, 4], [-5, 2], [7, -8] ].map(([rx, rz], i) => ({ id: `f${i}`, ...candidateBlock(END_CITY, low, rx, rz) }));

  it('no finds: nothing trusted', () => {
    expect(assess(END_CITY, SEED, []).confidence).toBe('none');
  });
  it('chance of a lucky match is computed from the offset distribution', () => {
    const p = chanceMatch(END_CITY);
    console.log('chance one find matches by luck:', p.toFixed(3));
    expect(p).toBeGreaterThan(0.05);
    expect(p).toBeLessThan(0.5);
  });
  it('confidence grows as matching finds accumulate', () => {
    const levels = [1, 2, 3, 4, 5].map((n) => {
      const more = [...real, ...[[9, 9], [-9, -4]].map(([rx, rz], i) => ({ id: `g${i}`, ...candidateBlock(END_CITY, low, rx, rz) }))];
      const a = assess(END_CITY, SEED, more.slice(0, n));
      return `${n}:${a.confidence}:${a.coincidence.toExponential(1)}:${a.best?.variant.id}`;
    });
    console.log(levels.join('  '));
    expect(levels[0].split(':')[1]).toBe('possible');
    expect(levels[4].split(':')[1]).toBe('confirmed');
    expect(levels.every((l) => l.endsWith('low32'))).toBe(true);
  });
  it('a marker placed a little off the city base still matches', () => {
    const f = { id: 'x', x: real[0].x + 10, z: real[0].z - 12 };
    expect(checkFind(END_CITY, low, f).match).toBe(true);
  });
  it('a find that no variant predicts is reported as a mismatch', () => {
    const p = candidateBlock(END_CITY, low, 2, 2);
    // move to the opposite corner of the spawn box: inside the grid, but not the predicted spot
    const b = spawnBox(END_CITY, 2, 2);
    const off = { id: 'm', x: p.x - b.x0 > 72 ? b.x0 + 8 : b.x1 - 8, z: p.z - b.z0 > 72 ? b.z0 + 8 : b.z1 - 8 };
    const a = assess(END_CITY, SEED, [...real, off]);
    if (a.confidence !== 'mismatch') {
      // another seed variant happens to predict it: allowed, but then it must match all
      expect(a.best!.matches).toBe(4);
    } else {
      expect(a.gridOk).toBe(true);
    }
  });
  it('a find outside every spawn box breaks the grid check', () => {
    const b = spawnBox(END_CITY, 0, 0);
    const a = assess(END_CITY, SEED, [{ id: 'g', x: b.x1 + 80, z: b.z1 + 80 }]);
    expect(a.gridOk).toBe(false);
  });
});
