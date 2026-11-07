// "Suggested End Cities" panel: evidence from your finds, confidence, layer
// toggles and the nearest places to look.

import { h, fmtNum } from '../dom';
import { MATCH_TOLERANCE, type Assessment } from '../structures/bedrock';
import { endCityFinds, suggestions, type EndCityState, type Suggestion } from '../structures/endCities';
import type { Store } from '../store';
import type { Marker } from '../model';

export interface StructuresHost {
  store: Store;
  state(): EndCityState;
  origin(): { x: number; z: number; label: string };
  flyTo(x: number, z: number): void;
  addPlanned(s: Suggestion): void;
  editMarker(m: Marker): void;
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

export function structuresPanel(host: StructuresHost): HTMLElement {
  const { store } = host;
  const s = store.settings;
  const st = host.state();
  const a = st.assessment;
  const finds = endCityFinds(store.markers);

  // ---- status card ----
  const card = h('div', { class: 'struct-card' + (a.confidence === 'mismatch' || !a.gridOk ? ' warn' : '') });
  card.append(h('div', {}, h('span', { class: `conf conf-${a.confidence}` }, CONF_LABEL[a.confidence])));
  if (a.confidence === 'none') {
    card.append(
      h('p', { class: 'big' }, 'Showing search boxes only'),
      h('p', { class: 'hint' },
        'Each box is one region of the End City grid. A region holds at most one city, and only inside its box; the shaded core holds it about two times in three. ' +
        'Exact predicted spots unlock once a formula matches a city you have found.'),
    );
  } else if (a.confidence === 'mismatch') {
    card.append(
      h('p', { class: 'big' }, `No formula matches all ${a.finds} finds`),
      h('p', { class: 'hint' }, 'Exact predictions are hidden. Search boxes still show. Check the finds below: a marker placed on a ship or a far tower will not match.'),
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
      const m = finds.find((f) => f.id === c.id)!;
      findList.append(h('button', { class: 'find-row' + (c.match ? '' : ' miss'), title: 'Edit this find', onclick: () => host.editMarker(m) },
        h('span', { class: 'find-mark' }, c.match ? '✓' : '✗'),
        h('span', {},
          h('strong', {}, m.name), ` ${m.x}, ${m.z} — `,
          c.match ? `${fmtNum(c.dist, 0)} blocks from prediction` : `nearest prediction ${c.predicted.x}, ${c.predicted.z} is ${fmtNum(c.dist, 0)} blocks away`,
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
    const zone = h('span', {});
    host.zoneAt(sg.x, sg.z).then((z) => {
      if (z === 'small_end_islands') {
        zone.textContent = ' · likely void';
        zone.className = 'zone-void';
      } else zone.textContent = ' · outer islands';
    });
    list.append(h('li', {},
      h('button', { class: 'mitem', onclick: () => host.flyTo(sg.x, sg.z) },
        h('span', { class: 'hit-num', style: '--c:var(--struct)' }, String(i + 1)),
        h('span', { class: 'mitem-main' },
          h('span', { class: 'mitem-name' }, `${sg.x}, ${sg.z}`),
          h('span', { class: 'mitem-sub' }, `${sg.kind === 'predicted' ? 'Predicted city' : 'Centre of search box'} · ${fmtNum(sg.dist, 0)} blocks`, zone))),
      h('button', { class: 'small', title: 'Add a planned End City marker here', onclick: () => host.addPlanned(sg) }, '+ Marker')));
  });

  return h('div', { class: 'structs' },
    h('p', { class: 'hint' }, 'Experimental Bedrock End City placement (ported from public research). It is only trusted as far as it matches the cities you find.'),
    card,
    findList,
    h('h3', {}, `Nearest to ${o.label}`),
    sugg.length ? list : h('p', { class: 'hint' }, 'No suggestions in range.'),
    h('p', { class: 'hint' }, 'The void hint uses Java End zones (cubiomes); Bedrock islands may differ.'),
    h('h3', {}, 'How to make it smarter'),
    h('p', { class: 'hint' },
      `Add each End City you find with category “End City”, status Found, in the End, at the base of the entrance tower (within ${MATCH_TOLERANCE} blocks). ` +
      'Two matching finds make predictions likely; four confirm them. The /locate trick in a copy of your world gives exact cities to check against.'),
    h('h3', {}, 'Map layers (End tab)'),
    toggle('Search boxes (grid regions)', 'structBoxes'),
    toggle('Predicted cities', 'structPins'),
    toggle('Show unverified predictions', 'structUnverified'),
  );
}
