// Small built-in icon set: simple stroke glyphs on a 16x16 grid, drawn in
// white over the marker's colored circle. Keep them thin and flat.

export const ICONS = {
  dot: '<circle cx="8" cy="8" r="2.2" fill="currentColor" stroke="none"/>',
  house: '<path d="M3 8 8 3.5 13 8M4.5 7v5.5h7V7"/>',
  cage: '<rect x="3.5" y="3.5" width="9" height="9"/><path d="M6.5 3.5v9M9.5 3.5v9"/>',
  bell: '<path d="M5 11V7.5a3 3 0 0 1 6 0V11M4 11h8M8 12.5v.5"/>',
  portal: '<rect x="4.5" y="2.5" width="7" height="11" rx="0.5"/><path d="M6.5 5.5v5M9.5 5.5v5"/>',
  key: '<circle cx="5.5" cy="8" r="2.3"/><path d="M7.8 8H13M11 8v2M12.8 8v1.5"/>',
  skull: '<path d="M4 7.5a4 4 0 0 1 8 0V10H10v2.5H6V10H4z"/><path d="M6.5 8h.01M9.5 8h.01"/>',
  eye: '<path d="M2.5 8S5 4.5 8 4.5 13.5 8 13.5 8 11 11.5 8 11.5 2.5 8 2.5 8z"/><circle cx="8" cy="8" r="1.4"/>',
  trident: '<path d="M8 13.5V4M4.5 3v3.5a3.5 3.5 0 0 0 7 0V3"/>',
  tower: '<path d="M4.5 13.5V5.5h7v8M4.5 5.5v-2h1.5v1h1v-1h2v1h1v-1h1.5v2M7 13.5v-3h2v3"/>',
  wheat: '<path d="M8 13.5V5M8 6 6 4.5M8 6l2-1.5M8 8.5 6 7M8 8.5 10 7M8 11 6 9.5M8 11l2-1.5"/>',
  star: '<path d="m8 3 1.5 3.2 3.4.4-2.5 2.3.7 3.4L8 10.6l-3.1 1.7.7-3.4-2.5-2.3 3.4-.4z"/>',
  pick: '<path d="M3.5 6.5C6 3 10 3 12.5 6.5M8 4.5l-4.5 9"/>',
  sword: '<path d="M12.5 3.5 6 10M3.5 12.5 6 10M4.5 8.5l3 3"/>',
  chest: '<rect x="3" y="5" width="10" height="7.5"/><path d="M3 8h10M8 7.5v2"/>',
  flag: '<path d="M4.5 13.5v-10M4.5 3.5h7l-1.5 2.5 1.5 2.5h-7"/>',
  heart: '<path d="M8 12.5 3.5 8a2.5 2.5 0 0 1 4.5-3 2.5 2.5 0 0 1 4.5 3z"/>',
  ship: '<path d="M2.5 10h11l-2 3h-7zM8 10V3l4 5H8"/>',
} as const;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export function iconSvg(name: IconName, size = 12): string {
  const body = ICONS[name] ?? ICONS.dot;
  return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
