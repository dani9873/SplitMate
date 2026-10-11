/**
 * Colores de grupo. Se guardan como clave, no como hexadecimal: cada clave tiene variantes
 * para tema claro y oscuro con contraste comprobado en `src/ui/theme/group-colors.json`.
 */
export const GROUP_COLORS = [
  'teal',
  'coral',
  'amber',
  'plum',
  'sky',
  'olive',
  'rose',
  'slate',
] as const;

export type GroupColor = (typeof GROUP_COLORS)[number];

export const DEFAULT_GROUP_COLOR: GroupColor = 'teal';

/** Emojis ofrecidos para un grupo: viajes, casa, comidas y planes habituales. */
export const GROUP_EMOJIS = [
  '🏖️',
  '✈️',
  '🏔️',
  '🏕️',
  '🚗',
  '🏠',
  '🛒',
  '🍕',
  '🍻',
  '☕',
  '🎉',
  '🎂',
  '🎁',
  '⚽',
  '🎮',
  '🎵',
  '💼',
  '📚',
  '🐶',
  '👶',
  '💡',
  '🏥',
  '💰',
  '⭐',
] as const;

/** Largo máximo en unidades UTF-16: un emoji con modificadores cabe con holgura. */
export const MAX_EMOJI_LENGTH = 16;
