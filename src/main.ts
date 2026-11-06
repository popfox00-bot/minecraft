import 'leaflet/dist/leaflet.css';
import './styles.css';

import { BiomeClient } from './gen/client';
import { Store } from './store';
import { Syncer } from './sync/syncer';
import { MapView, formatMeasure } from './map/mapView';
import { clearTileCache } from './map/tileCache';
import { h } from './dom';
import { chunkOf, parseCoords, toOtherDimension, DIMENSIONS, DIM_LABEL, type Dimension } from './coords';
import { prettyBiome, BIOMES_BY_DIM } from './biomes';
import type { Marker } from './model';
import {
  blankMarker,
  catDot,
  categoriesPanel,
  listPanel,
  markerForm,
  settingsPanel,
  toolsPanel,
  syncStatusText,
  biomeSearchPanel,
  matchBiome,
  type BiomeSearchHost,
  type PanelHost,
} from './ui/panels';

const ICON = {
  list: '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 4h11M2.5 8h11M2.5 12h11"/></svg>',
  ruler: '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 11 11 2l3 3-9 9zM5 8l1.5 1.5M7 6l1.5 1.5M9 4l1.5 1.5"/></svg>',
  plus: '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>',
  gear: '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6 5 5M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4"/></svg>',
  swap: '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 5h10l-2.5-2.5M13 11H3l2.5 2.5"/></svg>',
  find: '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3M5.5 6.5l1.5-1.5 1.5 1.5"/></svg>',
  close: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
};

async function main() {
  const store = new Store();
  await store.load();
  const client = new BiomeClient();
  const syncer = new Syncer(store);
  await client.ready;
  const mcResolved = () => store.settings.mc || client.newest;

  // ---- theme ----
  const media = matchMedia('(prefers-color-scheme: dark)');
  const applyTheme = () => {
    const t = store.settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : store.settings.theme;
    document.documentElement.dataset.theme = t;
  };
  applyTheme();
  media.addEventListener('change', () => { applyTheme(); view.refreshGrid(); });

  // ---- layout ----
  const app = document.getElementById('app')!;
  const mapEl = h('div', { id: 'map' });
  const dimTabs = h('div', { class: 'tabs', role: 'tablist' });
  const goto = h('input', { type: 'search', placeholder: 'Go to X, Z, marker or biome', enterKeyHint: 'go', 'aria-label': 'Go to coordinates, marker or biome', list: 'goto-suggest' });
  const suggest = h('datalist', { id: 'goto-suggest' });
  const gotoForm = h('form', { class: 'goto', onsubmit: (e: Event) => { e.preventDefault(); doGoto(goto.value); goto.blur(); } }, goto, suggest);
  const iconBtn = (label: string, svg: string, onclick: () => void, id?: string) =>
    h('button', { class: 'icon', title: label, 'aria-label': label, html: svg, onclick, id });
  const measureBtn = iconBtn('Measure', ICON.ruler, () => toggleMeasure());
  const topbar = h('header', { class: 'topbar' },
    iconBtn('Markers', ICON.list, () => openList()),
    dimTabs,
    gotoForm,
    h('div', { class: 'top-actions' },
      iconBtn('Find biome near me', ICON.find, () => openBiomeSearch()),
      iconBtn('Add marker at map centre', ICON.plus, () => addAt(view.centerBlock())),
      measureBtn,
      iconBtn('Converter & measure', ICON.swap, () => openTools()),
      iconBtn('Settings', ICON.gear, () => openSettings())),
  );
  const readout = h('div', { class: 'readout', 'aria-live': 'polite' });
  const legend = h('div', { class: 'legend' });
  const sheetTitle = h('h2', {});
  const sheetBody = h('div', { class: 'sheet-body' });
  const sheet = h('aside', { class: 'sheet', 'aria-hidden': 'true' },
    h('div', { class: 'sheet-head' }, sheetTitle,
      h('button', { class: 'icon', 'aria-label': 'Close', html: ICON.close, onclick: () => closeSheet() })),
    sheetBody);
  const toastEl = h('div', { class: 'toast', role: 'status' });
  const banner = h('div', { class: 'banner' });
  app.append(mapEl, topbar, readout, legend, sheet, toastEl, banner);

  let toastTimer = 0;
  const toast = (msg: string) => {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 2200);
  };

  // ---- map ----
  let pinned: { x: number; z: number } | null = null;
  let cursor: { x: number; z: number } | null = null;
  const view = new MapView(mapEl, store, client, mcResolved, {
    onPick: (p) => { pinned = p; view.showPick(p); view.select(null); updateReadout(); },
    onMarker: (m) => { pinned = null; view.showPick(null); view.select(m.id); openMarker(m, false); },
    onMeasure: async (m) => { await store.updateSettings({ measure: m }); toggleMeasure(false); openTools(); },
    onCursor: (p) => { cursor = p; updateReadout(); },
  });

  // initial view
  const sv = store.settings.view;
  const ref = store.referenceMarker() ?? store.markers[0];
  if (sv) view.goTo(sv.x, sv.z, sv.zoom, false);
  else if (ref) view.goTo(ref.x, ref.z, 2, false);
  else view.goTo(0, 0, -2, false);
  let viewTimer = 0;
  view.map.on('moveend', () => {
    clearTimeout(viewTimer);
    viewTimer = window.setTimeout(() => {
      const c = view.centerBlock();
      store.updateSettings({ view: { x: c.x, z: c.z, zoom: view.map.getZoom() } });
    }, 400);
    if (!cursor) updateReadout();
  });

  // ---- readout (coords + biome) ----
  let biomeSeq = 0;
  let biomeTimer = 0;
  const biomeSpan = h('span', { class: 'ro-biome' });
  const roInfo = h('div', {});
  const roPin = h('div', { class: 'ro-actions' });
  readout.append(roInfo, roPin);
  let pinKey = '';
  function updateReadout() {
    const p = cursor ?? pinned ?? view.centerBlock();
    const what = cursor ? '' : pinned ? 'Tapped' : 'Centre';
    const ch = chunkOf(p.x, p.z);
    const other = toOtherDimension(store.settings.dim, p.x, p.z);
    roInfo.innerHTML = '';
    roInfo.append(
      h('div', { class: 'ro-main' },
        what && h('span', { class: 'ro-what' }, what),
        h('strong', {}, `${p.x}, ${p.z}`),
        biomeSpan),
      h('div', { class: 'ro-sub' }, `Chunk ${ch.x}, ${ch.z}${other ? ` · ${DIM_LABEL[other.dim]} ${other.x}, ${other.z}` : ''}`),
    );
    // The pinned-point actions only re-render when the pin changes, so the
    // buttons stay stable while the mouse moves over the map.
    const key = pinned ? `${pinned.x},${pinned.z}` : '';
    if (key !== pinKey) {
      pinKey = key;
      roPin.innerHTML = '';
      roPin.hidden = !pinned;
      if (pinned) roPin.append(
        h('button', { class: 'primary small', onclick: () => addAt(pinned!) }, `+ Add marker at ${pinned.x}, ${pinned.z}`),
        h('button', { class: 'small', onclick: () => { pinned = null; view.showPick(null); updateReadout(); } }, 'Clear'));
    }
    clearTimeout(biomeTimer);
    const seq = ++biomeSeq;
    biomeTimer = window.setTimeout(async () => {
      const { seed, dim } = store.settings;
      const id = await client.biomeAt(seed, mcResolved(), dim, p.x, p.z, dim === 'nether' ? 64 : undefined);
      if (seq === biomeSeq) biomeSpan.textContent = ` · ${prettyBiome(client.names[id] ?? '')}`;
    }, 80);
  }

  // ---- dimension tabs ----
  function renderTabs() {
    dimTabs.innerHTML = '';
    for (const d of DIMENSIONS) {
      dimTabs.append(h('button', {
        role: 'tab', class: 'tab' + (store.settings.dim === d ? ' on' : ''), 'aria-selected': String(store.settings.dim === d),
        onclick: () => switchDim(d),
      }, DIM_LABEL[d]));
    }
    document.documentElement.dataset.dim = store.settings.dim;
  }
  async function switchDim(d: Dimension, keepPos = false) {
    if (store.settings.dim === d) return;
    const c = view.centerBlock();
    const linked = toOtherDimension(store.settings.dim, c.x, c.z);
    // Overworld <-> Nether keeps the 1:8 position; the End has no link, so open it at the main island.
    const o = keepPos ? c : linked && linked.dim === d ? linked : d === 'end' ? { x: 0, z: 0 } : linked ?? c;
    pinned = null;
    view.showPick(null);
    await store.updateSettings({ dim: d });
    view.goTo(o.x, o.z, view.map.getZoom(), false);
    updateReadout();
  }

  // ---- legend ----
  let legendOpen = false;
  function renderLegend() {
    legend.innerHTML = '';
    legend.classList.toggle('open', legendOpen);
    const head = h('button', { class: 'legend-head', 'aria-expanded': String(legendOpen), onclick: () => { legendOpen = !legendOpen; renderLegend(); } },
      h('span', { class: 'legend-dots' }, store.sortedCategories().slice(0, 6).map((c) => h('i', { style: `background:${c.color};opacity:${c.visible ? 1 : 0.25}` }))),
      'Legend');
    legend.append(head);
    if (legendOpen) {
      const list = h('ul', {});
      for (const c of store.sortedCategories()) {
        const n = store.markers.filter((m) => m.categoryId === c.id && m.dim === store.settings.dim).length;
        list.append(h('li', {},
          h('button', { class: 'legend-item' + (c.visible ? '' : ' off'), 'aria-pressed': String(c.visible),
            onclick: () => store.saveCategory({ ...c, visible: !c.visible }) },
            catDot(c.color, c.icon, 20), h('span', {}, c.name), h('span', { class: 'count' }, String(n)))));
      }
      legend.append(list);
    }
    legend.append(h('div', { class: 'legend-foot' }, store.settings.dim === 'end' ? 'Biomes: Java-parity generator (Java End zones)' : 'Biomes: Java-parity generator'));
    if (syncer.status.state !== 'off') legend.append(h('div', { class: 'legend-foot sync-' + syncer.status.state }, syncStatusText(syncer.status)));
  }

  // ---- sheet ----
  function openSheet(title: string, body: HTMLElement) {
    sheetTitle.textContent = title;
    sheetBody.innerHTML = '';
    sheetBody.append(body);
    sheet.classList.add('open');
    app.classList.add('sheet-open');
    sheet.setAttribute('aria-hidden', 'false');
    current = title;
  }
  let current = '';
  function closeSheet() {
    sheet.classList.remove('open');
    app.classList.remove('sheet-open');
    sheet.setAttribute('aria-hidden', 'true');
    current = '';
    if (view.selectedId) view.select(null);
  }
  const host: PanelHost = {
    store,
    close: closeSheet,
    open: openSheet,
    flyToMarker,
    center: () => view.centerBlock(),
    clearTileCache: async () => { await clearTileCache(); view.biome.redraw(); },
    toast,
    startMeasure: () => { closeSheet(); toggleMeasure(true); },
  };
  const openList = () => openSheet('Markers', listPanel(host));
  const openSettings = () => openSheet('Settings', settingsPanel(host, () => openSheet('Categories', categoriesPanel(host)), syncer));
  const openTools = () => openSheet('Tools', toolsPanel(host));
  const biomeHost: BiomeSearchHost = {
    biomeNames: client.names,
    origins: () => {
      const c = view.centerBlock();
      const out = [{ key: 'centre', label: `Map centre (${c.x}, ${c.z})`, x: c.x, z: c.z }];
      if (pinned) out.push({ key: 'pinned', label: `Tapped point (${pinned.x}, ${pinned.z})`, x: pinned.x, z: pinned.z });
      const ref = store.referenceMarker();
      if (ref && ref.dim === store.settings.dim) out.push({ key: 'ref', label: `${ref.name} (${ref.x}, ${ref.z})`, x: ref.x, z: ref.z });
      return out;
    },
    run: (biome, y, o) =>
      client.search(store.settings.seed, mcResolved(), store.settings.dim, {
        biome, x: o.x, z: o.z, y, k: 8, maxRadius: store.settings.dim === 'overworld' ? 12000 : 6000,
        separation: store.settings.dim === 'nether' ? 128 : 512,
      }),
    show: (hits, color) => view.showSearchHits(hits, color, (i) => { const hit = hits[i]; pinned = { x: hit.x, z: hit.z }; view.showPick(pinned); updateReadout(); }),
    clear: () => view.clearSearchHits(),
    flyTo: (x, z) => {
      pinned = { x, z };
      view.showPick(pinned);
      view.goTo(x, z, Math.max(view.map.getZoom(), 0));
      updateReadout();
      if (matchMedia('(max-width: 759px)').matches) closeSheet();
    },
    fit: (pts) => {
      // keep the pins clear of the top bar and the open panel
      const phone = matchMedia('(max-width: 759px)').matches;
      view.fitPoints(pts, [0, topbar.offsetHeight], phone ? [0, sheet.offsetHeight] : [sheet.offsetWidth, 0]);
    },
    addMarkerAt: (x, z) => addAt({ x, z }),
  };
  const openBiomeSearch = (preset?: { biome: number; autorun: boolean }) =>
    openSheet('Find biome', biomeSearchPanel(host, biomeHost, preset));
  function renderSuggestions() {
    suggest.innerHTML = '';
    for (const m of store.markers.filter((m) => m.dim === store.settings.dim)) suggest.append(h('option', { value: m.name }));
    for (const id of BIOMES_BY_DIM[store.settings.dim]) suggest.append(h('option', { value: prettyBiome(client.names[id]) }));
  }
  const openMarker = (m: Marker, isNew: boolean) => openSheet(isNew ? 'New marker' : m.name, markerForm(host, m, isNew));
  function addAt(p: { x: number; z: number }) {
    openMarker(blankMarker(host, p.x, p.z, store.settings.dim), true);
  }

  async function flyToMarker(m: Marker) {
    if (m.dim !== store.settings.dim) await switchDim(m.dim, true);
    view.goTo(m.x, m.z, Math.max(view.map.getZoom(), 2));
    view.select(m.id);
    if (matchMedia('(max-width: 759px)').matches) closeSheet();
  }

  // ---- measure ----
  function toggleMeasure(on = !view.measuring) {
    view.setMeasuring(on);
    measureBtn.classList.toggle('on', on);
    banner.classList.toggle('show', on);
    banner.innerHTML = '';
    if (on) banner.append('Measure: tap two points (tap a marker to use its Y). ',
      h('button', { class: 'small', onclick: () => toggleMeasure(false) }, 'Cancel'));
  }

  // ---- go to ----
  function doGoto(q: string) {
    const p = parseCoords(q);
    if (p) {
      pinned = { x: Math.floor(p.x), z: Math.floor(p.z) };
      view.showPick(pinned);
      view.goTo(pinned.x, pinned.z);
      updateReadout();
      return;
    }
    const needle = q.trim().toLowerCase();
    const m = needle && store.markers.find((m) => m.name.toLowerCase() === needle) || store.markers.find((m) => needle && m.name.toLowerCase().includes(needle));
    if (m) return void flyToMarker(m);
    const b = matchBiome(client.names, store.settings.dim, q);
    if (b != null) return void openBiomeSearch({ biome: b, autorun: true });
    toast('Type coordinates like “1180, -2808”, a marker or a biome name');
  }

  // ---- store wiring ----
  let lastSrc = '';
  store.on((kind) => {
    if (kind === 'settings') {
      const s = store.settings;
      applyTheme();
      const src = `${s.seed}|${mcResolved()}|${s.dim}`;
      if (src !== lastSrc) { lastSrc = src; view.refreshSource(); view.renderMarkers(); renderTabs(); renderLegend(); renderSuggestions(); view.clearSearchHits(); updateReadout(); }
      view.refreshGrid();
      view.renderMeasure();
    } else {
      view.renderMarkers();
      renderLegend();
      renderSuggestions();
      if (current === 'Markers') openList();
    }
  });
  lastSrc = `${store.settings.seed}|${mcResolved()}|${store.settings.dim}`;

  renderTabs();
  renderLegend();
  renderSuggestions();
  view.renderMarkers();
  view.renderMeasure();
  updateReadout();

  // ---- debug API ----
  const getBiome = async (x: number, z: number, opts: { y?: number; dim?: Dimension } = {}) => {
    const dim = opts.dim ?? store.settings.dim;
    const y = opts.y ?? (dim === 'nether' ? 64 : undefined);
    const id = await client.biomeAt(store.settings.seed, mcResolved(), dim, x, z, y);
    return { id, name: client.names[id] ?? null, x, z, y: y ?? 'surface(256)', dim };
  };
  Object.assign(window, { getBiome, worldatlas: { store, view, client, formatMeasure } });
  const checks = await Promise.all([
    getBiome(0, 0, { dim: 'overworld' }),
    getBiome(1180, -2808, { dim: 'overworld' }),
    getBiome(1180, -2808, { dim: 'overworld', y: -5 }),
    getBiome(1204, -2807, { dim: 'overworld' }),
    getBiome(1204, -2807, { dim: 'overworld', y: -1 }),
  ]);
  console.info('[WorldAtlas] biome spot checks (Java-parity generator):');
  for (const c of checks) console.info(`  ${c.x}, ${c.z} @ y=${c.y}: ${c.name}`);
  let lastSyncErr = '';
  syncer.onStatus((s) => {
    renderLegend();
    if (s.state === 'error' && s.error !== lastSyncErr) toast(`Sync failed: ${s.error}`);
    lastSyncErr = s.state === 'error' ? s.error ?? '' : '';
  });
  await syncer.start();
  Object.assign(window, { worldatlas: { store, view, client, formatMeasure, syncer } });
  document.documentElement.dataset.ready = '1';
}

main().catch((e) => {
  console.error(e);
  document.body.append(h('pre', { class: 'fatal' }, String(e?.stack ?? e)));
});
