// Portal planner: where to build the matching portal in the other dimension (1:8, floor division going into
// the Nether), and which portals already there (or back where you started) the game might link to instead.
//
// When you go through a portal, the game looks for an existing portal near the converted position: in
// Bedrock, about 128 blocks around it in the Overworld and 16 in the Nether (the whole height), taking the
// nearest. If none, it builds a new one there.

import { netherToOverworld, overworldToNether, type Dimension, type XZ } from './coords';

export const SEARCH_RADIUS: Record<'overworld' | 'nether', number> = { overworld: 128, nether: 16 };
/** Heights a portal can be built at: the Nether's roof is at 128 (a portal needs 5 blocks of room). */
const Y_RANGE: Record<'overworld' | 'nether', [number, number]> = { overworld: [-59, 315], nether: [1, 122] };

export interface PortalSpot { id: string; name: string; x: number; y: number | null; z: number; dim: Dimension }
export interface NearPortal { portal: PortalSpot; dist: number }

export interface PortalPlan {
  from: 'overworld' | 'nether';
  to: 'overworld' | 'nether';
  /** where to build the matching portal */
  target: XZ & { y: number | null };
  /** portals already near the target that the game could link to instead of a new one (nearest first) */
  nearTarget: NearPortal[];
  /** coming back through the new portal: where the game looks, and portals there nearer to it than where you started */
  back: XZ;
  stealsReturn: NearPortal[];
}

const dist = (a: XZ & { y?: number | null }, b: XZ & { y?: number | null }) =>
  Math.hypot(a.x - b.x, a.z - b.z, a.y != null && b.y != null ? a.y - b.y : 0);
const within = (p: XZ, c: XZ, r: number) => Math.abs(p.x - c.x) <= r && Math.abs(p.z - c.z) <= r;
const clampY = (y: number | null, d: 'overworld' | 'nether') => (y == null ? null : Math.min(Y_RANGE[d][1], Math.max(Y_RANGE[d][0], Math.floor(y))));

/** Plan the portal matching one at (x, y, z) in `from`; `portals`: the portals marked so far (both sides). */
export function planPortal(from: 'overworld' | 'nether', x: number, y: number | null, z: number, portals: PortalSpot[]): PortalPlan {
  const to = from === 'overworld' ? 'nether' : 'overworld';
  const t = from === 'overworld' ? overworldToNether(x, z) : netherToOverworld(x, z);
  const target = { ...t, y: clampY(y, to) };
  const rT = SEARCH_RADIUS[to];
  const nearTarget = portals.filter((p) => p.dim === to && within(p, target, rT))
    .map((p) => ({ portal: p, dist: dist(p, target) })).sort((a, b) => a.dist - b.dist);
  // (Back the other way, from the new portal: the game looks around `back` and takes the nearest portal.)
  const back = to === 'nether' ? netherToOverworld(target.x, target.z) : overworldToNether(target.x, target.z);
  const start = { x, y, z };
  const startDist = dist(start, back);
  const rB = SEARCH_RADIUS[from];
  const stealsReturn = portals.filter((p) => p.dim === from && dist(p, start) > 3 && within(p, back, rB))
    .map((p) => ({ portal: p, dist: dist(p, back) })).filter((n) => n.dist < startDist).sort((a, b) => a.dist - b.dist);
  return { from, to, target, nearTarget, back, stealsReturn };
}
