import { ChevronRight, FlaskConical } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { useDatabase } from '@/db/DatabaseProvider';
import { Card, Text, useAppTheme, usePressGuard } from '@/ui';

import './i18n';
import { createSampleData, SAMPLE_DATA_MARKER } from './sample-data';
import { useGuardedRouter } from '@/features/navigation/use-guarded-router';

/** Carga los datos de ejemplo desde Ajustes. Solo se monta en desarrollo. */
export function SampleDataButton() {
  const { t } = useTranslation('sampleData');
  const { repos } = useDatabase();
  const router = useGuardedRouter();
  const { colors } = useAppTheme();
  const load = usePressGuard(() => {
    createSampleData(repos, t);
    router.navigate('/');
  });
  return (
    <Card padded={false} className="overflow-hidden" testID={SAMPLE_DATA_MARKER}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('button')}
        accessibilityHint={t('hint')}
        onPress={load}
        className="min-h-[56px] flex-row items-center gap-3 px-4 py-3 active:bg-surface-muted"
      >
        <FlaskConical size={20} color={colors.primary} />
        <View className="flex-1 gap-0.5">
          <Text variant="bodyStrong">{t('button')}</Text>
          <Text variant="caption" tone="muted">
            {t('hint')}
          </Text>
        </View>
        <ChevronRight size={20} color={colors.fgMuted} />
      </Pressable>
    </Card>
  );
}
