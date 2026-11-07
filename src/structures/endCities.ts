// App-side End City suggestions: which markers count as finds, the current
// assessment, and the nearest suggested places to look.

import type { Marker } from '../model';
import {
  END_CITY,
  END_INNER_RADIUS,
  assess,
  candidateBlock,
  coreBox,
  regionOfBlock,
  seedVariants,
  spawnBox,
  type Assessment,
  type SeedVariant,
} from './bedrock';

export const END_CITY_CATEGORY = 'end-city';

/** Found/looted/built End City markers in the End are evidence; planned ones are not. */
export function endCityFinds(markers: Marker[]): Marker[] {
  return markers.filter((m) => m.categoryId === END_CITY_CATEGORY && m.dim === 'end' && m.status !== 'planned');
}

export interface Suggestion {
  kind: 'predicted' | 'box';
  rx: number;
  rz: number;
  x: number;
  z: number;
  dist: number;
}

export interface EndCityState {
  assessment: Assessment;
  /** variant used for exact pins, or null when pins are hidden */
  pinVariant: SeedVariant | null;
  /** pins shown although they have not matched anything yet */
  unverified: boolean;
  /** regions that already contain a marked End City (found or planned) */
  marked: Set<string>;
}

export const regionKey = (rx: number, rz: number) => `${rx},${rz}`;

export function endCityState(seed: string, markers: Marker[], showUnverified: boolean): EndCityState {
  const finds = endCityFinds(markers);
  const assessment = assess(END_CITY, seed, finds.map((m) => ({ id: m.id, x: m.x, z: m.z })));
  const trusted = assessment.confidence === 'possible' || assessment.confidence === 'likely' || assessment.confidence === 'confirmed';
  let pinVariant: SeedVariant | null = null;
  let unverified = false;
  if (trusted && assessment.best) pinVariant = assessment.best.variant;
  else if (showUnverified && assessment.confidence !== 'mismatch') {
    pinVariant = seedVariants(seed)[0];
    unverified = true;
  }
  const marked = new Set<string>();
  for (const m of markers) {
    if (m.categoryId !== END_CITY_CATEGORY || m.dim !== 'end') continue;
    const r = regionOfBlock(END_CITY, m.x, m.z);
    marked.add(regionKey(r.rx, r.rz));
  }
  return { assessment, pinVariant, unverified, marked };
}

/** Regions that cannot hold an End City: the main island and the empty ring around it. */
export function regionTooClose(rx: number, rz: number): boolean {
  const b = spawnBox(END_CITY, rx, rz);
  // farthest corner of the spawn box still inside the inner radius => skip
  const far = Math.max(Math.hypot(b.x0, b.z0), Math.hypot(b.x1, b.z0), Math.hypot(b.x0, b.z1), Math.hypot(b.x1, b.z1));
  return far < END_INNER_RADIUS;
}

/** Nearest places to look, skipping regions that already have a marked city. */
export function suggestions(state: EndCityState, origin: { x: number; z: number }, count = 10, maxRings = 12): Suggestion[] {
  const w = END_CITY.spacing * 16;
  const o = regionOfBlock(END_CITY, origin.x, origin.z);
  const core = coreBox(END_CITY);
  const out: Suggestion[] = [];
  for (let r = 0; r <= maxRings; r++) {
    for (let rz = o.rz - r; rz <= o.rz + r; rz++)
      for (let rx = o.rx - r; rx <= o.rx + r; rx++) {
        if (Math.max(Math.abs(rx - o.rx), Math.abs(rz - o.rz)) !== r) continue;
        if (regionTooClose(rx, rz) || state.marked.has(regionKey(rx, rz))) continue;
        let p: { x: number; z: number };
        let kind: Suggestion['kind'];
        if (state.pinVariant) {
          p = candidateBlock(END_CITY, state.pinVariant.seed32, rx, rz);
          kind = 'predicted';
        } else {
          const b = spawnBox(END_CITY, rx, rz, core.inset);
          p = { x: Math.round((b.x0 + b.x1) / 2), z: Math.round((b.z0 + b.z1) / 2) };
          kind = 'box';
        }
        // no land inside the empty ring around the main island
        if (Math.hypot(p.x, p.z) < END_INNER_RADIUS) continue;
        out.push({ kind, rx, rz, ...p, dist: Math.hypot(p.x - origin.x, p.z - origin.z) });
      }
    // stop once we have enough that are closer than anything in the next ring
    const ringEdge = r * w;
    const sorted = [...out].sort((a, b) => a.dist - b.dist);
    if (sorted.length >= count && sorted[count - 1].dist <= ringEdge) return sorted.slice(0, count);
  }
  return out.sort((a, b) => a.dist - b.dist).slice(0, count);
}
