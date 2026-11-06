// App state with IndexedDB persistence. Small and explicit: every mutation
// goes through a method that persists and then notifies listeners.

import * as db from './db';
import {
  DEFAULT_SETTINGS,
  defaultCategories,
  seedMarkers,
  seedMeasure,
  type Category,
  type Marker,
  type Settings,
} from './model';
import { normalizeSeed } from './seed';
import { ICON_NAMES, type IconName } from './icons';
import { DIMENSIONS } from './coords';
import { waCanon, waEmptyDoc, type SyncDoc } from './sync/merge.js';

export type ChangeKind = 'markers' | 'categories' | 'settings';
/** 'local' = a change made on this device; 'sync' = applied from the sync backend. */
export type ChangeSource = 'local' | 'sync';
type Listener = (kind: ChangeKind, source: ChangeSource) => void;

export interface ExportFile {
  format: 'worldatlas';
  version: 1;
  exportedAt: string;
  settings: Pick<Settings, 'seed' | 'mc'> & Partial<Settings>;
  categories: Category[];
  markers: Marker[];
}

type Tombstones = SyncDoc['tombstones'];

const now = () => new Date().toISOString();

/** Strips sync metadata (export files hold content only). */
function withoutStamp<T extends { updatedAt?: string }>(r: T): T {
  const { updatedAt: _u, ...rest } = r;
  return rest as T;
}

export class Store {
  markers: Marker[] = [];
  categories: Category[] = [];
  settings: Settings = { ...DEFAULT_SETTINGS };
  tombstones: Tombstones = { markers: {}, categories: {} };
  private listeners = new Set<Listener>();

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(kind: ChangeKind, source: ChangeSource = 'local'): void {
    for (const fn of this.listeners) fn(kind, source);
  }

  async load(): Promise<void> {
    const initialized = await db.get<boolean>('kv', 'initialized');
    if (!initialized) {
      // First run: seed defaults + test markers + measure line.
      this.categories = defaultCategories();
      this.markers = seedMarkers();
      this.settings = { ...DEFAULT_SETTINGS, measure: seedMeasure() };
      await db.replaceAll({ categories: this.categories, markers: this.markers });
      await db.put('kv', this.settings, 'settings');
      await db.put('kv', this.tombstones, 'tombstones');
      await db.put('kv', true, 'initialized');
      return;
    }
    this.markers = await db.getAll<Marker>('markers');
    this.categories = await db.getAll<Category>('categories');
    const s = await db.get<Partial<Settings>>('kv', 'settings');
    this.settings = { ...DEFAULT_SETTINGS, ...(s ?? {}) };
    this.tombstones = (await db.get<Tombstones>('kv', 'tombstones')) ?? { markers: {}, categories: {} };
    await this.migrateSeedIds();
  }

  /**
   * Early versions gave the first-run Dungeon A/B markers random ids, so every
   * device had its own copies. Give untouched seed markers their fixed ids so
   * sync merges them instead of duplicating them.
   */
  private async migrateSeedIds(): Promise<void> {
    let changed = false;
    for (const seed of seedMarkers()) {
      const old = this.markers.find(
        (m) => m.id !== seed.id && m.name === seed.name && m.x === seed.x && m.y === seed.y && m.z === seed.z && m.dim === seed.dim,
      );
      if (!old || this.markers.some((m) => m.id === seed.id)) continue;
      await db.del('markers', old.id);
      if (this.settings.referenceId === old.id) this.settings.referenceId = seed.id;
      Object.assign(old, { id: seed.id, createdAt: seed.createdAt, updatedAt: old.updatedAt ?? seed.updatedAt });
      await db.put('markers', old);
      changed = true;
    }
    if (changed) await db.put('kv', this.settings, 'settings');
  }

  private async saveTombstones(): Promise<void> {
    await db.put('kv', this.tombstones, 'tombstones');
  }

  // ---- markers --------------------------------------------------------------

  async saveMarker(m: Marker): Promise<void> {
    m = { ...m, updatedAt: now() };
    const i = this.markers.findIndex((x) => x.id === m.id);
    if (i >= 0) this.markers[i] = m;
    else this.markers.push(m);
    await db.put('markers', m);
    this.emit('markers');
  }

  async deleteMarker(id: string): Promise<void> {
    this.markers = this.markers.filter((m) => m.id !== id);
    this.tombstones.markers[id] = now();
    await db.del('markers', id);
    await this.saveTombstones();
    if (this.settings.referenceId === id) await this.updateSettings({ referenceId: null });
    this.emit('markers');
  }

  marker(id: string | null | undefined): Marker | undefined {
    return id ? this.markers.find((m) => m.id === id) : undefined;
  }

  // ---- categories -----------------------------------------------------------

  sortedCategories(): Category[] {
    return [...this.categories].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }

  category(id: string): Category | undefined {
    return this.categories.find((c) => c.id === id);
  }

  async saveCategory(c: Category): Promise<void> {
    c = { ...c, updatedAt: now() };
    const i = this.categories.findIndex((x) => x.id === c.id);
    if (i >= 0) this.categories[i] = c;
    else this.categories.push(c);
    await db.put('categories', c);
    this.emit('categories');
  }

  /** Deletes a category, moving its markers to `moveTo`. */
  async deleteCategory(id: string, moveTo: string): Promise<void> {
    const t = now();
    this.categories = this.categories.filter((c) => c.id !== id);
    this.tombstones.categories[id] = t;
    await db.del('categories', id);
    await this.saveTombstones();
    this.markers = this.markers.map((m) => (m.categoryId === id ? { ...m, categoryId: moveTo, updatedAt: t } : m));
    for (const m of this.markers.filter((m) => m.updatedAt === t)) await db.put('markers', m);
    this.emit('categories');
    this.emit('markers');
  }

  // ---- settings -------------------------------------------------------------

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    const sharedChanged =
      (patch.seed !== undefined && patch.seed !== this.settings.seed) || (patch.mc !== undefined && patch.mc !== this.settings.mc);
    this.settings = { ...this.settings, ...patch, ...(sharedChanged ? { sharedUpdatedAt: now() } : {}) };
    await db.put('kv', this.settings, 'settings');
    this.emit('settings');
  }

  /** Distance reference: chosen marker, else the first Base marker, else null. */
  referenceMarker(): Marker | undefined {
    return (
      this.marker(this.settings.referenceId) ??
      this.markers
        .filter((m) => m.categoryId === 'base')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
    );
  }

  // ---- sync -------------------------------------------------------------------

  /** Everything that syncs across devices. */
  snapshot(): SyncDoc {
    const { seed, mc, sharedUpdatedAt } = this.settings;
    return {
      ...waEmptyDoc(),
      shared: { seed, mc, updatedAt: sharedUpdatedAt },
      markers: structuredClone(this.markers),
      categories: structuredClone(this.categories),
      tombstones: structuredClone(this.tombstones),
    };
  }

  /** Replaces synced state with a merged document, without touching timestamps. */
  async applySnapshot(doc: SyncDoc): Promise<void> {
    const changed = { markers: false, categories: false, settings: false };
    if (waCanon(doc.markers) !== waCanon(this.markers)) changed.markers = true;
    if (waCanon(doc.categories) !== waCanon(this.categories)) changed.categories = true;
    this.markers = structuredClone(doc.markers);
    this.categories = structuredClone(doc.categories);
    this.tombstones = structuredClone(doc.tombstones);
    await db.replaceAll({ markers: this.markers, categories: this.categories });
    await this.saveTombstones();
    const sh = doc.shared;
    const seed = sh && normalizeSeed(sh.seed);
    if (sh && seed && sh.updatedAt > this.settings.sharedUpdatedAt) {
      changed.settings = seed !== this.settings.seed || sh.mc !== this.settings.mc;
      this.settings = { ...this.settings, seed, mc: sh.mc, sharedUpdatedAt: sh.updatedAt };
      await db.put('kv', this.settings, 'settings');
    }
    if (this.settings.referenceId && !this.marker(this.settings.referenceId)) {
      this.settings = { ...this.settings, referenceId: null };
      await db.put('kv', this.settings, 'settings');
      changed.settings = true;
    }
    if (changed.categories) this.emit('categories', 'sync');
    if (changed.markers) this.emit('markers', 'sync');
    if (changed.settings) this.emit('settings', 'sync');
  }

  // ---- backup ---------------------------------------------------------------

  exportData(): ExportFile {
    const { seed, mc, theme, chunkGrid, regionGrid, referenceId, measure } = this.settings;
    return {
      format: 'worldatlas',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: { seed, mc, theme, chunkGrid, regionGrid, referenceId, measure },
      categories: structuredClone(this.sortedCategories().map(withoutStamp)),
      markers: structuredClone(
        [...this.markers].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map(withoutStamp),
      ),
    };
  }

  /**
   * Replaces all markers + categories (and seed/version) with the file's
   * content. Imported records are stamped as new and everything not in the
   * file is tombstoned, so the restore also wins on other synced devices.
   */
  async importData(raw: unknown): Promise<{ markers: number; categories: number }> {
    const file = validateExport(raw);
    const t = now();
    const keepM = new Set(file.markers.map((m) => m.id));
    const keepC = new Set(file.categories.map((c) => c.id));
    for (const m of this.markers) if (!keepM.has(m.id)) this.tombstones.markers[m.id] = t;
    for (const c of this.categories) if (!keepC.has(c.id)) this.tombstones.categories[c.id] = t;
    for (const id of keepM) delete this.tombstones.markers[id];
    for (const id of keepC) delete this.tombstones.categories[id];
    this.categories = file.categories.map((c) => ({ ...c, updatedAt: t }));
    this.markers = file.markers.map((m) => ({ ...m, updatedAt: t }));
    await db.replaceAll({ categories: this.categories, markers: this.markers });
    await this.saveTombstones();
    await this.updateSettings({ ...file.settings });
    this.emit('categories');
    this.emit('markers');
    return { markers: file.markers.length, categories: file.categories.length };
  }

  /** Deletes all markers and categories (used by tests and "wipe"). */
  async wipe(): Promise<void> {
    const t = now();
    for (const m of this.markers) this.tombstones.markers[m.id] = t;
    for (const c of this.categories) this.tombstones.categories[c.id] = t;
    this.markers = [];
    this.categories = [];
    await db.replaceAll({ categories: [], markers: [] });
    await this.saveTombstones();
    this.emit('categories');
    this.emit('markers');
  }
}

function fail(msg: string): never {
  throw new Error(`Invalid WorldAtlas backup: ${msg}`);
}

export function validateExport(raw: unknown): ExportFile {
  const f = raw as ExportFile;
  if (!f || typeof f !== 'object' || f.format !== 'worldatlas') fail('not a WorldAtlas export');
  if (f.version !== 1) fail(`unsupported version ${String(f.version)}`);
  if (!Array.isArray(f.markers) || !Array.isArray(f.categories)) fail('missing markers/categories');
  const seed = normalizeSeed(String(f.settings?.seed ?? ''));
  if (!seed) fail('bad seed');
  const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  f.categories.forEach((c, i) => {
    if (typeof c.id !== 'string' || typeof c.name !== 'string') fail(`category ${i}`);
    if (!ICON_NAMES.includes(c.icon as IconName)) c.icon = 'dot';
  });
  f.markers.forEach((m, i) => {
    if (typeof m.id !== 'string' || typeof m.name !== 'string') fail(`marker ${i}: id/name`);
    if (!isNum(m.x) || !isNum(m.z) || (m.y !== null && !isNum(m.y))) fail(`marker ${i}: coordinates`);
    if (!DIMENSIONS.includes(m.dim)) fail(`marker ${i}: dimension`);
  });
  const settings: Partial<Settings> & { seed: string; mc: number } = { seed, mc: isNum(f.settings.mc) ? f.settings.mc : 0 };
  for (const k of ['theme', 'chunkGrid', 'regionGrid', 'referenceId', 'measure'] as const) {
    if (k in f.settings) (settings as Record<string, unknown>)[k] = f.settings[k];
  }
  return { ...f, settings };
}
