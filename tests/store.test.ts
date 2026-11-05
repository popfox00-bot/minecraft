import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { Store, validateExport } from '../src/store';
import { _resetDbForTests } from '../src/db';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetDbForTests();
});

describe('store', () => {
  it('seeds first-run data and persists across reloads', async () => {
    const s = new Store();
    await s.load();
    expect(s.markers.map((m) => m.name).sort()).toEqual(['Dungeon A', 'Dungeon B']);
    expect(s.categories).toHaveLength(11);
    expect(s.settings.measure).not.toBeNull();
    _resetDbForTests();
    const again = new Store();
    await again.load();
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
    expect([...again.markers].sort(byId)).toEqual([...s.markers].sort(byId));
  });

  it('export -> wipe -> import restores exactly', async () => {
    const s = new Store();
    await s.load();
    await s.saveMarker({ ...s.markers[0], id: 'x1', name: 'Nether hub', dim: 'nether', x: -3, y: 70, z: 9, notes: 'ünïcødé ✓', status: 'built', showLinked: true });
    await s.saveCategory({ ...s.categories[0], id: 'custom', name: 'Custom', color: '#123456', icon: 'ship', visible: false, order: 99 });
    const before = s.exportData();
    const json = JSON.stringify(before);
    await s.wipe();
    expect(s.markers).toHaveLength(0);
    await s.importData(JSON.parse(json));
    _resetDbForTests();
    const reloaded = new Store();
    await reloaded.load();
    const after = reloaded.exportData();
    expect({ ...after, exportedAt: '' }).toEqual({ ...before, exportedAt: '' });
  });

  it('rejects bad files', () => {
    expect(() => validateExport({})).toThrow();
    expect(() => validateExport({ format: 'worldatlas', version: 1, settings: { seed: 'x' }, markers: [], categories: [] })).toThrow(/seed/);
  });
});
