import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import {
  Archive,
  ArchiveRestore,
  Check,
  Compass,
  Pencil,
  Trash2,
  UserPlus,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, View } from 'react-native';

import { ALL_TABLES } from '@/db/changes';
import { useDatabase } from '@/db/DatabaseProvider';
import type { Group, Member, Repositories } from '@/db/repositories';
import { useLiveQuery } from '@/db/use-live-query';
import type { Money } from '@/domain';
import { useFormatters } from '@/i18n';
import type { GroupColor } from '@/lib/group-appearance';
import {
  Banner,
  Button,
  Card,
  cn,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  LoadingState,
  MemberAvatar,
  Screen,
  Sheet,
  Text,
  useAppTheme,
} from '@/ui';

import { absolute, balanceDirection } from '../balances';
import { CurrencyField, CurrencyPicker } from '../currency';
import { describeError } from '../errors/describe-error';
import { ScreenHeader, useRouteId } from '../navigation';
import { AppearancePicker } from './AppearancePicker';
import { appearanceSchema, isDuplicateName, type AppearanceForm } from './group-form';

interface SettingsData {
  readonly group: Group;
  readonly members: Member[];
  readonly balances: Map<string, Money>;
  readonly hasMovements: boolean;
  readonly localUserId: string | null;
}

function readSettings(repos: Repositories, groupId: string): SettingsData | null {
  const group = repos.groups.get(groupId);
  if (!group) {
    return null;
  }
  const { balances } = repos.balances.forGroup(groupId);
  return {
    group,
    members: repos.members.listByGroup(groupId),
    balances: new Map(balances.map((b) => [b.memberId, b.amount])),
    hasMovements: repos.groups.hasMovements(groupId),
    localUserId: repos.profile.get()?.id ?? null,
  };
}

/** Ajustes del grupo: datos, miembros, quién eres y archivar. */
export function GroupSettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const groupId = useRouteId('groupId');
  const query = useLiveQuery(
    (repos) => (groupId ? readSettings(repos, groupId) : null),
    { tables: ALL_TABLES, groupId: groupId ?? undefined },
    [groupId],
  );

  return (
    <Screen scroll edges={['top', 'bottom']} testID="group-settings-screen">
      <ScreenHeader title={t('groups.settings.title')} />
      {query.status === 'loading' ? (
        <LoadingState rows={3} />
      ) : query.status === 'error' ? (
        <ErrorState onRetry={query.retry} />
      ) : query.data === null ? (
        <EmptyState
          icon={Compass}
          title={t('common.notFound.title')}
          description={t('common.notFound.description')}
          action={{ label: t('common.notFound.action'), onPress: () => router.replace('/') }}
        />
      ) : (
        <SettingsContent data={query.data} />
      )}
    </Screen>
  );
}

function SettingsContent({ data }: { data: SettingsData }) {
  const { t } = useTranslation();
  const { repos } = useDatabase();
  const { group } = data;
  const archived = group.archivedAt !== null;

  const unarchive = () => {
    try {
      repos.groups.unarchive(group.id, group.version);
    } catch (error) {
      Alert.alert(t('groups.settings.unarchive'), describeError(error, t));
    }
  };

  const archive = () =>
    Alert.alert(
      t('groups.settings.archiveTitle', { name: group.name }),
      t('groups.settings.archiveMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('groups.settings.archiveConfirm'),
          style: 'destructive',
          onPress: () => {
            try {
              repos.groups.archive(group.id, group.version);
            } catch (error) {
              Alert.alert(t('groups.settings.archive'), describeError(error, t));
            }
          },
        },
      ],
    );

  return (
    <>
      {archived ? (
        <Banner
          icon={Archive}
          tone="warning"
          message={t('groupDetail.archived')}
          actions={
            <Button
              label={t('groups.settings.unarchive')}
              icon={ArchiveRestore}
              size="sm"
              variant="secondary"
              onPress={unarchive}
            />
          }
        />
      ) : null}
      <DetailsSection data={data} readOnly={archived} />
      <MembersSection data={data} readOnly={archived} />
      <MeSection data={data} readOnly={archived} />
      {archived ? null : (
        <View className="gap-2">
          <Button
            testID="archive-group"
            label={t('groups.settings.archive')}
            icon={Archive}
            variant="secondary"
            onPress={archive}
          />
          <Text variant="caption" tone="muted">
            {t('groups.settings.archiveHint')}
          </Text>
        </View>
      )}
    </>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Text variant="subheading" accessibilityRole="header">
      {children}
    </Text>
  );
}

function DetailsSection({ data, readOnly }: { data: SettingsData; readOnly: boolean }) {
  const { t } = useTranslation();
  const { repos } = useDatabase();
  const { group, hasMovements } = data;
  const [pickingCurrency, setPickingCurrency] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const defaults: AppearanceForm = {
    name: group.name,
    currency: group.currency,
    emoji: group.emoji,
    color: group.color as GroupColor,
  };
  const { control, handleSubmit, setValue, reset, formState } = useForm<AppearanceForm>({
    resolver: zodResolver(appearanceSchema),
    defaultValues: defaults,
  });
  // Si el grupo cambia fuera de este formulario (por ejemplo, al restaurarlo), se recarga.
  useEffect(() => {
    reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.version]);
  const [name, emoji, color, currency] = useWatch({
    control,
    name: ['name', 'emoji', 'color', 'currency'],
  });

  const save = handleSubmit((form) => {
    try {
      repos.groups.update(group.id, group.version, form);
      setStatus(t('groups.settings.saved'));
    } catch (error) {
      setStatus(describeError(error, t));
    }
  });

  return (
    <View className="gap-4">
      <SectionTitle>{t('groups.settings.details')}</SectionTitle>
      <Controller
        control={control}
        name="name"
        render={({ field, fieldState }) => (
          <Input
            testID="settings-group-name"
            label={t('groups.form.name')}
            value={field.value}
            onChangeText={(text) => {
              setStatus(null);
              field.onChange(text);
            }}
            onBlur={field.onBlur}
            editable={!readOnly}
            error={
              fieldState.error?.message
                ? t(`groups.form.errors.${fieldState.error.message as 'nameRequired'}`)
                : undefined
            }
            maxLength={80}
          />
        )}
      />
      <CurrencyField
        label={t('groups.form.currency')}
        value={currency}
        disabled={readOnly || hasMovements}
        hint={hasMovements ? t('groups.form.currencyLocked') : t('groups.form.currencyHint')}
        onPress={() => setPickingCurrency(true)}
      />
      {readOnly ? null : (
        <AppearancePicker
          name={name}
          emoji={emoji}
          color={color}
          onEmojiChange={(value) => setValue('emoji', value, { shouldDirty: true })}
          onColorChange={(value) => setValue('color', value, { shouldDirty: true })}
        />
      )}
      {readOnly ? null : (
        <Button
          testID="save-group"
          label={t('groups.form.save')}
          onPress={save}
          disabled={!formState.isDirty}
        />
      )}
      {status ? (
        <Text
          variant="label"
          tone="muted"
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
        >
          {status}
        </Text>
      ) : null}
      <CurrencyPicker
        visible={pickingCurrency}
        value={currency}
        suggested={[group.currency, 'USD', 'EUR']}
        onChange={(code) => setValue('currency', code, { shouldDirty: true })}
        onClose={() => setPickingCurrency(false)}
      />
    </View>
  );
}

function MembersSection({ data, readOnly }: { data: SettingsData; readOnly: boolean }) {
  const { t } = useTranslation();
  const { repos } = useDatabase();
  const { money } = useFormatters();
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Member | null>(null);
  const names = data.members.map((m) => m.displayName);

  const add = () => {
    const name = newName.trim();
    if (!name) {
      return;
    }
    if (isDuplicateName(name, names)) {
      setAddError(t('groups.form.errors.duplicate'));
      return;
    }
    try {
      repos.members.add(data.group.id, name);
      setNewName('');
      setAddError(null);
    } catch (error) {
      setAddError(describeError(error, t));
    }
  };

  const remove = (member: Member) => {
    const balance = data.balances.get(member.id);
    const title = t('groups.settings.cannotRemoveTitle', { name: member.displayName });
    if (data.members.length <= 1) {
      Alert.alert(title, t('groups.settings.cannotRemoveLast'));
      return;
    }
    if (balance && balance.amount !== 0) {
      const amount = money(absolute(balance));
      Alert.alert(
        title,
        balanceDirection(balance) === 'owes'
          ? t('groups.settings.cannotRemoveOwes', { name: member.displayName, amount })
          : t('groups.settings.cannotRemoveOwed', { name: member.displayName, amount }),
      );
      return;
    }
    Alert.alert(
      t('groups.settings.removeTitle', { name: member.displayName }),
      t('groups.settings.removeMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('groups.settings.removeConfirm'),
          style: 'destructive',
          onPress: () => {
            try {
              repos.members.remove(member.id, member.version);
            } catch (error) {
              Alert.alert(title, describeError(error, t));
            }
          },
        },
      ],
    );
  };

  return (
    <View className="gap-3">
      <SectionTitle>{t('groups.settings.members')}</SectionTitle>
      <Card padded={false}>
        {data.members.map((member, index) => {
          const isMe = member.userId !== null && member.userId === data.localUserId;
          return (
            <View
              key={member.id}
              className={cn(
                'min-h-[56px] flex-row items-center gap-3 pl-4 pr-1',
                index > 0 && 'border-t border-line',
              )}
            >
              <MemberAvatar name={member.displayName} highlight={isMe} />
              <Text className="flex-1" numberOfLines={1}>
                {isMe ? t('common.youSuffix', { name: member.displayName }) : member.displayName}
              </Text>
              {readOnly ? null : (
                <>
                  <IconButton
                    icon={Pencil}
                    tone="fgMuted"
                    label={t('groups.settings.rename', { name: member.displayName })}
                    onPress={() => setRenaming(member)}
                  />
                  <IconButton
                    icon={Trash2}
                    tone="fgMuted"
                    label={t('groups.settings.remove', { name: member.displayName })}
                    onPress={() => remove(member)}
                  />
                </>
              )}
            </View>
          );
        })}
      </Card>
      {readOnly ? null : (
        <View className="flex-row items-end gap-2">
          <Input
            testID="new-member-name"
            label={t('groups.settings.newMemberLabel')}
            value={newName}
            onChangeText={(text) => {
              setNewName(text);
              setAddError(null);
            }}
            onSubmitEditing={add}
            returnKeyType="done"
            error={addError ?? undefined}
            maxLength={80}
            className="flex-1"
          />
          <Button
            testID="add-member"
            label={t('groups.settings.addMember')}
            icon={UserPlus}
            variant="secondary"
            onPress={add}
            disabled={!newName.trim()}
            className={addError ? 'mb-6' : undefined}
          />
        </View>
      )}
      {renaming ? (
        <RenameSheet
          key={renaming.id}
          member={renaming}
          existing={names}
          onClose={() => setRenaming(null)}
        />
      ) : null}
    </View>
  );
}

function RenameSheet({
  member,
  existing,
  onClose,
}: {
  member: Member;
  existing: readonly string[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { repos } = useDatabase();
  const [name, setName] = useState(member.displayName);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const next = name.trim();
    if (!next) {
      setError(t('groups.form.errors.yourNameRequired'));
      return;
    }
    const others = existing.filter((n) => n !== member.displayName);
    if (isDuplicateName(next, others)) {
      setError(t('groups.form.errors.duplicate'));
      return;
    }
    try {
      repos.members.rename(member.id, member.version, next);
      onClose();
    } catch (caught) {
      setError(describeError(caught, t));
    }
  };

  return (
    <Sheet visible onClose={onClose} title={t('groups.settings.renameTitle')}>
      <View className="gap-4 px-5 pb-2">
        <Input
          testID="rename-member"
          label={t('groups.settings.renameLabel')}
          value={name}
          onChangeText={(text) => {
            setName(text);
            setError(null);
          }}
          onSubmitEditing={save}
          error={error ?? undefined}
          maxLength={80}
          autoFocus
        />
        <Button testID="save-rename" label={t('common.save')} onPress={save} />
      </View>
    </Sheet>
  );
}

function MeSection({ data, readOnly }: { data: SettingsData; readOnly: boolean }) {
  const { t } = useTranslation();
  const { repos } = useDatabase();
  const { colors } = useAppTheme();
  const current = data.members.find((m) => m.userId !== null && m.userId === data.localUserId);

  const choose = (memberId: string | null) => {
    try {
      repos.members.setCurrentMember(data.group.id, memberId);
    } catch (error) {
      Alert.alert(t('groups.settings.meTitle'), describeError(error, t));
    }
  };

  const options = [
    ...data.members.map((m) => ({ id: m.id as string | null, label: m.displayName })),
    { id: null, label: t('groups.settings.noneOfThem') },
  ];

  return (
    <View className="gap-3">
      <SectionTitle>{t('groups.settings.meTitle')}</SectionTitle>
      <Text variant="caption" tone="muted">
        {t('groups.settings.meHint')}
      </Text>
      <Card padded={false}>
        <View accessibilityRole="radiogroup">
          {options.map((option, index) => {
            const checked = (current?.id ?? null) === option.id;
            return (
              <Pressable
                key={option.id ?? 'none'}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ checked, disabled: readOnly }}
                disabled={readOnly}
                onPress={() => choose(option.id)}
                className={cn(
                  'min-h-[52px] flex-row items-center gap-3 px-4',
                  index > 0 && 'border-t border-line',
                  !readOnly && 'active:bg-surface-muted',
                )}
              >
                <View
                  className={cn(
                    'h-6 w-6 items-center justify-center rounded-full border-2',
                    checked ? 'border-primary bg-primary' : 'border-line-strong',
                  )}
                >
                  {checked ? <Check size={14} color={colors.onPrimary} strokeWidth={3} /> : null}
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
  );
}
