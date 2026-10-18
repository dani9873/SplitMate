import { z } from 'zod';

/**
 * Contrato de red de la sincronización: lo que se manda a `sync_push` y `sync_pull_v2` y lo que
 * devuelven. Todo dato que llega del servidor pasa por estos esquemas antes de tocar la base local.
 * Las filas (`row`) conservan los nombres de columna del servidor (snake_case); su forma por tabla
 * se valida al aplicarlas.
 */

export const SYNC_ENTITIES = ['group', 'member', 'category', 'expense', 'transfer'] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];

export const SYNC_TABLES = [
  'groups',
  'group_access',
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

export const REJECT_REASONS = [
  'conflict',
  'currency_locked',
  'group_currency_changed',
  'member_linked',
  'quota',
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

/** El cupo del servidor que se alcanzó cuando el motivo es `quota`. */
export const QUOTA_KINDS = ['groups', 'members', 'categories', 'movements'] as const;
export type QuotaKind = (typeof QUOTA_KINDS)[number];
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
      /** Solo con `reason: 'quota'`. */
      readonly quota?: QuotaKind;
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

/**
 * Dónde seguir con un grupo grande que se baja por páginas: `seq` es el cursor desde el que empezó
 * la ronda, `hw` el `change_seq` más alto del grupo al empezarla y `after` la última fila de la
 * página anterior (`t` es la posición de su tabla en el orden padre → hijo).
 */
export interface PullCursorObject {
  readonly seq: number;
  readonly hw: number;
  readonly after: { readonly t: number; readonly id: string };
}

/** Lo que se manda por grupo: el cursor confirmado, o el objeto de una descarga en curso. */
export type PullCursor = number | PullCursorObject;

/** Un grupo de la respuesta de `sync_pull_v2`: entero (`cursor`) o una página (`partial`/`next`). */
export interface PulledGroup {
  readonly id: string;
  /** Nulo en una página parcial. */
  readonly cursor: number | null;
  readonly partial: boolean;
  /** El cursor para pedir la página siguiente; nulo si no es parcial. */
  readonly next: PullCursorObject | null;
  readonly rows: readonly RemoteRow[];
}

export interface PullResponse {
  readonly groups: readonly PulledGroup[];
  readonly hasMore: boolean;
  /** Grupos de los cursores enviados que la cuenta ya no ve. */
  readonly lost: readonly string[];
}

/** Topes del contrato: el servidor nunca manda más; una respuesta que los pasa se rechaza. */
export const MAX_PULL_ROWS = 2000;
export const MAX_PULL_GROUPS = 2000;
export const MAX_PULL_LOST = 1000;

// Los ids los genera el cliente (UUID v7) y los valida el servidor al convertirlos a uuid: aquí
// basta el formato, sin exigir una versión.
const uuid = z.guid();
const safeInteger = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

export const remoteRowSchema = z.object({
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
    reason: z.enum(REJECT_REASONS),
    quota: z.enum(QUOTA_KINDS).optional(),
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

const nextSchema = z
  .object({
    seq: safeInteger,
    hw: safeInteger,
    after: z.object({ t: z.int().min(1).max(8), id: uuid }),
  })
  .refine((next) => next.seq <= next.hw);

const pulledGroupSchema = z
  .object({
    id: uuid,
    cursor: safeInteger.nullable(),
    partial: z.boolean(),
    next: nextSchema.nullable(),
    rows: z.array(remoteRowSchema).max(MAX_PULL_ROWS),
  })
  // Una página parcial no tiene cursor y sí `next`; una entera, al revés.
  .refine((group) =>
    group.partial
      ? group.cursor === null && group.next !== null
      : group.cursor !== null && group.next === null,
  );

/**
 * Respuesta de `sync_pull_v2`, con `has_more` convertido a `hasMore`. Los topes de tamaño por
 * llamada (filas totales, grupos, `lost`) los revisa `createSyncRemote.pull`, que conoce lo pedido.
 */
export const pullResponseSchema = z
  .object({
    groups: z.array(pulledGroupSchema).max(MAX_PULL_GROUPS),
    has_more: z.boolean(),
    lost: z.array(uuid).max(MAX_PULL_LOST),
  })
  .transform(({ groups, has_more, lost }): PullResponse => ({ groups, hasMore: has_more, lost }));
