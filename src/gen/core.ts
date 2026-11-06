// Thin, synchronous wrapper around the cubiomes WASM module. Used by the
// Web Worker (browser) and directly by Node tests/scripts.

import type { CubiomesModule } from '../wasm/cubiomes';
import { seedHalves } from '../seed';
import { cubiomesY, SURFACE_Y, type Dimension } from '../coords';

export const DIM_ID: Record<Dimension, number> = { overworld: 0, nether: -1, end: 1 };

export class BiomeGen {
  private key = '';
  constructor(private m: CubiomesModule) {}

  get newestVersion(): number {
    return this.m._wa_newest_version();
  }

  /** (Re)configures the generator only when seed/version/dimension changed. */
  configure(seed: string, mc: number, dim: Dimension): void {
    const key = `${seed}|${mc}|${dim}`;
    if (key === this.key) return;
    const { hi, lo } = seedHalves(seed);
    this.m._wa_init(mc, DIM_ID[dim], hi, lo);
    this.key = key;
  }

  /** Biome id at a block position (voronoi, 1:1). */
  biomeAt(x: number, z: number, y: number = SURFACE_Y): number {
    return this.m._wa_get_biome(1, Math.floor(x), Math.floor(y), Math.floor(z));
  }

  /** Generates a cells x cells area at `scale`, north-west corner (cx, cz) in scale units. */
  area(scale: number, cx: number, cz: number, cells: number, blockY: number = SURFACE_Y): Uint8Array {
    const ptr = this.m._wa_gen_area(scale, cx, cz, cells, cells, cubiomesY(blockY, scale));
    if (!ptr) throw new Error('cubiomes genBiomes failed');
    const n = cells * cells;
    const src = this.m.HEAP32.subarray(ptr >> 2, (ptr >> 2) + n);
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = src[i] & 0xff;
    return out;
  }

  biomeName(id: number): string {
    return this.m.UTF8ToString(this.m._wa_biome_name(id));
  }
}
