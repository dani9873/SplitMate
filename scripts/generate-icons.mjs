// Genera los íconos de la app y las imágenes del splash a partir del logo en SVG.
// Uso: npm run icons
//
// El logo vive en assets/brand/logo.svg: un lienzo de 1024 × 1024 con fondo
// transparente y los colores primary y accent del tema claro. Para el modo oscuro
// se cambian por los tonos equivalentes del tema oscuro.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';

const colors = JSON.parse(readFileSync('src/ui/theme/colors.json', 'utf8'));
const logo = readFileSync('assets/brand/logo.svg', 'utf8');
const mark = logo.slice(logo.indexOf('>') + 1, logo.lastIndexOf('</svg>'));

const replaceColors = (content, map) =>
  Object.entries(map).reduce((result, [from, to]) => result.replaceAll(from, to), content);

const darkMark = replaceColors(mark, {
  [colors.light.primary]: colors.dark.primary,
  [colors.light.accent]: colors.dark.accent,
});
// Ícono temático de Android 13+: una sola tinta que el sistema colorea.
const monochromeMark = mark.replace(/#[0-9a-f]{6}/gi, '#FFFFFF');

/** Coloca la marca en un lienzo de 1024, escalada hacia el centro y con fondo opcional. */
function canvas(content, { background, scale = 1 } = {}) {
  const offset = 512 * (1 - scale);
  const fill = background ? `<rect width="1024" height="1024" fill="${background}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${fill}<g transform="translate(${offset} ${offset}) scale(${scale})">${content}</g></svg>`;
}

function render(svg, output) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } }).render().asPng();
  writeFileSync(output, png);
  console.log(`✓ ${output}`);
}

// iOS no admite transparencia en el ícono: fondo de papel.
render(canvas(mark, { background: colors.light.background }), 'assets/images/icon.png');
// Android adaptativo: la marca debe caber en la zona segura circular (66 de 108 dp).
render(canvas(mark, { scale: 0.88 }), 'assets/images/adaptive-icon.png');
render(canvas(monochromeMark, { scale: 0.88 }), 'assets/images/adaptive-icon-monochrome.png');
// Splash: marca sobre fondo transparente; el color de fondo lo pone app.json.
render(canvas(mark), 'assets/images/splash-icon.png');
render(canvas(darkMark), 'assets/images/splash-icon-dark.png');
