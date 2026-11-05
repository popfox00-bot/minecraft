// Faint chunk (16) and region (512) grid lines, drawn per tile.
// Lines only appear once they're far enough apart on screen to be useful.

import L from 'leaflet';
import { tileBlocks, TILE_PX } from '../coords';

export const CHUNK_MIN_ZOOM = 1; // 16 blocks = 32px
export const REGION_MIN_ZOOM = -3; // 512 blocks = 64px

export class GridLayer extends L.GridLayer {
  chunk = true;
  region = true;

  constructor(opts?: L.GridLayerOptions) {
    super({ tileSize: TILE_PX, pane: 'overlayPane', updateWhenZooming: false, ...opts });
  }

  setVisible(chunk: boolean, region: boolean): void {
    this.chunk = chunk;
    this.region = region;
    this.redraw();
  }

  protected createTile(coords: L.Coords): HTMLElement {
    const canvas = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = canvas.height = TILE_PX * dpr;
    canvas.style.width = canvas.style.height = `${TILE_PX}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const z = coords.z;
    const blocks = tileBlocks(z);
    const bx0 = coords.x * blocks;
    const bz0 = coords.y * blocks;
    const pxPerBlock = TILE_PX / blocks;
    const css = getComputedStyle(document.documentElement);

    const draw = (step: number, color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let b = Math.ceil(bx0 / step) * step; b < bx0 + blocks; b += step) {
        const p = Math.round((b - bx0) * pxPerBlock) + 0.5 / dpr;
        ctx.moveTo(p, 0);
        ctx.lineTo(p, TILE_PX);
      }
      for (let b = Math.ceil(bz0 / step) * step; b < bz0 + blocks; b += step) {
        const p = Math.round((b - bz0) * pxPerBlock) + 0.5 / dpr;
        ctx.moveTo(0, p);
        ctx.lineTo(TILE_PX, p);
      }
      ctx.stroke();
    };

    if (this.chunk && z >= CHUNK_MIN_ZOOM) draw(16, css.getPropertyValue('--grid-chunk').trim(), 1 / dpr);
    if (this.region && z >= REGION_MIN_ZOOM) draw(512, css.getPropertyValue('--grid-region').trim(), 1);
    return canvas;
  }
}
