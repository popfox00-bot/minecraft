// "Suggested structures" panel (End Cities, Nether bastions + fortresses, and Overworld villages, outposts,
// monuments, mansions and temples):
// evidence from your finds, confidence, layer toggles and the nearest places
// to look.

import { h, fmtNum } from '../dom';
import { netherToOverworld } from '../coords';
import type { Assessment } from '../structures/bedrock';
import { KINDS_BY_DIM, TYPE_LABEL, structureFinds, suggestions, type EndCityState, type StructureKind, type Suggestion } from '../structures/endCities';
import { DIM_LABEL } from '../coords';
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
  /** the Overworld biome id at a point (async, from the worker) */
  biomeAt(x: number, z: number): Promise<number>;
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
  const cfg = st.cfg;

  // ---- kind switch: each dimension's ----
  const tabs = h('div', { class: 'struct-tab-groups' },
    (['overworld', 'nether', 'end'] as const).map((d) => h('div', { class: 'tabs struct-tabs', role: 'tablist', 'aria-label': DIM_LABEL[d] },
      KINDS_BY_DIM[d].map((k) => h('button', {
        role: 'tab', class: 'tab' + (k.id === kind.id ? ' on' : ''), 'aria-selected': String(k.id === kind.id),
        onclick: () => k.id !== kind.id && host.switchKind(k),
      }, k.tab)))));

  // ---- status card ----
  const card = h('div', { class: 'struct-card' + (a.confidence === 'mismatch' || !a.gridOk ? ' warn' : '') });
  card.append(h('div', {}, h('span', { class: `conf conf-${a.confidence}` }, CONF_LABEL[a.confidence])));
  if (a.confidence === 'none') {
    card.append(
      h('p', { class: 'big' }, 'Showing search boxes only'),
      h('p', { class: 'hint' }, kind.boxHint),
    );
  } else if (a.confidence === 'mismatch') {
    card.append(
      h('p', { class: 'big' }, `No formula matches all ${a.finds} finds`),
      h('p', { class: 'hint' }, `Exact predictions are hidden. Search boxes still show. Check the finds below: the marker should be ${kind.markHint}${isNether ? ', with the right category (bastion vs fortress)' : ''}.`),
    );
  } else if (a.best) {
    card.append(
      h('p', { class: 'big' }, `Formula matches ${a.best.matches} of ${a.finds} finds`),
      h('p', { class: 'hint' }, `Seed reduction: ${a.best.variant.label}${kind.cfgs && kind.cfgs.length > 1 ? ` · grid: ${cfg.label}` : ''} · ${odds(a.coincidence)}.`),
    );
    if (a.confidence === 'possible') card.append(h('p', { class: 'hint' }, 'One match can be luck. Predictions are shown dashed until more finds agree.'));
  }
  if (!a.gridOk) {
    card.append(h('p', { class: 'error' },
      `${a.outsideGrid.length} find(s) lie outside every possible spawn box. The grid itself may be wrong for Bedrock — treat all suggestions with caution.`));
  }
  if (st.unverified) card.append(h('p', { class: 'hint' }, `Unverified predictions are on: pins use the low-32-bit formula${kind.cfgs && kind.cfgs.length > 1 ? ` and the first grid (${cfg.label})` : ''} and have matched nothing yet.`));

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
  // (Overworld: more are worked out, then only those whose biome allows the structure are listed.)
  const want = 10;
  const raw = suggestions(st, o, kind.biomes ? 40 : want, kind.biomes ? 24 : 12);
  const fill = (sugg: Suggestion[]) => { list.innerHTML = ''; if (!sugg.length) list.append(h('li', { class: 'hint' }, 'No suggestions in range.')); sugg.forEach((sg, i) => {
    const extra = h('span', {});
    if (isNether) {
      const ow = netherToOverworld(sg.x, sg.z);
      extra.textContent = ` · Overworld portal ≈ ${ow.x}, ${ow.z}`;
    }
    const what = sg.kind === 'box' ? 'Centre of search box' : sg.type ? `Predicted ${(TYPE_LABEL[sg.type] ?? sg.type).toLowerCase()}` : kind.id === 'end' ? 'Predicted city' : `Predicted ${kind.noun}`;
    const numColor = sg.type === 'bastion' || sg.type === 'fortress' ? `var(--${sg.type})` : 'var(--struct)';
    list.append(h('li', {},
      h('button', { class: 'mitem', onclick: () => host.flyTo(sg.x, sg.z) },
        h('span', { class: 'hit-num', style: `--c:${numColor}` }, String(i + 1)),
        h('span', { class: 'mitem-main' },
          h('span', { class: 'mitem-name' }, `${sg.x}, ${sg.z}`),
          h('span', { class: 'mitem-sub' }, `${what} · ${fmtNum(sg.dist, 0)} blocks`, extra))),
      h('button', { class: 'small', title: `Add a planned ${kind.noun} marker here`, onclick: () => host.addPlanned(sg) }, '+ Marker')));
  }); };
  if (!kind.biomes) fill(raw.slice(0, want));
  else {
    list.append(h('li', { class: 'hint' }, 'Checking biomes…'));
    const biomes = kind.biomes;
    void Promise.all(raw.map((sg) => host.biomeAt(sg.x, sg.z).catch(() => -1))).then((ids) => {
      // (A search box's middle isn't where it would be: those are kept, with no type.)
      fill(raw.map((sg, i) => ({ sg, id: ids[i] }))
        .filter(({ sg, id }) => sg.kind === 'box' || id in biomes)
        .map(({ sg, id }) => (sg.kind === 'box' ? sg : { ...sg, type: biomes[id] || null }))
        .slice(0, want));
    });
  }

  return h('div', { class: 'structs' },
    tabs,
    h('p', { class: 'hint' }, `Experimental Bedrock ${isNether ? 'bastion and fortress' : kind.noun} placement (ported from public research${kind.cfgs && kind.cfgs.length > 1 ? `; ${kind.cfgs.length} possible grids, the finds pick one` : ''}). It is only trusted as far as it matches what you find.${kind.biomes ? ' Biomes are checked with the Overworld map, which matches Bedrock.' : ''}`),
    card,
    findList,
    isNether && st.pinVariant && h('p', { class: 'legend-types' },
      h('span', { class: 'swatch', style: 'background:var(--bastion)' }), 'Bastion ',
      h('span', { class: 'swatch', style: 'background:var(--fortress)' }), 'Fortress'),
    h('h3', {}, `Nearest to ${o.label}`),
    list,
    isNether
      ? h('p', { class: 'hint' }, 'A pin is where the structure starts; bastions and fortresses spread 50–100+ blocks from it.')
      : kind.id === 'end' ? h('p', { class: 'hint' }, 'A pin is where a city could start; whether there\'s an island under it isn\'t known here (the End terrain doesn\'t match Bedrock).')
      : h('p', { class: 'hint' }, `A pin is where a ${kind.noun} would start, if the grid is right and the region gets one; pins only show where the biome allows it.`),
    h('h3', {}, 'How to make it smarter'),
    h('p', { class: 'hint' },
      `Add each one you find with category ${categoryNames(kind, store)}, status Found, in the ${DIM_LABEL[kind.dim]}, ${kind.markHint} (within ${cfg.tolerance} blocks). ` +
      'More matching finds raise the confidence; any miss hides the exact pins.'),
    h('h3', {}, `Map layers (${DIM_LABEL[kind.dim]} tab)`),
    toggle('Search boxes (grid regions)', 'structBoxes'),
    toggle(isNether ? 'Predicted bastions & fortresses' : kind.id === 'end' ? 'Predicted cities' : `Predicted ${kind.tab.toLowerCase()}`, 'structPins'),
    toggle('Show unverified predictions', 'structUnverified'),
  );
}
