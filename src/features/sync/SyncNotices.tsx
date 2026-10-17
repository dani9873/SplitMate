import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { SyncNotice } from '@/db/sync';
import { Toast } from '@/ui';

import { useSyncEngine } from './SyncProvider';
import { useGuardedRouter } from '@/features/navigation/use-guarded-router';

/** Por encima del aviso de "Deshacer" (que va a `insets.bottom + 72`), para no taparse. */
const BOTTOM_OFFSET = 140;

/** La clave de `sync.notice.*` que cuenta qué pasó con un cambio, según la razón del rechazo. */
function noticeKey(notice: SyncNotice) {
  if (notice.reason === 'currency_locked') {
    return 'currencyLocked';
  }
  if (notice.reason === 'group_currency_changed') {
    return 'groupCurrencyChanged';
  }
  if (notice.serverDeleted) {
    return 'serverDeleted';
  }
  return notice.wasDeletion ? 'deletionRejected' : 'conflict';
}

/**
 * Avisa cuando el servidor rechaza un cambio del usuario y queda como borrador. Un aviso nombra lo
 * que pasó; varios juntos se resumen en uno. "Revisar" lleva al detalle del grupo (la lista de
 * borradores es de la pantalla de revisión). Se queda hasta cerrarlo: el borrador no se pierde, pero
 * el aviso es lo único que explica por qué cambió lo que se ve.
 */
export function SyncNotices() {
  const { t } = useTranslation();
  const engine = useSyncEngine();
  const router = useGuardedRouter();
  const insets = useSafeAreaInsets();
  const [notices, setNotices] = useState<readonly SyncNotice[]>([]);

  useEffect(
    () => engine.onNotice((notice) => setNotices((current) => [...current, notice])),
    [engine],
  );

  const first = notices[0];
  if (!first) {
    return null;
  }

  const dismiss = () => setNotices([]);
  const message =
    notices.length === 1
      ? t(`sync.notice.${noticeKey(first)}`, { label: first.label })
      : t('sync.notice.many', { count: notices.length });

  return (
    <View
      pointerEvents="box-none"
      className="absolute inset-x-0 px-4"
      style={{ bottom: insets.bottom + BOTTOM_OFFSET }}
    >
      <Toast
        message={message}
        actionLabel={t('sync.notice.review')}
        onAction={() => {
          dismiss();
          router.push(`/groups/${first.groupId}`);
        }}
        onDismiss={dismiss}
      />
    </View>
  );
}
