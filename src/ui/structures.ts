// "Suggested structures" panel (End Cities / Nether bastions + fortresses):
// evidence from your finds, confidence, layer toggles and the nearest places
// to look.

import { h, fmtNum } from '../dom';
import { netherToOverworld } from '../coords';
import type { Assessment } from '../structures/bedrock';
import { KINDS, TYPE_LABEL, structureFinds, suggestions, type EndCityState, type StructureKind, type Suggestion } from '../structures/endCities';
import type { Store } from '../store';
import type { Marker } from '../model';

export interface StructuresHost {
  store: Store;
  state(): EndCityState;
  origin(): { x: number; z: number; label: string };
  flyTo(x: number, z: number): void;
  addPlanned(s: Suggestion): void;
  editMarker(m: Marker): void;
  /** switch the panel (and map) to another structure kind */
  switchKind(kind: StructureKind): void;
  /** Java End zone at a point, for the void hint (async, from the worker) */
  zoneAt(x: number, z: number): Promise<string>;
}

const CONF_LABEL: Record<Assessment['confidence'], string> = {
  none: 'No finds yet',
  possible: 'Possible',
  likely: 'Likely',
  confirmed: 'Confirmed',
  mismatch: 'No match',
};

function odds(p: number): string {
  if (p >= 0.5) return 'easily a coincidence';
  return `about 1 in ${fmtNum(Math.round(1 / p), 0)} chance of coincidence`;
}

function categoryNames(kind: StructureKind, store: Store): string {
  return Object.values(kind.categories)
    .map((id) => `“${store.category(id)?.name ?? id}”`)
    .join(' or ');
}

export function structuresPanel(host: StructuresHost): HTMLElement {
  const { store } = host;
  const s = store.settings;
  const st = host.state();
  const { kind } = st;
  const a = st.assessment;
  const finds = structureFinds(kind, store.markers);
  const isNether = kind.id === 'nether';

  // ---- kind switch ----
  const tabs = h('div', { class: 'tabs struct-tabs', role: 'tablist' },
    Object.values(KINDS).map((k) => h('button', {
      role: 'tab', class: 'tab' + (k.id === kind.id ? ' on' : ''), 'aria-selected': String(k.id === kind.id),
      onclick: () => k.id !== kind.id && host.switchKind(k),
    }, k.id === 'end' ? 'End Cities' : 'Bastions & Fortresses')));

  // ---- status card ----
  const card = h('div', { class: 'struct-card' + (a.confidence === 'mismatch' || !a.gridOk ? ' warn' : '') });
  card.append(h('div', {}, h('span', { class: `conf conf-${a.confidence}` }, CONF_LABEL[a.confidence])));
  if (a.confidence === 'none') {
    card.append(
      h('p', { class: 'big' }, 'Showing search boxes only'),
      h('p', { class: 'hint' }, isNether
        ? 'Each box is one region of the Nether structure grid (480 blocks). A region holds one bastion or fortress, starting inside its box. Exact predicted spots and types unlock once the formula matches a structure you have found.'
        : 'Each box is one region of the End City grid. A region holds at most one city, and only inside its box; the shaded core holds it about two times in three. Exact predicted spots unlock once a formula matches a city you have found.'),
    );
  } else if (a.confidence === 'mismatch') {
    card.append(
      h('p', { class: 'big' }, `No formula matches all ${a.finds} finds`),
      h('p', { class: 'hint' }, `Exact predictions are hidden. Search boxes still show. Check the finds below: the marker should be ${kind.markHint}${isNether ? ', with the right category (bastion vs fortress)' : ''}.`),
    );
  } else if (a.best) {
    card.append(
      h('p', { class: 'big' }, `Formula matches ${a.best.matches} of ${a.finds} finds`),
      h('p', { class: 'hint' }, `Seed reduction: ${a.best.variant.label} · ${odds(a.coincidence)}.`),
    );
    if (a.confidence === 'possible') card.append(h('p', { class: 'hint' }, 'One match can be luck. Predictions are shown dashed until more finds agree.'));
  }
  if (!a.gridOk) {
    card.append(h('p', { class: 'error' },
      `${a.outsideGrid.length} find(s) lie outside every possible spawn box. The grid itself may be wrong for Bedrock — treat all suggestions with caution.`));
  }
  if (st.unverified) card.append(h('p', { class: 'hint' }, 'Unverified predictions are on: pins use the low-32-bit formula and have matched nothing yet.'));

  // ---- finds ----
  const findList = h('div', {});
  if (finds.length && a.best) {
    for (const c of a.best.checks) {
      const m = finds.find((f) => f.id === c.id)!.marker;
      const typeNote = c.type && c.predicted.type && c.type !== c.predicted.type ? ` (predicted a ${TYPE_LABEL[c.predicted.type].toLowerCase()} there)` : '';
      findList.append(h('button', { class: 'find-row' + (c.match ? '' : ' miss'), title: 'Edit this find', onclick: () => host.editMarker(m) },
        h('span', { class: 'find-mark' }, c.match ? '✓' : '✗'),
        h('span', {},
          h('strong', {}, m.name), ` ${m.x}, ${m.z} — `,
          c.match ? `${fmtNum(c.dist, 0)} blocks from prediction` : `nearest prediction ${c.predicted.x}, ${c.predicted.z} is ${fmtNum(c.dist, 0)} blocks away${typeNote}`,
          !c.inGrid ? ' · outside grid' : '')));
    }
  }

  // ---- toggles ----
  const toggle = (label: string, key: 'structBoxes' | 'structPins' | 'structUnverified') => {
    const cb = h('input', { type: 'checkbox', checked: s[key], onchange: () => store.updateSettings({ [key]: cb.checked }) });
    return h('label', { class: 'check' }, cb, h('span', {}, label));
  };

  // ---- suggestions ----
  const o = host.origin();
  const list = h('ul', { class: 'hits' });
  const sugg = suggestions(st, o, 10);
  sugg.forEach((sg, i) => {
    const extra = h('span', {});
    if (isNether) {
      const ow = netherToOverworld(sg.x, sg.z);
      extra.textContent = ` · Overworld portal ≈ ${ow.x}, ${ow.z}`;
    } else {
      host.zoneAt(sg.x, sg.z).then((z) => {
        if (z === 'small_end_islands') {
          extra.textContent = ' · likely void';
          extra.className = 'zone-void';
        } else extra.textContent = ' · outer islands';
      });
    }
    const what = sg.kind === 'box' ? 'Centre of search box' : sg.type ? `Predicted ${TYPE_LABEL[sg.type].toLowerCase()}` : 'Predicted city';
    const numColor = sg.type ? `var(--${sg.type})` : 'var(--struct)';
    list.append(h('li', {},
      h('button', { class: 'mitem', onclick: () => host.flyTo(sg.x, sg.z) },
        h('span', { class: 'hit-num', style: `--c:${numColor}` }, String(i + 1)),
        h('span', { class: 'mitem-main' },
          h('span', { class: 'mitem-name' }, `${sg.x}, ${sg.z}`),
          h('span', { class: 'mitem-sub' }, `${what} · ${fmtNum(sg.dist, 0)} blocks`, extra))),
      h('button', { class: 'small', title: `Add a planned ${kind.noun} marker here`, onclick: () => host.addPlanned(sg) }, '+ Marker')));
  });

  return h('div', { class: 'structs' },
    tabs,
    h('p', { class: 'hint' }, `Experimental Bedrock ${isNether ? 'bastion and fortress' : 'End City'} placement (ported from public research). It is only trusted as far as it matches what you find.`),
    card,
    findList,
    isNether && st.pinVariant && h('p', { class: 'legend-types' },
      h('span', { class: 'swatch', style: 'background:var(--bastion)' }), 'Bastion ',
      h('span', { class: 'swatch', style: 'background:var(--fortress)' }), 'Fortress'),
    h('h3', {}, `Nearest to ${o.label}`),
    sugg.length ? list : h('p', { class: 'hint' }, 'No suggestions in range.'),
    isNether
      ? h('p', { class: 'hint' }, 'A pin is where the structure starts; bastions and fortresses spread 50–100+ blocks from it. In Java, bastions never generate in basalt deltas.')
      : h('p', { class: 'hint' }, 'The void hint uses Java End zones (cubiomes); Bedrock islands differ.'),
    h('h3', {}, 'How to make it smarter'),
    h('p', { class: 'hint' },
      `Add each one you find with category ${categoryNames(kind, store)}, status Found, in the ${isNether ? 'Nether' : 'End'}, ${kind.markHint} (within ${kind.cfg.tolerance} blocks). ` +
      'More matching finds raise the confidence; any miss hides the exact pins.'),
    h('h3', {}, `Map layers (${isNether ? 'Nether' : 'End'} tab)`),
    toggle('Search boxes (grid regions)', 'structBoxes'),
    toggle(isNether ? 'Predicted bastions & fortresses' : 'Predicted cities', 'structPins'),
    toggle('Show unverified predictions', 'structUnverified'),
  );
}
