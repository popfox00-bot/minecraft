import { describe, it, expect } from 'vitest';
import { KINDS, KINDS_BY_DIM, kindForDim, structureState, suggestions } from '../src/structures/endCities';
import { candidate, seedVariants, spawnBox, VILLAGE_CFGS } from '../src/structures/bedrock';
import type { Marker } from '../src/model';

const SEED = '-2829401596156382806';
const mk = (id: string, categoryId: string, x: number, z: number, status: Marker['status'] = 'found'): Marker =>
  ({ id, name: id, categoryId, x, y: null, z, dim: 'overworld', notes: '', status, createdAt: '', showLinked: false });

describe('Overworld structure kinds', () => {
  it('each dimension has its kinds; the Overworld defaults to villages and keeps the one picked', () => {
    expect(KINDS_BY_DIM.overworld.map((k) => k.id)).toEqual(['village', 'outpost', 'monument', 'mansion', 'temple']);
    expect(kindForDim('overworld').id).toBe('village');
    expect(kindForDim('overworld', KINDS.temple).id).toBe('temple');
    expect(kindForDim('nether', KINDS.temple).id).toBe('nether');
  });

  it('with no finds: boxes only, from the first grid', () => {
    const st = structureState(KINDS.village, SEED, [], false);
    expect(st.assessment.confidence).toBe('none');
    expect(st.pinVariant).toBeNull();
    expect(st.cfg).toBe(VILLAGE_CFGS[0]);
    const sg = suggestions(st, { x: 0, z: 0 }, 5);
    expect(sg).toHaveLength(5);
    for (const s of sg) expect(s.kind).toBe('box');
  });

  it('finds that fit one grid pick that grid (and only matching finds count)', () => {
    // Villages placed exactly where the uniform-offset grid (low 32 bits) puts them.
    const cfg = VILLAGE_CFGS[1];
    const v = seedVariants(SEED)[0];
    const finds = [[0, 0], [1, -2], [-3, 2]].map(([rx, rz], i) => { const p = candidate(cfg, v.seed32, rx, rz); return mk(`v${i}`, 'village', p.x + 5, p.z - 4); });
    const st = structureState(KINDS.village, SEED, finds, false);
    expect(st.cfg).toBe(cfg);
    expect(st.pinVariant?.id).toBe('low32');
    expect(['likely', 'confirmed', 'possible']).toContain(st.assessment.confidence);
    // (A planned marker isn't evidence, but its region is skipped.)
    const st2 = structureState(KINDS.village, SEED, [mk('p', 'village', 100, 100, 'planned')], false);
    expect(st2.assessment.finds).toBe(0);
    expect(st2.marked.size).toBe(1);
  });

  it('a find outside every box of every grid: no match, pins stay hidden', () => {
    const st = structureState(KINDS.mansion, SEED, [mk('m', 'mansion', 60 * 16 + 300, 60 * 16 + 300)], false);
    const b = spawnBox(st.cfg, 0, 0);
    expect(60 * 16 + 300).toBeGreaterThan(b.x1);
    expect(st.pinVariant).toBeNull();
  });

  it('temple biomes pick the kind of temple', () => {
    const b = KINDS.temple.biomes!;
    expect(b[2]).toBe('desert_pyramid');
    expect(b[21]).toBe('jungle_temple');
    expect(b[6]).toBe('witch_hut');
    expect(b[12]).toBe('igloo');
    expect(1 in b).toBe(false); // plains: none
    expect(24 in KINDS.monument.biomes!).toBe(true); // deep ocean
    expect(0 in KINDS.monument.biomes!).toBe(false); // shallow ocean
  });
});
