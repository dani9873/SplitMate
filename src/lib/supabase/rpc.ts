import type { SupabaseClient } from '@supabase/supabase-js';

import { SyncTransportError, type RpcCall, type TransportErrorKind } from '@/db/sync/remote';

const DEFAULT_TIMEOUT_MS = 30_000;

/** Clase de fallo según el código HTTP de PostgREST (0 = la petición ni salió o se cortó). */
function kindForStatus(status: number): TransportErrorKind {
  if (status === 0) {
    return 'offline';
  }
  if (status === 401 || status === 403) {
    return 'auth';
  }
  if (status === 408 || status === 429 || status >= 500) {
    return 'server';
  }
  return 'protocol';
}

const MESSAGES: Record<TransportErrorKind, string> = {
  offline: 'Sin conexión con el servidor',
  timeout: 'El servidor tardó demasiado en responder',
  server: 'Error del servidor',
  auth: 'La sesión no es válida',
  protocol: 'El servidor rechazó la petición',
};

const transportError = (kind: TransportErrorKind) => new SyncTransportError(kind, MESSAGES[kind]);

/**
 * Llama a las RPC de sincronización con supabase-js, con tiempo límite, y traduce cualquier fallo
 * a `SyncTransportError`. Los mensajes son fijos: el del servidor y los argumentos pueden llevar
 * nombres y montos, así que no se copian a ningún error.
 */
export function createSupabaseRpc(
  client: SupabaseClient,
  options: { timeoutMs?: number } = {},
): RpcCall {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (name, args) => {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const { data, error, status } = await client
        .rpc(name, { ...args })
        .abortSignal(controller.signal);
      if (timedOut) {
        throw transportError('timeout');
      }
      if (error) {
        throw transportError(kindForStatus(status));
      }
      return data;
    } catch (error) {
      if (error instanceof SyncTransportError) {
        throw error;
      }
      throw transportError(timedOut ? 'timeout' : 'server');
    } finally {
      clearTimeout(timer);
    }
  };
}
