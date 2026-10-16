import {
  pullResponseSchema,
  pushResponseSchema,
  type Mutation,
  type PullResponse,
  type PushResult,
} from './wire';

export type RpcName = 'sync_push' | 'sync_pull';

/** Una llamada a una RPC del servidor: la inyecta quien tiene el cliente de red. */
export type RpcCall = (name: RpcName, args: Readonly<Record<string, unknown>>) => Promise<unknown>;

/**
 * Por qué no hubo respuesta útil:
 * - `offline`: no hay red; `timeout`: el servidor no contestó a tiempo.
 * - `server`: error del servidor (5xx, límite de peticiones) u otro fallo inesperado.
 * - `auth`: la sesión no vale (401 o 403).
 * - `protocol`: la respuesta o el sobre no cumplen el contrato; reintentar igual no sirve.
 */
export type TransportErrorKind = 'offline' | 'timeout' | 'server' | 'auth' | 'protocol';

/** El mensaje nunca lleva datos del usuario: ni lo enviado ni lo que contestó el servidor. */
export class SyncTransportError extends Error {
  readonly kind: TransportErrorKind;

  constructor(kind: TransportErrorKind, message: string) {
    super(message);
    this.name = 'SyncTransportError';
    this.kind = kind;
  }
}

export interface SyncRemote {
  /** Envía los cambios y devuelve un resultado por envío, en el orden en que se mandaron. */
  push(mutations: readonly Mutation[]): Promise<PushResult[]>;
  /** Pide lo nuevo de cada grupo desde su cursor; `maxRows` acota el tamaño de la página. */
  pull(cursors: Readonly<Record<string, number>>, maxRows: number): Promise<PullResponse>;
}

const protocolError = () =>
  new SyncTransportError('protocol', 'La respuesta del servidor no cumple el contrato');

export function createSyncRemote(rpc: RpcCall): SyncRemote {
  /** Deja pasar los errores de transporte y clasifica cualquier otro como error del servidor. */
  async function call(name: RpcName, args: Readonly<Record<string, unknown>>): Promise<unknown> {
    try {
      return await rpc(name, args);
    } catch (error) {
      if (error instanceof SyncTransportError) {
        throw error;
      }
      throw new SyncTransportError('server', 'Error inesperado al hablar con el servidor');
    }
  }

  return {
    async push(mutations) {
      if (mutations.length === 0) {
        return [];
      }
      const parsed = pushResponseSchema.safeParse(
        await call('sync_push', { p_mutations: mutations }),
      );
      if (!parsed.success) {
        throw protocolError();
      }
      // Exactamente un resultado por envío: ni de menos, ni repetidos, ni de uno que no se mandó.
      const byId = new Map<string, PushResult>(parsed.data.map((result) => [result.id, result]));
      if (parsed.data.length !== mutations.length || byId.size !== mutations.length) {
        throw protocolError();
      }
      return mutations.map((mutation) => {
        const result = byId.get(mutation.id);
        if (!result) {
          throw protocolError();
        }
        return result;
      });
    },

    async pull(cursors, maxRows) {
      const parsed = pullResponseSchema.safeParse(
        await call('sync_pull', { p_cursors: cursors, p_max_rows: maxRows }),
      );
      if (!parsed.success) {
        throw protocolError();
      }
      return parsed.data;
    },
  };
}
