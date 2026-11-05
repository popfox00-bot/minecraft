// Muted, low-saturation biome palette (flat colors, no textures).
// Keys are cubiomes biome ids (Java numeric ids, 1.18+ naming).

export const BIOME_COLORS: Record<number, string> = {
  // water
  0: '#8fa9c2', // ocean
  24: '#7d97b1', // deep_ocean
  44: '#97b7c4', // warm_ocean
  45: '#92adc3', // lukewarm_ocean
  48: '#809cb3', // deep_lukewarm_ocean
  46: '#8ea4bd', // cold_ocean
  49: '#7c92ab', // deep_cold_ocean
  10: '#a8b8c9', // frozen_ocean
  50: '#93a3b6', // deep_frozen_ocean
  7: '#9db5c9', // river
  11: '#b4c3d1', // frozen_river
  // shores
  16: '#ddd5b8', // beach
  26: '#e3e2da', // snowy_beach
  25: '#b2b0a8', // stony_shore
  // temperate
  1: '#c4cfa3', // plains
  129: '#cbd3a0', // sunflower_plains
  177: '#bccca4', // meadow
  4: '#a3b48c', // forest
  132: '#b2bc94', // flower_forest
  27: '#b0bf96', // birch_forest
  155: '#a7b98f', // old_growth_birch_forest
  29: '#8b9a7c', // dark_forest
  186: '#b3b6ae', // pale_garden
  185: '#d8c3c8', // cherry_grove
  6: '#99a58c', // swamp
  184: '#8f9f84', // mangrove_swamp
  14: '#bfaab6', // mushroom_fields
  // cold
  5: '#9eae94', // taiga
  32: '#93a28b', // old_growth_pine_taiga
  160: '#8e9d87', // old_growth_spruce_taiga
  30: '#c7d0cb', // snowy_taiga
  12: '#e4e7e6', // snowy_plains
  140: '#d6e0e6', // ice_spikes
  178: '#cfd8d4', // grove
  179: '#e8ebec', // snowy_slopes
  180: '#dfe3e6', // jagged_peaks
  181: '#d3dce4', // frozen_peaks
  182: '#b8b6b0', // stony_peaks
  3: '#b0b4a6', // windswept_hills
  34: '#9eaa96', // windswept_forest
  131: '#b4b4ad', // windswept_gravelly_hills
  // warm / dry
  2: '#e2d6b0', // desert
  35: '#d4cfa2', // savanna
  36: '#cbc69b', // savanna_plateau
  163: '#c9c3a0', // windswept_savanna
  37: '#d4ab90', // badlands
  38: '#c8aa8f', // wooded_badlands
  165: '#d9a68c', // eroded_badlands
  21: '#9cb48a', // jungle
  23: '#acc096', // sparse_jungle
  168: '#a2b98a', // bamboo_jungle
  // caves (only when sampling below surface)
  174: '#a9a39a', // dripstone_caves
  175: '#a7b897', // lush_caves
  183: '#5f6a70', // deep_dark
  // nether
  8: '#a77d74', // nether_wastes
  170: '#a99a86', // soul_sand_valley
  171: '#b0767a', // crimson_forest
  172: '#6f9c97', // warped_forest
  173: '#8c8a8e', // basalt_deltas
};

export const UNKNOWN_COLOR = '#d0d0d0';

/** "old_growth_pine_taiga" -> "Old Growth Pine Taiga" */
export function prettyBiome(name: string): string {
  if (!name) return 'Unknown';
  return name
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** RGBA lookup table for fast tile painting. */
export function buildRgbaLut(): Uint32Array {
  const lut = new Uint32Array(256);
  const parse = (hex: string) => {
    const v = parseInt(hex.slice(1), 16);
    const r = (v >> 16) & 255,
      g = (v >> 8) & 255,
      b = v & 255;
    // little-endian ImageData: ABGR in a Uint32
    return (255 << 24) | (b << 16) | (g << 8) | r;
  };
  for (let i = 0; i < 256; i++) lut[i] = parse(BIOME_COLORS[i] ?? UNKNOWN_COLOR) >>> 0;
  return lut;
}
