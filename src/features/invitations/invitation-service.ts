import { z } from 'zod';

import { parseServerInstant } from '@/db/sync/instant';
import { SyncTransportError, type RpcCall } from '@/db/sync/remote';
import { isKnownCurrency } from '@/domain';
import { GROUP_COLORS, MAX_EMOJI_LENGTH } from '@/lib/group-appearance';

import { INVITE_TOKEN_PATTERN } from './invite-link';

/**
 * Las invitaciones por enlace contra el servidor: crear, ver, aceptar, revocar y listar. Todas
 * necesitan internet. Cada respuesta se valida con zod antes de usarse, y los errores del servidor
 * (`{ "error": "SM…" }` o un fallo de la llamada) se traducen a un código estable. Ningún error ni
 * mensaje lleva el token ni lo que contestó el servidor.
 *
 * Códigos de `InvitationError`:
 * - `INVALID_LINK`: el enlace no sirve (no existe, venció, se revocó o se agotó: el servidor no
 *   distingue un caso de otro).
 * - `RATE_LIMITED`: demasiados intentos fallidos o demasiados enlaces creados.
 * - `MEMBER_TAKEN`: el miembro que se eligió ya tiene cuenta; hay que volver a elegir.
 * - `GROUP_FULL`: el grupo llegó al máximo de personas.
 * - `TOO_MANY_GROUPS`: la cuenta llegó al máximo de grupos.
 * - `OFFLINE`, `FORBIDDEN`, `AUTH`: sin conexión, sin permiso, sesión inválida.
 * - `BAD_INPUT`: un argumento con mala forma; no llega a salir.
 * - `SERVER`: cualquier otro fallo, incluida una respuesta que no cumple el contrato.
 */
export type InvitationErrorCode =
  | 'INVALID_LINK'
  | 'RATE_LIMITED'
  | 'MEMBER_TAKEN'
  | 'GROUP_FULL'
  | 'TOO_MANY_GROUPS'
  | 'OFFLINE'
  | 'FORBIDDEN'
  | 'AUTH'
  | 'BAD_INPUT'
  | 'SERVER';

/** El mensaje es fijo: nunca lleva el token, los ids ni lo que contestó el servidor. */
export class InvitationError extends Error {
  constructor(readonly code: InvitationErrorCode) {
    super(`No se pudo completar la acción de invitación (${code})`);
    this.name = 'InvitationError';
  }
}

export interface InvitePreview {
  readonly group: {
    readonly id: string;
    readonly name: string;
    readonly emoji: string | null;
    readonly color: (typeof GROUP_COLORS)[number];
    readonly currency: string;
  };
  /** Los miembros activos sin cuenta, entre los que la persona elige quién es. */
  readonly members: readonly { readonly id: string; readonly displayName: string }[];
  readonly accounts: number;
  readonly expiresAt: number;
  /** La cuenta ya tiene acceso al grupo. */
  readonly alreadyMember: boolean;
}

export interface CreatedInvitation {
  readonly id: string;
  readonly token: string;
  readonly expiresAt: number;
  readonly maxUses: number;
}

export type InvitationStatus = 'active' | 'expired' | 'revoked' | 'exhausted';

export interface InvitationInfo {
  readonly id: string;
  /** La cuenta que lo creó. */
  readonly createdBy: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly maxUses: number;
  readonly useCount: number;
  readonly revokedAt: number | null;
  readonly status: InvitationStatus;
}

/** Cómo se une quien acepta: eligiendo un miembro que ya existe o como alguien nuevo. */
export type JoinChoice =
  | { readonly kind: 'member'; readonly memberId: string }
  | { readonly kind: 'new'; readonly displayName: string };

export interface CreateInvitationInput {
  readonly groupId: string;
  /** De 1 a 720 horas. Por omisión, 168 (7 días). */
  readonly expiresHours?: number;
  /** De 1 a 50 usos. Por omisión, 10. */
  readonly maxUses?: number;
}

export interface InvitationService {
  create(input: CreateInvitationInput): Promise<CreatedInvitation>;
  preview(token: string): Promise<InvitePreview>;
  /** Devuelve el id del grupo al que entró la cuenta. */
  accept(token: string, choice: JoinChoice): Promise<{ readonly groupId: string }>;
  revoke(invitationId: string): Promise<void>;
  list(groupId: string): Promise<InvitationInfo[]>;
}

const uuid = z.guid();
/** Solo monedas que la app conoce: otra rompería los saldos del grupo. */
const currencySchema = z.string().refine(isKnownCurrency);
const token = z.string().regex(INVITE_TOKEN_PATTERN);
const instant = z
  .string()
  .refine((value) => parseServerInstant(value) !== null)
  .transform((value) => parseServerInstant(value) as number);
const name = z.string().min(1).max(80);

/** Lo que el servidor responde en vez de lanzar: un error de negocio con estado 200. */
const businessError = z.object({
  error: z.enum(['SMINV', 'SMRLT', 'SMTKN', 'SMGFL']),
  quota: z.enum(['groups', 'accounts', 'members']).optional(),
});

const previewSchema = z.object({
  group: z.object({
    id: uuid,
    name: z.string().min(1).max(80),
    emoji: z.string().min(1).max(MAX_EMOJI_LENGTH).nullable(),
    color: z.enum(GROUP_COLORS),
    currency: currencySchema,
  }),
  members: z
    .array(z.object({ id: uuid, display_name: name }))
    .max(200)
    .transform((members) => members.map((m) => ({ id: m.id, displayName: m.display_name }))),
  accounts: z.int().min(0).max(1000),
  expires_at: instant,
  already_member: z.boolean(),
});

const createdSchema = z.object({
  id: uuid,
  token,
  expires_at: instant,
  max_uses: z.int().min(1).max(50),
});

const acceptedSchema = z.object({ group_id: uuid });

const listSchema = z
  .array(
    z.object({
      id: uuid,
      created_by: uuid,
      created_at: instant,
      expires_at: instant,
      max_uses: z.int().min(1).max(50),
      use_count: z.int().min(0).max(50),
      revoked_at: instant.nullable(),
      status: z.enum(['active', 'expired', 'revoked', 'exhausted']),
    }),
  )
  .max(100);

function translateTransport(error: unknown): InvitationError {
  if (error instanceof SyncTransportError) {
    if (error.code === '42501') {
      return new InvitationError('FORBIDDEN');
    }
    if (error.kind === 'offline' || error.kind === 'timeout') {
      return new InvitationError('OFFLINE');
    }
    if (error.kind === 'auth') {
      return new InvitationError('AUTH');
    }
  }
  return new InvitationError('SERVER');
}

function translateBusiness(error: z.infer<typeof businessError>): InvitationError {
  switch (error.error) {
    case 'SMINV':
      return new InvitationError('INVALID_LINK');
    case 'SMRLT':
      return new InvitationError('RATE_LIMITED');
    case 'SMTKN':
      return new InvitationError('MEMBER_TAKEN');
    case 'SMGFL':
      return new InvitationError(error.quota === 'groups' ? 'TOO_MANY_GROUPS' : 'GROUP_FULL');
  }
}

export function createInvitationService(
  rpc: RpcCall,
  deps: { readonly newId: () => string },
): InvitationService {
  /** Llama, y entrega la respuesta ya validada o lanza el error traducido. */
  async function call<T extends z.ZodType>(
    rpcName:
      | 'create_invitation'
      | 'preview_invitation'
      | 'accept_invitation'
      | 'revoke_invitation'
      | 'list_invitations',
    args: Record<string, unknown>,
    schema: T,
  ): Promise<z.output<T>> {
    let raw: unknown;
    try {
      raw = await rpc(rpcName, args);
    } catch (error) {
      throw translateTransport(error);
    }
    const failure = businessError.safeParse(raw);
    if (failure.success) {
      throw translateBusiness(failure.data);
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new InvitationError('SERVER');
    }
    return parsed.data;
  }

  const requireToken = (value: string) => {
    if (!token.safeParse(value).success) {
      throw new InvitationError('BAD_INPUT');
    }
  };

  return {
    async create({ groupId, expiresHours = 168, maxUses = 10 }) {
      if (
        !uuid.safeParse(groupId).success ||
        !Number.isInteger(expiresHours) ||
        expiresHours < 1 ||
        expiresHours > 720 ||
        !Number.isInteger(maxUses) ||
        maxUses < 1 ||
        maxUses > 50
      ) {
        throw new InvitationError('BAD_INPUT');
      }
      const created = await call(
        'create_invitation',
        { p_group_id: groupId, p_expires_hours: expiresHours, p_max_uses: maxUses },
        createdSchema,
      );
      return {
        id: created.id,
        token: created.token,
        expiresAt: created.expires_at,
        maxUses: created.max_uses,
      };
    },

    async preview(value) {
      requireToken(value);
      const preview = await call('preview_invitation', { p_token: value }, previewSchema);
      return {
        group: preview.group,
        members: preview.members,
        accounts: preview.accounts,
        expiresAt: preview.expires_at,
        alreadyMember: preview.already_member,
      };
    },

    async accept(value, choice) {
      requireToken(value);
      if (choice.kind === 'member') {
        if (!uuid.safeParse(choice.memberId).success) {
          throw new InvitationError('BAD_INPUT');
        }
        const done = await call(
          'accept_invitation',
          { p_token: value, p_member_id: choice.memberId },
          acceptedSchema,
        );
        return { groupId: done.group_id };
      }
      const displayName = choice.displayName.trim();
      if (!name.safeParse(displayName).success) {
        throw new InvitationError('BAD_INPUT');
      }
      // El id del miembro nuevo lo genera el teléfono (UUID v7), como todo lo demás.
      const done = await call(
        'accept_invitation',
        { p_token: value, p_new_member: { id: deps.newId(), display_name: displayName } },
        acceptedSchema,
      );
      return { groupId: done.group_id };
    },

    async revoke(invitationId) {
      if (!uuid.safeParse(invitationId).success) {
        throw new InvitationError('BAD_INPUT');
      }
      try {
        await rpc('revoke_invitation', { p_invitation_id: invitationId });
      } catch (error) {
        throw translateTransport(error);
      }
    },

    async list(groupId) {
      if (!uuid.safeParse(groupId).success) {
        throw new InvitationError('BAD_INPUT');
      }
      const rows = await call('list_invitations', { p_group_id: groupId }, listSchema);
      return rows.map((row) => ({
        id: row.id,
        createdBy: row.created_by,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        maxUses: row.max_uses,
        useCount: row.use_count,
        revokedAt: row.revoked_at,
        status: row.status,
      }));
    },
  };
}

/** La clave de `invite.errors.*` que explica el error a la persona. */
export function invitationErrorKey(
  error: unknown,
):
  | 'invalidLink'
  | 'rateLimited'
  | 'memberTaken'
  | 'groupFull'
  | 'tooManyGroups'
  | 'offline'
  | 'forbidden'
  | 'auth'
  | 'generic' {
  if (error instanceof InvitationError) {
    switch (error.code) {
      case 'INVALID_LINK':
        return 'invalidLink';
      case 'RATE_LIMITED':
        return 'rateLimited';
      case 'MEMBER_TAKEN':
        return 'memberTaken';
      case 'GROUP_FULL':
        return 'groupFull';
      case 'TOO_MANY_GROUPS':
        return 'tooManyGroups';
      case 'OFFLINE':
        return 'offline';
      case 'FORBIDDEN':
        return 'forbidden';
      case 'AUTH':
        return 'auth';
    }
  }
  return 'generic';
}
