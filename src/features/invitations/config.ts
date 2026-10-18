/**
 * El dominio de los enlaces de invitación (`https://<dominio>/i#<token>`). Es un valor público: se
 * pone en `EXPO_PUBLIC_INVITE_HOST` al compilar (en EAS, en las variables de entorno del build). Sin
 * él queda el marcador `<dominio>`: los enlaces https no se reconocen ni se arman, y las
 * invitaciones circulan con el esquema propio de la app (`splitmate://i#<token>`).
 */
export const INVITE_PLACEHOLDER_HOST = '<dominio>';

export const INVITE_HOST: string =
  (process.env.EXPO_PUBLIC_INVITE_HOST ?? '').trim().toLowerCase() || INVITE_PLACEHOLDER_HOST;

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** ¿Es un dominio de verdad (y no el marcador)? Sin esquema, puerto ni ruta. */
export function isInviteHostConfigured(host: string = INVITE_HOST): boolean {
  return HOSTNAME.test(host.toLowerCase());
}
