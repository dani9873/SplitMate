import { z } from 'zod';

import { SyncTransportError, type RpcCall } from '@/db/sync';

/**
 * Salir de un grupo y quitar el acceso a otra cuenta. Las dos son RPC del servidor (necesitan
 * internet) y después de cada una la sincronización baja el cambio.
 *
 * - `OFFLINE`: sin conexión o sin respuesta a tiempo.
 * - `LAST_ACCOUNT`: eres la única cuenta con acceso (SMLST): se puede borrar el grupo, no salir.
 * - `FORBIDDEN`: el servidor no lo permite a esta cuenta (solo el dueño quita el acceso).
 * - `AUTH`: la sesión ya no vale.
 * - `INVALID`: un argumento que no es UUID; no llega a salir.
 * - `SERVER`: cualquier otro fallo.
 */
export type AccessErrorCode =
  'OFFLINE' | 'LAST_ACCOUNT' | 'FORBIDDEN' | 'AUTH' | 'INVALID' | 'SERVER';

/** El mensaje es fijo: nunca lleva lo que contestó el servidor ni los ids. */
export class AccessError extends Error {
  constructor(readonly code: AccessErrorCode) {
    super(`No se pudo completar la acción de acceso (${code})`);
    this.name = 'AccessError';
  }
}

export interface AccessService {
  /** La cuenta sale del grupo. Su miembro queda en los movimientos, sin cuenta. */
  leaveGroup(groupId: string): Promise<void>;
  /** El dueño quita el acceso a otra cuenta. */
  removeAccess(groupId: string, userId: string): Promise<void>;
}

const uuid = z.guid();

function translate(error: unknown): AccessError {
  if (error instanceof SyncTransportError) {
    if (error.code === 'SMLST') {
      return new AccessError('LAST_ACCOUNT');
    }
    if (error.code === '42501') {
      return new AccessError('FORBIDDEN');
    }
    if (error.kind === 'offline' || error.kind === 'timeout') {
      return new AccessError('OFFLINE');
    }
    if (error.kind === 'auth') {
      return new AccessError('AUTH');
    }
  }
  return new AccessError('SERVER');
}

export function createAccessService(rpc: RpcCall): AccessService {
  async function call(name: 'leave_group' | 'remove_access', args: Record<string, string>) {
    if (!Object.values(args).every((value) => uuid.safeParse(value).success)) {
      throw new AccessError('INVALID');
    }
    try {
      await rpc(name, args);
    } catch (error) {
      throw translate(error);
    }
  }

  return {
    leaveGroup: (groupId) => call('leave_group', { p_group_id: groupId }),
    removeAccess: (groupId, userId) =>
      call('remove_access', { p_group_id: groupId, p_user_id: userId }),
  };
}

/** La clave de `groups.settings.*` que explica el error a la persona. */
export function accessErrorKey(
  error: unknown,
): 'needInternet' | 'leaveLastOne' | 'forbidden' | 'accessActionFailed' {
  if (error instanceof AccessError) {
    switch (error.code) {
      case 'OFFLINE':
        return 'needInternet';
      case 'LAST_ACCOUNT':
        return 'leaveLastOne';
      case 'FORBIDDEN':
        return 'forbidden';
    }
  }
  return 'accessActionFailed';
}
