// Convierte los tokens de color en variables CSS para NativeWind.
// Lo usan tailwind.config.js (Node) y la app (Metro), por eso es CommonJS.

/** @param {string} token `surfaceMuted` → `--color-surface-muted` */
function toCssVariableName(token) {
  return `--color-${toKebabCase(token)}`;
}

/** @param {string} token `surfaceMuted` → `surface-muted` */
function toKebabCase(token) {
  return token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** @param {string} hex `#0E6B5E` → `14 107 94`, formato que admite `<alpha-value>`. */
function toRgbChannels(hex) {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((start) => parseInt(value.slice(start, start + 2), 16)).join(' ');
}

/**
 * @param {Record<string, string>} colors
 * @returns {Record<string, string>}
 */
function toCssVariables(colors) {
  return Object.fromEntries(
    Object.entries(colors).map(([token, hex]) => [toCssVariableName(token), toRgbChannels(hex)]),
  );
}

module.exports = { toCssVariableName, toCssVariables, toKebabCase, toRgbChannels };
