import { LogOut, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useAuth } from '@/features/auth';
import { UnsyncedWarning, unsyncedCount, useSyncStatus } from '@/features/sync';
import { Button, Sheet, Text } from '@/ui';

import { wipeAccountData } from './account-actions';

/**
 * Cerrar sesión: solo la sesión (los datos quedan cifrados en el teléfono) o también los datos de
 * este teléfono. Para borrarlos, la confirmación dice que están en la nube o, si hay cambios sin
 * subir, los cuenta y ofrece sincronizar primero.
 */
export function SignOutSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { state, signOut } = useAuth();
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const userId = state.status === 'signedIn' ? state.session.userId : null;
  const unsynced = unsyncedCount(useSyncStatus()) > 0;

  const close = () => {
    setConfirmingWipe(false);
    onClose();
  };

  const keepData = () => {
    close();
    void signOut();
  };

  const wipeData = () => {
    if (!userId) {
      return;
    }
    close();
    void signOut({
      cleanup: wipeAccountData(userId, { done: 'dataDeleted', failed: 'dataDeleteFailed' }),
    });
  };

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={
        confirmingWipe ? t('account.signOutSheet.confirmTitle') : t('account.signOutSheet.title')
      }
      testID="sign-out-sheet"
    >
      {confirmingWipe && unsynced ? (
        <View className="gap-4 px-5 pb-2">
          <UnsyncedWarning consequence={t('account.signOutSheet.unsyncedBody')} onReview={close} />
          <Button
            testID="sign-out-wipe-anyway"
            label={t('account.signOutSheet.wipeAnyway')}
            variant="danger"
            icon={Trash2}
            onPress={wipeData}
            fullWidth
          />
          <Button
            label={t('common.cancel')}
            variant="ghost"
            onPress={() => setConfirmingWipe(false)}
            fullWidth
          />
        </View>
      ) : confirmingWipe ? (
        <View className="gap-4 px-5 pb-2">
          <Text tone="muted">{t('account.signOutSheet.confirmBody')}</Text>
          <Button
            testID="sign-out-wipe-confirm"
            label={t('account.signOutSheet.confirm')}
            variant="danger"
            icon={Trash2}
            onPress={wipeData}
            fullWidth
          />
          <Button
            label={t('common.cancel')}
            variant="ghost"
            onPress={() => setConfirmingWipe(false)}
            fullWidth
          />
        </View>
      ) : (
        <View className="gap-4 px-5 pb-2">
          <View className="gap-1.5">
            <Button
              testID="sign-out-keep"
              label={t('account.signOutSheet.keep')}
              icon={LogOut}
              onPress={keepData}
              fullWidth
            />
            <Text variant="caption" tone="muted">
              {t('account.signOutSheet.keepHint')}
            </Text>
          </View>
          <View className="gap-1.5">
            <Button
              testID="sign-out-wipe"
              label={t('account.signOutSheet.wipe')}
              variant="secondary"
              onPress={() => setConfirmingWipe(true)}
              fullWidth
            />
            <Text variant="caption" tone="muted">
              {t('account.signOutSheet.wipeHint')}
            </Text>
          </View>
        </View>
      )}
    </Sheet>
  );
}
