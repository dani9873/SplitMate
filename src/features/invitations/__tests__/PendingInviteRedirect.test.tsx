import { Slot } from 'expo-router';
import { act, renderRouter, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { clearPendingInvite, setPendingInvite } from '../pending-invite';
import { PendingInviteRedirect } from '../PendingInviteRedirect';

const TOKEN = 'p'.repeat(43);

async function renderApp(initialUrl = '/') {
  await renderRouter(
    {
      _layout: () => (
        <>
          <Slot />
          <PendingInviteRedirect />
        </>
      ),
      index: () => <Text testID="home">inicio</Text>,
      invite: () => <Text testID="invite">unirse</Text>,
    },
    { initialUrl },
  );
}

afterEach(async () => {
  await act(async () => clearPendingInvite());
});

describe('PendingInviteRedirect', () => {
  it('sin enlace pendiente no cambia de pantalla', async () => {
    await renderApp();
    expect(await screen.findByTestId('home')).toBeOnTheScreen();
    expect(screen.queryByTestId('invite')).toBeNull();
  });

  it('con un enlace pendiente (llegó antes de iniciar sesión), lleva a unirse', async () => {
    setPendingInvite(TOKEN);
    await renderApp();
    expect(await screen.findByTestId('invite')).toBeOnTheScreen();
  });

  it('no consume el enlace: la pantalla de unirse lo usa', async () => {
    setPendingInvite(TOKEN);
    await renderApp();
    await screen.findByTestId('invite');
    const { peekPendingInvite } =
      require('../pending-invite') as typeof import('../pending-invite');
    expect(peekPendingInvite()).toBe(TOKEN);
  });

  it('si ya está en la pantalla de unirse, no la abre otra vez', async () => {
    setPendingInvite(TOKEN);
    await renderApp('/invite');
    expect(await screen.findByTestId('invite')).toBeOnTheScreen();
    expect(screen.queryByTestId('home')).toBeNull();
  });
});
