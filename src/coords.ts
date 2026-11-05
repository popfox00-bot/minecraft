// Coordinate conventions
//  * Minecraft: +X = east (right), +Z = south (down), north = -Z.
//  * Leaflet L.CRS.Simple: LatLng(lat, lng) where lng grows right and lat grows UP.
//  * 1 map unit = 1 block. So lng = x, lat = -z (north/-Z is up).
//
// Overworld <-> Nether is 8:1 on X/Z. Minecraft uses floor division for
// Overworld -> Nether (block -2808 -> -351, not -351.0 truncated to -351 by
// accident: -2801 -> -351 too, and -1 -> -1, not 0).

export type Dimension = 'overworld' | 'nether';

export interface XZ {
  x: number;
  z: number;
}

export interface LatLngLike {
  lat: number;
  lng: number;
}

/** Block position -> Leaflet CRS.Simple latlng (map units). */
export function blockToLatLng(x: number, z: number): [number, number] {
  return [-z, x];
}

/** Leaflet latlng -> continuous block-space position (not floored). */
export function latLngToBlock(ll: LatLngLike): XZ {
  // `0 - lat` avoids returning -0 for lat == 0.
  return { x: ll.lng, z: 0 - ll.lat };
}

/** Leaflet latlng -> integer block coordinate containing that point. */
export function latLngToBlockInt(ll: LatLngLike): XZ {
  const b = latLngToBlock(ll);
  return { x: Math.floor(b.x), z: Math.floor(b.z) };
}

/** Center of a block in map units (useful for placing markers). */
export function blockCenterLatLng(x: number, z: number): [number, number] {
  return [-(z + 0.5), x + 0.5];
}

export function overworldToNether(x: number, z: number): XZ {
  return { x: Math.floor(x / 8), z: Math.floor(z / 8) };
}

export function netherToOverworld(x: number, z: number): XZ {
  return { x: x * 8, z: z * 8 };
}

/** Converts a position to the other dimension. */
export function toOtherDimension(dim: Dimension, x: number, z: number): { dim: Dimension } & XZ {
  if (dim === 'overworld') return { dim: 'nether', ...overworldToNether(x, z) };
  return { dim: 'overworld', ...netherToOverworld(x, z) };
}

export function distance2D(a: XZ, b: XZ): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

export function distance3D(
  a: XZ & { y?: number | null },
  b: XZ & { y?: number | null },
): number {
  const dy = a.y != null && b.y != null ? b.y - a.y : 0;
  return Math.hypot(b.x - a.x, dy, b.z - a.z);
}

/**
 * Nether travel equivalent of an Overworld distance: walking the same route
 * through the Nether covers 1/8 of the horizontal distance.
 */
export function netherTravelEquivalent(overworldDistance: number): number {
  return overworldDistance / 8;
}

/** Parses "X, Z", "X Z", "X, Y, Z" or "X Y Z" (also with ; or /). */
export function parseCoords(input: string): { x: number; y: number | null; z: number } | null {
  const parts = input
    .trim()
    .split(/[\s,;/]+/)
    .filter(Boolean)
    .map((p) => p.replace(/^[xyzXYZ]=?/, ''));
  if (parts.length !== 2 && parts.length !== 3) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  if (nums.length === 2) return { x: nums[0], y: null, z: nums[1] };
  return { x: nums[0], y: nums[1], z: nums[2] };
}

export function formatXZ(x: number, z: number): string {
  return `${Math.floor(x)}, ${Math.floor(z)}`;
}

/** Chunk and region that contain a block position. */
export function chunkOf(x: number, z: number): XZ {
  return { x: Math.floor(x / 16), z: Math.floor(z / 16) };
}

export function regionOf(x: number, z: number): XZ {
  return { x: Math.floor(x / 512), z: Math.floor(z / 512) };
}

// ---- Biome tile maths -------------------------------------------------------

export const TILE_PX = 256;

/** Blocks covered by one 256px tile at a given Leaflet zoom (CRS.Simple, zoom 0 = 1px/block). */
export function tileBlocks(zoom: number): number {
  return TILE_PX / Math.pow(2, zoom);
}

/**
 * Picks the cubiomes sampling scale for a zoom so each tile is at most ~128
 * cells across. Scales are cubiomes' supported 1, 4, 16, 64, 256.
 */
export function scaleForZoom(zoom: number): number {
  if (zoom >= 2) return 1;
  const want = tileBlocks(zoom) / 128;
  for (const s of [4, 16, 64, 256]) if (s >= want) return s;
  return 256;
}

export interface TileSpec {
  scale: number;
  /** north-west corner in scale units */
  cx: number;
  cz: number;
  /** cells across */
  cells: number;
  /** blocks covered by the tile */
  blocks: number;
}

/** Leaflet tile coords (x right, y down in tile rows) -> cubiomes area request. */
export function tileSpec(tx: number, ty: number, zoom: number): TileSpec {
  const blocks = tileBlocks(zoom);
  const scale = scaleForZoom(zoom);
  // CRS.Simple: pixel y grows downward and equals -lat * 2^zoom = z * 2^zoom,
  // so tile row ty covers block z in [ty*blocks, (ty+1)*blocks).
  const bx = tx * blocks;
  const bz = ty * blocks;
  return {
    scale,
    cx: Math.floor(bx / scale),
    cz: Math.floor(bz / scale),
    cells: Math.max(1, Math.round(blocks / scale)),
    blocks,
  };
}

/** Y used for the 2D "surface" biome map (block units). High enough to avoid cave biomes. */
export const SURFACE_Y = 256;

/** y argument for cubiomes at a given scale (1:1 at scale 1, 1:4 otherwise). */
export function cubiomesY(blockY: number, scale: number): number {
  return scale === 1 ? blockY : Math.floor(blockY / 4);
}
