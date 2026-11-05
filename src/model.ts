import type { Dimension } from './coords';
import type { IconName } from './icons';

export type Status = 'planned' | 'found' | 'built' | 'looted';
export const STATUSES: Status[] = ['planned', 'found', 'built', 'looted'];

export interface Marker {
  id: string;
  name: string;
  categoryId: string;
  x: number;
  y: number | null;
  z: number;
  dim: Dimension;
  notes: string;
  status: Status;
  /** ISO timestamp */
  createdAt: string;
  /** Show this marker's linked portal position in the other dimension. */
  showLinked: boolean;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  icon: IconName;
  visible: boolean;
  order: number;
}

export interface MeasurePoint {
  x: number;
  z: number;
  y?: number | null;
}

export interface Measure {
  dim: Dimension;
  a: MeasurePoint;
  b: MeasurePoint;
}

export interface Settings {
  seed: string;
  /** cubiomes MCVersion enum value; 0 = newest supported */
  mc: number;
  theme: 'light' | 'dark' | 'system';
  chunkGrid: boolean;
  regionGrid: boolean;
  /** marker id used as distance reference; null = first Base marker */
  referenceId: string | null;
  dim: Dimension;
  measure: Measure | null;
  view: { x: number; z: number; zoom: number } | null;
}

export const DEFAULT_SEED = '-2829401596156382806';

export const DEFAULT_SETTINGS: Settings = {
  seed: DEFAULT_SEED,
  mc: 0,
  theme: 'system',
  chunkGrid: true,
  regionGrid: true,
  referenceId: null,
  dim: 'overworld',
  measure: null,
  view: null,
};

/** cubiomes MCVersion values for the 1.18+ (noise-based, Bedrock-parity) generators. */
export const VERSIONS: { mc: number; label: string }[] = [
  { mc: 0, label: 'Newest supported (Java 1.21.4+ / Winter Drop)' },
  { mc: 27, label: 'Java 1.21.2–1.21.3' },
  { mc: 26, label: 'Java 1.21–1.21.1' },
  { mc: 25, label: 'Java 1.20' },
  { mc: 24, label: 'Java 1.19.3–1.19.4' },
  { mc: 23, label: 'Java 1.19–1.19.2' },
  { mc: 22, label: 'Java 1.18' },
];

const DEFAULT_CATS: [string, string, IconName][] = [
  ['Base', '#d1495b', 'house'],
  ['Spawner', '#7a5c99', 'cage'],
  ['Village', '#c8963e', 'bell'],
  ['Portal', '#8e44ad', 'portal'],
  ['Trial Chamber', '#c06c34', 'key'],
  ['Ancient City', '#2f6f73', 'skull'],
  ['Stronghold', '#5b6770', 'eye'],
  ['Monument', '#2e86ab', 'trident'],
  ['Mansion', '#6b4f3a', 'tower'],
  ['Farm', '#5c946e', 'wheat'],
  ['Point of Interest', '#e0a100', 'star'],
];

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cat';
}

export function defaultCategories(): Category[] {
  return DEFAULT_CATS.map(([name, color, icon], order) => ({
    id: slug(name),
    name,
    color,
    icon,
    visible: true,
    order,
  }));
}

export function newId(): string {
  return crypto.randomUUID();
}

export function seedMarkers(now = new Date().toISOString()): Marker[] {
  return [
    {
      id: newId(),
      name: 'Dungeon A',
      categoryId: 'spawner',
      x: 1180,
      y: -5,
      z: -2808,
      dim: 'overworld',
      notes: '',
      status: 'found',
      createdAt: now,
      showLinked: false,
    },
    {
      id: newId(),
      name: 'Dungeon B',
      categoryId: 'spawner',
      x: 1204,
      y: -1,
      z: -2807,
      dim: 'overworld',
      notes: '',
      status: 'found',
      createdAt: now,
      showLinked: false,
    },
  ];
}

export function seedMeasure(): Measure {
  return { dim: 'overworld', a: { x: 1180, y: -5, z: -2808 }, b: { x: 1204, y: -1, z: -2807 } };
}
