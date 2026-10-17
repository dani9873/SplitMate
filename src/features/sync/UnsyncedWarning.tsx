import { CloudUpload, Eye } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useDatabase } from '@/db/DatabaseProvider';
import { Button, Card, Text } from '@/ui';

import { useSyncEngine, useSyncStatus } from './SyncProvider';
import { onlyDrafts, unsyncedCount } from './unsynced';
import { useGuardedRouter } from '@/features/navigation/use-guarded-router';

export interface UnsyncedWarningProps {
  /** Qué pasa con esos cambios si la persona sigue, ya traducido. */
  consequence: string;
  /** Se llama justo antes de ir a revisar un borrador (para cerrar la hoja que lo muestra). */
  onReview?: () => void;
}

/**
 * Aviso de lo que todavía no está en la nube. Con algo por subir ofrece "Sincronizar primero"; si
 * solo quedan borradores, sincronizar no los resuelve y ofrece "Revisar", que lleva al grupo del
 * primero. Se redibuja con el estado del motor: si lo pendiente sube, desaparece solo; si queda
 * algo, muestra los números nuevos y el motivo. No renderiza nada cuando no hay nada sin subir.
 */
export function UnsyncedWarning({ consequence, onReview }: UnsyncedWarningProps) {
  const { t } = useTranslation();
  const engine = useSyncEngine();
  const status = useSyncStatus();
  const { repos } = useDatabase();
  const router = useGuardedRouter();
  const [busy, setBusy] = useState(false);

  if (unsyncedCount(status) === 0) {
    return null;
  }

  const syncFirst = () => {
    setBusy(true);
    void engine.syncNow().finally(() => setBusy(false));
  };

  const review = () => {
    const draft = repos.conflicts.list()[0];
    if (!draft) {
      return;
    }
    onReview?.();
    router.push(`/groups/${draft.groupId}`);
  };

  return (
    <Card testID="unsynced-warning" className="gap-2">
      <Text variant="bodyStrong">{t('sync.unsynced.intro')}</Text>
      <View className="gap-1">
        {status.pending > 0 ? <Text>{t('sync.pending', { count: status.pending })}</Text> : null}
        {status.failed > 0 ? <Text>{t('sync.failed', { count: status.failed })}</Text> : null}
        {status.conflicts > 0 ? (
          <Text>{t('sync.conflicts', { count: status.conflicts })}</Text>
        ) : null}
      </View>
      <Text tone="muted">{consequence}</Text>
      {status.lastError ? <Text tone="warning">{t(`sync.error.${status.lastError}`)}</Text> : null}
      {onlyDrafts(status) ? (
        <Button
          label={t('sync.review.open')}
          icon={Eye}
          variant="secondary"
          onPress={review}
          fullWidth
        />
      ) : (
        <Button
          label={t('sync.unsynced.syncFirst')}
          icon={CloudUpload}
          variant="secondary"
          loading={busy || status.syncing}
          onPress={syncFirst}
          fullWidth
        />
      )}
    </Card>
  );
}
