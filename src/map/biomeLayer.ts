// Leaflet GridLayer that paints cubiomes biome tiles generated in workers.

import L from 'leaflet';
import { tileSpec, TILE_PX, type Dimension } from '../coords';
import { buildRgbaLut } from '../biomes';
import { AbortedError, type BiomeClient } from '../gen/client';
import { getTile, putTile, tileKey, type CachedTile } from './tileCache';

const LUT = buildRgbaLut();

export interface BiomeSource {
  seed: string;
  mc: number;
  dim: Dimension;
}

type TileEl = HTMLCanvasElement & { _abort?: AbortController };

export class BiomeLayer extends L.GridLayer {
  private scratch = document.createElement('canvas');
  /** Stats for the debug overlay / e2e checks. */
  stats = { generated: 0, fromCache: 0 };

  constructor(
    private client: BiomeClient,
    private source: BiomeSource,
    opts?: L.GridLayerOptions,
  ) {
    super({ tileSize: TILE_PX, updateWhenZooming: false, keepBuffer: 1, ...opts });
    this.on('tileunload', (e: L.TileEvent) => (e.tile as unknown as TileEl)._abort?.abort());
  }

  setSource(src: BiomeSource): void {
    this.source = src;
    this.redraw();
  }

  protected createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const canvas = document.createElement('canvas') as TileEl;
    canvas.width = canvas.height = TILE_PX;
    const ac = new AbortController();
    canvas._abort = ac;
    const { seed, mc, dim } = this.source;
    const key = tileKey(seed, mc, dim, coords.z, coords.x, coords.y);
    const spec = tileSpec(coords.x, coords.y, coords.z);

    // Tiles near the view centre first.
    const map = this._map;
    let priority = 0;
    if (map) {
      const c = map.project(map.getCenter(), coords.z).divideBy(TILE_PX);
      priority = -Math.hypot(coords.x + 0.5 - c.x, coords.y + 0.5 - c.y);
    }

    (async () => {
      let t: CachedTile | undefined = await getTile(key);
      if (t) this.stats.fromCache++;
      else {
        const ids = await this.client.area(seed, mc, dim, spec.scale, spec.cx, spec.cz, spec.cells, priority, ac.signal);
        t = { cells: spec.cells, ids };
        putTile(key, t);
        this.stats.generated++;
      }
      if (ac.signal.aborted) throw new AbortedError();
      this.paint(canvas, t);
      done(undefined, canvas);
    })().catch((e) => {
      if (!(e instanceof AbortedError)) {
        console.warn('biome tile failed', e);
        done(e as Error, canvas);
      }
    });
    return canvas;
  }

  private paint(canvas: HTMLCanvasElement, t: CachedTile): void {
    const n = t.cells;
    const s = this.scratch;
    s.width = s.height = n;
    const sctx = s.getContext('2d')!;
    const img = sctx.createImageData(n, n);
    const px = new Uint32Array(img.data.buffer);
    for (let i = 0; i < n * n; i++) px[i] = LUT[t.ids[i]];
    sctx.putImageData(img, 0, 0);
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(s, 0, 0, TILE_PX, TILE_PX);
  }
}
