import type { Dimension } from '../coords';

interface Base {
  id: number;
  seed: string;
  mc: number;
  dim: Dimension;
}

export type WorkerRequest =
  | { type: 'info'; id: number }
  | (Base & { type: 'point'; x: number; z: number; y?: number })
  | (Base & { type: 'area'; scale: number; cx: number; cz: number; cells: number; y?: number });

export type WorkerResponse =
  | { id: number; ok: false; error: string }
  | { id: number; ok: true; newest: number; names: string[] }
  | { id: number; ok: true; biome: number }
  | { id: number; ok: true; ids: Uint8Array };
