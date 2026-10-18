import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

import { logger } from '@/lib/logger';

import { INVITE_TOKEN_PATTERN } from './invite-link';

/**
 * El enlace de invitación que llegó y todavía no se usó. Vive en memoria (de ahí lo lee la pantalla
 * de unirse, sin que el token pase por la URL del router) y, con la hora, en `expo-secure-store`:
 * así sobrevive a registrarse con confirmación por correo, que puede cerrar la app. Vence en 1 hora
 * y se borra al usarlo. El token nunca va a un registro ni a un mensaje de error.
 */

/** Cuánto vale un enlace guardado: cubre el registro con confirmación por correo. */
export const PENDING_INVITE_TTL_MS = 60 * 60 * 1000;

/** Un reloj adelantado más que esto invalida lo guardado (una hora del futuro no es de fiar). */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

const KEY = 'splitmate.pending-invite';

export interface SecureValueStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

const storedSchema = z.strictObject({
  token: z.string().regex(INVITE_TOKEN_PATTERN),
  at: z.int(),
});

interface Pending {
  readonly token: string;
  readonly at: number;
}

const alive = (pending: Pending, now: number) =>
  now - pending.at < PENDING_INVITE_TTL_MS && pending.at - now <= MAX_CLOCK_SKEW_MS;

export function createPendingInviteStore(storage: SecureValueStore) {
  let memory: Pending | null = null;

  // Mensajes fijos y sin el error: el de una falla del almacén podría repetir el valor.
  const forget = async () => {
    try {
      await storage.deleteItemAsync(KEY);
    } catch {
      logger.warn('No se pudo borrar el enlace de invitación pendiente');
    }
  };

  return {
    /** Guarda el enlace que acaba de llegar. Uno nuevo reemplaza al anterior. */
    set(token: string, now: number = Date.now()): void {
      if (!INVITE_TOKEN_PATTERN.test(token)) {
        return;
      }
      memory = { token, at: now };
      storage.setItemAsync(KEY, JSON.stringify({ token, at: now })).catch(() => {
        logger.warn('No se pudo guardar el enlace de invitación pendiente');
      });
    },

    /** El token pendiente si sigue vigente en memoria; sin tocar el almacén. */
    peek(now: number = Date.now()): string | null {
      if (memory && alive(memory, now)) {
        return memory.token;
      }
      memory = null;
      return null;
    },

    /** Como `peek`, y si la memoria está vacía, lo busca en el almacén seguro (la app se reabrió). */
    async load(now: number = Date.now()): Promise<string | null> {
      const inMemory = this.peek(now);
      if (inMemory) {
        return inMemory;
      }
      let raw: string | null;
      try {
        raw = await storage.getItemAsync(KEY);
      } catch {
        logger.warn('No se pudo leer el enlace de invitación pendiente');
        return null;
      }
      if (raw === null) {
        return null;
      }
      let parsed: z.ZodSafeParseResult<Pending>;
      try {
        parsed = storedSchema.safeParse(JSON.parse(raw));
      } catch {
        parsed = { success: false } as z.ZodSafeParseResult<Pending>;
      }
      if (!parsed.success || !alive(parsed.data, now)) {
        await forget();
        return null;
      }
      memory = parsed.data;
      return parsed.data.token;
    },

    /** Borra del almacén el enlace guardado si ya venció o no tiene la forma esperada. */
    async purgeExpired(now: number = Date.now()): Promise<void> {
      await this.load(now);
    },

    /** Se usó (o se descartó): fuera de la memoria y del almacén. */
    async clear(): Promise<void> {
      memory = null;
      await forget();
    },
  };
}

const pendingInvite = createPendingInviteStore({
  getItemAsync: (key) => SecureStore.getItemAsync(key),
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value),
  deleteItemAsync: (key) => SecureStore.deleteItemAsync(key),
});

export const setPendingInvite = (token: string) => pendingInvite.set(token);
export const peekPendingInvite = () => pendingInvite.peek();
export const loadPendingInvite = () => pendingInvite.load();
export const clearPendingInvite = () => pendingInvite.clear();
export const purgeExpiredPendingInvite = () => pendingInvite.purgeExpired();
