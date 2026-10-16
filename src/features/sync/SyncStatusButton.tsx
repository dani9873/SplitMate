import { CloudCheck, CloudOff, CloudUpload, RefreshCw, TriangleAlert } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { IconButton, type IconButtonProps } from '@/ui';

import { useSyncStatus } from './SyncProvider';
import { SyncStatusSheet } from './SyncStatusSheet';
import { visualState, type VisualState } from './visual-state';

const ICONS: Record<VisualState, LucideIcon> = {
  synced: CloudCheck,
  pending: CloudUpload,
  offline: CloudOff,
  error: TriangleAlert,
  syncing: RefreshCw,
};

const TONES: Record<VisualState, NonNullable<IconButtonProps['tone']>> = {
  synced: 'fgMuted',
  pending: 'fg',
  offline: 'fgMuted',
  error: 'negative',
  syncing: 'primary',
};

/** Indicador compacto del estado de la sincronización. Al tocarlo abre la hoja con el detalle. */
export function SyncStatusButton() {
  const { t } = useTranslation();
  const status = useSyncStatus();
  const [open, setOpen] = useState(false);
  const state = visualState(status);

  return (
    <>
      <IconButton
        testID="sync-status-button"
        icon={ICONS[state]}
        label={t(`sync.button.${state}`)}
        accessibilityHint={t('sync.button.hint')}
        tone={TONES[state]}
        onPress={() => setOpen(true)}
      />
      <SyncStatusSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
