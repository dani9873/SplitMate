import { useRouter } from 'expo-router';
import { ChevronRight, FlaskConical } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Card, Text, useAppTheme } from '@/ui';

import './i18n';

/** Acceso a la pantalla de desarrollo desde Ajustes. Solo se monta en desarrollo. */
export function DevSettingsLink() {
  const { t } = useTranslation('dev');
  const router = useRouter();
  const { colors } = useAppTheme();
  return (
    <Card padded={false} className="overflow-hidden">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('settingsLink')}
        accessibilityHint={t('settingsHint')}
        onPress={() => router.push('/dev')}
        className="min-h-[56px] flex-row items-center gap-3 px-4 py-3 active:bg-surface-muted"
      >
        <FlaskConical size={20} color={colors.primary} />
        <View className="flex-1 gap-0.5">
          <Text variant="bodyStrong">{t('settingsLink')}</Text>
          <Text variant="caption" tone="muted">
            {t('settingsHint')}
          </Text>
        </View>
        <ChevronRight size={20} color={colors.fgMuted} />
      </Pressable>
    </Card>
  );
}
