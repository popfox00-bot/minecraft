// Main-thread side of the biome worker pool. Jobs are queued here and handed
// to idle workers one at a time, so queued jobs for tiles that scrolled out of
// view can be cancelled before they cost anything.

import type { Dimension } from '../coords';
import type { WorkerRequest, WorkerResponse } from './protocol';
import type { SearchOptions, SearchResult } from './search';

type Req = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

interface Job {
  req: Req;
  resolve: (r: WorkerResponse) => void;
  reject: (e: unknown) => void;
  priority: number;
  cancelled: boolean;
}

interface Slot {
  worker: Worker;
  busy: boolean;
}

export class AbortedError extends Error {
  constructor() {
    super('aborted');
  }
}

export class BiomeClient {
  private slots: Slot[] = [];
  private queue: Job[] = [];
  private pending = new Map<number, Job>();
  private nextId = 1;
  names: string[] = [];
  newest = 0;
  readonly ready: Promise<void>;

  constructor(size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1))) {
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL('./biome.worker.ts', import.meta.url), { type: 'module' });
      const slot: Slot = { worker, busy: false };
      worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        slot.busy = false;
        const job = this.pending.get(ev.data.id);
        this.pending.delete(ev.data.id);
        if (job) {
          if (ev.data.ok) job.resolve(ev.data);
          else job.reject(new Error(ev.data.error));
        }
        this.pump();
      };
      worker.onerror = (e) => console.error('biome worker error', e);
      this.slots.push(slot);
    }
    this.ready = this.run({ type: 'info' }, 1e9).then((r) => {
      if ('names' in r) {
        this.names = r.names;
        this.newest = r.newest;
      }
    });
  }

  private run(req: Req, priority = 0, signal?: AbortSignal): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      const job: Job = { req, resolve, reject, priority, cancelled: false };
      if (signal) {
        if (signal.aborted) return reject(new AbortedError());
        signal.addEventListener('abort', () => {
          if (!job.cancelled) {
            job.cancelled = true;
            reject(new AbortedError());
          }
        });
      }
      this.queue.push(job);
      this.pump();
    });
  }

  private pump(): void {
    this.queue = this.queue.filter((j) => !j.cancelled);
    for (const slot of this.slots) {
      if (slot.busy) continue;
      if (!this.queue.length) return;
      // highest priority first, FIFO within equal priority
      let best = 0;
      for (let i = 1; i < this.queue.length; i++) {
        if (this.queue[i].priority > this.queue[best].priority) best = i;
      }
      const job = this.queue.splice(best, 1)[0];
      const id = this.nextId++;
      this.pending.set(id, job);
      slot.busy = true;
      slot.worker.postMessage({ ...job.req, id } as WorkerRequest);
    }
  }

  async biomeAt(seed: string, mc: number, dim: Dimension, x: number, z: number, y?: number): Promise<number> {
    const r = await this.run({ type: 'point', seed, mc, dim, x, z, y }, 100);
    return 'biome' in r ? r.biome : -1;
  }

  async area(
    seed: string,
    mc: number,
    dim: Dimension,
    scale: number,
    cx: number,
    cz: number,
    cells: number,
    priority = 0,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const r = await this.run({ type: 'area', seed, mc, dim, scale, cx, cz, cells }, priority, signal);
    if (!('ids' in r)) throw new Error('bad response');
    return r.ids;
  }

  async search(seed: string, mc: number, dim: Dimension, opts: SearchOptions): Promise<SearchResult> {
    const r = await this.run({ type: 'search', seed, mc, dim, opts }, 50);
    if (!('search' in r)) throw new Error('bad response');
    return r.search;
  }

  get queued(): number {
    return this.queue.filter((j) => !j.cancelled).length;
  }
}
