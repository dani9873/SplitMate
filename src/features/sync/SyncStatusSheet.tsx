import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { useFormatters } from '@/i18n/use-formatters';
import { Button, Card, Sheet, Text } from '@/ui';

import { useSyncEngine, useSyncStatus } from './SyncProvider';
import { visualState } from './visual-state';

export interface SyncStatusSheetProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Cuenta de lo que hay por subir, apartar o revisar, con una frase simple de por qué y qué hacer.
 * Solo muestra las filas que tienen algo; la lógica ya está en el motor.
 */
export function SyncStatusSheet({ visible, onClose }: SyncStatusSheetProps) {
  const { t } = useTranslation();
  const { instant } = useFormatters();
  const engine = useSyncEngine();
  const status = useSyncStatus();
  const visual = visualState(status);
  // Al día no es "todo en la nube" si queda un borrador: ese solo existe en este teléfono.
  const state = visual === 'synced' && status.conflicts > 0 ? 'syncedDrafts' : visual;

  const needsRetry = status.failed > 0 || status.held > 0 || status.lastError !== null;

  return (
    <Sheet visible={visible} onClose={onClose} title={t('sync.sheet.title')} testID="sync-sheet">
      <ScrollView contentContainerClassName="gap-3 px-5 pb-4" keyboardShouldPersistTaps="handled">
        <View className="gap-1">
          <Text variant="subheading">{t(`sync.state.${state}.title`)}</Text>
          <Text tone="muted">{t(`sync.state.${state}.body`)}</Text>
        </View>

        {status.pending > 0 ? (
          <Row label={t('sync.pending', { count: status.pending })} testID="sync-row-pending" />
        ) : null}
        {status.conflicts > 0 ? (
          <Row
            label={t('sync.conflicts', { count: status.conflicts })}
            hint={t('sync.conflictsHint')}
            testID="sync-row-conflicts"
          />
        ) : null}
        {status.failed > 0 ? (
          <Row
            label={t('sync.failed', { count: status.failed })}
            hint={t('sync.failedHint')}
            testID="sync-row-failed"
          />
        ) : null}
        {status.held > 0 ? (
          <Row
            label={t('sync.held', { count: status.held })}
            hint={t('sync.heldHint')}
            testID="sync-row-held"
          />
        ) : null}

        {status.lastError ? (
          <Text tone="warning">{t(`sync.error.${status.lastError}`)}</Text>
        ) : null}

        <Text variant="caption" tone="muted">
          {status.lastSyncedAt === null
            ? t('sync.neverSynced')
            : t('sync.lastSynced', { when: instant(status.lastSyncedAt) })}
        </Text>

        <View className="gap-2 pt-1">
          <Button
            label={status.syncing ? t('sync.syncingNow') : t('sync.syncNow')}
            loading={status.syncing}
            onPress={() => {
              void engine.syncNow();
            }}
          />
          {needsRetry ? (
            <Button
              label={t('sync.retry')}
              variant="secondary"
              onPress={() => engine.retryFailed()}
            />
          ) : null}
        </View>
      </ScrollView>
    </Sheet>
  );
}

function Row({ label, hint, testID }: { label: string; hint?: string; testID: string }) {
  return (
    <Card testID={testID} className="gap-1">
      <Text variant="bodyStrong">{label}</Text>
      {hint ? (
        <Text variant="label" tone="muted">
          {hint}
        </Text>
      ) : null}
    </Card>
  );
}
