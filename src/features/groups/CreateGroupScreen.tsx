import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { Plus, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useDatabase } from '@/db/DatabaseProvider';
import { DEFAULT_GROUP_COLOR } from '@/lib/group-appearance';
import { Button, GroupAvatar, IconButton, Input, Screen, Text } from '@/ui';

import { CurrencyField, CurrencyPicker } from '../currency';
import { describeError } from '../errors/describe-error';
import { ScreenHeader } from '../navigation';
import { AppearancePicker } from './AppearancePicker';
import { createGroupFormSchema, otherMemberNames, type CreateGroupForm } from './group-form';

/** Nuevo grupo: nombre, moneda, ícono, color, tu nombre y las demás personas. */
export function CreateGroupScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { repos } = useDatabase();
  const [pickingCurrency, setPickingCurrency] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { control, handleSubmit, setValue, formState } = useForm<CreateGroupForm>({
    resolver: zodResolver(createGroupFormSchema),
    defaultValues: {
      name: '',
      currency: 'USD',
      emoji: null,
      color: DEFAULT_GROUP_COLOR,
      yourName: repos.profile.get()?.displayName ?? '',
      others: [{ name: '' }, { name: '' }],
    },
  });
  const others = useFieldArray({ control, name: 'others' });
  const [name, emoji, color, currency] = useWatch({
    control,
    name: ['name', 'emoji', 'color', 'currency'],
  });
  const errorText = (message?: string) =>
    message ? t(`groups.form.errors.${message as 'nameRequired'}`) : undefined;

  const submit = handleSubmit((form) => {
    setSubmitError(null);
    try {
      const groupId = repos.changes.batch(() => {
        const me = repos.profile.ensure(form.yourName);
        return repos.groups.create({
          name: form.name,
          currency: form.currency,
          emoji: form.emoji,
          color: form.color,
          createdBy: me.id,
          members: [
            { displayName: form.yourName, userId: me.id },
            ...otherMemberNames(form).map((displayName) => ({ displayName })),
          ],
        }).id;
      });
      router.replace(`/groups/${groupId}`);
    } catch (error) {
      setSubmitError(describeError(error, t));
    }
  });

  return (
    <Screen scroll edges={['top', 'bottom']} testID="create-group-screen">
      <ScreenHeader title={t('groups.form.createTitle')} variant="modal" />
      <View className="flex-row items-end gap-3">
        <GroupAvatar name={name} emoji={emoji} color={color} size="lg" />
        <Controller
          control={control}
          name="name"
          render={({ field, fieldState }) => (
            <Input
              testID="group-name"
              label={t('groups.form.name')}
              placeholder={t('groups.form.namePlaceholder')}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={errorText(fieldState.error?.message)}
              maxLength={80}
              autoFocus
              className="flex-1"
            />
          )}
        />
      </View>

      <CurrencyField
        testID="group-currency"
        label={t('groups.form.currency')}
        value={currency}
        hint={t('groups.form.currencyHint')}
        onPress={() => setPickingCurrency(true)}
      />

      <AppearancePicker
        name={name}
        emoji={emoji}
        color={color}
        onEmojiChange={(value) => setValue('emoji', value)}
        onColorChange={(value) => setValue('color', value)}
      />

      <Controller
        control={control}
        name="yourName"
        render={({ field, fieldState }) => (
          <Input
            testID="your-name"
            label={t('groups.form.yourName')}
            placeholder={t('groups.form.yourNamePlaceholder')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errorText(fieldState.error?.message)}
            maxLength={80}
          />
        )}
      />

      <View className="gap-3">
        <Text variant="subheading" accessibilityRole="header">
          {t('groups.form.others')}
        </Text>
        {others.fields.map((item, index) => (
          <View key={item.id} className="flex-row items-end gap-1">
            <Controller
              control={control}
              name={`others.${index}.name`}
              render={({ field, fieldState }) => (
                <Input
                  testID={`member-name-${index}`}
                  label={t('groups.form.memberLabel', { number: index + 1 })}
                  placeholder={t('groups.form.memberPlaceholder')}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={errorText(fieldState.error?.message)}
                  maxLength={80}
                  className="flex-1"
                />
              )}
            />
            <IconButton
              icon={Trash2}
              tone="fgMuted"
              label={t('groups.form.removeMember', { number: index + 1 })}
              onPress={() => others.remove(index)}
              className="mb-1"
            />
          </View>
        ))}
        {formState.errors.others?.message ? (
          <Text variant="caption" tone="negative" accessibilityRole="alert">
            {errorText(formState.errors.others.message)}
          </Text>
        ) : null}
        <Button
          testID="add-member-row"
          label={t('groups.form.addMember')}
          icon={Plus}
          variant="ghost"
          onPress={() => others.append({ name: '' })}
          className="self-start"
        />
      </View>

      {submitError ? (
        <Text tone="negative" accessibilityRole="alert">
          {submitError}
        </Text>
      ) : null}
      <Button testID="create-group" label={t('groups.form.create')} onPress={submit} fullWidth />

      <CurrencyPicker
        visible={pickingCurrency}
        value={currency}
        suggested={['USD', 'EUR', 'COP', 'MXN']}
        onChange={(code) => setValue('currency', code)}
        onClose={() => setPickingCurrency(false)}
      />
    </Screen>
  );
}
