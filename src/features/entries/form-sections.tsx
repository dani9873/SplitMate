import { CalendarDays, ChevronDown } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Switch, TextInput, View } from 'react-native';

import type { Money } from '@/domain';
import { useFormatters } from '@/i18n';
import { addDays, type CalendarDate } from '@/lib/calendar-date';
import {
  Calendar,
  Checkbox,
  Chip,
  cn,
  MemberAvatar,
  SegmentedControl,
  Sheet,
  Stepper,
  Text,
  useAppTheme,
} from '@/ui';

import { categoryIcon, type CategoryOption } from '../categories';
import { MemberPicker } from '../members';
import { AmountField } from './AmountField';
import { SPLIT_METHODS, type EntryFormValues } from './entry-form';

/** Miembro tal como lo muestra el formulario. */
export interface FormMember {
  readonly id: string;
  /** Nombre visible, con "(tú)" o "(ya no está)" si corresponde. */
  readonly label: string;
  readonly isMe: boolean;
}

type SetValue = <K extends keyof EntryFormValues>(key: K, value: EntryFormValues[K]) => void;

export function SectionLabel({ children }: { children: string }) {
  return (
    <Text variant="label" tone="muted" accessibilityRole="header">
      {children}
    </Text>
  );
}

/** Línea de estado bajo una sección: lo que falta en rojo, o que cuadra. */
function StatusLine({ problem, ok }: { problem?: string; ok: string }) {
  return problem ? (
    <Text
      variant="caption"
      tone="negative"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      {problem}
    </Text>
  ) : (
    <Text variant="caption" tone="positive">
      {ok}
    </Text>
  );
}

/** Fila que abre el selector de miembros: "Pagó · Ana (tú)". */
export function MemberSelect({
  label,
  pickTitle,
  members,
  value,
  onChange,
  testID,
}: {
  label: string;
  pickTitle: string;
  members: readonly FormMember[];
  value: string | null;
  onChange: (id: string) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const [open, setOpen] = useState(false);
  const selected = members.find((m) => m.id === value);
  return (
    <>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={t('entries.payer.change', { label, name: selected?.label ?? '—' })}
        onPress={() => setOpen(true)}
        className="min-h-[52px] flex-row items-center gap-3 rounded-md border-[1.5px] border-line-strong bg-surface px-3 active:bg-surface-muted"
      >
        <Text variant="label" tone="muted" className="w-16">
          {label}
        </Text>
        {selected ? <MemberAvatar name={selected.label} highlight={selected.isMe} /> : null}
        <Text variant="bodyStrong" className="flex-1" numberOfLines={1}>
          {selected?.label ?? pickTitle}
        </Text>
        <ChevronDown size={20} color={colors.fgMuted} />
      </Pressable>
      <MemberPicker
        visible={open}
        title={pickTitle}
        members={members}
        value={value}
        onChange={onChange}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

export interface PayersSectionProps {
  kind: 'expense' | 'income';
  values: EntryFormValues;
  set: SetValue;
  members: readonly FormMember[];
  activeField: string | null;
  onActivate: (field: string) => void;
  problem?: string;
}

/** Quién pagó (o recibió): uno por defecto, o varios con su monto. */
export function PayersSection({
  kind,
  values,
  set,
  members,
  activeField,
  onActivate,
  problem,
}: PayersSectionProps) {
  const { t } = useTranslation();
  const multipleLabel = t(`entries.payer.multiple.${kind}`);
  return (
    <View className="gap-3">
      {values.multiplePayers ? (
        <SectionLabel>{t(`entries.payer.label.${kind}`)}</SectionLabel>
      ) : (
        <MemberSelect
          testID="payer-select"
          label={t(`entries.payer.label.${kind}`)}
          pickTitle={t(`entries.payer.pick.${kind}`)}
          members={members}
          value={values.payerId}
          onChange={(id) => set('payerId', id)}
        />
      )}
      <View className="min-h-[44px] flex-row items-center gap-3">
        <Text className="flex-1">{multipleLabel}</Text>
        <Switch
          testID="multiple-payers"
          accessibilityLabel={multipleLabel}
          value={values.multiplePayers}
          onValueChange={(on) => set('multiplePayers', on)}
        />
      </View>
      {values.multiplePayers ? (
        <View className="gap-2">
          {members.map((member) => {
            const field = `payer:${member.id}`;
            return (
              <View key={member.id} className="flex-row items-center gap-3">
                <MemberAvatar name={member.label} highlight={member.isMe} />
                <Text className="flex-1" numberOfLines={1}>
                  {member.label}
                </Text>
                <AmountField
                  size="compact"
                  testID={`payer-amount-${member.id}`}
                  label={t('entries.payer.amountLabel', { name: member.label })}
                  expression={values.payerExpressions[member.id] ?? ''}
                  currency={values.currency}
                  active={activeField === field}
                  onActivate={() => onActivate(field)}
                />
              </View>
            );
          })}
          <StatusLine problem={problem} ok={t('entries.payer.matches')} />
        </View>
      ) : null}
    </View>
  );
}

export interface SplitSectionProps {
  kind: 'expense' | 'income';
  values: EntryFormValues;
  set: SetValue;
  members: readonly FormMember[];
  shares: ReadonlyMap<string, Money>;
  activeField: string | null;
  onActivate: (field: string) => void;
  onTextFocus: () => void;
  problem?: string;
}

/** Entre quiénes se divide y cómo, con lo que le toca a cada uno en vivo. */
export function SplitSection({
  kind,
  values,
  set,
  members,
  shares,
  activeField,
  onActivate,
  onTextFocus,
  problem,
}: SplitSectionProps) {
  const { t } = useTranslation();
  const { money } = useFormatters();
  const { colors } = useAppTheme();
  const shareText = (id: string) => {
    const share = shares.get(id);
    return share ? money(share) : '—';
  };
  const shareA11y = (id: string) => {
    const share = shares.get(id);
    return share ? t('entries.split.shareA11y', { amount: money(share) }) : undefined;
  };

  return (
    <View className="gap-3">
      <SectionLabel>{t(`entries.split.label.${kind}`)}</SectionLabel>
      <SegmentedControl
        label={t('entries.split.method.label')}
        value={values.splitMethod}
        onChange={(method) => set('splitMethod', method)}
        segments={SPLIT_METHODS.map((method) => ({
          value: method,
          testID: `split-${method}`,
          label:
            method === 'percentage'
              ? t('entries.split.methodA11y.percentage')
              : t(`entries.split.method.${method}`),
        }))}
      />
      <View className="gap-1">
        {members.map((member) => {
          switch (values.splitMethod) {
            case 'equal':
              return (
                <Checkbox
                  key={member.id}
                  testID={`participant-${member.id}`}
                  label={member.label}
                  checked={Boolean(values.participants[member.id])}
                  onChange={(checked) =>
                    set('participants', { ...values.participants, [member.id]: checked })
                  }
                  trailing={
                    <Text tabular tone="muted" accessibilityLabel={shareA11y(member.id)}>
                      {values.participants[member.id] ? shareText(member.id) : '—'}
                    </Text>
                  }
                />
              );
            case 'exact': {
              const field = `exact:${member.id}`;
              return (
                <View key={member.id} className="min-h-[52px] flex-row items-center gap-3">
                  <MemberAvatar name={member.label} highlight={member.isMe} />
                  <Text className="flex-1" numberOfLines={1}>
                    {member.label}
                  </Text>
                  <AmountField
                    size="compact"
                    testID={`exact-amount-${member.id}`}
                    label={t('entries.split.amountLabel', { name: member.label })}
                    expression={values.exactExpressions[member.id] ?? ''}
                    currency={values.currency}
                    active={activeField === field}
                    onActivate={() => onActivate(field)}
                  />
                </View>
              );
            }
            case 'percentage':
              return (
                <View key={member.id} className="min-h-[52px] flex-row items-center gap-3">
                  <MemberAvatar name={member.label} highlight={member.isMe} />
                  <Text className="flex-1" numberOfLines={1}>
                    {member.label}
                  </Text>
                  <Text tabular tone="muted" accessibilityLabel={shareA11y(member.id)}>
                    {shareText(member.id)}
                  </Text>
                  <View className="flex-row items-center gap-1">
                    <TextInput
                      testID={`percent-${member.id}`}
                      accessibilityLabel={t('entries.split.percentLabel', { name: member.label })}
                      value={values.percents[member.id] ?? ''}
                      onChangeText={(text) =>
                        set('percents', { ...values.percents, [member.id]: text.slice(0, 6) })
                      }
                      onFocus={onTextFocus}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={colors.fgSubtle}
                      selectionColor={colors.primary}
                      className="min-h-[44px] w-20 rounded-md border-[1.5px] border-line-strong bg-surface px-3 text-right font-sans-semibold text-[16px] text-fg"
                    />
                    <Text tone="muted">%</Text>
                  </View>
                </View>
              );
            case 'shares':
              return (
                <View key={member.id} className="min-h-[52px] flex-row items-center gap-2">
                  <MemberAvatar name={member.label} highlight={member.isMe} />
                  <Text className="flex-1" numberOfLines={1}>
                    {member.label}
                  </Text>
                  <Text tabular tone="muted" accessibilityLabel={shareA11y(member.id)}>
                    {shareText(member.id)}
                  </Text>
                  <Stepper
                    label={t('entries.split.sharesLabel', { name: member.label })}
                    value={values.shares[member.id] ?? 0}
                    min={0}
                    max={99}
                    onChange={(value) => set('shares', { ...values.shares, [member.id]: value })}
                  />
                </View>
              );
          }
        })}
      </View>
      <StatusLine problem={problem} ok={t('entries.split.matches')} />
    </View>
  );
}

/** Fecha con atajos de hoy y ayer, y el calendario propio para cualquier otro día. */
export function DateField({
  value,
  today,
  onChange,
}: {
  value: CalendarDate;
  today: CalendarDate;
  onChange: (date: CalendarDate) => void;
}) {
  const { t } = useTranslation();
  const { locale, weekStartsOn, day } = useFormatters();
  const [open, setOpen] = useState(false);
  const yesterday = addDays(today, -1);
  const isOther = value !== today && value !== yesterday;
  return (
    <View className="gap-2">
      <SectionLabel>{t('entries.date.label')}</SectionLabel>
      <View className="flex-row flex-wrap gap-2">
        <Chip
          label={t('entries.date.today')}
          selected={value === today}
          onPress={() => onChange(today)}
        />
        <Chip
          label={t('entries.date.yesterday')}
          selected={value === yesterday}
          onPress={() => onChange(yesterday)}
        />
        <Chip
          testID="date-other"
          label={isOther ? day(value, 'medium') : t('entries.date.other')}
          icon={CalendarDays}
          selected={isOther}
          onPress={() => setOpen(true)}
          accessibilityHint={t('entries.date.pick')}
        />
      </View>
      <Sheet visible={open} onClose={() => setOpen(false)} title={t('entries.date.pick')}>
        <Calendar
          value={value}
          today={today}
          locale={locale}
          weekStartsOn={weekStartsOn}
          onChange={(date) => {
            onChange(date);
            setOpen(false);
          }}
        />
      </Sheet>
    </View>
  );
}

/** Categorías como chips en una fila desplazable. Tocar la elegida la quita. */
export function CategoryField({
  categories,
  value,
  onChange,
}: {
  categories: readonly CategoryOption[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="gap-2">
      <SectionLabel>{t('entries.category.label')}</SectionLabel>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2"
        className={cn('-mx-5')}
        contentContainerStyle={{ paddingHorizontal: 20 }}
      >
        {categories.map((category) => (
          <Chip
            key={category.id}
            testID={`category-${category.id}`}
            label={category.label}
            icon={categoryIcon(category.icon)}
            selected={category.id === value}
            onPress={() => onChange(category.id === value ? null : category.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
}
