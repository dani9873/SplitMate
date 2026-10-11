import { Search, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';

import { cn } from './cn';
import { IconButton } from './IconButton';
import { useAppTheme } from './theme';

export interface SearchFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  /** Texto de ayuda y nombre accesible del campo, ya traducido. */
  label: string;
  className?: string;
  testID?: string;
}

/** Campo de búsqueda con ícono y botón para borrar. */
export function SearchField({ value, onChangeText, label, className, testID }: SearchFieldProps) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  return (
    <View
      className={cn(
        'min-h-[48px] flex-row items-center gap-2 rounded-lg border border-line-strong bg-surface pl-3',
        className,
      )}
    >
      <Search size={18} color={colors.fgMuted} />
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={label}
        placeholder={label}
        placeholderTextColor={colors.fgSubtle}
        selectionColor={colors.primary}
        cursorColor={colors.primary}
        returnKeyType="search"
        autoCorrect={false}
        maxLength={80}
        className="min-h-[46px] flex-1 font-sans text-[16px] text-fg"
      />
      {value ? (
        <IconButton
          icon={X}
          label={t('ui.search.clear')}
          tone="fgMuted"
          onPress={() => onChangeText('')}
        />
      ) : (
        <View className="w-2" />
      )}
    </View>
  );
}
