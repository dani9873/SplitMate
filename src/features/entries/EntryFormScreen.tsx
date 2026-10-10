import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { FileClock } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch, type Resolver } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { AppState, Keyboard, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { ALL_TABLES } from '@/db/changes';
import { useDatabase } from '@/db/DatabaseProvider';
import type { Repositories } from '@/db/repositories';
import { useLiveQuery } from '@/db/use-live-query';
import { currencyCode, minorUnits } from '@/domain';
import { useFormatters } from '@/i18n';
import { today as localToday, type CalendarDate } from '@/lib/calendar-date';
import {
  Banner,
  Button,
  EmptyState,
  ErrorState,
  Input,
  Keypad,
  LoadingState,
  SegmentedControl,
  Text,
  type KeypadKey,
} from '@/ui';

import { useCategories } from '../categories';
import { CurrencyPicker, currencyName } from '../currency';
import { describeError } from '../errors/describe-error';
import { ScreenHeader, useRouteChoice, useRouteId } from '../navigation';
import { AmountField } from './AmountField';
import {
  defaultEntryValues,
  entryDraftSchema,
  evaluateEntry,
  hasContent,
  problemOf,
  valuesFromExpense,
  valuesFromTransfer,
  type EntryContext,
  type EntryFormValues,
  type EntryType,
} from './entry-form';
import {
  CategoryField,
  DateField,
  MemberSelect,
  PayersSection,
  SectionLabel,
  SplitSection,
  type FormMember,
} from './form-sections';
import { applyKey } from './keypad-input';
import { problemMessage } from './problem-message';

const ENTRY_TYPES: readonly EntryType[] = ['expense', 'income', 'transfer'];

interface Existing {
  readonly kind: 'entry' | 'transfer';
  readonly id: string;
  readonly version: number;
  readonly values: EntryFormValues;
}

interface FormData {
  readonly context: EntryContext;
  readonly members: readonly FormMember[];
  readonly initial: EntryFormValues;
  readonly existing: Existing | null;
}

interface LoadOptions {
  readonly groupId: string;
  readonly entryId: string | null;
  readonly type: EntryType;
  readonly today: CalendarDate;
  readonly you: (name: string) => string;
  readonly removed: (name: string) => string;
}

/** Lee lo que necesita el formulario. `null` si el grupo o el movimiento no existen. */
function loadForm(repos: Repositories, options: LoadOptions): FormData | null {
  const group = repos.groups.get(options.groupId);
  if (!group || group.archivedAt !== null) {
    return null;
  }
  const localUserId = repos.profile.get()?.id ?? null;
  const all = repos.members.listAll(group.id);
  const expense = options.entryId ? repos.expenses.get(options.entryId) : undefined;
  const transfer = options.entryId && !expense ? repos.transfers.get(options.entryId) : undefined;
  if (options.entryId && !expense && !transfer) {
    return null;
  }
  // Activos más los quitados que ya están en el movimiento que se edita.
  const referenced = new Set<string>([
    ...(expense?.payers.map((p) => p.memberId) ?? []),
    ...(expense?.splits.map((s) => s.memberId) ?? []),
    ...(transfer ? [transfer.fromMemberId, transfer.toMemberId] : []),
  ]);
  const members = all
    .filter((m) => m.deletedAt === null || referenced.has(m.id))
    .map((m) => {
      const isMe = m.deletedAt === null && m.userId !== null && m.userId === localUserId;
      return {
        id: m.id,
        isMe,
        label: m.deletedAt
          ? options.removed(m.displayName)
          : isMe
            ? options.you(m.displayName)
            : m.displayName,
      };
    });
  const memberIds = members.map((m) => m.id);
  const meId = members.find((m) => m.isMe)?.id ?? null;
  const base = defaultEntryValues({
    type: transfer ? 'transfer' : (expense?.kind ?? options.type),
    currency: group.currency,
    memberIds,
    meId,
    today: options.today,
  });
  const existing: Existing | null = expense
    ? {
        kind: 'entry',
        id: expense.id,
        version: expense.version,
        values: valuesFromExpense(expense, base),
      }
    : transfer
      ? {
          kind: 'transfer',
          id: transfer.id,
          version: transfer.version,
          values: valuesFromTransfer(transfer, base),
        }
      : null;
  return {
    context: { groupId: group.id, groupCurrency: group.currency, memberIds },
    members,
    initial: existing?.values ?? base,
    existing,
  };
}

/** Pantalla de nuevo movimiento o de edición, según la ruta. */
export function EntryFormScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const groupId = useRouteId('groupId');
  const entryId = useRouteId('entryId');
  const type = useRouteChoice('type', ENTRY_TYPES, 'expense');
  // La fecha de hoy se fija al abrir: si el formulario queda abierto pasada la medianoche, no
  // cambia sola.
  const [today] = useState(() => localToday());
  const query = useLiveQuery(
    (repos) =>
      groupId
        ? loadForm(repos, {
            groupId,
            entryId,
            type,
            today,
            you: (name) => t('common.youSuffix', { name }),
            removed: (name) => t('common.removedSuffix', { name }),
          })
        : null,
    { tables: ALL_TABLES, groupId: groupId ?? undefined },
    [groupId, entryId, type, today],
  );
  // El formulario se arma una sola vez con los datos del primer momento; los cambios
  // posteriores de la base no lo reinician mientras se edita.
  const [data, setData] = useState<FormData | null | undefined>(undefined);
  if (data === undefined && query.status === 'ready') {
    setData(query.data);
  }

  if (data === undefined) {
    return (
      <View className="flex-1 bg-background px-5" style={{ paddingTop: insets.top }}>
        <ScreenHeader title={t('entries.newTitle.expense')} variant="modal" />
        {query.status === 'error' ? (
          <ErrorState onRetry={query.retry} />
        ) : (
          <LoadingState rows={3} />
        )}
      </View>
    );
  }
  if (data === null || !groupId) {
    return (
      <View className="flex-1 bg-background px-5" style={{ paddingTop: insets.top }}>
        <ScreenHeader title={t('common.notFound.title')} variant="modal" />
        <EmptyState
          icon={FileClock}
          title={t('common.notFound.title')}
          description={t('common.notFound.description')}
          action={{ label: t('common.notFound.action'), onPress: () => router.replace('/') }}
        />
      </View>
    );
  }
  return <EntryForm data={data} today={today} />;
}

function EntryForm({ data, today }: { data: FormData; today: CalendarDate }) {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { repos } = useDatabase();
  const formatters = useFormatters();
  const categories = useCategories();
  const { context, members, existing } = data;
  const isNew = existing === null;
  const [activeField, setActiveField] = useState<string | null>(isNew ? 'total' : null);
  const [pickingCurrency, setPickingCurrency] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState(() =>
    isNew ? repos.drafts.get(context.groupId, entryDraftSchema) : null,
  );
  const saved = useRef(false);

  const schema = useMemo(
    () =>
      z.custom<EntryFormValues>().superRefine((values, ctx) => {
        for (const problem of evaluateEntry(values, context).problems) {
          ctx.addIssue({ code: 'custom', path: [problem.field], message: problem.code });
        }
      }),
    [context],
  );
  const { control, setValue, getValues, reset, handleSubmit } = useForm<EntryFormValues>({
    resolver: zodResolver(schema) as Resolver<EntryFormValues>,
    defaultValues: data.initial,
  });
  const values = useWatch({ control }) as EntryFormValues;
  const evaluation = useMemo(() => evaluateEntry(values, context), [values, context]);
  const set = useCallback(
    <K extends keyof EntryFormValues>(key: K, value: EntryFormValues[K]) => {
      setSubmitError(null);
      setValue(key as never, value as never, { shouldDirty: true });
    },
    [setValue],
  );
  const message = (field: Parameters<typeof problemOf>[1]) => {
    const problem = problemOf(evaluation, field);
    return problem
      ? problemMessage(problem, values.currency, t, formatters.money, formatters.decimalSeparator)
      : undefined;
  };

  // Borrador: se guarda al pasar a segundo plano y al salir sin guardar, si hay algo escrito.
  const saveDraft = useCallback(() => {
    const current = getValues();
    if (isNew && !saved.current && hasContent(current)) {
      repos.drafts.save(context.groupId, { v: 1, values: current });
    }
  }, [context.groupId, getValues, isNew, repos]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        saveDraft();
      }
    });
    return () => {
      subscription.remove();
      saveDraft();
    };
  }, [saveDraft]);

  const restoreDraft = () => {
    if (!draft) {
      return;
    }
    const known = new Set(context.memberIds);
    const keep = <T,>(record: Record<string, T>) =>
      Object.fromEntries(Object.entries(record).filter(([id]) => known.has(id)));
    const restored = draft.values;
    reset({
      ...data.initial,
      ...restored,
      payerId:
        restored.payerId && known.has(restored.payerId) ? restored.payerId : data.initial.payerId,
      fromId: restored.fromId && known.has(restored.fromId) ? restored.fromId : data.initial.fromId,
      toId: restored.toId && known.has(restored.toId) ? restored.toId : data.initial.toId,
      payerExpressions: keep(restored.payerExpressions),
      participants: { ...data.initial.participants, ...keep(restored.participants) },
      exactExpressions: keep(restored.exactExpressions),
      percents: keep(restored.percents),
      shares: { ...data.initial.shares, ...keep(restored.shares) },
    });
    repos.drafts.discard(context.groupId);
    setDraft(null);
  };
  const discardDraft = () => {
    repos.drafts.discard(context.groupId);
    setDraft(null);
  };

  const onKey = useCallback(
    (key: KeypadKey) => {
      if (key === 'done') {
        setActiveField(null);
        return;
      }
      const current = getValues();
      const currency = currencyCode(current.currency);
      if (activeField === 'total') {
        set('expression', applyKey(current.expression, key, currency));
      } else if (activeField?.startsWith('payer:')) {
        const id = activeField.slice('payer:'.length);
        set('payerExpressions', {
          ...current.payerExpressions,
          [id]: applyKey(current.payerExpressions[id] ?? '', key, currency),
        });
      } else if (activeField?.startsWith('exact:')) {
        const id = activeField.slice('exact:'.length);
        set('exactExpressions', {
          ...current.exactExpressions,
          [id]: applyKey(current.exactExpressions[id] ?? '', key, currency),
        });
      }
    },
    [activeField, getValues, set],
  );
  const activate = useCallback((field: string) => {
    Keyboard.dismiss();
    setActiveField(field);
  }, []);

  // handleSubmit se llama al tocar Guardar, no durante el render.
  const save = () =>
    handleSubmit(
      (form) => {
        const result = evaluateEntry(form, context);
        if (!result.input) {
          return;
        }
        try {
          if (result.input.kind === 'entry') {
            if (existing) {
              repos.expenses.update(existing.id, existing.version, result.input.value);
            } else {
              repos.expenses.add(result.input.value);
            }
          } else if (existing) {
            repos.transfers.update(existing.id, existing.version, result.input.value);
          } else {
            repos.transfers.add(result.input.value);
          }
          saved.current = true;
          if (isNew) {
            repos.drafts.discard(context.groupId);
          }
          router.back();
        } catch (error) {
          setSubmitError(describeError(error, t));
        }
      },
      () => setTouched({ expression: true, title: true }),
    )();

  const kind = values.type === 'transfer' ? null : values.type;
  const otherCurrency = values.currency !== context.groupCurrency;
  const firstProblem = evaluation.problems[0];
  const blocked = evaluation.input === null;
  const title = isNew
    ? t(`entries.newTitle.${values.type}`)
    : t(`entries.editTitle.${values.type}`);
  const amountError =
    values.expression !== '' || touched.expression ? message('expression') : undefined;

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top }}
      testID="entry-form-screen"
    >
      <View className="px-5">
        <ScreenHeader
          title={title}
          variant="modal"
          actions={
            <Button
              testID="save-entry"
              label={t('entries.save')}
              size="sm"
              onPress={save}
              disabled={blocked}
              accessibilityHint={
                blocked && firstProblem
                  ? t('entries.cannotSave', {
                      reason: problemMessage(
                        firstProblem,
                        values.currency,
                        t,
                        formatters.money,
                        formatters.decimalSeparator,
                      ),
                    })
                  : undefined
              }
            />
          }
        />
      </View>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pb-10 pt-2"
        keyboardShouldPersistTaps="handled"
      >
        {draft ? (
          <Banner
            testID="draft-banner"
            icon={FileClock}
            message={
              draft.values.title.trim()
                ? t('entries.draft.found', { summary: draft.values.title.trim() })
                : t('entries.draft.foundUntitled')
            }
            actions={
              <>
                <Button
                  label={t('entries.draft.discard')}
                  size="sm"
                  variant="ghost"
                  onPress={discardDraft}
                />
                <Button
                  label={t('entries.draft.restore')}
                  size="sm"
                  variant="secondary"
                  onPress={restoreDraft}
                />
              </>
            }
          />
        ) : null}

        {isNew ? (
          <SegmentedControl
            label={t('entries.type.label')}
            value={values.type}
            onChange={(next) => set('type', next)}
            segments={ENTRY_TYPES.map((value) => ({
              value,
              label: t(`entries.type.${value}`),
              testID: `type-${value}`,
            }))}
          />
        ) : null}

        <View className="gap-3">
          <AmountField
            testID="amount-field"
            label={t('entries.amount.label')}
            expression={values.expression}
            currency={values.currency}
            active={activeField === 'total'}
            onActivate={() => activate('total')}
            error={amountError}
          />
          <Button
            testID="entry-currency"
            label={`${values.currency} · ${currencyName(values.currency, formatters.locale)}`}
            accessibilityLabel={t('entries.currency.change', { currency: values.currency })}
            variant="ghost"
            size="sm"
            onPress={() => setPickingCurrency(true)}
            className="self-start"
          />
          {otherCurrency ? (
            <View className="gap-1">
              <Input
                testID="exchange-rate"
                label={t('entries.currency.rateLabel', {
                  from: values.currency,
                  to: context.groupCurrency,
                })}
                hint={t('entries.currency.rateHint', {
                  from: values.currency,
                  to: context.groupCurrency,
                })}
                value={values.rate}
                onChangeText={(text) => set('rate', text.slice(0, 32))}
                onFocus={() => setActiveField(null)}
                keyboardType="decimal-pad"
                error={values.rate !== '' || touched.rate ? message('rate') : undefined}
              />
              {evaluation.converted ? (
                <Text variant="label" tone="muted" tabular>
                  {t('entries.currency.converted', {
                    amount: formatters.money(evaluation.converted),
                  })}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>

        {kind ? (
          <>
            <Input
              testID="entry-title"
              label={t('entries.title.label')}
              placeholder={t('entries.title.placeholder')}
              value={values.title}
              onChangeText={(text) => set('title', text)}
              onFocus={() => setActiveField(null)}
              onBlur={() => setTouched((state) => ({ ...state, title: true }))}
              maxLength={120}
              error={touched.title ? message('title') : undefined}
            />
            <CategoryField
              categories={categories}
              value={values.categoryId}
              onChange={(id) => set('categoryId', id)}
            />
            <DateField
              value={values.occurredOn}
              today={today}
              onChange={(date) => set('occurredOn', date)}
            />
            <PayersSection
              kind={kind}
              values={values}
              set={set}
              members={members}
              activeField={activeField}
              onActivate={activate}
              problem={message('payers')}
            />
            <SplitSection
              kind={kind}
              values={values}
              set={set}
              members={members}
              shares={evaluation.shares}
              activeField={activeField}
              onActivate={activate}
              onTextFocus={() => setActiveField(null)}
              problem={message('split')}
            />
          </>
        ) : (
          <>
            <View className="gap-3">
              <SectionLabel>{t('entries.type.transfer')}</SectionLabel>
              <MemberSelect
                testID="transfer-from"
                label={t('entries.transfer.from')}
                pickTitle={t('entries.transfer.pickFrom')}
                members={members}
                value={values.fromId}
                onChange={(id) => set('fromId', id)}
              />
              <MemberSelect
                testID="transfer-to"
                label={t('entries.transfer.to')}
                pickTitle={t('entries.transfer.pickTo')}
                members={members}
                value={values.toId}
                onChange={(id) => set('toId', id)}
              />
              {message('transfer') ? (
                <Text variant="caption" tone="negative" accessibilityRole="alert">
                  {message('transfer')}
                </Text>
              ) : null}
            </View>
            <DateField
              value={values.occurredOn}
              today={today}
              onChange={(date) => set('occurredOn', date)}
            />
          </>
        )}

        {submitError ? (
          <Text tone="negative" accessibilityRole="alert">
            {submitError}
          </Text>
        ) : blocked && firstProblem && (values.expression !== '' || touched.expression) ? (
          <Text variant="caption" tone="muted" testID="cannot-save">
            {t('entries.cannotSave', {
              reason: problemMessage(
                firstProblem,
                values.currency,
                t,
                formatters.money,
                formatters.decimalSeparator,
              ),
            })}
          </Text>
        ) : null}
      </ScrollView>

      {activeField ? (
        <View style={{ paddingBottom: insets.bottom }} className="bg-surface-muted">
          <Keypad
            onKey={onKey}
            decimalSeparator={formatters.decimalSeparator}
            allowDecimal={minorUnits(currencyCode(values.currency)) > 0}
          />
        </View>
      ) : null}

      <CurrencyPicker
        visible={pickingCurrency}
        value={values.currency}
        suggested={[context.groupCurrency, 'USD', 'EUR']}
        onChange={(code) => {
          set('currency', code);
          if (code === context.groupCurrency) {
            set('rate', '');
          }
        }}
        onClose={() => setPickingCurrency(false)}
      />
    </View>
  );
}
