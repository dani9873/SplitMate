/// <reference types="node" />
// Tipos de Node solo para este archivo: corre en Jest (entorno node), nunca en la app.
import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';

import { SyncTransportError, type RpcCall } from '@/db/sync/remote';

/**
 * Servidor de Supabase de pruebas: Postgres real (PGlite, en WASM) con las migraciones de
 * `supabase/migrations`, para probar la sincronización de punta a punta sin red ni Docker.
 * Es Postgres 18; el CI de "Base de datos y RLS" (Postgres 17) sigue siendo la fuente de verdad
 * de las migraciones.
 *
 * PGlite corre en un proceso hijo (`pglite-worker.cjs`): carga su WASM con `import()` dinámico,
 * que Jest no permite sin --experimental-vm-modules. Este archivo solo habla con él por mensajes.
 */

export interface FaultPlan {
  /**
   * La siguiente llamada (o las siguientes `times`) falla:
   * - `offline`: no hay red; la llamada no llega a la base.
   * - `server-error`: el servidor contesta con un error antes de aplicar nada.
   * - `lost-response`: la llamada se aplica y se confirma en la base, pero la respuesta se pierde.
   */
  failNext(mode: 'offline' | 'lost-response' | 'server-error', times?: number): void;
}

export interface SupabaseTestServer {
  /** Crea la cuenta (`auth.users`) y su perfil; devuelve su id. */
  createUser(name: string): Promise<string>;
  /** Las RPC como las vería esa cuenta: rol `authenticated` y su `sub`. */
  rpcFor(userId: string): RpcCall & { readonly faults: FaultPlan };
  /** Una consulta como `postgres`, para revisar lo que quedó en la base. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

const WORKER = path.join(__dirname, 'pglite-worker.cjs');

type Reply =
  | { readonly id: number; readonly ok: true; readonly result: unknown }
  | {
      readonly id: number;
      readonly ok: false;
      readonly error: { readonly message: string; readonly code?: string };
    };

/** Error de la base del hijo, con el código SQLSTATE de Postgres si lo hubo. */
class WorkerError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = 'WorkerError';
  }
}

/** Código de error de Postgres → clase de fallo, como lo haría PostgREST con su código HTTP. */
function kindForSqlState(code: unknown): 'protocol' | 'auth' | 'server' {
  if (code === '22023' || code === '54000') {
    return 'protocol'; // 400 y 413
  }
  if (code === '42501') {
    return 'auth'; // 403
  }
  return 'server';
}

const MESSAGES = {
  offline: 'Sin conexión con el servidor',
  server: 'Error del servidor',
  protocol: 'El servidor rechazó la petición',
  auth: 'La sesión no es válida',
} as const;

/** Pedidos al hijo con un id cada uno; las respuestas llegan por el canal en cualquier orden. */
function createChannel(child: ChildProcess) {
  let nextId = 1;
  let closed = false;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

  const failAll = (error: Error) => {
    closed = true;
    for (const waiting of pending.values()) {
      waiting.reject(error);
    }
    pending.clear();
  };
  child.on('message', (reply: Reply) => {
    const waiting = pending.get(reply.id);
    if (!waiting) {
      return;
    }
    pending.delete(reply.id);
    if (reply.ok) {
      waiting.resolve(reply.result);
    } else {
      waiting.reject(new WorkerError(reply.error.message, reply.error.code));
    }
  });
  child.on('exit', () => failAll(new Error('El proceso de PGlite terminó')));
  child.on('error', (error) => failAll(error));

  return {
    request<T>(message: Record<string, unknown>): Promise<T> {
      if (closed) {
        return Promise.reject(new Error('El servidor de prueba ya está cerrado'));
      }
      return new Promise<T>((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
        child.send({ id, ...message });
      });
    },
  };
}

export async function createSupabaseTestServer(): Promise<SupabaseTestServer> {
  // Serialización avanzada: los `bigint` de Postgres (count, etc.) cruzan el canal sin error.
  const child = fork(WORKER, [], {
    serialization: 'advanced',
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  const channel = createChannel(child);
  try {
    await channel.request({ op: 'init' });
  } catch (error) {
    child.kill();
    throw error;
  }

  return {
    createUser: (name) => channel.request<string>({ op: 'createUser', name }),

    rpcFor(userId) {
      const planned: ('offline' | 'lost-response' | 'server-error')[] = [];
      const faults: FaultPlan = {
        failNext(mode, times = 1) {
          for (let i = 0; i < times; i += 1) {
            planned.push(mode);
          }
        },
      };
      const rpc: RpcCall = async (name, args) => {
        const fault = planned.shift();
        if (fault === 'offline') {
          throw new SyncTransportError('offline', MESSAGES.offline);
        }
        if (fault === 'server-error') {
          throw new SyncTransportError('server', MESSAGES.server);
        }
        let result: unknown;
        try {
          result = await channel.request({ op: 'rpc', userId, name, args });
        } catch (error) {
          const code = (error as { code?: unknown }).code;
          const kind = kindForSqlState(code);
          throw new SyncTransportError(
            kind,
            MESSAGES[kind],
            typeof code === 'string' ? code : undefined,
          );
        }
        if (fault === 'lost-response') {
          throw new SyncTransportError('offline', MESSAGES.offline);
        }
        return result;
      };
      return Object.assign(rpc, { faults });
    },

    query: <T>(sql: string, params: unknown[] = []) =>
      channel.request<T[]>({ op: 'query', sql, params }),

    async close() {
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      try {
        await channel.request({ op: 'close' });
      } catch {
        child.kill();
      }
      await exited;
    },
  };
}
