import {
  pullResponseSchema,
  pushResponseSchema,
  type Mutation,
  type PullCursor,
  type PullResponse,
  type PushResult,
} from './wire';

export type RpcName =
  | 'sync_push'
  | 'sync_pull_v2'
  | 'create_invitation'
  | 'preview_invitation'
  | 'accept_invitation'
  | 'revoke_invitation'
  | 'list_invitations'
  | 'leave_group'
  | 'remove_access';

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
  /**
   * Pide lo nuevo desde los cursores. Hay que mandar el cursor de **todos** los grupos que tiene el
   * teléfono: el servidor descarga desde 0 el que falte. `maxRows` acota la página.
   */
  pull(cursors: Readonly<Record<string, PullCursor>>, maxRows: number): Promise<PullResponse>;
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
        await call('sync_pull_v2', { p_cursors: cursors, p_max_rows: maxRows }),
      );
      if (!parsed.success) {
        throw protocolError();
      }
      // C5: el servidor nunca manda más de lo pedido. Una respuesta que pasa los topes se rechaza
      // entera, antes de tocar la base.
      const requested = new Set(Object.keys(cursors).map((id) => id.toLowerCase()));
      const { groups, lost } = parsed.data;
      const rows = groups.reduce((total, group) => total + group.rows.length, 0);
      const ids = groups.map((group) => group.id.toLowerCase());
      const lostIds = lost.map((id) => id.toLowerCase());
      if (
        rows > maxRows ||
        groups.length > maxRows ||
        new Set(ids).size !== ids.length ||
        new Set(lostIds).size !== lostIds.length ||
        lostIds.some((id) => !requested.has(id)) ||
        // Una página parcial es la única de la llamada.
        (groups.some((group) => group.partial) && groups.length !== 1)
      ) {
        throw protocolError();
      }
      return parsed.data;
    },
  };
}
