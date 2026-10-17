import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { ALL_TABLES } from '@/db/changes';
import { useDatabase } from '@/db/DatabaseProvider';
import { useLiveQuery } from '@/db/use-live-query';
import { Button, Card, ErrorState, LoadingState, Sheet, Text } from '@/ui';

import { describeError } from '../errors/describe-error';
import {
  applyMine,
  deleteNow,
  readConflictItem,
  reasonKey,
  type ConflictItem,
  type FieldDiff,
} from './conflict-review';
import { useGuardedRouter } from '@/features/navigation/use-guarded-router';

export interface ConflictSheetProps {
  visible: boolean;
  onClose: () => void;
  groupId: string;
}

/**
 * Los cambios tuyos que el servidor no aplicó, uno por tarjeta, con lo que se puede hacer con cada
 * uno. Lo que se ve en la app ya es la versión actual; aquí se decide qué pasa con la tuya. Nada se
 * borra sin que el usuario lo elija.
 */
export function ConflictSheet({ visible, onClose, groupId }: ConflictSheetProps) {
  const { t } = useTranslation();
  const router = useGuardedRouter();
  const { repos } = useDatabase();
  const query = useLiveQuery(
    (r) => r.conflicts.list(groupId).map((draft) => readConflictItem(r, draft)),
    { tables: [...ALL_TABLES, 'sync_conflicts'], groupId },
    [groupId],
  );
  const [confirming, setConfirming] = useState<string | null>(null);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  /** Corre la elección del usuario; si falla, lo explica y el borrador sigue. */
  const run = (item: ConflictItem, action: () => void) => {
    try {
      action();
      setErrors(({ [item.draft.id]: _removed, ...rest }) => rest);
    } catch (error) {
      setErrors((current) => ({ ...current, [item.draft.id]: describeError(error, t) }));
    }
    setConfirming(null);
  };
  const discard = (item: ConflictItem) => run(item, () => repos.conflicts.discard(item.draft.id));

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('sync.review.title')}
      testID="conflict-sheet"
    >
      <ScrollView contentContainerClassName="gap-3 px-5 pb-4" keyboardShouldPersistTaps="handled">
        <Text tone="muted">{t('sync.review.intro')}</Text>
        {query.status === 'loading' ? <LoadingState rows={2} /> : null}
        {query.status === 'error' ? <ErrorState onRetry={query.retry} /> : null}
        {query.status === 'ready'
          ? query.data.map((item) => (
              <ItemCard
                key={item.draft.id}
                item={item}
                error={errors[item.draft.id]}
                confirming={confirming === item.draft.id}
                onAsk={() => setConfirming(item.draft.id)}
                onCancel={() => setConfirming(null)}
                onDiscard={() => discard(item)}
                onOpenForm={() => {
                  if (item.route) {
                    onClose();
                    router.push(item.route);
                  }
                }}
                onDeleteNow={() => run(item, () => deleteNow(repos, item))}
                onUseMine={() => run(item, () => applyMine(repos, item))}
              />
            ))
          : null}
      </ScrollView>
    </Sheet>
  );
}

interface ItemCardProps {
  item: ConflictItem;
  error: string | undefined;
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onDiscard: () => void;
  onOpenForm: () => void;
  onDeleteNow: () => void;
  onUseMine: () => void;
}

function ItemCard({
  item,
  error,
  confirming,
  onAsk,
  onCancel,
  onDiscard,
  onOpenForm,
  onDeleteNow,
  onUseMine,
}: ItemCardProps) {
  const { t } = useTranslation();
  const { draft } = item;
  const id = draft.id;
  // "Entendido": no hay nada que aplicar, solo enterarse.
  const onlyAcknowledge =
    (item.kind === 'deletion' && !item.canDeleteNow) ||
    (item.kind === 'fields' && !item.canUseMine);

  return (
    <Card testID={`conflict-item-${id}`} className="gap-3">
      <View className="gap-1">
        <Text variant="bodyStrong">{item.label || t('sync.review.noLabel')}</Text>
        <Text variant="caption" tone="muted">
          {t(`sync.review.entity.${draft.entity}`)}
        </Text>
        <Text variant="label">{t(`sync.review.reason.${reasonKey(draft)}`)}</Text>
      </View>

      {item.kind === 'fields' ? <Diffs item={item} /> : null}
      {item.kind === 'deletion' ? (
        <Text tone="muted">
          {item.canDeleteNow ? t('sync.review.deletionHint') : t('sync.review.deletionGone')}
        </Text>
      ) : null}

      {error ? (
        <Text tone="warning" testID={`conflict-error-${id}`}>
          {error}
        </Text>
      ) : null}

      {confirming ? (
        <View className="gap-2">
          <Text>{t('sync.review.action.discardConfirm')}</Text>
          <View className="flex-row flex-wrap justify-end gap-2">
            <Button label={t('common.cancel')} size="sm" variant="secondary" onPress={onCancel} />
            <Button
              testID={`conflict-discard-confirm-${id}`}
              label={t('sync.review.action.discardYes')}
              size="sm"
              variant="danger"
              onPress={onDiscard}
            />
          </View>
        </View>
      ) : (
        <View className="flex-row flex-wrap justify-end gap-2">
          {item.kind === 'movement' ? (
            <>
              <Button
                testID={`conflict-discard-${id}`}
                label={t('sync.review.action.discard')}
                size="sm"
                variant="secondary"
                onPress={onAsk}
              />
              <Button
                testID={`conflict-open-${id}`}
                label={t('sync.review.action.openForm')}
                size="sm"
                onPress={onOpenForm}
              />
            </>
          ) : null}
          {item.kind === 'deletion' && item.canDeleteNow ? (
            <>
              <Button
                testID={`conflict-keep-${id}`}
                label={t('sync.review.action.keep')}
                size="sm"
                variant="secondary"
                onPress={onDiscard}
              />
              <Button
                testID={`conflict-delete-now-${id}`}
                label={t('sync.review.action.deleteNow')}
                size="sm"
                variant="danger"
                onPress={onDeleteNow}
              />
            </>
          ) : null}
          {item.kind === 'fields' && item.canUseMine ? (
            <>
              <Button
                testID={`conflict-keep-${id}`}
                label={t('sync.review.action.keepCurrent')}
                size="sm"
                variant="secondary"
                onPress={onDiscard}
              />
              <Button
                testID={`conflict-use-mine-${id}`}
                label={t('sync.review.action.useMine')}
                size="sm"
                onPress={onUseMine}
              />
            </>
          ) : null}
          {onlyAcknowledge ? (
            <Button
              testID={`conflict-understood-${id}`}
              label={t('sync.review.action.understood')}
              size="sm"
              onPress={onDiscard}
            />
          ) : null}
        </View>
      )}
    </Card>
  );
}

/** Los campos que difieren, con tu valor y el actual uno bajo el otro. */
function Diffs({ item }: { item: ConflictItem }) {
  const { t } = useTranslation();
  if (item.diffs.length === 0) {
    return <Text tone="muted">{t('sync.review.noDiff')}</Text>;
  }
  const show = (diff: FieldDiff, value: string) =>
    diff.field === 'archived'
      ? t(value === 'true' ? 'sync.review.yes' : 'sync.review.no')
      : value === ''
        ? '—'
        : value;
  return (
    <View className="gap-2">
      {item.diffs.map((diff) => (
        <View key={diff.field} className="gap-0.5">
          <Text variant="caption" tone="muted">
            {t(`sync.review.field.${diff.field}`)}
          </Text>
          <View className="flex-row items-baseline gap-2">
            <Text variant="label" tone="muted">
              {t('sync.review.mine')}
            </Text>
            <Text
              variant="bodyStrong"
              className="flex-1"
              testID={`conflict-diff-${diff.field}-mine`}
            >
              {show(diff, diff.mine)}
            </Text>
          </View>
          <View className="flex-row items-baseline gap-2">
            <Text variant="label" tone="muted">
              {t('sync.review.current')}
            </Text>
            <Text
              variant="bodyStrong"
              className="flex-1"
              testID={`conflict-diff-${diff.field}-current`}
            >
              {show(diff, diff.current)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}
