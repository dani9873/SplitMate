import { z } from 'zod';

/**
 * Contrato de red de la sincronización: lo que se manda a `sync_push` y `sync_pull` y lo que
 * devuelven. Todo dato que llega del servidor pasa por estos esquemas antes de tocar la base local.
 * Las filas (`row`) conservan los nombres de columna del servidor (snake_case); su forma por tabla
 * se valida al aplicarlas.
 */

export const SYNC_ENTITIES = ['group', 'member', 'category', 'expense', 'transfer'] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];

export const SYNC_TABLES = [
  'groups',
  'group_members',
  'categories',
  'expenses',
  'expense_payers',
  'expense_splits',
  'transfers',
] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

export interface Mutation {
  /** UUID del envío: el servidor lo usa para no aplicarlo dos veces. */
  readonly id: string;
  readonly entity: SyncEntity;
  /** Versión del servidor sobre la que se hizo el cambio; `null` si la unidad es nueva. */
  readonly base: number | null;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface RemoteRow {
  readonly table: SyncTable;
  readonly row: Readonly<Record<string, unknown>>;
}

export type RejectReason = 'conflict' | 'currency_locked' | 'group_currency_changed';
export type FailReason = 'forbidden' | 'invalid' | 'not_found' | 'error';

export type PushResult =
  | {
      readonly id: string;
      readonly status: 'applied';
      readonly version: number;
      readonly current: readonly RemoteRow[];
    }
  | {
      readonly id: string;
      readonly status: 'rejected';
      readonly reason: RejectReason;
      readonly current: readonly RemoteRow[];
    }
  | {
      readonly id: string;
      readonly status: 'failed';
      readonly reason: FailReason;
      readonly field?: string;
    };

export interface RemoteGroupChanges {
  readonly id: string;
  readonly cursor: number;
  readonly rows: readonly RemoteRow[];
}

export interface PullResponse {
  readonly groups: readonly RemoteGroupChanges[];
  readonly hasMore: boolean;
}

// Los ids los genera el cliente (UUID v7) y los valida el servidor al convertirlos a uuid: aquí
// basta el formato, sin exigir una versión.
const uuid = z.guid();
const safeInteger = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

const remoteRowSchema = z.object({
  table: z.enum(SYNC_TABLES),
  // `looseObject` conserva todas las columnas; solo se exige el `id`.
  row: z.looseObject({ id: uuid }),
});

const pushResultSchema = z.discriminatedUnion('status', [
  z.object({
    id: uuid,
    status: z.literal('applied'),
    version: safeInteger.min(1),
    current: z.array(remoteRowSchema),
  }),
  z.object({
    id: uuid,
    status: z.literal('rejected'),
    reason: z.enum(['conflict', 'currency_locked', 'group_currency_changed']),
    current: z.array(remoteRowSchema),
  }),
  z.object({
    id: uuid,
    status: z.literal('failed'),
    reason: z.enum(['forbidden', 'invalid', 'not_found', 'error']),
    field: z.string().optional(),
  }),
]);

/** Respuesta de `sync_push`: un resultado por envío. */
export const pushResponseSchema = z.array(pushResultSchema);

/** Respuesta de `sync_pull`, con `has_more` convertido a `hasMore`. */
export const pullResponseSchema = z
  .object({
    groups: z.array(z.object({ id: uuid, cursor: safeInteger, rows: z.array(remoteRowSchema) })),
    has_more: z.boolean(),
  })
  .transform(({ groups, has_more }): PullResponse => ({ groups, hasMore: has_more }));
