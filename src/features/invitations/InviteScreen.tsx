import { Check, TriangleAlert, UserRound } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { useDatabase } from '@/db/DatabaseProvider';
import { forgetGroupDownload } from '@/db/sync';
import { useFormatters } from '@/i18n';
import {
  Banner,
  Button,
  Card,
  cn,
  GroupAvatar,
  Input,
  LoadingState,
  Screen,
  Text,
  useAppTheme,
} from '@/ui';
import type { GroupColor } from '@/lib/group-appearance';

import { ScreenHeader } from '../navigation';
import { useGuardedRouter } from '../navigation/use-guarded-router';
import { useSyncEngine } from '../sync';
import { useInvitationService } from './InvitationProvider';
import {
  InvitationError,
  invitationErrorKey,
  type InvitePreview,
  type JoinChoice,
} from './invitation-service';
import { clearPendingInvite, loadPendingInvite } from './pending-invite';

type ErrorKey = ReturnType<typeof invitationErrorKey>;

type Phase =
  | { readonly kind: 'checking' }
  | { readonly kind: 'ready'; readonly preview: InvitePreview; readonly notice: string | null }
  | { readonly kind: 'joining'; readonly preview: InvitePreview }
  | { readonly kind: 'downloading' }
  | { readonly kind: 'failed'; readonly key: ErrorKey; readonly canRetry: boolean };

/** Errores que no mejoran reintentando: el enlace ya no sirve o ya no hay lugar. */
const FINAL_ERRORS: ReadonlySet<ErrorKey> = new Set([
  'invalidLink',
  'rateLimited',
  'groupFull',
  'tooManyGroups',
  'forbidden',
]);

/**
 * Unirse a un grupo con un enlace: muestra el grupo, pregunta quién eres entre sus miembros sin
 * cuenta (o «Soy alguien nuevo») y entra. El token vive solo en memoria: se lee del enlace pendiente
 * (nunca de la ruta), no se muestra ni se registra, y se borra al unirse o al cerrar.
 */
export function InviteScreen() {
  const { t } = useTranslation();
  const router = useGuardedRouter();
  const service = useInvitationService();
  const engine = useSyncEngine();
  const { db, repos } = useDatabase();
  const { instant } = useFormatters();
  const [token, setToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const [attempt, setAttempt] = useState(0);
  const [choice, setChoice] = useState<'new' | string | null>(null);
  const [newName, setNewName] = useState(() => repos.profile.get()?.displayName ?? '');
  const [nameError, setNameError] = useState(false);

  const close = useCallback(async () => {
    await clearPendingInvite();
    router.replace('/');
  }, [router]);

  const fail = useCallback((error: unknown, retry = true) => {
    const key = invitationErrorKey(error);
    setPhase({ kind: 'failed', key, canRetry: retry && !FINAL_ERRORS.has(key) });
    if (FINAL_ERRORS.has(key)) {
      // Ya no sirve: que no quede pendiente para volver a intentarlo al reabrir la app.
      void clearPendingInvite();
    }
  }, []);

  // Lee el enlace pendiente y pide la vista previa al servidor.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const pending = await loadPendingInvite();
      if (cancelled) {
        return;
      }
      if (!pending) {
        setPhase({ kind: 'failed', key: 'invalidLink', canRetry: false });
        return;
      }
      setToken(pending);
      try {
        const preview = await service.preview(pending);
        if (!cancelled) {
          setPhase({ kind: 'ready', preview, notice: null });
          setChoice(preview.members.length === 0 ? 'new' : null);
        }
      } catch (error) {
        if (!cancelled) {
          fail(error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt, service, fail]);

  const openGroup = useCallback(
    async (groupId: string) => {
      setPhase({ kind: 'downloading' });
      await clearPendingInvite();
      // Que el servidor mande el grupo entero: aunque el teléfono ya lo tuviera y lo hubiera perdido.
      forgetGroupDownload(db, groupId);
      try {
        await engine.syncNow();
      } catch {
        // Sin red después de entrar: el grupo llegará con la próxima sincronización.
      }
      router.replace(repos.groups.get(groupId) ? `/groups/${groupId}` : '/');
    },
    [db, engine, repos, router],
  );

  const join = async (preview: InvitePreview) => {
    if (!token || choice === null) {
      return;
    }
    let joinChoice: JoinChoice;
    if (choice === 'new') {
      if (newName.trim().length === 0) {
        setNameError(true);
        return;
      }
      joinChoice = { kind: 'new', displayName: newName };
    } else {
      joinChoice = { kind: 'member', memberId: choice };
    }
    setPhase({ kind: 'joining', preview });
    try {
      const { groupId } = await service.accept(token, joinChoice);
      await openGroup(groupId);
    } catch (error) {
      if (error instanceof InvitationError && error.code === 'MEMBER_TAKEN') {
        // Alguien se le adelantó: se recarga la lista de quién queda libre.
        const taken = preview.members.find((m) => m.id === choice)?.displayName;
        try {
          const fresh = await service.preview(token);
          setChoice(fresh.members.length === 0 ? 'new' : null);
          setPhase({
            kind: 'ready',
            preview: fresh,
            notice: taken
              ? t('invite.errors.memberTaken', { name: taken })
              : t('invite.errors.memberTakenGeneric'),
          });
        } catch (reloadError) {
          fail(reloadError);
        }
        return;
      }
      fail(error);
    }
  };

  return (
    <Screen scroll edges={['top', 'bottom']} testID="invite-screen">
      <ScreenHeader
        title={t('invite.screen.title')}
        variant="modal"
        onBack={() => {
          void close();
        }}
      />
      {phase.kind === 'checking' ? (
        <View className="gap-3" testID="invite-checking">
          <LoadingState rows={2} />
          <Text tone="muted" accessibilityLiveRegion="polite">
            {t('invite.screen.checking')}
          </Text>
        </View>
      ) : phase.kind === 'downloading' ? (
        <View className="gap-3" testID="invite-downloading">
          <LoadingState rows={2} />
          <Text tone="muted" accessibilityLiveRegion="polite">
            {t('invite.screen.downloading')}
          </Text>
        </View>
      ) : phase.kind === 'failed' ? (
        <View className="gap-4" testID="invite-failed">
          <Banner
            icon={TriangleAlert}
            tone="warning"
            message={t(`invite.errors.${phase.key}`)}
            testID="invite-error"
          />
          <View className="flex-row gap-2">
            {phase.canRetry ? (
              <Button
                testID="invite-retry"
                label={t('invite.screen.retry')}
                onPress={() => {
                  setPhase({ kind: 'checking' });
                  setAttempt((n) => n + 1);
                }}
              />
            ) : null}
            <Button
              testID="invite-close"
              label={t('invite.screen.close')}
              variant="secondary"
              onPress={() => {
                void close();
              }}
            />
          </View>
        </View>
      ) : (
        <Ready
          preview={phase.preview}
          notice={phase.kind === 'ready' ? phase.notice : null}
          joining={phase.kind === 'joining'}
          choice={choice}
          onChoice={(next) => {
            setChoice(next);
            setNameError(false);
          }}
          name={newName}
          onName={(value) => {
            setNewName(value);
            setNameError(false);
          }}
          nameError={nameError}
          onJoin={() => void join(phase.preview)}
          onOpen={() => void openGroup(phase.preview.group.id)}
          expires={t('invite.screen.expires', { when: instant(phase.preview.expiresAt) })}
        />
      )}
    </Screen>
  );
}

interface ReadyProps {
  readonly preview: InvitePreview;
  readonly notice: string | null;
  readonly joining: boolean;
  readonly choice: 'new' | string | null;
  readonly onChoice: (choice: 'new' | string) => void;
  readonly name: string;
  readonly onName: (name: string) => void;
  readonly nameError: boolean;
  readonly onJoin: () => void;
  readonly onOpen: () => void;
  readonly expires: string;
}

function Ready({
  preview,
  notice,
  joining,
  choice,
  onChoice,
  name,
  onName,
  nameError,
  onJoin,
  onOpen,
  expires,
}: ReadyProps) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const { group } = preview;

  const options = [
    ...preview.members.map((m) => ({ id: m.id, label: m.displayName })),
    { id: 'new', label: t('invite.screen.newPerson') },
  ];

  return (
    <View className="gap-5" testID="invite-ready">
      <View className="flex-row items-center gap-3">
        <GroupAvatar name={group.name} emoji={group.emoji} color={group.color as GroupColor} />
        <View className="flex-1 gap-0.5">
          <Text variant="heading" numberOfLines={2} accessibilityRole="header">
            {t('invite.screen.joinTitle', { name: group.name })}
          </Text>
          <Text variant="caption" tone="muted">
            {t('invite.screen.groupLine', {
              currency: group.currency,
              accounts: t('invite.screen.accounts', { count: preview.accounts }),
            })}
          </Text>
        </View>
      </View>
      <Text variant="caption" tone="muted">
        {expires}
      </Text>

      {preview.alreadyMember ? (
        <View className="gap-3">
          <Banner icon={Check} message={t('invite.screen.alreadyMember')} />
          <Button
            testID="invite-open-group"
            label={t('invite.screen.openGroup')}
            onPress={onOpen}
          />
        </View>
      ) : (
        <>
          {notice ? (
            <Banner testID="invite-notice" icon={UserRound} tone="warning" message={notice} />
          ) : null}
          <View className="gap-3">
            <Text variant="subheading" accessibilityRole="header">
              {t('invite.screen.whoAreYou')}
            </Text>
            <Text variant="caption" tone="muted">
              {preview.members.length === 0
                ? t('invite.screen.noFreeMembers')
                : t('invite.screen.whoHint')}
            </Text>
            <Card padded={false}>
              <View accessibilityRole="radiogroup">
                {options.map((option, index) => {
                  const checked = choice === option.id;
                  return (
                    <Pressable
                      key={option.id}
                      testID={`invite-option-${option.id === 'new' ? 'new' : option.id}`}
                      accessibilityRole="radio"
                      accessibilityLabel={option.label}
                      accessibilityState={{ checked, disabled: joining }}
                      disabled={joining}
                      onPress={() => onChoice(option.id)}
                      className={cn(
                        'min-h-[52px] flex-row items-center gap-3 px-4',
                        index > 0 && 'border-t border-line',
                        !joining && 'active:bg-surface-muted',
                      )}
                    >
                      <View
                        className={cn(
                          'h-6 w-6 items-center justify-center rounded-full border-2',
                          checked ? 'border-primary bg-primary' : 'border-line-strong',
                        )}
                      >
                        {checked ? (
                          <Check size={14} color={colors.onPrimary} strokeWidth={3} />
                        ) : null}
                      </View>
                      <Text className="flex-1" numberOfLines={1}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Card>
          </View>

          {choice === 'new' ? (
            <Input
              testID="invite-new-name"
              label={t('invite.screen.yourName')}
              value={name}
              onChangeText={onName}
              error={nameError ? t('invite.screen.nameRequired') : undefined}
              maxLength={80}
              editable={!joining}
            />
          ) : null}

          <Button
            testID="invite-join"
            label={joining ? t('invite.screen.joining') : t('invite.screen.join')}
            onPress={onJoin}
            disabled={choice === null || joining}
            loading={joining}
            fullWidth
          />
        </>
      )}
    </View>
  );
}
