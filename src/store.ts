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

export type ChangeKind = 'markers' | 'categories' | 'settings';
type Listener = (kind: ChangeKind) => void;

export interface ExportFile {
  format: 'worldatlas';
  version: 1;
  exportedAt: string;
  settings: Pick<Settings, 'seed' | 'mc'> & Partial<Settings>;
  categories: Category[];
  markers: Marker[];
}

export class Store {
  markers: Marker[] = [];
  categories: Category[] = [];
  settings: Settings = { ...DEFAULT_SETTINGS };
  private listeners = new Set<Listener>();

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(kind: ChangeKind): void {
    for (const fn of this.listeners) fn(kind);
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
      await db.put('kv', true, 'initialized');
      return;
    }
    this.markers = await db.getAll<Marker>('markers');
    this.categories = await db.getAll<Category>('categories');
    const s = await db.get<Partial<Settings>>('kv', 'settings');
    this.settings = { ...DEFAULT_SETTINGS, ...(s ?? {}) };
  }

  // ---- markers --------------------------------------------------------------

  async saveMarker(m: Marker): Promise<void> {
    const i = this.markers.findIndex((x) => x.id === m.id);
    if (i >= 0) this.markers[i] = m;
    else this.markers.push(m);
    await db.put('markers', m);
    this.emit('markers');
  }

  async deleteMarker(id: string): Promise<void> {
    this.markers = this.markers.filter((m) => m.id !== id);
    await db.del('markers', id);
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
    const i = this.categories.findIndex((x) => x.id === c.id);
    if (i >= 0) this.categories[i] = c;
    else this.categories.push(c);
    await db.put('categories', c);
    this.emit('categories');
  }

  /** Deletes a category, moving its markers to `moveTo`. */
  async deleteCategory(id: string, moveTo: string): Promise<void> {
    this.categories = this.categories.filter((c) => c.id !== id);
    await db.del('categories', id);
    for (const m of this.markers.filter((m) => m.categoryId === id)) {
      m.categoryId = moveTo;
      await db.put('markers', m);
    }
    this.emit('categories');
    this.emit('markers');
  }

  // ---- settings -------------------------------------------------------------

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    this.settings = { ...this.settings, ...patch };
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

  // ---- backup ---------------------------------------------------------------

  exportData(): ExportFile {
    const { seed, mc, theme, chunkGrid, regionGrid, referenceId, measure } = this.settings;
    return {
      format: 'worldatlas',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: { seed, mc, theme, chunkGrid, regionGrid, referenceId, measure },
      categories: structuredClone(this.sortedCategories()),
      markers: structuredClone([...this.markers].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))),
    };
  }

  /** Replaces all markers + categories (and seed/version) with the file's content. */
  async importData(raw: unknown): Promise<{ markers: number; categories: number }> {
    const file = validateExport(raw);
    this.categories = file.categories;
    this.markers = file.markers;
    await db.replaceAll({ categories: this.categories, markers: this.markers });
    await this.updateSettings({ ...file.settings });
    this.emit('categories');
    this.emit('markers');
    return { markers: file.markers.length, categories: file.categories.length };
  }

  /** Deletes all markers and categories (used by tests and "wipe"). */
  async wipe(): Promise<void> {
    this.markers = [];
    this.categories = [];
    await db.replaceAll({ categories: [], markers: [] });
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
    if (m.dim !== 'overworld' && m.dim !== 'nether') fail(`marker ${i}: dimension`);
  });
  const settings: Partial<Settings> & { seed: string; mc: number } = { seed, mc: isNum(f.settings.mc) ? f.settings.mc : 0 };
  for (const k of ['theme', 'chunkGrid', 'regionGrid', 'referenceId', 'measure'] as const) {
    if (k in f.settings) (settings as Record<string, unknown>)[k] = f.settings[k];
  }
  return { ...f, settings };
}
