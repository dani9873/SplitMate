import { INVITE_HOST, isInviteHostConfigured } from './config';

/**
 * Los enlaces de invitación: `https://<dominio>/i#<token>` y, como respaldo, `splitmate://i#<token>`.
 * El token (43 caracteres base64url, 256 bits) va en el fragmento: ni el navegador ni el servidor de
 * la página de respaldo lo reciben. Todo texto que llega de fuera (un enlace que abre la app o uno
 * que se pega) se valida aquí antes de que lo lea nadie más. El token nunca se escribe en un
 * registro ni en un mensaje de error.
 */

export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Un enlace de invitación mide unos 80 caracteres; más de esto no es uno. */
export const MAX_INVITE_LINK_LENGTH = 256;

/** Un mensaje pegado (con su enlace dentro) no se interpreta si es más largo que esto. */
export const MAX_PASTED_TEXT_LENGTH = 2048;

export interface InviteLinkOptions {
  /** El dominio de los enlaces https; por omisión, el configurado. */
  readonly host?: string;
}

interface ParseOptions extends InviteLinkOptions {
  /** Acepta también el token solo (al pegarlo en «Unirme con un enlace»). */
  readonly allowBare?: boolean;
}

// Sin usuario, puerto ni ruta de más: el host es exactamente el configurado.
const HTTPS_LINK = /^https:\/\/([^/?#@:\s]+)\/i\/?#([^#]*)$/i;
const SCHEME_LINK = /^splitmate:\/\/\/?i\/?#([^#]*)$/i;
const HTTPS_IN_TEXT = /https:\/\/([^/?#@:\s]+)\/i\/?#([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/gi;
const SCHEME_IN_TEXT = /splitmate:\/\/\/?i\/?#([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/i;

const hostMatches = (candidate: string, host: string) =>
  isInviteHostConfigured(host) && candidate.toLowerCase() === host.toLowerCase();

/**
 * El token de un enlace de invitación, o `null` si el texto no es exactamente uno: mismo dominio,
 * ruta `/i`, sin consulta, y el token en el fragmento con su forma.
 */
export function parseInviteLink(text: string, options: ParseOptions = {}): string | null {
  const host = options.host ?? INVITE_HOST;
  const link = text.trim();
  if (link.length === 0 || link.length > MAX_INVITE_LINK_LENGTH) {
    return null;
  }
  if (options.allowBare && INVITE_TOKEN_PATTERN.test(link)) {
    return link;
  }
  const https = HTTPS_LINK.exec(link);
  if (https && hostMatches(https[1] as string, host)) {
    return INVITE_TOKEN_PATTERN.test(https[2] as string) ? (https[2] as string) : null;
  }
  const scheme = SCHEME_LINK.exec(link);
  if (scheme) {
    return INVITE_TOKEN_PATTERN.test(scheme[1] as string) ? (scheme[1] as string) : null;
  }
  return null;
}

/**
 * El token de un texto pegado, que puede traer palabras alrededor (un mensaje de WhatsApp con el
 * enlace dentro). Solo cuenta un enlace del dominio configurado, uno con el esquema propio o el
 * token solo.
 */
export function findInviteToken(text: string, options: InviteLinkOptions = {}): string | null {
  const host = options.host ?? INVITE_HOST;
  if (text.length === 0 || text.length > MAX_PASTED_TEXT_LENGTH) {
    return null;
  }
  const whole = parseInviteLink(text, { host, allowBare: true });
  if (whole) {
    return whole;
  }
  for (const match of text.matchAll(HTTPS_IN_TEXT)) {
    if (hostMatches(match[1] as string, host)) {
      return match[2] as string;
    }
  }
  return SCHEME_IN_TEXT.exec(text)?.[1] ?? null;
}

/**
 * El token de un enlace que abre la app desde fuera (un App Link o el esquema propio). Un token
 * suelto o una ruta cualquiera no son un enlace de invitación.
 */
export function resolveIncomingInvite(
  link: string,
  options: InviteLinkOptions = {},
): string | null {
  return parseInviteLink(link, { host: options.host ?? INVITE_HOST, allowBare: false });
}

/** El enlace para compartir: https si hay dominio configurado; si no, el esquema propio. */
export function buildInviteLink(token: string, options: InviteLinkOptions = {}): string {
  if (!INVITE_TOKEN_PATTERN.test(token)) {
    throw new Error('El token de la invitación no tiene la forma esperada');
  }
  const host = options.host ?? INVITE_HOST;
  return isInviteHostConfigured(host) ? `https://${host}/i#${token}` : buildSchemeInviteLink(token);
}

/** El enlace con el esquema propio: abre la app (instalada) sin pasar por la página web. */
export function buildSchemeInviteLink(token: string): string {
  if (!INVITE_TOKEN_PATTERN.test(token)) {
    throw new Error('El token de la invitación no tiene la forma esperada');
  }
  return `splitmate://i#${token}`;
}

export { isInviteHostConfigured };
