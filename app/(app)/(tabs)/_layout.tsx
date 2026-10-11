import { Tabs } from 'expo-router/js-tabs';
import { ReceiptText, Settings, Users } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { TabBarIcon } from '@/features/navigation';
import { fontFamily, useAppTheme } from '@/ui';

export default function TabsLayout() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.fgMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
        tabBarLabelStyle: { fontFamily: fontFamily.semibold, fontSize: 12 },
        tabBarIconStyle: { width: 56, height: 32 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.groups'),
          tabBarIcon: ({ focused }) => <TabBarIcon icon={Users} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: t('tabs.activity'),
          tabBarIcon: ({ focused }) => <TabBarIcon icon={ReceiptText} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabs.settings'),
          tabBarIcon: ({ focused }) => <TabBarIcon icon={Settings} focused={focused} />,
        }}
      />
    </Tabs>
  );
}
