import * as Crypto from 'expo-crypto';

import { createIdGenerator } from '@/lib/ids';

import type { RepositoryDeps } from './repositories';

/**
 * Reloj e ids de la app. Un solo generador para toda la app, así los UUID v7 son
 * estrictamente crecientes también dentro del mismo milisegundo.
 */
export const appRepositoryDeps: RepositoryDeps = {
  now: () => Date.now(),
  newId: createIdGenerator({
    now: () => Date.now(),
    randomBytes: (length) => Crypto.getRandomBytes(length),
  }),
};
