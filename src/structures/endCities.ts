// App-side structure suggestions (End Cities, Nether bastions/fortresses):
// which markers count as finds, the current assessment, and the nearest
// suggested places to look.

import type { Dimension } from '../coords';
import type { Marker } from '../model';
import {
  END_CITY,
  END_INNER_RADIUS,
  NETHER_COMPLEX,
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

export interface StructureKind {
  id: 'end' | 'nether';
  dim: Dimension;
  cfg: PlacementConfig;
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

export const KINDS: Record<'end' | 'nether', StructureKind> = {
  end: {
    id: 'end',
    dim: 'end',
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
    cfg: NETHER_COMPLEX,
    title: 'Suggested Nether structures',
    noun: 'Nether structure',
    categories: { bastion: BASTION_CATEGORY, fortress: FORTRESS_CATEGORY },
    innerRadius: 0,
    markHint: 'near the middle of the bastion, or on a fortress bridge or spawner',
  },
};

export function kindForDim(dim: Dimension): StructureKind {
  return dim === 'end' ? KINDS.end : KINDS.nether;
}

export const TYPE_LABEL: Record<string, string> = { bastion: 'Bastion', fortress: 'Fortress', '': 'End City' };

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
  const assessment = assess(kind.cfg, seed, finds);
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
    const r = regionOfBlock(kind.cfg, m.x, m.z);
    marked.add(regionKey(r.rx, r.rz));
  }
  return { kind, assessment, pinVariant, unverified, marked };
}

/** End-only convenience (used by older callers/tests). */
export function endCityState(seed: string, markers: Marker[], showUnverified: boolean): EndCityState {
  return structureState(KINDS.end, seed, markers, showUnverified);
}

/** Regions that cannot hold a structure (End: main island and the empty ring around it). */
export function regionTooClose(kind: StructureKind, rx: number, rz: number): boolean {
  if (!kind.innerRadius) return false;
  const b = spawnBox(kind.cfg, rx, rz);
  const far = Math.max(Math.hypot(b.x0, b.z0), Math.hypot(b.x1, b.z0), Math.hypot(b.x0, b.z1), Math.hypot(b.x1, b.z1));
  return far < kind.innerRadius;
}

/** Nearest places to look, skipping regions that already have a marked structure. */
export function suggestions(state: EndCityState, origin: { x: number; z: number }, count = 10, maxRings = 12): Suggestion[] {
  const { kind } = state;
  const cfg = kind.cfg;
  const w = cfg.spacing * 16;
  const o = regionOfBlock(cfg, origin.x, origin.z);
  const core = coreBox(cfg);
  const out: Suggestion[] = [];
  for (let r = 0; r <= maxRings; r++) {
    for (let rz = o.rz - r; rz <= o.rz + r; rz++)
      for (let rx = o.rx - r; rx <= o.rx + r; rx++) {
        if (Math.max(Math.abs(rx - o.rx), Math.abs(rz - o.rz)) !== r) continue;
        if (regionTooClose(kind, rx, rz) || state.marked.has(regionKey(rx, rz))) continue;
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
