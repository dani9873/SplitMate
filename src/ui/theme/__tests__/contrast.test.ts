import { GROUP_COLORS } from '@/lib/group-appearance';

import { groupPalette, palette, type ColorScheme, type ColorToken } from '../tokens';

/** Luminancia relativa de WCAG 2.2. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r, g, b] = channels.map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

// Texto normal: 4,5:1. Íconos, barras y texto grande (teclado, cifras grandes): 3:1.
const TEXT = 4.5;
const GRAPHIC = 3;

const surfaces: ColorToken[] = ['background', 'surface', 'surfaceMuted'];

const pairs: [ColorToken, ColorToken, number][] = [
  ...(['fg', 'fgMuted', 'fgSubtle', 'primary', 'positive', 'negative', 'warning'] as const).flatMap(
    (text) => surfaces.map((bg): [ColorToken, ColorToken, number] => [text, bg, TEXT]),
  ),
  ['fg', 'primarySoft', TEXT],
  ['primary', 'primarySoft', TEXT],
  ['positive', 'positiveSoft', TEXT],
  ['negative', 'negativeSoft', TEXT],
  ['warning', 'warningSoft', TEXT],
  ['fg', 'accentSoft', TEXT],
  ['accentStrong', 'accentSoft', TEXT],
  ...surfaces.map((bg): [ColorToken, ColorToken, number] => ['accentStrong', bg, TEXT]),
  ['onPrimary', 'primary', TEXT],
  ['onPrimary', 'primaryPressed', TEXT],
  ['onDanger', 'danger', TEXT],
  ['onAccent', 'accent', TEXT],
  ['lineStrong', 'surface', GRAPHIC],
  ['lineStrong', 'background', GRAPHIC],
  ['primary', 'background', GRAPHIC],
  ['positive', 'background', GRAPHIC],
  ['negative', 'background', GRAPHIC],
  ['accent', 'surface', GRAPHIC],
];

describe.each<ColorScheme>(['light', 'dark'])('contraste AA en tema %s', (scheme) => {
  const colors = palette[scheme];

  it.each(pairs)('%s sobre %s', (fg, bg, minimum) => {
    expect(contrast(colors[fg], colors[bg])).toBeGreaterThanOrEqual(minimum);
  });

  it.each([...GROUP_COLORS])('la inicial del grupo %s se lee sobre su fondo', (color) => {
    const swatch = groupPalette[scheme][color];
    expect(contrast(swatch.ink, swatch.tile)).toBeGreaterThanOrEqual(TEXT);
  });
});

it('calcula el contraste de referencia de WCAG', () => {
  expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
});
