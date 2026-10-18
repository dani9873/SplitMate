import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button, Input, Screen } from '@/ui';

import { ScreenHeader } from '../navigation';
import { useGuardedRouter } from '../navigation/use-guarded-router';
import { findInviteToken, MAX_PASTED_TEXT_LENGTH } from './invite-link';
import { setPendingInvite } from './pending-invite';

/**
 * «Unirme con un enlace»: se pega el enlace tal como llegó (también sirve el mensaje entero, con el
 * enlace dentro). Es la vía de iOS mientras no haya enlaces universales, y la de quien recibió el
 * enlace en otra app. El texto se valida antes de pasarlo a la pantalla de unirse; el token no
 * viaja por la ruta.
 */
export function JoinWithLinkScreen() {
  const { t } = useTranslation();
  const router = useGuardedRouter();
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);

  const submit = () => {
    const token = findInviteToken(text);
    if (!token) {
      setInvalid(true);
      return;
    }
    setPendingInvite(token);
    router.replace('/invite');
  };

  return (
    <Screen scroll edges={['top', 'bottom']} testID="join-screen">
      <ScreenHeader title={t('invite.join.title')} variant="modal" />
      <View className="gap-4">
        <Input
          testID="join-link"
          label={t('invite.join.label')}
          placeholder={t('invite.join.placeholder')}
          hint={t('invite.join.hint')}
          value={text}
          onChangeText={(value) => {
            setText(value);
            setInvalid(false);
          }}
          error={invalid ? t('invite.join.invalid') : undefined}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          keyboardType="url"
          multiline
          maxLength={MAX_PASTED_TEXT_LENGTH}
        />
        <Button
          testID="join-continue"
          label={t('invite.join.continue')}
          onPress={submit}
          disabled={text.trim().length === 0}
          fullWidth
        />
      </View>
    </Screen>
  );
}
