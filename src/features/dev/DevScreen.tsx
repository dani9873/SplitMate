import { Stack } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { readCipherVersion } from '@/db/cipher';
import { useDatabase } from '@/db/DatabaseProvider';
import { useDatabaseChanges } from '@/db/use-database-changes';
import { EXACT_SETTLEMENT_LIMIT, money } from '@/domain';
import { formatMoney } from '@/lib/format';
import { Button, Card, Screen, Text } from '@/ui';

import { measureSettlement, type SettlementTiming } from './benchmark';
import './i18n';
import { addRandomExpense, createSampleGroup, resetSampleData } from './sample-data';

/** Marca única: el script de verificación falla si aparece en el bundle de producción. */
export const DEV_SCREEN_MARKER = 'splitmate-dev-screen-v1';

const BENCHMARK_SIZES = [12, 14, 16, 18, 20];

/**
 * Pantalla temporal para probar el motor en el teléfono: crea un grupo de ejemplo, agrega
 * gastos y muestra saldos y transferencias sugeridas. Solo existe en desarrollo.
 */
export function DevScreen() {
  const { t, i18n } = useTranslation('dev');
  const { db, repos } = useDatabase();
  // Vuelve a leer ante cualquier escritura en la base, venga de donde venga.
  useDatabaseChanges();
  const [, setRefresh] = useState(0);
  const [randomCount, setRandomCount] = useState(0);
  const [timings, setTimings] = useState<SettlementTiming[] | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const refresh = () => setRefresh((value) => value + 1);
  const locale = i18n.language;

  const cipherVersion = readCipherVersion(db);
  const group = repos.groups.list()[0];
  const members = group ? repos.members.listByGroup(group.id) : [];
  const names = new Map(members.map((m) => [m.id, m.displayName]));
  const summary = group ? repos.balances.forGroup(group.id) : null;
  const expenses = group ? repos.expenses.listByGroup(group.id) : [];

  const runBenchmark = () => {
    setMeasuring(true);
    // Deja pintar el estado de carga antes de bloquear el hilo de JavaScript.
    setTimeout(() => {
      setTimings(measureSettlement(BENCHMARK_SIZES));
      setMeasuring(false);
    }, 50);
  };

  return (
    <Screen scroll edges={['bottom']} testID={DEV_SCREEN_MARKER}>
      <Stack.Screen options={{ headerShown: true, title: t('title') }} />

      <Card>
        <Text variant="label" tone={cipherVersion ? 'positive' : 'warning'}>
          {cipherVersion
            ? t('database.encrypted', { version: cipherVersion })
            : t('database.plain')}
        </Text>
      </Card>

      <View className="gap-3">
        <Text variant="heading">{t('sample.title')}</Text>
        {group ? (
          <>
            <Text variant="subheading">{group.name}</Text>
            <Button
              label={t('sample.addExpense')}
              onPress={() => {
                const next = randomCount + 1;
                addRandomExpense(repos, group.id, t('sample.random', { number: next }));
                setRandomCount(next);
                refresh();
              }}
            />
            <Button
              label={t('sample.reset')}
              variant="secondary"
              onPress={() => {
                resetSampleData(repos);
                setRandomCount(0);
                refresh();
              }}
            />
          </>
        ) : (
          <>
            <Text tone="muted">{t('sample.empty')}</Text>
            <Button
              label={t('sample.create')}
              onPress={() => {
                createSampleGroup(repos, {
                  groupName: t('sample.groupName'),
                  you: t('sample.you'),
                  hotel: t('sample.hotel'),
                  dinner: t('sample.dinner'),
                  taxi: t('sample.taxi'),
                  refund: t('sample.refund'),
                });
                refresh();
              }}
            />
          </>
        )}
      </View>

      {summary ? (
        <>
          <View className="gap-2">
            <Text variant="heading">{t('balances.title')}</Text>
            <Card className="gap-2">
              {summary.balances.map((balance) => (
                <View key={balance.memberId} className="flex-row justify-between">
                  <Text>{names.get(balance.memberId)}</Text>
                  <Text
                    tabular
                    tone={
                      balance.amount.amount > 0
                        ? 'positive'
                        : balance.amount.amount < 0
                          ? 'negative'
                          : 'muted'
                    }
                  >
                    {formatMoney(balance.amount, locale)}
                  </Text>
                </View>
              ))}
            </Card>
          </View>

          <View className="gap-2">
            <Text variant="heading">{t('settlement.title')}</Text>
            <Card className="gap-2">
              {summary.settlement.length === 0 ? (
                <Text tone="muted">{t('balances.settled')}</Text>
              ) : (
                summary.settlement.map((transfer) => (
                  <Text key={`${transfer.from}-${transfer.to}`}>
                    {t('settlement.item', {
                      from: names.get(transfer.from),
                      to: names.get(transfer.to),
                      amount: formatMoney(transfer.amount, locale),
                    })}
                  </Text>
                ))
              )}
            </Card>
          </View>

          <View className="gap-2">
            <Text variant="heading">{t('expenses.title')}</Text>
            <Card className="gap-2">
              {expenses.map((expense) => (
                <View key={expense.id} className="flex-row justify-between gap-3">
                  <Text className="flex-1">{expense.title}</Text>
                  <Text tabular tone="muted">
                    {formatMoney(money(expense.amount, expense.currency), locale)}
                  </Text>
                </View>
              ))}
            </Card>
          </View>
        </>
      ) : null}

      <View className="gap-3">
        <Text variant="heading">{t('benchmark.title')}</Text>
        <Text tone="muted">{t('benchmark.limit', { limit: EXACT_SETTLEMENT_LIMIT })}</Text>
        <Button
          label={measuring ? t('benchmark.running') : t('benchmark.run')}
          loading={measuring}
          variant="secondary"
          onPress={runBenchmark}
        />
        {timings?.map((timing) => (
          <Text key={timing.members} tabular>
            {t('benchmark.result', { members: timing.members, ms: timing.ms })}
          </Text>
        ))}
      </View>
    </Screen>
  );
}
