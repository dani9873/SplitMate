import { deleteAccountData } from '@/db/client';
import { logger } from '@/lib/logger';

import { useAccountNotice, type AccountNotice } from './account-notice';

/**
 * Limpieza para `signOut({ cleanup })`: borra del teléfono la base de la cuenta, su clave y su
 * entrada del registro, y deja el aviso para la bienvenida. Corre cuando las pantallas con sesión
 * ya se desmontaron. Nunca lanza: si falla, el aviso lo dice.
 */
export function wipeAccountData(
  userId: string,
  notices: { done: AccountNotice; failed: AccountNotice },
): () => Promise<void> {
  return async () => {
    try {
      await deleteAccountData(userId);
      useAccountNotice.getState().show(notices.done);
    } catch (error) {
      logger.warn('No se pudieron borrar los datos de la cuenta en este teléfono', error);
      useAccountNotice.getState().show(notices.failed);
    }
  };
}
