// Experimental Bedrock structure placement (End Cities first).
//
// Sources (both public reverse-engineering projects):
//  * bedrock-dev/MCBEStructureFinder (structure.h, be_finder.cpp, be_random.cpp):
//    region seed, MT19937 first-n outputs, END_CITY = {spacing 20, range 9,
//    salt 10387313, 4 draws => triangular offset}. Its README marks End City
//    as unfinished, and it predates 64-bit seeds.
//  * Earthcomputer/bedrockified (BedrockRandom, SharedSeedRandom): Bedrock's
//    RNG is MT19937 with 32-bit seeds; nextInt(n) = unsigned % n.
//
// Nothing here is trusted until it matches the user's own found markers:
// see verify(). Several 64-bit -> 32-bit seed reductions are offered as
// hypotheses because which one current Bedrock uses is unknown.

/** First `n` outputs of MT19937 seeded with init_genrand(seed) (same as C++ std::mt19937). */
export function mtFirst(seed: number, n: number): number[] {
  // Only the first n+1 state words and words 397..397+n are needed for the
  // first n outputs (same shortcut as MCBEStructureFinder's mt_n_get).
  const init = (prev: number, i: number) => (Math.imul(0x6c078965, (prev ^ (prev >>> 30)) >>> 0) + i) >>> 0;
  const head = new Array<number>(n + 1);
  head[0] = seed >>> 0;
  for (let i = 1; i <= n; i++) head[i] = init(head[i - 1], i);
  let t = head[n];
  for (let i = n; i < 397; i++) t = init(t, i + 1);
  const tail = new Array<number>(n + 1);
  tail[0] = t;
  for (let i = 1; i <= n; i++) tail[i] = init(tail[i - 1], i + 397);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const y0 = ((head[i] & 0x80000000) | (head[i + 1] & 0x7fffffff)) >>> 0;
    let y = (y0 >>> 1) ^ tail[i];
    if (y0 & 1) y ^= 0x9908b0df;
    y >>>= 0;
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    out.push(y >>> 0);
  }
  return out;
}

export interface PlacementConfig {
  id: string;
  label: string;
  /** region size in chunks */
  spacing: number;
  /** offsets are 0..range-1 chunks */
  range: number;
  salt: number;
  /** average two draws per axis (centre-weighted) */
  triangular: boolean;
  /** placement point inside the start chunk */
  blockOffset: number;
}

export const END_CITY: PlacementConfig = {
  id: 'end-city',
  label: 'End City',
  spacing: 20,
  range: 9,
  salt: 10387313,
  triangular: true,
  blockOffset: 8,
};

/** Java's 64-bit region seed formula, truncated to 32 bits (identical constants in Bedrock). */
export function regionSeed(seed32: number, salt: number, rx: number, rz: number): number {
  // 341873128712 mod 2^32 = -1724254968, 132897987541 mod 2^32 = -245998635
  return (Math.imul(rx, -1724254968) + Math.imul(rz, -245998635) + seed32 + salt) >>> 0;
}

export interface SeedVariant {
  id: string;
  label: string;
  seed32: number;
}

/** Ways a 64-bit world seed could be reduced to Bedrock's 32-bit structure seed. */
export function seedVariants(seed: string): SeedVariant[] {
  const v = BigInt.asUintN(64, BigInt(seed));
  const lo = Number(v & 0xffffffffn);
  const hi = Number(v >> 32n);
  return [
    { id: 'low32', label: 'low 32 bits of the seed', seed32: lo },
    { id: 'high32', label: 'high 32 bits of the seed', seed32: hi },
    { id: 'xor32', label: 'high XOR low 32 bits', seed32: (hi ^ lo) >>> 0 },
  ];
}

const floorDiv = (a: number, b: number) => Math.floor(a / b);

/** Start chunk of the structure attempt in region (rx, rz). */
export function candidateChunk(cfg: PlacementConfig, seed32: number, rx: number, rz: number): { cx: number; cz: number } {
  const r = mtFirst(regionSeed(seed32, cfg.salt, rx, rz), cfg.triangular ? 4 : 2).map((x) => x % cfg.range);
  const ox = cfg.triangular ? Math.floor((r[0] + r[1]) / 2) : r[0];
  const oz = cfg.triangular ? Math.floor((r[2] + r[3]) / 2) : r[1];
  return { cx: rx * cfg.spacing + ox, cz: rz * cfg.spacing + oz };
}

export function candidateBlock(cfg: PlacementConfig, seed32: number, rx: number, rz: number): { x: number; z: number } {
  const { cx, cz } = candidateChunk(cfg, seed32, rx, rz);
  return { x: cx * 16 + cfg.blockOffset, z: cz * 16 + cfg.blockOffset };
}

export function regionOfBlock(cfg: PlacementConfig, x: number, z: number): { rx: number; rz: number } {
  return { rx: floorDiv(floorDiv(x, 16), cfg.spacing), rz: floorDiv(floorDiv(z, 16), cfg.spacing) };
}

/** Block-space box where region (rx, rz)'s structure can start (independent of the RNG). */
export function spawnBox(cfg: PlacementConfig, rx: number, rz: number, inset = 0): { x0: number; z0: number; x1: number; z1: number } {
  const x0 = (rx * cfg.spacing + inset) * 16;
  const z0 = (rz * cfg.spacing + inset) * 16;
  const size = (cfg.range - 2 * inset) * 16;
  return { x0, z0, x1: x0 + size, z1: z0 + size };
}

/**
 * The "most likely" inner box: with two averaged draws, offsets 2..range-3
 * hold most of the probability. Returns the inset and the probability that a
 * structure lands inside it.
 */
export function coreBox(cfg: PlacementConfig): { inset: number; probability: number } {
  if (!cfg.triangular) return { inset: 0, probability: 1 };
  const inset = 2;
  let p = 0;
  for (let a = 0; a < cfg.range; a++)
    for (let b = 0; b < cfg.range; b++) {
      const o = Math.floor((a + b) / 2);
      if (o >= inset && o <= cfg.range - 1 - inset) p++;
    }
  const axis = p / (cfg.range * cfg.range);
  return { inset, probability: axis * axis };
}

// ---- verification against the user's finds ------------------------------------

/** Blocks between a found marker (placed at the base of the entrance tower) and a prediction that still count as a match. */
export const MATCH_TOLERANCE = 20;

export interface FindCheck {
  id: string;
  x: number;
  z: number;
  /** nearest prediction under this variant, and distance to it */
  predicted: { x: number; z: number };
  dist: number;
  match: boolean;
  /** inside (or within tolerance of) a region's possible spawn box */
  inGrid: boolean;
}

export interface VariantResult {
  variant: SeedVariant;
  checks: FindCheck[];
  matches: number;
}

export function checkFind(cfg: PlacementConfig, seed32: number, f: { id: string; x: number; z: number }): FindCheck {
  const { rx, rz } = regionOfBlock(cfg, f.x, f.z);
  let best = { x: 0, z: 0 };
  let dist = Infinity;
  let inGrid = false;
  const tol = MATCH_TOLERANCE;
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const p = candidateBlock(cfg, seed32, rx + dx, rz + dz);
      const d = Math.hypot(p.x - f.x, p.z - f.z);
      if (d < dist) {
        dist = d;
        best = p;
      }
      const b = spawnBox(cfg, rx + dx, rz + dz);
      if (f.x >= b.x0 - tol && f.x < b.x1 + tol && f.z >= b.z0 - tol && f.z < b.z1 + tol) inGrid = true;
    }
  return { id: f.id, x: f.x, z: f.z, predicted: best, dist, match: dist <= tol, inGrid };
}

export function verify(cfg: PlacementConfig, seed: string, finds: { id: string; x: number; z: number }[]): VariantResult[] {
  return seedVariants(seed)
    .map((variant) => {
      const checks = finds.map((f) => checkFind(cfg, variant.seed32, f));
      return { variant, checks, matches: checks.filter((c) => c.match).length };
    })
    .sort((a, b) => b.matches - a.matches);
}

export type Confidence = 'none' | 'possible' | 'likely' | 'confirmed' | 'mismatch';

/** Distribution of a placement offset along one axis (index = chunks). */
function offsetDist(cfg: PlacementConfig): number[] {
  const d = new Array<number>(cfg.range).fill(0);
  if (!cfg.triangular) return d.map(() => 1 / cfg.range);
  for (let a = 0; a < cfg.range; a++) for (let b = 0; b < cfg.range; b++) d[Math.floor((a + b) / 2)] += 1 / (cfg.range * cfg.range);
  return d;
}

/**
 * Probability that a wrong formula still "matches" one find by luck: the
 * chance that two independent placements in the same region land within
 * MATCH_TOLERANCE of each other.
 */
export function chanceMatch(cfg: PlacementConfig, tol = MATCH_TOLERANCE): number {
  const d = offsetDist(cfg);
  const diff = new Map<number, number>();
  for (let a = 0; a < d.length; a++) for (let b = 0; b < d.length; b++) diff.set(a - b, (diff.get(a - b) ?? 0) + d[a] * d[b]);
  let p = 0;
  for (const [dx, px] of diff) for (const [dz, pz] of diff) if (16 * Math.hypot(dx, dz) <= tol) p += px * pz;
  return p;
}

export interface Assessment {
  finds: number;
  /** variant whose predictions are shown, if any */
  best: VariantResult | null;
  confidence: Confidence;
  /** chance that the matches are a coincidence (all variants considered) */
  coincidence: number;
  /** every find sits in the predicted grid boxes */
  gridOk: boolean;
  outsideGrid: FindCheck[];
}

/**
 * Exact predictions are trusted only when one seed variant matches every
 * find. Confidence comes from how unlikely that is by chance:
 * possible > 1 in 20, likely > 1 in 1000, confirmed below that.
 */
export function assess(cfg: PlacementConfig, seed: string, finds: { id: string; x: number; z: number }[]): Assessment {
  const results = verify(cfg, seed, finds);
  const gridChecks = results[0]?.checks ?? [];
  const outsideGrid = gridChecks.filter((c) => !c.inGrid);
  if (!finds.length) return { finds: 0, best: null, confidence: 'none', coincidence: 1, gridOk: true, outsideGrid: [] };
  const perfect = results.filter((r) => r.matches === finds.length);
  if (!perfect.length) {
    return { finds: finds.length, best: results[0], confidence: 'mismatch', coincidence: 1, gridOk: !outsideGrid.length, outsideGrid };
  }
  const coincidence = Math.min(1, results.length * chanceMatch(cfg) ** finds.length);
  const confidence: Confidence = coincidence > 1 / 20 ? 'possible' : coincidence > 1 / 1000 ? 'likely' : 'confirmed';
  return { finds: finds.length, best: perfect[0], confidence, coincidence, gridOk: !outsideGrid.length, outsideGrid };
}

/** Regions (rx, rz) whose spawn box intersects a block-space rectangle. */
export function regionsIn(cfg: PlacementConfig, x0: number, z0: number, x1: number, z1: number): { rx: number; rz: number }[] {
  const w = cfg.spacing * 16;
  const out: { rx: number; rz: number }[] = [];
  for (let rz = floorDiv(z0, w); rz <= floorDiv(z1, w); rz++)
    for (let rx = floorDiv(x0, w); rx <= floorDiv(x1, w); rx++) out.push({ rx, rz });
  return out;
}

/** End Cities never generate on or near the main island (there is no land there). */
export const END_INNER_RADIUS = 1000;
