/// <reference lib="webworker" />
// Biome generation worker. All cubiomes work happens here, off the main thread.

import createCubiomes from '../wasm/cubiomes.js';
import { BiomeGen } from './core';
import type { WorkerRequest, WorkerResponse } from './protocol';

const ready = createCubiomes().then((m) => new BiomeGen(m));

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  const gen = await ready;
  let res: WorkerResponse;
  try {
    switch (req.type) {
      case 'info': {
        const names: string[] = [];
        for (let i = 0; i < 256; i++) names.push(gen.biomeName(i));
        res = { id: req.id, ok: true, newest: gen.newestVersion, names };
        break;
      }
      case 'point': {
        gen.configure(req.seed, req.mc, req.dim);
        res = { id: req.id, ok: true, biome: gen.biomeAt(req.x, req.z, req.y) };
        break;
      }
      case 'area': {
        gen.configure(req.seed, req.mc, req.dim);
        const ids = gen.area(req.scale, req.cx, req.cz, req.cells, req.y);
        (self as unknown as DedicatedWorkerGlobalScope).postMessage(
          { id: req.id, ok: true, ids } satisfies WorkerResponse,
          [ids.buffer],
        );
        return;
      }
    }
  } catch (e) {
    res = { id: req.id, ok: false, error: String(e) };
  }
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(res);
};
