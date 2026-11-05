import { describe, it, expect } from 'vitest';
import {
  blockToLatLng, latLngToBlock, latLngToBlockInt, blockCenterLatLng,
  overworldToNether, netherToOverworld, toOtherDimension,
  distance2D, distance3D, netherTravelEquivalent, parseCoords,
  chunkOf, regionOf, tileSpec, scaleForZoom, tileBlocks,
} from '../src/coords';

describe('block <-> map units', () => {
  it('maps X to lng and Z to -lat (north up)', () => {
    expect(blockToLatLng(1180, -2808)).toEqual([2808, 1180]);
    expect(blockToLatLng(0, 0)).toEqual([-0, 0]);
    expect(blockToLatLng(-5, 7)).toEqual([-7, -5]);
  });
  it('round-trips', () => {
    for (const [x, z] of [[0, 0], [1180, -2808], [-1, -1], [123456, -98765]]) {
      const [lat, lng] = blockToLatLng(x, z);
      expect(latLngToBlock({ lat, lng })).toEqual({ x, z });
    }
  });
  it('floors fractional positions to the containing block', () => {
    expect(latLngToBlockInt({ lat: 2807.5, lng: 1180.9 })).toEqual({ x: 1180, z: -2808 });
    expect(latLngToBlockInt({ lat: 0.2, lng: -0.2 })).toEqual({ x: -1, z: -1 });
    const [lat, lng] = blockCenterLatLng(-3, 4);
    expect(latLngToBlockInt({ lat, lng })).toEqual({ x: -3, z: 4 });
  });
});

describe('Overworld <-> Nether', () => {
  it('uses floor division for negatives', () => {
    expect(overworldToNether(1180, -2808)).toEqual({ x: 147, z: -351 });
    expect(overworldToNether(-1, -1)).toEqual({ x: -1, z: -1 });
    expect(overworldToNether(-8, -9)).toEqual({ x: -1, z: -2 });
    expect(overworldToNether(-2801, 7)).toEqual({ x: -351, z: 0 });
    expect(overworldToNether(8, 15)).toEqual({ x: 1, z: 1 });
  });
  it('multiplies by 8 going back', () => {
    expect(netherToOverworld(147, -351)).toEqual({ x: 1176, z: -2808 });
    expect(toOtherDimension('nether', -2, 3)).toEqual({ dim: 'overworld', x: -16, z: 24 });
    expect(toOtherDimension('overworld', -2808, 0)).toEqual({ dim: 'nether', x: -351, z: 0 });
  });
});

describe('distances', () => {
  const a = { x: 1180, y: -5, z: -2808 };
  const b = { x: 1204, y: -1, z: -2807 };
  it('dungeon measure reads ~24.4 blocks (3D)', () => {
    expect(distance3D(a, b)).toBeCloseTo(24.35, 2);
    expect(Math.round(distance3D(a, b) * 10) / 10).toBe(24.4);
    expect(distance2D(a, b)).toBeCloseTo(24.02, 2);
    expect(netherTravelEquivalent(distance2D(a, b))).toBeCloseTo(3.0, 1);
  });
  it('3D falls back to 2D when Y missing', () => {
    expect(distance3D({ x: 0, z: 0, y: null }, { x: 3, z: 4, y: 10 })).toBe(5);
  });
});

describe('parsing & grids', () => {
  it('parses coordinate input', () => {
    expect(parseCoords('1180, -2808')).toEqual({ x: 1180, y: null, z: -2808 });
    expect(parseCoords('1180 -5 -2808')).toEqual({ x: 1180, y: -5, z: -2808 });
    expect(parseCoords('x=1 z=2')).toEqual({ x: 1, y: null, z: 2 });
    expect(parseCoords('village')).toBeNull();
  });
  it('chunk/region', () => {
    expect(chunkOf(1180, -2808)).toEqual({ x: 73, z: -176 });
    expect(chunkOf(-1, -16)).toEqual({ x: -1, z: -1 });
    expect(regionOf(-1, 511)).toEqual({ x: -1, z: 0 });
  });
  it('tile specs cover exactly their block range', () => {
    for (let z = -6; z <= 5; z++) {
      const s = tileSpec(-3, 2, z);
      expect(s.cells * s.scale).toBe(tileBlocks(z));
      expect(s.cx * s.scale).toBe(-3 * tileBlocks(z));
      expect(s.cz * s.scale).toBe(2 * tileBlocks(z));
      expect(s.cells).toBeLessThanOrEqual(128);
      expect([1, 4, 16, 64, 256]).toContain(scaleForZoom(z));
    }
  });
});
