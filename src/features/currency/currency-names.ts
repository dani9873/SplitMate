const names = new Map<string, string>();

type DisplayNamesConstructor = new (
  locales: string[],
  options: { type: 'currency' },
) => { of(code: string): string | undefined };

/**
 * Nombre de la moneda en el idioma pedido, como "peso colombiano". Usa `Intl.DisplayNames`
 * si el motor lo tiene; si no, el nombre largo de `Intl.NumberFormat`; y si tampoco, el
 * código. Se guarda en caché por idioma.
 */
export function currencyName(code: string, locale: string): string {
  const key = `${locale}|${code}`;
  const cached = names.get(key);
  if (cached) {
    return cached;
  }
  const name = displayName(code, locale) ?? numberFormatName(code, locale) ?? code;
  names.set(key, name);
  return name;
}

function displayName(code: string, locale: string): string | undefined {
  const DisplayNames = (Intl as { DisplayNames?: DisplayNamesConstructor }).DisplayNames;
  if (!DisplayNames) {
    return undefined;
  }
  try {
    const name = new DisplayNames([locale], { type: 'currency' }).of(code);
    return name && name !== code ? name : undefined;
  } catch {
    return undefined;
  }
}

function numberFormatName(code: string, locale: string): string | undefined {
  try {
    const text = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'name',
      maximumFractionDigits: 0,
    }).format(2);
    const name = text.replace(/[\d\s.,]+/g, ' ').trim();
    return name && name !== code ? name : undefined;
  } catch {
    return undefined;
  }
}

/** Texto en minúsculas y sin tildes, para buscar sin importar cómo se escribió. */
export function normalizeForSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
