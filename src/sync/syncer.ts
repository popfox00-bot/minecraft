// Cross-device sync through the user's own Google Apps Script web app
// (apps-script/Code.gs). The backend merges under a lock and returns the
// merged document; this side merges that with anything edited meanwhile.

import * as db from '../db';
import type { Store } from '../store';
import { waMerge, waSameDoc, type SyncDoc } from './merge.js';

export interface SyncConfig {
  url: string;
  key: string;
}

export interface SyncStatus {
  state: 'off' | 'syncing' | 'ok' | 'error';
  at?: string;
  error?: string;
}

type Post = (url: string, body: string) => Promise<unknown>;

/** Apps Script needs a "simple" request (text/plain, no custom headers) to avoid a CORS preflight. */
const defaultPost: Post = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    redirect: 'follow',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      /<html/i.test(text)
        ? 'Got a web page instead of JSON. Check the URL ends in /exec and the deployment allows "Anyone".'
        : 'Bad response from sync backend',
    );
  }
};

interface Reply {
  ok: boolean;
  error?: string;
  doc?: SyncDoc;
}

export class Syncer {
  config: SyncConfig | null = null;
  status: SyncStatus = { state: 'off' };
  private running: Promise<void> | null = null;
  private again = false;
  private timer = 0;
  private listeners = new Set<(s: SyncStatus) => void>();

  constructor(
    private store: Store,
    private post: Post = defaultPost,
  ) {}

  onStatus(fn: (s: SyncStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setStatus(s: SyncStatus): void {
    this.status = s;
    for (const fn of this.listeners) fn(s);
  }

  /** Loads saved config and starts syncing (on local edits, on focus, every minute). */
  async start(): Promise<void> {
    this.config = (await db.get<SyncConfig>('kv', 'sync')) ?? null;
    this.store.on((_kind, source) => {
      if (source === 'local') this.schedule();
    });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.schedule(0);
      });
      window.addEventListener('online', () => this.schedule(0));
      setInterval(() => {
        if (document.visibilityState === 'visible') this.schedule(0);
      }, 60_000);
    }
    if (this.config) await this.syncNow().catch(() => {});
  }

  private async call(cfg: SyncConfig, payload: object): Promise<Reply> {
    const r = (await this.post(cfg.url, JSON.stringify({ key: cfg.key, ...payload }))) as Reply;
    if (!r || typeof r !== 'object') throw new Error('Bad response from sync backend');
    if (!r.ok) throw new Error(r.error || 'Sync backend error');
    return r;
  }

  /** Checks the URL + key, saves them, then syncs. */
  async connect(url: string, key: string): Promise<void> {
    url = url.trim();
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) {
      throw new Error('That does not look like an Apps Script web app URL (https://script.google.com/macros/s/…/exec).');
    }
    const cfg = { url, key: key.trim() };
    await this.call(cfg, { action: 'ping' });
    this.config = cfg;
    await db.put('kv', cfg, 'sync');
    await this.syncNow();
  }

  async disconnect(): Promise<void> {
    this.config = null;
    clearTimeout(this.timer);
    await db.del('kv', 'sync');
    this.setStatus({ state: 'off' });
  }

  schedule(delay = 1500): void {
    if (!this.config) return;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.syncNow().catch(() => {}), delay);
  }

  /** One sync round trip (coalesces concurrent calls). */
  syncNow(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        // A second round pushes edits made during the first; cap it so a
        // misbehaving backend can't cause a loop.
        for (let i = 0; i < 3; i++) {
          this.again = false;
          await this.round();
          if (!this.again || !this.config) break;
        }
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async round(): Promise<void> {
    const cfg = this.config;
    if (!cfg) return;
    this.setStatus({ ...this.status, state: 'syncing' });
    try {
      const sent = this.store.snapshot();
      const r = await this.call(cfg, { action: 'sync', doc: sent });
      if (!r.doc) throw new Error('Sync backend returned no data');
      // Fold in anything edited on this device while the request was in flight.
      const merged = waMerge(this.store.snapshot(), r.doc);
      if (!waSameDoc(merged, this.store.snapshot())) await this.store.applySnapshot(merged);
      if (!waSameDoc(merged, r.doc)) this.again = true; // local edits the server hasn't seen yet
      this.setStatus({ state: 'ok', at: new Date().toISOString() });
    } catch (e) {
      this.setStatus({ state: 'error', at: this.status.at, error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }
}
