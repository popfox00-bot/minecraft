import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { waMerge, waSameDoc, waEmptyDoc, type SyncDoc } from '../src/sync/merge.js';
// @ts-expect-error plain JS helper
import { loadAppsScript } from '../scripts/fake-apps-script.mjs';
// @ts-expect-error plain JS helper
import { buildGs } from '../scripts/build-gs.mjs';
import { Store } from '../src/store';
import { Syncer } from '../src/sync/syncer';
import { _resetDbForTests } from '../src/db';

const mk = (id: string, updatedAt: string, name = id) =>
  ({ id, name, categoryId: 'base', x: 0, y: null, z: 0, dim: 'overworld', notes: '', status: 'planned', createdAt: updatedAt, showLinked: false, updatedAt }) as SyncDoc['markers'][number];
const doc = (markers: SyncDoc['markers'], tomb: Record<string, string> = {}): SyncDoc => ({ ...waEmptyDoc(), markers, tombstones: { markers: tomb, categories: {} } });

describe('merge', () => {
  const a = doc([mk('1', '2026-01-01T00:00:00Z', 'old'), mk('2', '2026-01-02T00:00:00Z')], { '3': '2026-01-05T00:00:00Z' });
  const b = doc([mk('1', '2026-01-03T00:00:00Z', 'new'), mk('3', '2026-01-04T00:00:00Z')]);
  const c = doc([mk('4', '2026-01-01T00:00:00Z')], { '2': '2026-01-06T00:00:00Z' });

  it('keeps the newest version and honours tombstones', () => {
    const m = waMerge(a, b);
    expect(m.markers.map((x) => [x.id, x.name])).toEqual([['1', 'new'], ['2', '2']]);
  });
  it('is commutative, associative and idempotent', () => {
    expect(waSameDoc(waMerge(a, b), waMerge(b, a))).toBe(true);
    expect(waSameDoc(waMerge(waMerge(a, b), c), waMerge(a, waMerge(b, c)))).toBe(true);
    const m = waMerge(a, b);
    expect(waSameDoc(waMerge(m, m), m)).toBe(true);
  });
  it('an edit newer than a deletion survives (re-created record)', () => {
    const m = waMerge(doc([], { '1': '2026-01-01T00:00:00Z' }), doc([mk('1', '2026-02-01T00:00:00Z')]));
    expect(m.markers).toHaveLength(1);
  });
});

describe('Code.gs', () => {
  it('is up to date with src/sync/merge.js', () => {
    expect(fs.readFileSync('apps-script/Code.gs', 'utf8')).toBe(buildGs());
  });
  it('rejects a wrong key and an unset key', () => {
    const gs = loadAppsScript({ key: 'secret' });
    expect(gs.post(JSON.stringify({ key: 'nope', action: 'ping' }))).toEqual({ ok: false, error: 'Wrong sync key' });
    const unset = loadAppsScript({ key: 'CHANGE-ME-to-a-long-random-string' });
    expect(unset.post(JSON.stringify({ key: 'x', action: 'ping' })).ok).toBe(false);
  });
  it('merges and stores', () => {
    const gs = loadAppsScript({ key: 'k' });
    expect(gs.post(JSON.stringify({ key: 'k', action: 'ping' }))).toEqual({ ok: true, api: 1 });
    gs.post(JSON.stringify({ key: 'k', action: 'sync', doc: doc([mk('a', '2026-01-01T00:00:00Z')]) }));
    const r = gs.post(JSON.stringify({ key: 'k', action: 'sync', doc: doc([mk('b', '2026-01-01T00:00:00Z')]) }));
    expect(r.doc.markers.map((m: { id: string }) => m.id)).toEqual(['a', 'b']);
    expect(gs.stored().markers).toHaveLength(2);
    expect(gs.get({ key: 'k', action: 'pull' }).doc.markers).toHaveLength(2);
  });
});

describe('two devices through the backend', () => {
  beforeEach(() => _resetDbForTests());

  async function device(gs: ReturnType<typeof loadAppsScript>) {
    globalThis.indexedDB = new IDBFactory(); // each device has its own browser storage
    _resetDbForTests();
    const store = new Store();
    await store.load();
    const syncer = new Syncer(store, async (_url, body) => gs.post(body));
    return { store, syncer };
  }

  it('adds, edits and deletes propagate; seed markers are not duplicated', async () => {
    const gs = loadAppsScript({ key: 'k' });
    const url = 'https://script.google.com/macros/s/X/exec';
    const A = await device(gs);
    await A.syncer.connect(url, 'k');
    const B = await device(gs);
    await B.syncer.connect(url, 'k');
    expect(B.store.markers.map((m) => m.name).sort()).toEqual(['Dungeon A', 'Dungeon B']);

    await A.store.saveMarker({ ...mk('home', ''), name: 'Home', categoryId: 'base' });
    await A.syncer.syncNow();
    await B.syncer.syncNow();
    expect(B.store.marker('home')?.name).toBe('Home');

    await B.store.deleteMarker('seed-dungeon-b');
    await B.store.saveMarker({ ...B.store.marker('home')!, notes: 'edited on B' });
    await B.syncer.syncNow();
    await A.syncer.syncNow();
    expect(A.store.marker('seed-dungeon-b')).toBeUndefined();
    expect(A.store.marker('home')?.notes).toBe('edited on B');
    expect(waSameDoc(A.store.snapshot(), B.store.snapshot())).toBe(true);
  });

  it('reports a wrong key without saving the config', async () => {
    const gs = loadAppsScript({ key: 'right' });
    const A = await device(gs);
    await expect(A.syncer.connect('https://script.google.com/macros/s/X/exec', 'wrong')).rejects.toThrow('Wrong sync key');
    expect(A.syncer.config).toBeNull();
  });
});
