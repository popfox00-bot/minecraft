// WorldAtlas sync merge.
//
// This file is used by the web app AND pasted verbatim into the Apps Script
// backend (apps-script/Code.gs is generated from it by scripts/build-gs.mjs),
// so it must stay plain JavaScript that Apps Script's V8 runtime can run:
// no imports, no TypeScript, no DOM. `export ` is stripped for Code.gs.
//
// Model: a document holds markers, categories and tombstones (id -> deletion
// time). Each record carries `updatedAt` (ISO time). Merging two documents
// keeps, per id, the record with the newer `updatedAt`, and drops records that
// a tombstone at least as new has deleted. The merge is commutative,
// associative and idempotent, so devices converge no matter the sync order.

export const WA_SYNC_FORMAT = 'worldatlas-sync';

export function waEmptyDoc() {
  return {
    format: WA_SYNC_FORMAT,
    version: 1,
    shared: null,
    markers: [],
    categories: [],
    tombstones: { markers: {}, categories: {} },
  };
}

/** JSON with sorted object keys, for stable comparisons. */
export function waCanon(v) {
  if (Array.isArray(v)) return '[' + v.map(waCanon).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + waCanon(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

function waStamp(r) {
  return (r && (r.updatedAt || r.createdAt)) || '';
}

function waPickNewer(a, b) {
  if (!a) return b;
  if (!b) return a;
  const ta = waStamp(a);
  const tb = waStamp(b);
  if (ta !== tb) return ta > tb ? a : b;
  // same timestamp: deterministic choice so every device picks the same one
  return waCanon(a) >= waCanon(b) ? a : b;
}

function waMergeTombs(ta, tb) {
  const out = {};
  [ta || {}, tb || {}].forEach((t) => {
    Object.keys(t).forEach((id) => {
      if (!out[id] || t[id] > out[id]) out[id] = t[id];
    });
  });
  return out;
}

function waMergeList(la, lb, tomb) {
  const byId = {};
  (la || []).concat(lb || []).forEach((r) => {
    if (r && typeof r.id === 'string') byId[r.id] = waPickNewer(byId[r.id], r);
  });
  return Object.keys(byId).sort()
    .map((id) => byId[id])
    .filter((r) => !(tomb[r.id] && tomb[r.id] >= waStamp(r)));
}

export function waMerge(a, b) {
  a = a || waEmptyDoc();
  b = b || waEmptyDoc();
  const ta = a.tombstones || {};
  const tb = b.tombstones || {};
  const tm = waMergeTombs(ta.markers, tb.markers);
  const tc = waMergeTombs(ta.categories, tb.categories);
  let shared = a.shared || b.shared || null;
  if (a.shared && b.shared) {
    const sa = a.shared.updatedAt || '';
    const sb = b.shared.updatedAt || '';
    shared = sa !== sb ? (sa > sb ? a.shared : b.shared) : waCanon(a.shared) >= waCanon(b.shared) ? a.shared : b.shared;
  }
  return {
    format: WA_SYNC_FORMAT,
    version: 1,
    shared: shared,
    markers: waMergeList(a.markers, b.markers, tm),
    categories: waMergeList(a.categories, b.categories, tc),
    tombstones: { markers: tm, categories: tc },
  };
}

export function waSameDoc(a, b) {
  return waCanon(a) === waCanon(b);
}
