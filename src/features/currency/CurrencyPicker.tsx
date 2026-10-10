import { FlashList } from '@shopify/flash-list';
import { Check, ChevronDown } from 'lucide-react-native';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { KNOWN_CURRENCIES } from '@/domain';
import { useFormatters } from '@/i18n';
import { cn, SearchField, Sheet, Text, useAppTheme } from '@/ui';

import { currencyName, normalizeForSearch } from './currency-names';

type Row =
  | { readonly type: 'header'; readonly key: string; readonly label: string }
  | {
      readonly type: 'currency';
      readonly key: string;
      readonly code: string;
      readonly name: string;
    };

export interface CurrencyPickerProps {
  visible: boolean;
  value: string;
  onChange: (code: string) => void;
  onClose: () => void;
  /** Monedas que se ofrecen primero, como la del grupo. */
  suggested?: readonly string[];
}

/** Hoja para elegir una de las 155 monedas, con búsqueda por código o nombre. */
export function CurrencyPicker({
  visible,
  value,
  onChange,
  onClose,
  suggested = [],
}: CurrencyPickerProps) {
  const { t } = useTranslation();
  const { locale } = useFormatters();
  const { height } = useWindowDimensions();
  const [query, setQuery] = useState('');

  const rows = useMemo<Row[]>(() => {
    const all = KNOWN_CURRENCIES.map((code) => ({ code, name: currencyName(code, locale) }));
    const needle = normalizeForSearch(query);
    if (needle) {
      return all
        .filter(
          ({ code, name }) =>
            code.toLowerCase().includes(needle) || normalizeForSearch(name).includes(needle),
        )
        .map(({ code, name }) => ({ type: 'currency', key: code, code, name }));
    }
    const pinned = [...new Set(suggested)].filter((code) => all.some((c) => c.code === code));
    return [
      ...(pinned.length > 0
        ? [{ type: 'header' as const, key: 'h-suggested', label: t('currencyPicker.suggested') }]
        : []),
      ...pinned.map((code) => ({
        type: 'currency' as const,
        key: `s-${code}`,
        code,
        name: currencyName(code, locale),
      })),
      { type: 'header' as const, key: 'h-all', label: t('currencyPicker.all') },
      ...all.map(({ code, name }) => ({ type: 'currency' as const, key: code, code, name })),
    ];
  }, [locale, query, suggested, t]);

  const select = useCallback(
    (code: string) => {
      onChange(code);
      setQuery('');
      onClose();
    },
    [onChange, onClose],
  );

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('currencyPicker.title')}
      testID="currency-picker"
    >
      <View className="px-5 pb-2">
        <SearchField
          value={query}
          onChangeText={setQuery}
          label={t('currencyPicker.search')}
          testID="currency-search"
        />
      </View>
      <View style={{ height: height * 0.55 }}>
        {rows.length === 0 ? (
          <Text tone="muted" className="px-5 py-6 text-center">
            {t('currencyPicker.noResults')}
          </Text>
        ) : (
          <FlashList
            data={rows}
            keyExtractor={(row) => row.key}
            getItemType={(row) => row.type}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) =>
              item.type === 'header' ? (
                <Text
                  variant="caption"
                  tone="muted"
                  accessibilityRole="header"
                  className="px-5 pb-1 pt-4 uppercase"
                >
                  {item.label}
                </Text>
              ) : (
                <CurrencyRow
                  code={item.code}
                  name={item.name}
                  selected={item.code === value}
                  onSelect={select}
                />
              )
            }
          />
        )}
      </View>
    </Sheet>
  );
}

interface CurrencyRowProps {
  code: string;
  name: string;
  selected: boolean;
  onSelect: (code: string) => void;
}

const CurrencyRow = memo(function CurrencyRow({
  code,
  name,
  selected,
  onSelect,
}: CurrencyRowProps) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      testID={`currency-${code}`}
      accessibilityRole="radio"
      accessibilityLabel={`${code}, ${name}`}
      accessibilityState={{ checked: selected }}
      onPress={() => onSelect(code)}
      className={cn(
        'min-h-[52px] flex-row items-center gap-3 px-5',
        selected ? 'bg-primary-soft' : 'active:bg-surface-muted',
      )}
    >
      <Text variant="bodyStrong" tabular className="w-12">
        {code}
      </Text>
      <Text tone="muted" numberOfLines={1} className="flex-1">
        {name}
      </Text>
      {selected ? <Check size={20} color={colors.primary} strokeWidth={2.6} /> : null}
    </Pressable>
  );
});

export interface CurrencyFieldProps {
  label: string;
  value: string;
  onPress: () => void;
  disabled?: boolean;
  hint?: string;
  testID?: string;
}

/** Campo de formulario que muestra la moneda elegida y abre el selector. */
export function CurrencyField({
  label,
  value,
  onPress,
  disabled = false,
  hint,
  testID,
}: CurrencyFieldProps) {
  const { locale } = useFormatters();
  const { colors } = useAppTheme();
  const name = currencyName(value, locale);
  return (
    <View className="gap-1.5">
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}, ${name}`}
        accessibilityHint={hint}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        className={cn(
          'min-h-[52px] flex-row items-center gap-3 rounded-md border-[1.5px] border-line-strong bg-surface px-4',
          disabled ? 'opacity-60' : 'active:bg-surface-muted',
        )}
      >
        <Text variant="bodyStrong" tabular>
          {value}
        </Text>
        <Text tone="muted" numberOfLines={1} className="flex-1">
          {name}
        </Text>
        {disabled ? null : <ChevronDown size={20} color={colors.fgMuted} />}
      </Pressable>
      {hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
