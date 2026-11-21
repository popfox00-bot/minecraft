// App-side structure suggestions (End Cities, Nether bastions/fortresses):
// which markers count as finds, the current assessment, and the nearest
// suggested places to look.

import type { Dimension } from '../coords';
import type { Marker } from '../model';
import {
  END_CITY,
  END_INNER_RADIUS,
  NETHER_COMPLEX,
  VILLAGE_CFGS,
  OUTPOST_CFGS,
  MONUMENT_CFGS,
  MANSION_CFGS,
  TEMPLE_CFGS,
  assess,
  candidate,
  coreBox,
  regionOfBlock,
  seedVariants,
  spawnBox,
  type Assessment,
  type Find,
  type PlacementConfig,
  type SeedVariant,
} from './bedrock';

export const END_CITY_CATEGORY = 'end-city';
export const BASTION_CATEGORY = 'bastion';
export const FORTRESS_CATEGORY = 'nether-fortress';

export type KindId = 'end' | 'nether' | 'village' | 'outpost' | 'monument' | 'mansion' | 'temple';

export interface StructureKind {
  id: KindId;
  dim: Dimension;
  /** its grid (the first of `cfgs` where there are hypotheses) */
  cfg: PlacementConfig;
  /** grids to choose between by the finds (Overworld); the one matching every find is used */
  cfgs?: PlacementConfig[];
  /** short name for its tab */
  tab: string;
  /** biome ids (Overworld) where it can be → its type ('' when one kind), or none: it can't be there */
  biomes?: Record<number, string>;
  /** what a search box means */
  boxHint: string;
  /** panel title */
  title: string;
  /** what one structure is called */
  noun: string;
  /** marker category per structure type ('' = untyped) */
  categories: Record<string, string>;
  /** no structures closer than this to 0,0 (End: main island + void ring) */
  innerRadius: number;
  /** where to put the marker for best matching */
  markHint: string;
}

const set = (ids: number[], type = '') => Object.fromEntries(ids.map((i) => [i, type])) as Record<number, string>;
// (Overworld biome ids, Java numbering as cubiomes uses: generous, so a real spot isn't ruled out.)
const VILLAGE_BIOMES = [1, 129, 177, 2, 35, 36, 5, 12, 30];
const OUTPOST_BIOMES = [...VILLAGE_BIOMES, 178, 179, 185, 180, 181, 182];

export const KINDS: Record<KindId, StructureKind> = {
  end: {
    id: 'end',
    dim: 'end',
    tab: 'End Cities',
    boxHint: 'Each box is one region of the End City grid. A region holds at most one city, and only inside its box; the shaded core holds it about two times in three. Exact predicted spots unlock once a formula matches a city you have found.',
    cfg: END_CITY,
    title: 'Suggested End Cities',
    noun: 'End City',
    categories: { '': END_CITY_CATEGORY },
    innerRadius: END_INNER_RADIUS,
    markHint: 'at the base of the entrance tower',
  },
  nether: {
    id: 'nether',
    dim: 'nether',
    tab: 'Bastions & Fortresses',
    boxHint: 'Each box is one region of the Nether structure grid (480 blocks). A region holds one bastion or fortress, starting inside its box. Exact predicted spots and types unlock once the formula matches a structure you have found.',
    cfg: NETHER_COMPLEX,
    title: 'Suggested Nether structures',
    noun: 'Nether structure',
    categories: { bastion: BASTION_CATEGORY, fortress: FORTRESS_CATEGORY },
    innerRadius: 0,
    markHint: 'near the middle of the bastion, or on a fortress bridge or spawner',
  },
  village: {
    id: 'village', dim: 'overworld', tab: 'Villages', cfg: VILLAGE_CFGS[0], cfgs: VILLAGE_CFGS,
    title: 'Suggested villages', noun: 'village', categories: { village: 'village' }, innerRadius: 0,
    biomes: set(VILLAGE_BIOMES, 'village'),
    boxHint: 'Each box is one region of the village grid (544 blocks). A region holds at most one village, starting inside its box, and only where the biome allows one (plains, meadow, desert, savanna, taiga, snowy plains or taiga). Exact spots unlock once a grid matches the villages you have found.',
    markHint: 'at the bell, or the middle of the village',
  },
  outpost: {
    id: 'outpost', dim: 'overworld', tab: 'Outposts', cfg: OUTPOST_CFGS[0], cfgs: OUTPOST_CFGS,
    title: 'Suggested pillager outposts', noun: 'pillager outpost', categories: { outpost: 'pillager-outpost' }, innerRadius: 0,
    biomes: set(OUTPOST_BIOMES, 'outpost'),
    boxHint: 'Each box is one region of a possible outpost grid. Not every region has one (outposts are rare, and stay away from villages); where the biome can\'t have one, the region is skipped. Exact spots unlock once a grid matches the outposts you have found.',
    markHint: 'at the foot of the watchtower',
  },
  monument: {
    id: 'monument', dim: 'overworld', tab: 'Monuments', cfg: MONUMENT_CFGS[0], cfgs: MONUMENT_CFGS,
    title: 'Suggested ocean monuments', noun: 'ocean monument', categories: { monument: 'monument' }, innerRadius: 0,
    biomes: set([24, 47, 48, 49, 50], 'monument'),
    boxHint: 'Each box is one region of the monument grid (512 blocks). A region holds at most one monument, in deep ocean only. Exact spots unlock once a grid matches the monuments you have found.',
    markHint: 'at the middle of the monument (its top)',
  },
  mansion: {
    id: 'mansion', dim: 'overworld', tab: 'Mansions', cfg: MANSION_CFGS[0], cfgs: MANSION_CFGS,
    title: 'Suggested woodland mansions', noun: 'woodland mansion', categories: { mansion: 'mansion' }, innerRadius: 0,
    biomes: set([29, 186], 'mansion'),
    boxHint: 'Each box is one region of the mansion grid (1280 blocks). A region holds at most one mansion, in a dark forest (or pale garden). Exact spots unlock once a grid matches the mansions you have found.',
    markHint: 'at the front door',
  },
  temple: {
    id: 'temple', dim: 'overworld', tab: 'Temples', cfg: TEMPLE_CFGS[0], cfgs: TEMPLE_CFGS,
    title: 'Suggested temples', noun: 'temple', categories: { temple: 'temple' }, innerRadius: 0,
    biomes: { ...set([2], 'desert_pyramid'), ...set([21, 168], 'jungle_temple'), ...set([6, 184], 'witch_hut'), ...set([12, 30, 179], 'igloo') },
    boxHint: 'Each box is one region of the temple grid (512 blocks). A region holds at most one, and the biome there picks which: a desert pyramid in desert, a jungle temple in jungle, a witch hut in swamp, an igloo in snowy plains or taiga. Exact spots unlock once a grid matches the temples you have found.',
    markHint: 'at its middle (for a pyramid, the top of the middle)',
  },
};

/** Kinds shown on a dimension's tab (the first is the default). */
export const KINDS_BY_DIM: Record<Dimension, StructureKind[]> = {
  overworld: [KINDS.village, KINDS.outpost, KINDS.monument, KINDS.mansion, KINDS.temple],
  nether: [KINDS.nether],
  end: [KINDS.end],
};

/** The kind for a dimension: `prev` if it belongs there, else the dimension's first. */
export function kindForDim(dim: Dimension, prev?: StructureKind): StructureKind {
  return prev && prev.dim === dim ? prev : KINDS_BY_DIM[dim][0];
}

export const TYPE_LABEL: Record<string, string> = {
  bastion: 'Bastion', fortress: 'Fortress', '': 'End City', village: 'Village', outpost: 'Pillager outpost', monument: 'Ocean monument',
  mansion: 'Woodland mansion', temple: 'Temple', desert_pyramid: 'Desert pyramid', jungle_temple: 'Jungle temple', witch_hut: 'Witch hut', igloo: 'Igloo',
};

function typeOfCategory(kind: StructureKind, categoryId: string): string | null {
  for (const [type, cat] of Object.entries(kind.categories)) if (cat === categoryId) return type;
  return null;
}

/** Found/looted/built markers of this kind's categories, in its dimension, are evidence; planned ones are not. */
export function structureFinds(kind: StructureKind, markers: Marker[]): (Find & { marker: Marker })[] {
  const out: (Find & { marker: Marker })[] = [];
  for (const m of markers) {
    if (m.dim !== kind.dim || m.status === 'planned') continue;
    const type = typeOfCategory(kind, m.categoryId);
    if (type === null) continue;
    out.push({ id: m.id, x: m.x, z: m.z, type: type || undefined, marker: m });
  }
  return out;
}

/** @deprecated kept for the End-only callers */
export function endCityFinds(markers: Marker[]): Marker[] {
  return structureFinds(KINDS.end, markers).map((f) => f.marker);
}

export interface Suggestion {
  kind: 'predicted' | 'box';
  rx: number;
  rz: number;
  x: number;
  z: number;
  dist: number;
  /** bastion / fortress for shared grids (exact predictions only) */
  type: string | null;
}

export interface EndCityState {
  kind: StructureKind;
  /** the grid in use (of the kind's hypotheses: the one matching the finds, else the first) */
  cfg: PlacementConfig;
  assessment: Assessment;
  /** variant used for exact pins, or null when pins are hidden */
  pinVariant: SeedVariant | null;
  /** pins shown although they have not matched anything yet */
  unverified: boolean;
  /** regions that already contain a marked structure (found or planned) */
  marked: Set<string>;
}

export const regionKey = (rx: number, rz: number) => `${rx},${rz}`;

export function structureState(kind: StructureKind, seed: string, markers: Marker[], showUnverified: boolean): EndCityState {
  const finds = structureFinds(kind, markers);
  // (Several grids to choose from: the one that matches every find, the least likely by chance; the chance
  // of a coincidence counts every grid tried.)
  const cfgs = kind.cfgs ?? [kind.cfg];
  const tried = cfgs.map((cfg) => ({ cfg, a: assess(cfg, seed, finds) }));
  const ok = tried.filter((t) => t.a.best && t.a.best.matches === finds.length && finds.length > 0).sort((x, y) => x.a.coincidence - y.a.coincidence);
  const pick = ok[0] ?? tried[0];
  const cfg = pick.cfg;
  let assessment = pick.a;
  if (ok.length && cfgs.length > 1) {
    const coincidence = Math.min(1, assessment.coincidence * cfgs.length);
    assessment = { ...assessment, coincidence, confidence: coincidence > 1 / 20 ? 'possible' : coincidence > 1 / 1000 ? 'likely' : 'confirmed' };
  }
  const trusted = assessment.confidence === 'possible' || assessment.confidence === 'likely' || assessment.confidence === 'confirmed';
  let pinVariant: SeedVariant | null = null;
  let unverified = false;
  if (trusted && assessment.best) pinVariant = assessment.best.variant;
  else if (showUnverified && assessment.confidence !== 'mismatch') {
    pinVariant = seedVariants(seed)[0];
    unverified = true;
  }
  const marked = new Set<string>();
  const cats = new Set(Object.values(kind.categories));
  for (const m of markers) {
    if (!cats.has(m.categoryId) || m.dim !== kind.dim) continue;
    const r = regionOfBlock(cfg, m.x, m.z);
    marked.add(regionKey(r.rx, r.rz));
  }
  return { kind, cfg, assessment, pinVariant, unverified, marked };
}

/** End-only convenience (used by older callers/tests). */
export function endCityState(seed: string, markers: Marker[], showUnverified: boolean): EndCityState {
  return structureState(KINDS.end, seed, markers, showUnverified);
}

/** Regions that cannot hold a structure (End: main island and the empty ring around it). */
export function regionTooClose(kind: StructureKind, rx: number, rz: number, cfg = kind.cfg): boolean {
  if (!kind.innerRadius) return false;
  const b = spawnBox(cfg, rx, rz);
  const far = Math.max(Math.hypot(b.x0, b.z0), Math.hypot(b.x1, b.z0), Math.hypot(b.x0, b.z1), Math.hypot(b.x1, b.z1));
  return far < kind.innerRadius;
}

/** Nearest places to look, skipping regions that already have a marked structure. */
export function suggestions(state: EndCityState, origin: { x: number; z: number }, count = 10, maxRings = 12): Suggestion[] {
  const { kind, cfg } = state;
  const w = cfg.spacing * 16;
  const o = regionOfBlock(cfg, origin.x, origin.z);
  const core = coreBox(cfg);
  const out: Suggestion[] = [];
  for (let r = 0; r <= maxRings; r++) {
    for (let rz = o.rz - r; rz <= o.rz + r; rz++)
      for (let rx = o.rx - r; rx <= o.rx + r; rx++) {
        if (Math.max(Math.abs(rx - o.rx), Math.abs(rz - o.rz)) !== r) continue;
        if (regionTooClose(kind, rx, rz, cfg) || state.marked.has(regionKey(rx, rz))) continue;
        let p: { x: number; z: number; type: string | null };
        let sk: Suggestion['kind'];
        if (state.pinVariant) {
          p = candidate(cfg, state.pinVariant.seed32, rx, rz);
          sk = 'predicted';
        } else {
          const b = spawnBox(cfg, rx, rz, core.inset);
          p = { x: Math.round((b.x0 + b.x1) / 2), z: Math.round((b.z0 + b.z1) / 2), type: null };
          sk = 'box';
        }
        // End: no land inside the empty ring around the main island
        if (kind.innerRadius && Math.hypot(p.x, p.z) < kind.innerRadius) continue;
        out.push({ kind: sk, rx, rz, x: p.x, z: p.z, type: p.type, dist: Math.hypot(p.x - origin.x, p.z - origin.z) });
      }
    const ringEdge = r * w;
    const sorted = [...out].sort((a, b) => a.dist - b.dist);
    if (sorted.length >= count && sorted[count - 1].dist <= ringEdge) return sorted.slice(0, count);
  }
  return out.sort((a, b) => a.dist - b.dist).slice(0, count);
}
