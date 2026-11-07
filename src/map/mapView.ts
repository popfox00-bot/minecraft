// The Leaflet map: layers, markers, linked portals, measure line, readout.

import L from 'leaflet';
import {
  blockCenterLatLng,
  blockToLatLng,
  distance2D,
  distance3D,
  latLngToBlockInt,
  netherTravelEquivalent,
  toOtherDimension,
  type Dimension,
} from '../coords';
import { BiomeLayer } from './biomeLayer';
import { GridLayer } from './gridLayer';
import type { BiomeClient } from '../gen/client';
import type { Store } from '../store';
import type { Marker, Measure, MeasurePoint } from '../model';
import { iconSvg } from '../icons';
import { candidate, coreBox, regionsIn, spawnBox } from '../structures/bedrock';
import { regionKey, regionTooClose, type EndCityState } from '../structures/endCities';

/** Structure boxes/pins are drawn from this zoom up (keeps the count of shapes small). */
export const STRUCT_MIN_ZOOM = -3;
import { esc, fmtNum } from '../dom';

export const MIN_ZOOM = -6;
export const MAX_ZOOM = 5;
/** Marker labels are always visible from this zoom up (else on hover/tap). */
export const LABEL_ZOOM = -1;

export interface MapEvents {
  onPick(p: { x: number; z: number }): void;
  onMarker(m: Marker): void;
  onMeasure(m: Measure | null): void;
  onCursor(p: { x: number; z: number } | null): void;
}

export function formatMeasure(m: Measure): { main: string; detail: string } {
  const flat = distance2D(m.a, m.b);
  const has3d = m.a.y != null && m.b.y != null;
  const d = has3d ? distance3D(m.a, m.b) : flat;
  const main = `${fmtNum(d)} blocks`;
  const parts: string[] = [];
  if (has3d) parts.push(`${fmtNum(flat)} horizontal`);
  if (m.dim === 'overworld') parts.push(`Nether travel ≈ ${fmtNum(netherTravelEquivalent(flat))}`);
  else if (m.dim === 'nether') parts.push(`Overworld equiv. ≈ ${fmtNum(flat * 8)}`);
  return { main, detail: parts.join(' · ') };
}

export class MapView {
  map: L.Map;
  biome: BiomeLayer;
  grid: GridLayer;
  private markerLayer = L.layerGroup();
  private ghostLayer = L.layerGroup();
  private measureLayer = L.layerGroup();
  private pickLayer = L.layerGroup();
  private searchLayer = L.layerGroup();
  private structLayer = L.layerGroup();
  private structRenderer = L.canvas({ padding: 0.2 });
  private structInput: { state: EndCityState; boxes: boolean; pins: boolean; onTap: (p: { x: number; z: number; type: string | null }) => void } | null = null;
  private markerEls = new Map<string, L.Marker>();
  measuring = false;
  private pendingA: MeasurePoint | null = null;
  selectedId: string | null = null;

  constructor(
    el: HTMLElement,
    private store: Store,
    client: BiomeClient,
    private mcResolved: () => number,
    private ev: MapEvents,
  ) {
    this.map = L.map(el, {
      crs: L.CRS.Simple,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      zoomSnap: 1,
      zoomDelta: 1,
      wheelPxPerZoomLevel: 90,
      attributionControl: false,
      zoomControl: false,
      tapTolerance: 12,
      preferCanvas: false,
    } as L.MapOptions);
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    const s = store.settings;
    this.biome = new BiomeLayer(client, { seed: s.seed, mc: mcResolved(), dim: s.dim });
    this.biome.addTo(this.map);
    this.grid = new GridLayer();
    this.grid.chunk = s.chunkGrid;
    this.grid.region = s.regionGrid;
    this.grid.addTo(this.map);
    this.ghostLayer.addTo(this.map);
    this.measureLayer.addTo(this.map);
    this.markerLayer.addTo(this.map);
    this.structLayer.addTo(this.map);
    this.searchLayer.addTo(this.map);
    this.pickLayer.addTo(this.map);

    this.map.on('click', (e: L.LeafletMouseEvent) => {
      const p = latLngToBlockInt(e.latlng);
      if (this.measuring) this.measureClick({ x: p.x, z: p.z, y: null });
      else this.ev.onPick(p);
    });
    this.map.on('mousemove', (e: L.LeafletMouseEvent) => this.ev.onCursor(latLngToBlockInt(e.latlng)));
    this.map.on('mouseout', () => this.ev.onCursor(null));
    this.map.on('zoomend', () => this.updateLabelClass());
    this.map.on('moveend', () => this.drawStructures());
    this.updateLabelClass();
  }

  private updateLabelClass(): void {
    this.map.getContainer().classList.toggle('labels-on', this.map.getZoom() >= LABEL_ZOOM);
  }

  get dim(): Dimension {
    return this.store.settings.dim;
  }

  refreshSource(): void {
    const s = this.store.settings;
    this.biome.setSource({ seed: s.seed, mc: this.mcResolved(), dim: s.dim });
  }

  refreshGrid(): void {
    this.grid.setVisible(this.store.settings.chunkGrid, this.store.settings.regionGrid);
  }

  // ---- view -----------------------------------------------------------------

  centerBlock(): { x: number; z: number } {
    return latLngToBlockInt(this.map.getCenter());
  }

  goTo(x: number, z: number, zoom?: number, animate = true): void {
    const ll = blockCenterLatLng(x, z);
    const zz = zoom ?? Math.max(this.map.getZoom(), 1);
    if (animate) this.map.flyTo(ll, zz, { duration: 0.6 });
    else this.map.setView(ll, zz, { animate: false });
  }

  showPick(p: { x: number; z: number } | null): void {
    this.pickLayer.clearLayers();
    if (!p) return;
    L.marker(blockCenterLatLng(p.x, p.z), {
      icon: L.divIcon({ className: 'pick', html: '<div class="pick-dot"></div>', iconSize: [18, 18] }),
      interactive: false,
      keyboard: false,
    }).addTo(this.pickLayer);
  }

  // ---- markers ----------------------------------------------------------------

  renderMarkers(): void {
    this.markerLayer.clearLayers();
    this.ghostLayer.clearLayers();
    this.markerEls.clear();
    const dim = this.dim;
    for (const m of this.store.markers) {
      const cat = this.store.category(m.categoryId);
      if (cat && !cat.visible) continue;
      const color = cat?.color ?? '#888';
      if (m.dim === dim) {
        const mk = L.marker(blockCenterLatLng(m.x, m.z), {
          icon: L.divIcon({
            className: 'mk-wrap' + (m.id === this.selectedId ? ' selected' : ''),
            html:
              `<div class="mk mk-${m.status}" style="--c:${color}">${iconSvg(cat?.icon ?? 'dot', 12)}</div>` +
              `<div class="mk-label">${esc(m.name)}</div>`,
            iconSize: [36, 36],
            iconAnchor: [18, 18],
          }),
          keyboard: true,
          title: m.name,
          riseOnHover: true,
        });
        mk.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          if (this.measuring) this.measureClick({ x: m.x, z: m.z, y: m.y });
          else this.ev.onMarker(m);
        });
        mk.addTo(this.markerLayer);
        this.markerEls.set(m.id, mk);
      } else if (m.showLinked) {
        // Linked portal position in the other dimension.
        const o = toOtherDimension(m.dim, m.x, m.z);
        if (!o || o.dim !== dim) continue;
        L.marker(blockCenterLatLng(o.x, o.z), {
          icon: L.divIcon({
            className: 'mk-wrap ghost',
            html:
              `<div class="mk mk-ghost" style="--c:${color}">${iconSvg('portal', 12)}</div>` +
              `<div class="mk-label">${esc(m.name)} (linked · ${o.x}, ${o.z})</div>`,
            iconSize: [36, 36],
            iconAnchor: [18, 18],
          }),
          title: `${m.name} — linked ${dim} position ${o.x}, ${o.z}`,
        })
          .on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            this.ev.onMarker(m);
          })
          .addTo(this.ghostLayer);
      }
    }
  }

  select(id: string | null): void {
    this.selectedId = id;
    this.renderMarkers();
  }

  // ---- measure ----------------------------------------------------------------

  setMeasuring(on: boolean): void {
    this.measuring = on;
    this.pendingA = null;
    this.map.getContainer().classList.toggle('measuring', on);
    this.renderMeasure();
  }

  private measureClick(p: MeasurePoint): void {
    if (!this.pendingA) {
      this.pendingA = p;
      this.renderMeasure();
      return;
    }
    const m: Measure = { dim: this.dim, a: this.pendingA, b: p };
    this.pendingA = null;
    this.ev.onMeasure(m);
  }

  renderMeasure(): void {
    this.measureLayer.clearLayers();
    const dot = (p: MeasurePoint) =>
      L.circleMarker(blockCenterLatLng(p.x, p.z), { radius: 4, weight: 1.5, className: 'measure-dot', interactive: false }).addTo(
        this.measureLayer,
      );
    if (this.pendingA) dot(this.pendingA);
    const m = this.store.settings.measure;
    if (!m || m.dim !== this.dim) return;
    const a = blockCenterLatLng(m.a.x, m.a.z);
    const b = blockCenterLatLng(m.b.x, m.b.z);
    L.polyline([a, b], { weight: 2, dashArray: '6 5', className: 'measure-line', interactive: false }).addTo(this.measureLayer);
    dot(m.a);
    dot(m.b);
    const { main } = formatMeasure(m);
    L.marker([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], {
      icon: L.divIcon({ className: 'measure-label', html: `<span>${esc(main)}</span>`, iconSize: [0, 0] }),
      interactive: false,
    }).addTo(this.measureLayer);
  }

  // ---- structure suggestions (End Cities) -----------------------------------------

  setStructures(input: MapView['structInput']): void {
    this.structInput = input;
    this.drawStructures();
  }

  private drawStructures(): void {
    this.structLayer.clearLayers();
    const inp = this.structInput;
    if (!inp || this.dim !== inp.state.kind.dim || (!inp.boxes && !inp.pins)) return;
    if (this.map.getZoom() < STRUCT_MIN_ZOOM) return;
    const { kind } = inp.state;
    const cfg = kind.cfg;
    const b = this.map.getBounds().pad(0.1);
    const x0 = b.getWest(), x1 = b.getEast(), z0 = -b.getNorth(), z1 = -b.getSouth();
    const core = coreBox(cfg);
    const r = this.structRenderer;
    const css = getComputedStyle(document.documentElement);
    const cssVar = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const color = cssVar('--struct', '#6f3f91');
    const found = cssVar('--struct-found', '#3f7a50');
    const typeColor: Record<string, string> = { bastion: cssVar('--bastion', '#a0701c'), fortress: cssVar('--fortress', '#8e2f2f') };
    for (const { rx, rz } of regionsIn(cfg, x0, z0, x1, z1)) {
      if (regionTooClose(kind, rx, rz)) continue;
      const done = inp.state.marked.has(regionKey(rx, rz));
      const rect = (inset: number) => {
        const s = spawnBox(cfg, rx, rz, inset);
        return L.latLngBounds([-s.z0, s.x0], [-s.z1, s.x1]);
      };
      if (inp.boxes) {
        L.rectangle(rect(0), { renderer: r, weight: 1, color: done ? found : color, opacity: 0.5, fill: false, dashArray: '4 4', interactive: false }).addTo(this.structLayer);
        // the centre-weighted core only exists for averaged (triangular) offsets
        if (!done && core.inset) L.rectangle(rect(core.inset), { renderer: r, weight: 0, fillColor: color, fillOpacity: 0.12, interactive: false }).addTo(this.structLayer);
      }
      if (inp.pins && inp.state.pinVariant && !done) {
        const p = candidate(cfg, inp.state.pinVariant.seed32, rx, rz);
        const c = (p.type && typeColor[p.type]) || color;
        L.circleMarker(blockCenterLatLng(p.x, p.z), {
          renderer: r,
          radius: p.type === 'bastion' ? 8 : 7,
          weight: 2,
          color: c,
          fillColor: c,
          fillOpacity: inp.state.unverified ? 0 : 0.4,
          dashArray: inp.state.unverified || inp.state.assessment.confidence === 'possible' ? '3 3' : undefined,
        })
          .on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            inp.onTap(p);
          })
          .addTo(this.structLayer);
      }
    }
  }

  // ---- biome search results ------------------------------------------------------

  showSearchHits(hits: { x: number; z: number }[], color: string, onTap: (i: number) => void): void {
    this.searchLayer.clearLayers();
    hits.forEach((h, i) => {
      L.marker(blockCenterLatLng(h.x, h.z), {
        icon: L.divIcon({
          className: 'hit-wrap',
          html: `<div class="hit" style="--c:${color}">${i + 1}</div>`,
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        }),
        title: `Result ${i + 1}: ${h.x}, ${h.z}`,
        zIndexOffset: 500,
      })
        .on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          onTap(i);
        })
        .addTo(this.searchLayer);
    });
  }

  clearSearchHits(): void {
    this.searchLayer.clearLayers();
  }

  /** Fits the view to the origin plus all hits. */
  fitPoints(pts: { x: number; z: number }[], padTopLeft: [number, number] = [0, 0], padBottomRight: [number, number] = [0, 0]): void {
    if (!pts.length) return;
    const b = L.latLngBounds(pts.map((p) => blockCenterLatLng(p.x, p.z)));
    this.map.flyToBounds(b, {
      maxZoom: 1,
      duration: 0.6,
      paddingTopLeft: L.point(padTopLeft[0] + 30, padTopLeft[1] + 30),
      paddingBottomRight: L.point(padBottomRight[0] + 30, padBottomRight[1] + 30),
    });
  }

  // ---- misc -------------------------------------------------------------------

  /** Leaflet latlng for a block, exposed for tests. */
  static latLngOf(x: number, z: number): [number, number] {
    return blockToLatLng(x, z);
  }
}
