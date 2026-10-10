import { useRouter } from 'expo-router';
import { ChevronRight, FlaskConical } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { useDatabase } from '@/db/DatabaseProvider';
import { Card, Text, useAppTheme } from '@/ui';

import './i18n';
import { createSampleData, SAMPLE_DATA_MARKER } from './sample-data';

/** Carga los datos de ejemplo desde Ajustes. Solo se monta en desarrollo. */
export function SampleDataButton() {
  const { t } = useTranslation('sampleData');
  const { repos } = useDatabase();
  const router = useRouter();
  const { colors } = useAppTheme();
  return (
    <Card padded={false} className="overflow-hidden" testID={SAMPLE_DATA_MARKER}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('button')}
        accessibilityHint={t('hint')}
        onPress={() => {
          createSampleData(repos, t);
          router.navigate('/');
        }}
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
