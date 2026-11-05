import 'leaflet/dist/leaflet.css';
import './styles.css';

import { BiomeClient } from './gen/client';
import { Store } from './store';
import { MapView, formatMeasure } from './map/mapView';
import { clearTileCache } from './map/tileCache';
import { h } from './dom';
import { chunkOf, parseCoords, toOtherDimension, type Dimension } from './coords';
import { prettyBiome } from './biomes';
import type { Marker } from './model';
import {
  blankMarker,
  catDot,
  categoriesPanel,
  listPanel,
  markerForm,
  settingsPanel,
  toolsPanel,
  type PanelHost,
} from './ui/panels';

const ICON = {
  list: '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 4h11M2.5 8h11M2.5 12h11"/></svg>',
  ruler: '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 11 11 2l3 3-9 9zM5 8l1.5 1.5M7 6l1.5 1.5M9 4l1.5 1.5"/></svg>',
  plus: '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>',
  gear: '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6 5 5M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4"/></svg>',
  swap: '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 5h10l-2.5-2.5M13 11H3l2.5 2.5"/></svg>',
  close: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
};

async function main() {
  const store = new Store();
  await store.load();
  const client = new BiomeClient();
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
  const goto = h('input', { type: 'search', placeholder: 'Go to X, Z or marker', enterKeyHint: 'go', 'aria-label': 'Go to coordinates' });
  const gotoForm = h('form', { class: 'goto', onsubmit: (e: Event) => { e.preventDefault(); doGoto(goto.value); goto.blur(); } }, goto);
  const iconBtn = (label: string, svg: string, onclick: () => void, id?: string) =>
    h('button', { class: 'icon', title: label, 'aria-label': label, html: svg, onclick, id });
  const measureBtn = iconBtn('Measure', ICON.ruler, () => toggleMeasure());
  const topbar = h('header', { class: 'topbar' },
    iconBtn('Markers', ICON.list, () => openList()),
    dimTabs,
    gotoForm,
    h('div', { class: 'top-actions' },
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
  function updateReadout() {
    const p = cursor ?? pinned ?? view.centerBlock();
    const what = cursor ? '' : pinned ? 'Tapped' : 'Centre';
    const ch = chunkOf(p.x, p.z);
    readout.innerHTML = '';
    const other = toOtherDimension(store.settings.dim, p.x, p.z);
    readout.append(
      h('div', { class: 'ro-main' },
        what && h('span', { class: 'ro-what' }, what),
        h('strong', {}, `${p.x}, ${p.z}`),
        biomeSpan),
      h('div', { class: 'ro-sub' }, `Chunk ${ch.x}, ${ch.z} · ${other.dim === 'nether' ? 'Nether' : 'Overworld'} ${other.x}, ${other.z}`),
    );
    if (pinned && !cursor) {
      readout.append(h('div', { class: 'ro-actions' },
        h('button', { class: 'primary small', onclick: () => addAt(pinned!) }, '+ Add marker here'),
        h('button', { class: 'small', onclick: () => { pinned = null; view.showPick(null); updateReadout(); } }, 'Clear')));
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
    for (const d of ['overworld', 'nether'] as Dimension[]) {
      dimTabs.append(h('button', {
        role: 'tab', class: 'tab' + (store.settings.dim === d ? ' on' : ''), 'aria-selected': String(store.settings.dim === d),
        onclick: () => switchDim(d),
      }, d === 'overworld' ? 'Overworld' : 'Nether'));
    }
    document.documentElement.dataset.dim = store.settings.dim;
  }
  async function switchDim(d: Dimension, keepPos = false) {
    if (store.settings.dim === d) return;
    const c = view.centerBlock();
    const o = keepPos ? c : toOtherDimension(store.settings.dim, c.x, c.z);
    pinned = null;
    view.showPick(null);
    await store.updateSettings({ dim: d });
    view.goTo(o.x, o.z, view.map.getZoom(), false);
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
    legend.append(h('div', { class: 'legend-foot' }, 'Biomes: Java-parity generator'));
  }

  // ---- sheet ----
  function openSheet(title: string, body: HTMLElement) {
    sheetTitle.textContent = title;
    sheetBody.innerHTML = '';
    sheetBody.append(body);
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
    current = title;
  }
  let current = '';
  function closeSheet() {
    sheet.classList.remove('open');
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
  const openSettings = () => openSheet('Settings', settingsPanel(host, () => openSheet('Categories', categoriesPanel(host))));
  const openTools = () => openSheet('Tools', toolsPanel(host));
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
    const m = needle && store.markers.find((m) => m.name.toLowerCase().includes(needle));
    if (m) flyToMarker(m);
    else toast('Type coordinates like “1180, -2808” or a marker name');
  }

  // ---- store wiring ----
  let lastSrc = '';
  store.on((kind) => {
    if (kind === 'settings') {
      const s = store.settings;
      applyTheme();
      const src = `${s.seed}|${mcResolved()}|${s.dim}`;
      if (src !== lastSrc) { lastSrc = src; view.refreshSource(); view.renderMarkers(); renderTabs(); renderLegend(); updateReadout(); }
      view.refreshGrid();
      view.renderMeasure();
    } else {
      view.renderMarkers();
      renderLegend();
      if (current === 'Markers') openList();
    }
  });
  lastSrc = `${store.settings.seed}|${mcResolved()}|${store.settings.dim}`;

  renderTabs();
  renderLegend();
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
  document.documentElement.dataset.ready = '1';
}

main().catch((e) => {
  console.error(e);
  document.body.append(h('pre', { class: 'fatal' }, String(e?.stack ?? e)));
});
