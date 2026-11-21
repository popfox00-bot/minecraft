import { describe, it, expect } from 'vitest';
import { isSlimeChunk, nearestSlimeChunks } from '../src/structures/slime';
import { mtFirst } from '../src/structures/bedrock';
import { planPortal, type PortalSpot } from '../src/portals';

describe('Bedrock slime chunks', () => {
  it('uses MT19937 seeded with (x * 0x1f1f1f1f) ^ z, a slime chunk when the first output is a multiple of 10', () => {
    // chunk 0,0: seed 0, first output 2357136044 (ends in 4): not a slime chunk
    expect(isSlimeChunk(0, 0)).toBe(false);
    for (const [x, z] of [[1, 0], [-3, 7], [100, -250], [-1, -1]]) {
      const seed = Number(BigInt.asUintN(32, BigInt(x) * 522133279n) ^ BigInt.asUintN(32, BigInt(z)));
      expect(isSlimeChunk(x, z)).toBe(mtFirst(seed >>> 0, 1)[0] % 10 === 0);
    }
  });
  it('about one chunk in ten', () => {
    let n = 0;
    for (let z = -50; z < 50; z++) for (let x = -50; x < 50; x++) if (isSlimeChunk(x, z)) n++;
    expect(n / 10000).toBeGreaterThan(0.08);
    expect(n / 10000).toBeLessThan(0.12);
  });
  it('lists the nearest, nearest first, all slime chunks', () => {
    const l = nearestSlimeChunks(100, -200, 5);
    expect(l).toHaveLength(5);
    for (const c of l) expect(isSlimeChunk(c.cx, c.cz)).toBe(true);
    for (let i = 1; i < l.length; i++) expect(l[i].dist).toBeGreaterThanOrEqual(l[i - 1].dist);
  });
});

describe('Portal planner', () => {
  const P = (id: string, dim: 'overworld' | 'nether', x: number, z: number, y: number | null = 70): PortalSpot => ({ id, name: id, dim, x, y, z });
  it('Overworld → Nether: floor division by 8, same height inside the Nether', () => {
    const p = planPortal('overworld', -2808, 70, 1180, []);
    expect(p.target).toEqual({ x: -351, z: 147, y: 70 });
    expect(planPortal('overworld', -1, 200, -9, []).target).toEqual({ x: -1, z: -2, y: 122 });
    expect(planPortal('nether', -351, 40, 147, []).target).toEqual({ x: -2808, z: 1176, y: 40 });
  });
  it('warns about another portal within the 16 blocks searched in the Nether', () => {
    const p = planPortal('overworld', 800, 64, 800, [P('old', 'nether', 110, 95), P('far', 'nether', 140, 100), P('ow', 'overworld', 800, 800)]);
    expect(p.nearTarget.map((n) => n.portal.id)).toEqual(['old']);
  });
  it('warns when the way back would come out at another Overworld portal', () => {
    // from 807, 807 the Nether portal is at 100, 100, which leads back to 800, 800: a portal nearer to that than the start wins
    const p = planPortal('overworld', 807, 64, 807, [P('start', 'overworld', 807, 807, 64), P('thief', 'overworld', 802, 801, 64), P('fine', 'overworld', 900, 900, 64)]);
    expect(p.back).toEqual({ x: 800, z: 800 });
    expect(p.stealsReturn.map((n) => n.portal.id)).toEqual(['thief']);
  });
});
