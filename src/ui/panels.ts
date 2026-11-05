// Sheet panels: list, marker form, categories, settings, tools.

import { h, fmtNum } from '../dom';
import {
  distance2D,
  formatXZ,
  netherToOverworld,
  overworldToNether,
  parseCoords,
  toOtherDimension,
  type Dimension,
} from '../coords';
import { ICON_NAMES, iconSvg, type IconName } from '../icons';
import { newId, slug, STATUSES, VERSIONS, type Category, type Marker, type Status } from '../model';
import { normalizeSeed } from '../seed';
import type { Store } from '../store';
import { formatMeasure } from '../map/mapView';

export interface PanelHost {
  store: Store;
  close(): void;
  open(title: string, body: HTMLElement): void;
  flyToMarker(m: Marker): void;
  center(): { x: number; z: number };
  clearTileCache(): Promise<void>;
  toast(msg: string): void;
  startMeasure(): void;
}

const dimLabel = (d: Dimension) => (d === 'overworld' ? 'Overworld' : 'Nether');

export function catDot(color: string, icon: IconName, size = 22): HTMLElement {
  return h('span', { class: 'cat-dot', style: `--c:${color};width:${size}px;height:${size}px`, html: iconSvg(icon, Math.round(size * 0.55)) });
}

function field(label: string, input: HTMLElement, extra?: string): HTMLElement {
  return h('label', { class: 'field ' + (extra ?? '') }, h('span', {}, label), input);
}

// ---- list -------------------------------------------------------------------

export interface ListState {
  q: string;
  cat: string;
  status: string;
  dim: string;
  ref: string;
}

export const listState: ListState = { q: '', cat: '', status: '', dim: 'current', ref: '' };

export function listPanel(host: PanelHost): HTMLElement {
  const { store } = host;
  const root = h('div', { class: 'list-panel' });
  const results = h('ul', { class: 'mlist' });

  const refSel = h('select', { 'aria-label': 'Distance reference' });
  const rebuildRef = () => {
    refSel.innerHTML = '';
    refSel.append(h('option', { value: '' }, `Reference: ${store.referenceMarker()?.name ?? 'map centre'}`));
    refSel.append(h('option', { value: '@center' }, 'Reference: map centre'));
    for (const m of [...store.markers].sort((a, b) => a.name.localeCompare(b.name)))
      refSel.append(h('option', { value: m.id }, `Reference: ${m.name}`));
    refSel.value = listState.ref;
  };
  rebuildRef();

  const search = h('input', { type: 'search', placeholder: 'Search markers…', value: listState.q, 'aria-label': 'Search markers' });
  const catSel = h('select', { 'aria-label': 'Category filter' }, h('option', { value: '' }, 'All categories'),
    store.sortedCategories().map((c) => h('option', { value: c.id }, c.name)));
  catSel.value = listState.cat;
  const statusSel = h('select', { 'aria-label': 'Status filter' }, h('option', { value: '' }, 'Any status'),
    STATUSES.map((s) => h('option', { value: s }, s)));
  statusSel.value = listState.status;
  const dimSel = h('select', { 'aria-label': 'Dimension filter' },
    h('option', { value: 'current' }, 'This dimension'),
    h('option', { value: 'all' }, 'All dimensions'),
    h('option', { value: 'overworld' }, 'Overworld'),
    h('option', { value: 'nether' }, 'Nether'));
  dimSel.value = listState.dim;

  const render = () => {
    listState.q = search.value;
    listState.cat = catSel.value;
    listState.status = statusSel.value;
    listState.dim = dimSel.value;
    listState.ref = refSel.value;
    const dimFilter = listState.dim === 'current' ? store.settings.dim : listState.dim;
    const refMarker = listState.ref === '@center' ? undefined : store.marker(listState.ref) ?? store.referenceMarker();
    const refDim: Dimension = refMarker?.dim ?? store.settings.dim;
    const refPos = refMarker ?? host.center();
    const q = listState.q.trim().toLowerCase();

    // Distance is measured in the reference's dimension; markers in the other
    // dimension are converted 1:8 first.
    const dist = (m: Marker) => {
      const p = m.dim === refDim ? m : toOtherDimension(m.dim, m.x, m.z);
      return distance2D(refPos, p);
    };
    const items = store.markers
      .filter((m) => dimFilter === 'all' || m.dim === dimFilter)
      .filter((m) => !listState.cat || m.categoryId === listState.cat)
      .filter((m) => !listState.status || m.status === listState.status)
      .filter((m) => !q || m.name.toLowerCase().includes(q) || m.notes.toLowerCase().includes(q))
      .map((m) => ({ m, d: dist(m) }))
      .sort((a, b) => a.d - b.d);

    results.innerHTML = '';
    if (!items.length) results.append(h('li', { class: 'empty' }, 'No markers match.'));
    for (const { m, d } of items) {
      const cat = store.category(m.categoryId);
      results.append(
        h('li', {},
          h('button', { class: 'mitem', onclick: () => host.flyToMarker(m) },
            catDot(cat?.color ?? '#888', cat?.icon ?? 'dot'),
            h('span', { class: 'mitem-main' },
              h('span', { class: 'mitem-name' }, m.name),
              h('span', { class: 'mitem-sub' },
                `${formatXZ(m.x, m.z)}${m.y != null ? ` · Y ${m.y}` : ''} · ${dimLabel(m.dim)} · ${m.status}`)),
            h('span', { class: 'mitem-dist' }, m === refMarker ? 'ref' : `${fmtNum(d, 0)}`)),
        ),
      );
    }
  };

  for (const el of [search, catSel, statusSel, dimSel, refSel]) el.addEventListener('input', render);
  root.append(
    search,
    h('div', { class: 'filters' }, catSel, statusSel, dimSel),
    refSel,
    h('p', { class: 'hint' }, 'Sorted by distance (blocks). Other-dimension markers are converted 1:8.'),
    results,
  );
  render();
  return root;
}

// ---- marker form ---------------------------------------------------------------

export function markerForm(host: PanelHost, m: Marker, isNew: boolean): HTMLElement {
  const { store } = host;
  const name = h('input', { value: m.name, required: true, placeholder: 'Name', autocomplete: 'off' });
  const cat = h('select', {}, store.sortedCategories().map((c) => h('option', { value: c.id }, c.name)));
  cat.value = m.categoryId;
  const num = (v: number | null, ph = '') => h('input', { type: 'text', inputMode: 'numeric', value: v == null ? '' : String(v), placeholder: ph });
  const x = num(m.x), y = num(m.y, 'optional'), z = num(m.z);
  const dim = h('select', {}, h('option', { value: 'overworld' }, 'Overworld'), h('option', { value: 'nether' }, 'Nether'));
  dim.value = m.dim;
  const status = h('select', {}, STATUSES.map((s) => h('option', { value: s }, s)));
  status.value = m.status;
  const notes = h('textarea', { rows: 3, placeholder: 'Notes' }, m.notes);
  const linked = h('input', { type: 'checkbox', checked: m.showLinked });
  const linkedInfo = h('p', { class: 'hint' });
  const updLinked = () => {
    const xv = Number(x.value), zv = Number(z.value);
    if (!Number.isFinite(xv) || !Number.isFinite(zv)) return (linkedInfo.textContent = '');
    const o = toOtherDimension(dim.value as Dimension, xv, zv);
    linkedInfo.textContent = `Linked ${dimLabel(o.dim)} position: ${o.x}, ${o.z}`;
  };
  for (const el of [x, z, dim]) el.addEventListener('input', updLinked);
  updLinked();
  const err = h('p', { class: 'error' });

  const save = async (ev: Event) => {
    ev.preventDefault();
    const xv = Number(x.value.trim()), zv = Number(z.value.trim());
    const yv = y.value.trim() === '' ? null : Number(y.value.trim());
    if (!name.value.trim()) return (err.textContent = 'Name is required.');
    if (!Number.isInteger(xv) || !Number.isInteger(zv) || x.value.trim() === '' || z.value.trim() === '')
      return (err.textContent = 'X and Z must be whole numbers.');
    if (yv !== null && !Number.isInteger(yv)) return (err.textContent = 'Y must be a whole number.');
    await store.saveMarker({
      ...m,
      name: name.value.trim(),
      categoryId: cat.value,
      x: xv, y: yv, z: zv,
      dim: dim.value as Dimension,
      status: status.value as Status,
      notes: notes.value,
      showLinked: linked.checked,
    });
    host.close();
    host.toast(isNew ? 'Marker added' : 'Marker saved');
  };

  const form = h('form', { class: 'mform', onsubmit: save },
    field('Name', name),
    field('Category', cat),
    h('div', { class: 'row3' }, field('X', x), field('Y', y), field('Z', z)),
    h('div', { class: 'row2' }, field('Dimension', dim), field('Status', status)),
    field('Notes', notes),
    h('label', { class: 'check' }, linked, h('span', {}, 'Show linked portal position in the other dimension')),
    linkedInfo,
    !isNew && h('p', { class: 'hint' }, `Created ${new Date(m.createdAt).toLocaleString()}`),
    err,
    h('div', { class: 'actions' },
      h('button', { type: 'submit', class: 'primary' }, isNew ? 'Add marker' : 'Save'),
      !isNew && h('button', { type: 'button', onclick: async () => {
        await store.updateSettings({ referenceId: m.id });
        host.toast(`Distance reference: ${m.name}`);
      } }, 'Use as reference'),
      !isNew && h('button', { type: 'button', class: 'danger', onclick: async () => {
        if (!confirm(`Delete “${m.name}”?`)) return;
        await store.deleteMarker(m.id);
        host.close();
        host.toast('Marker deleted');
      } }, 'Delete'),
    ),
  );
  setTimeout(() => isNew && name.focus(), 50);
  return form;
}

export function blankMarker(host: PanelHost, x: number, z: number, dim: Dimension): Marker {
  const ref = host.store.sortedCategories()[0];
  return {
    id: newId(), name: '', categoryId: ref?.id ?? 'point-of-interest', x, y: null, z, dim,
    notes: '', status: 'planned', createdAt: new Date().toISOString(), showLinked: false,
  };
}

// ---- categories ------------------------------------------------------------------

export function categoriesPanel(host: PanelHost): HTMLElement {
  const { store } = host;
  const root = h('div', { class: 'cats' });
  const render = () => {
    root.innerHTML = '';
    for (const c of store.sortedCategories()) root.append(categoryRow(host, c, render));
    root.append(h('button', { class: 'primary', onclick: async () => {
      let id = slug('New category'), n = 1;
      while (store.category(id)) id = `${slug('New category')}-${++n}`;
      const order = Math.max(-1, ...store.categories.map((c) => c.order)) + 1;
      await store.saveCategory({ id, name: 'New category', color: '#607d8b', icon: 'dot', visible: true, order });
      render();
    } }, '+ Add category'));
  };
  render();
  return root;
}

function categoryRow(host: PanelHost, c: Category, rerender: () => void): HTMLElement {
  const { store } = host;
  const save = (patch: Partial<Category>) => store.saveCategory({ ...c, ...patch }).then(() => Object.assign(c, patch));
  const name = h('input', { value: c.name, 'aria-label': 'Category name', onchange: () => save({ name: name.value.trim() || c.name }) });
  const color = h('input', { type: 'color', value: c.color, 'aria-label': 'Color', oninput: () => { save({ color: color.value }); preview.style.setProperty('--c', color.value); } });
  const preview = catDot(c.color, c.icon, 28);
  const icons = h('div', { class: 'icon-grid', role: 'radiogroup', 'aria-label': 'Icon' },
    ICON_NAMES.map((ic) => h('button', {
      type: 'button', class: 'icon-btn' + (ic === c.icon ? ' on' : ''), title: ic, 'aria-label': ic,
      html: iconSvg(ic, 16),
      onclick: async () => { await save({ icon: ic }); rerender(); },
    })));
  const count = store.markers.filter((m) => m.categoryId === c.id).length;
  return h('div', { class: 'cat-row' },
    h('div', { class: 'cat-head' }, preview, name, color),
    icons,
    h('div', { class: 'cat-foot' },
      h('span', { class: 'hint' }, `${count} marker${count === 1 ? '' : 's'}`),
      h('button', { type: 'button', class: 'danger small', onclick: async () => {
        const others = store.sortedCategories().filter((o) => o.id !== c.id);
        if (!others.length) return host.toast('Keep at least one category');
        const target = others.find((o) => o.id === 'point-of-interest') ?? others[0];
        if (!confirm(`Delete category “${c.name}”?${count ? ` Its ${count} marker(s) move to “${target.name}”.` : ''}`)) return;
        await store.deleteCategory(c.id, target.id);
        rerender();
      } }, 'Delete')),
  );
}

// ---- settings ----------------------------------------------------------------------

export function settingsPanel(host: PanelHost, openCategories: () => void): HTMLElement {
  const { store } = host;
  const s = store.settings;
  const seed = h('input', { value: s.seed, inputMode: 'numeric', 'aria-label': 'Seed' });
  const seedErr = h('p', { class: 'error' });
  seed.addEventListener('change', async () => {
    const v = normalizeSeed(seed.value);
    if (!v) return (seedErr.textContent = 'Seed must be a 64-bit integer.');
    seedErr.textContent = '';
    seed.value = v;
    await store.updateSettings({ seed: v });
  });
  const ver = h('select', { onchange: () => store.updateSettings({ mc: Number(ver.value) }) },
    VERSIONS.map((v) => h('option', { value: String(v.mc) }, v.label)));
  ver.value = String(s.mc);
  const theme = h('select', { onchange: () => store.updateSettings({ theme: theme.value as 'light' }) },
    h('option', { value: 'system' }, 'System'), h('option', { value: 'light' }, 'Light'), h('option', { value: 'dark' }, 'Dark'));
  theme.value = s.theme;
  const chunk = h('input', { type: 'checkbox', checked: s.chunkGrid, onchange: () => store.updateSettings({ chunkGrid: chunk.checked }) });
  const region = h('input', { type: 'checkbox', checked: s.regionGrid, onchange: () => store.updateSettings({ regionGrid: region.checked }) });

  const fileIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!confirm('Importing replaces all current markers and categories. Continue?')) return;
      const r = await store.importData(data);
      host.toast(`Imported ${r.markers} markers, ${r.categories} categories`);
      host.close();
    } catch (e) {
      alert(String(e instanceof Error ? e.message : e));
    } finally {
      fileIn.value = '';
    }
  });

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(store.exportData(), null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `worldatlas-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return h('div', { class: 'settings' },
    h('h3', {}, 'World'),
    field('Seed', seed), seedErr,
    field('Generator version', ver),
    h('p', { class: 'hint' }, 'Biomes: Java-parity generator (cubiomes). Bedrock and Java share biome generation since 1.18. Structures are not predicted — add them as markers.'),
    h('h3', {}, 'Display'),
    field('Theme', theme),
    h('label', { class: 'check' }, chunk, h('span', {}, 'Chunk grid (16 blocks, when zoomed in)')),
    h('label', { class: 'check' }, region, h('span', {}, 'Region grid (512 blocks)')),
    h('button', { onclick: openCategories }, 'Edit categories…'),
    h('h3', {}, 'Data'),
    h('div', { class: 'actions' },
      h('button', { onclick: exportJson }, 'Export JSON'),
      h('button', { onclick: () => fileIn.click() }, 'Import JSON'),
      fileIn),
    h('div', { class: 'actions' },
      h('button', { onclick: async () => { await host.clearTileCache(); host.toast('Tile cache cleared'); } }, 'Clear tile cache')),
  );
}

// ---- tools: converter + measure -------------------------------------------------------

export function toolsPanel(host: PanelHost): HTMLElement {
  const { store } = host;
  const ow = h('input', { placeholder: 'X, Z', inputMode: 'text', 'aria-label': 'Overworld X, Z' });
  const ne = h('input', { placeholder: 'X, Z', inputMode: 'text', 'aria-label': 'Nether X, Z' });
  ow.addEventListener('input', () => {
    const p = parseCoords(ow.value);
    if (p) { const n = overworldToNether(p.x, p.z); ne.value = `${n.x}, ${n.z}`; }
  });
  ne.addEventListener('input', () => {
    const p = parseCoords(ne.value);
    if (p) { const o = netherToOverworld(p.x, p.z); ow.value = `${o.x}, ${o.z}`; }
  });
  const c = host.center();
  if (store.settings.dim === 'overworld') { ow.value = `${c.x}, ${c.z}`; ow.dispatchEvent(new Event('input')); }
  else { ne.value = `${c.x}, ${c.z}`; ne.dispatchEvent(new Event('input')); }

  const m = store.settings.measure;
  const mInfo = m ? formatMeasure(m) : null;
  return h('div', { class: 'tools' },
    h('h3', {}, 'Overworld ⇄ Nether (1:8)'),
    h('div', { class: 'row2' }, field('Overworld', ow), field('Nether', ne)),
    h('p', { class: 'hint' }, 'Overworld → Nether uses floor division (−2808 → −351).'),
    h('h3', {}, 'Measure'),
    mInfo
      ? h('div', { class: 'measure-box' },
          h('div', { class: 'measure-main' }, mInfo.main),
          h('div', { class: 'hint' }, mInfo.detail),
          h('div', { class: 'hint' }, `${dimLabel(m!.dim)}: ${formatXZ(m!.a.x, m!.a.z)} → ${formatXZ(m!.b.x, m!.b.z)}`))
      : h('p', { class: 'hint' }, 'No measurement yet.'),
    h('div', { class: 'actions' },
      h('button', { class: 'primary', onclick: () => host.startMeasure() }, 'New measurement'),
      m && h('button', { onclick: async () => { await store.updateSettings({ measure: null }); host.close(); } }, 'Clear')),
  );
}
