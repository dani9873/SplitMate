import { Compass, Link2, Share2 } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Share, View } from 'react-native';

import { ALL_TABLES } from '@/db/changes';
import { useDatabase } from '@/db/DatabaseProvider';
import type { InvitationLink, Repositories } from '@/db/repositories';
import { useLiveQuery } from '@/db/use-live-query';
import { useFormatters } from '@/i18n';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  SegmentedControl,
  Text,
} from '@/ui';

import { ScreenHeader, useRouteId } from '../navigation';
import { useGuardedRouter } from '../navigation/use-guarded-router';
import { useInvitationService } from './InvitationProvider';
import {
  InvitationError,
  invitationErrorKey,
  type InvitationInfo,
  type InvitationStatus,
} from './invitation-service';
import { buildInviteLink } from './invite-link';

type Duration = '1' | '7' | '30';

interface GroupData {
  readonly name: string;
  readonly localUserId: string | null;
  readonly isOwner: boolean;
  readonly writable: boolean;
  /** Nombre del miembro vinculado a cada cuenta, para decir quién creó un enlace. */
  readonly namesByAccount: ReadonlyMap<string, string>;
}

function readGroup(repos: Repositories, groupId: string): GroupData | null {
  const group = repos.groups.get(groupId);
  if (!group) {
    return null;
  }
  const members = repos.members.listAll(groupId);
  return {
    name: group.name,
    localUserId: repos.profile.get()?.id ?? null,
    isOwner: repos.access.myRole(groupId) === 'owner',
    writable: group.archivedAt === null && group.accessLostAt === null,
    namesByAccount: new Map(
      members.filter((m) => m.userId !== null).map((m) => [m.userId as string, m.displayName]),
    ),
  };
}

/** Un enlace de la lista: lo que dice el servidor y, si lo creó este teléfono, su token. */
interface Row {
  readonly info: InvitationInfo;
  readonly local: InvitationLink | undefined;
}

type ListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly rows: Row[]; readonly offline: boolean }
  | { readonly kind: 'error' };

/**
 * Invitar a un grupo: crea un enlace (1, 7 o 30 días), abre la hoja de compartir y lista los enlaces
 * del grupo con su estado, para revocarlos o compartirlos otra vez. Crear y revocar necesitan
 * internet. El token solo se puede volver a compartir desde el teléfono que lo creó.
 */
export function InviteGroupScreen() {
  const { t } = useTranslation();
  const router = useGuardedRouter();
  const groupId = useRouteId('groupId');
  const query = useLiveQuery(
    (repos) => (groupId ? readGroup(repos, groupId) : null),
    { tables: ALL_TABLES, groupId: groupId ?? undefined },
    [groupId],
  );

  return (
    <Screen scroll edges={['top', 'bottom']} testID="invite-group-screen">
      {query.status === 'loading' ? (
        <>
          <ScreenHeader title="" />
          <LoadingState rows={3} />
        </>
      ) : query.status === 'error' ? (
        <>
          <ScreenHeader title="" />
          <ErrorState onRetry={query.retry} />
        </>
      ) : query.data === null || groupId === null ? (
        <>
          <ScreenHeader title={t('common.notFound.title')} />
          <EmptyState
            icon={Compass}
            title={t('common.notFound.title')}
            description={t('common.notFound.description')}
            action={{ label: t('common.notFound.action'), onPress: () => router.replace('/') }}
          />
        </>
      ) : (
        <InviteContent groupId={groupId} data={query.data} />
      )}
    </Screen>
  );
}

function InviteContent({ groupId, data }: { groupId: string; data: GroupData }) {
  const { t } = useTranslation();
  const { instant } = useFormatters();
  const { repos } = useDatabase();
  const service = useInvitationService();
  const [duration, setDuration] = useState<Duration>('7');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  // Cambiar este número vuelve a pedir la lista sin esconder la que ya se ve.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  const localRows = useCallback(
    (): Row[] =>
      repos.invitationLinks.listByGroup(groupId).map((local) => ({
        local,
        info: {
          id: local.id,
          createdBy: data.localUserId ?? '',
          createdAt: local.createdAt,
          expiresAt: local.expiresAt,
          maxUses: local.maxUses,
          useCount: 0,
          revokedAt: null,
          status: local.expiresAt > Date.now() ? 'active' : 'expired',
        },
      })),
    [repos, groupId, data.localUserId],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const infos = await service.list(groupId);
        const locals = new Map(repos.invitationLinks.listByGroup(groupId).map((l) => [l.id, l]));
        if (!cancelled) {
          setList({
            kind: 'ready',
            offline: false,
            rows: infos.map((info) => ({ info, local: locals.get(info.id) })),
          });
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (error instanceof InvitationError && error.code === 'OFFLINE') {
          setList({ kind: 'ready', offline: true, rows: localRows() });
        } else {
          setList({ kind: 'error' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [service, repos, groupId, localRows, reloadKey]);

  const share = useCallback(
    async (token: string) => {
      try {
        await Share.share({
          message: t('invite.manage.shareMessage', {
            name: data.name,
            link: buildInviteLink(token),
          }),
        });
      } catch {
        // La hoja de compartir se cerró o falló: el enlace ya está creado y en la lista.
      }
    },
    [t, data.name],
  );

  const create = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const created = await service.create({
        groupId,
        expiresHours: Number(duration) * 24,
        maxUses: 10,
      });
      repos.invitationLinks.save({
        id: created.id,
        groupId,
        token: created.token,
        expiresAt: created.expiresAt,
        maxUses: created.maxUses,
      });
      await share(created.token);
      reload();
    } catch (error) {
      setCreateError(t(`invite.errors.${invitationErrorKey(error)}`));
    } finally {
      setCreating(false);
    }
  };

  const revoke = (row: Row) =>
    Alert.alert(t('invite.manage.revokeTitle'), t('invite.manage.revokeMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('invite.manage.revokeConfirm'),
        style: 'destructive',
        onPress: () => {
          service
            .revoke(row.info.id)
            .then(() => {
              repos.invitationLinks.remove(row.info.id);
              reload();
            })
            .catch((error: unknown) =>
              Alert.alert(
                t('invite.manage.revokeTitle'),
                t(`invite.errors.${invitationErrorKey(error)}`),
              ),
            );
        },
      },
    ]);

  const creatorLabel = (row: Row) => {
    if (data.localUserId !== null && row.info.createdBy === data.localUserId) {
      return t('invite.manage.byYou');
    }
    const name = data.namesByAccount.get(row.info.createdBy);
    return name ? t('invite.manage.by', { who: name }) : t('invite.manage.byOther');
  };

  return (
    <>
      <ScreenHeader title={t('invite.manage.title', { name: data.name })} />
      <View className="gap-5">
        <Text tone="muted">{t('invite.manage.intro')}</Text>

        {data.writable ? (
          <View className="gap-3">
            <Text variant="subheading" accessibilityRole="header">
              {t('invite.manage.duration')}
            </Text>
            <SegmentedControl
              label={t('invite.manage.duration')}
              value={duration}
              onChange={setDuration}
              segments={[
                { value: '1', label: t('invite.manage.duration1'), testID: 'duration-1' },
                { value: '7', label: t('invite.manage.duration7'), testID: 'duration-7' },
                { value: '30', label: t('invite.manage.duration30'), testID: 'duration-30' },
              ]}
            />
            {createError ? (
              <Text tone="warning" testID="invite-create-error" accessibilityRole="alert">
                {createError}
              </Text>
            ) : null}
            <Button
              testID="create-invite-link"
              label={creating ? t('invite.manage.creating') : t('invite.manage.create')}
              icon={Share2}
              onPress={() => void create()}
              loading={creating}
              disabled={creating}
              fullWidth
            />
          </View>
        ) : null}

        <View className="gap-3">
          <Text variant="subheading" accessibilityRole="header">
            {t('invite.manage.links')}
          </Text>
          {list.kind === 'loading' ? (
            <View className="gap-2" testID="invite-list-loading">
              <LoadingState rows={2} />
              <Text tone="muted" accessibilityLiveRegion="polite">
                {t('invite.manage.loading')}
              </Text>
            </View>
          ) : list.kind === 'error' ? (
            <View className="gap-2" testID="invite-list-error">
              <Text tone="warning">{t('invite.manage.listError')}</Text>
              <Button
                label={t('invite.screen.retry')}
                size="sm"
                variant="secondary"
                onPress={() => {
                  setList({ kind: 'loading' });
                  reload();
                }}
              />
            </View>
          ) : (
            <>
              {list.offline ? (
                <Banner
                  testID="invite-offline"
                  icon={Link2}
                  tone="warning"
                  message={t('invite.manage.offlineList')}
                />
              ) : null}
              {list.rows.length === 0 ? (
                <Text tone="muted">{t('invite.manage.noLinks')}</Text>
              ) : (
                list.rows.map((row) => (
                  <LinkCard
                    key={row.info.id}
                    row={row}
                    creator={creatorLabel(row)}
                    expires={t('invite.manage.expiresOn', { when: instant(row.info.expiresAt) })}
                    canRevoke={
                      row.info.status === 'active' &&
                      (data.isOwner ||
                        (data.localUserId !== null && row.info.createdBy === data.localUserId))
                    }
                    onShare={() => row.local && void share(row.local.token)}
                    onRevoke={() => revoke(row)}
                  />
                ))
              )}
            </>
          )}
        </View>
      </View>
    </>
  );
}

function LinkCard({
  row,
  creator,
  expires,
  canRevoke,
  onShare,
  onRevoke,
}: {
  row: Row;
  creator: string;
  expires: string;
  canRevoke: boolean;
  onShare: () => void;
  onRevoke: () => void;
}) {
  const { t } = useTranslation();
  const { info, local } = row;
  const active = info.status === 'active';
  const status: InvitationStatus = info.status;
  return (
    <Card testID={`invite-link-${info.id}`} className="gap-2">
      <View className="flex-row items-center justify-between gap-2">
        <Text variant="bodyStrong">{t(`invite.manage.status.${status}`)}</Text>
        <Text variant="caption" tone="muted">
          {t('invite.manage.usage', {
            count: info.maxUses,
            used: info.useCount,
            max: info.maxUses,
          })}
        </Text>
      </View>
      <Text variant="caption" tone="muted">
        {expires}
      </Text>
      <Text variant="caption" tone="muted">
        {creator}
      </Text>
      {active && !local ? (
        <Text variant="caption" tone="muted">
          {t('invite.manage.otherPhone')}
        </Text>
      ) : null}
      {active && (local || canRevoke) ? (
        <View className="flex-row flex-wrap justify-end gap-2">
          {local ? (
            <Button
              testID={`share-again-${info.id}`}
              label={t('invite.manage.shareAgain')}
              icon={Share2}
              size="sm"
              variant="secondary"
              onPress={onShare}
            />
          ) : null}
          {canRevoke ? (
            <Button
              testID={`revoke-${info.id}`}
              label={t('invite.manage.revoke')}
              size="sm"
              variant="danger"
              onPress={onRevoke}
            />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}
