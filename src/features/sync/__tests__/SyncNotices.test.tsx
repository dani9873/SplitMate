import { userEvent } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { act, renderRouter, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import type { SyncNotice } from '@/db/sync';
import { changeLanguage } from '@/i18n';

import { createFakeSyncEngine, type FakeSyncEngine } from '../fake-engine';
import { SyncNotices } from '../SyncNotices';
import { SyncEngineProvider } from '../SyncProvider';

const GROUP = '0192a000-0000-7000-8000-000000000001';
const OTHER_GROUP = '0192a000-0000-7000-8000-000000000002';

const notice = (overrides: Partial<SyncNotice> = {}): SyncNotice => ({
  draftId: `draft-${Math.random()}`,
  groupId: GROUP,
  entity: 'expense',
  reason: 'conflict',
  label: 'Cena',
  serverDeleted: false,
  wasNew: false,
  wasDeletion: false,
  ...overrides,
});

async function renderNotices(engine: FakeSyncEngine) {
  await renderRouter(
    {
      _layout: () => (
        <SyncEngineProvider engine={engine}>
          <Slot />
          <SyncNotices />
        </SyncEngineProvider>
      ),
      index: () => <Text testID="home">inicio</Text>,
      'groups/[groupId]/index': () => <Text testID="group-screen">grupo</Text>,
    },
    { initialUrl: '/' },
  );
}

beforeEach(async () => {
  await act(() => changeLanguage('es'));
});

afterAll(async () => {
  await act(() => changeLanguage('en'));
});

describe('SyncNotices', () => {
  it('no muestra nada hasta que llega un aviso', async () => {
    await renderNotices(createFakeSyncEngine());
    expect(await screen.findByTestId('home')).toBeOnTheScreen();
    expect(screen.queryByText('Revisar')).toBeNull();
  });

  it.each([
    [
      'cambió en el otro dispositivo',
      {},
      '«Cena» cambió en otro dispositivo. Tu versión quedó como borrador.',
    ],
    [
      'se borró en el otro',
      { serverDeleted: true },
      '«Cena» se borró en otro dispositivo. Tu versión quedó como borrador.',
    ],
    [
      'tu borrado no se aplicó',
      { wasDeletion: true },
      'No se borró «Cena»: se cambió en otro dispositivo. Tu borrado quedó como borrador.',
    ],
    [
      'la moneda del grupo cambió',
      { reason: 'group_currency_changed', wasNew: true },
      '«Cena» no se guardó: cambió la moneda del grupo. Quedó como borrador.',
    ],
    [
      'la moneda ya no se puede cambiar',
      { reason: 'currency_locked', entity: 'group', label: 'Viaje' },
      'No se cambió la moneda de «Viaje»: ya tiene movimientos. Quedó como borrador.',
    ],
    [
      'no se quitó a alguien con cuenta',
      { reason: 'member_linked', entity: 'member', label: 'Beto', wasDeletion: true },
      'No se quitó a «Beto»: tiene cuenta en el grupo. Primero quítale el acceso. Quedó como borrador.',
    ],
    [
      'cupo de grupos',
      { reason: 'quota', quota: 'groups', entity: 'group', label: 'Viaje', wasNew: true },
      '«Viaje» no se guardó: llegaste al máximo de grupos. Quedó como borrador.',
    ],
    [
      'cupo de miembros',
      { reason: 'quota', quota: 'members', entity: 'member', label: 'Dani', wasNew: true },
      '«Dani» no se guardó: el grupo llegó al máximo de miembros. Quedó como borrador.',
    ],
    [
      'cupo de categorías',
      { reason: 'quota', quota: 'categories', entity: 'category', label: 'Snacks', wasNew: true },
      '«Snacks» no se guardó: el grupo llegó al máximo de categorías. Quedó como borrador.',
    ],
    [
      'cupo de movimientos',
      { reason: 'quota', quota: 'movements', wasNew: true },
      '«Cena» no se guardó: el grupo llegó al máximo de movimientos. Quedó como borrador.',
    ],
  ] as const)('%s: dice qué pasó con su nombre y ofrece "Revisar"', async (_name, patch, text) => {
    const engine = createFakeSyncEngine();
    await renderNotices(engine);
    await act(() => engine.emitNotice(notice(patch)));

    expect(await screen.findByText(text)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Revisar' })).toBeOnTheScreen();
  });

  it('varios avisos juntos se resumen en uno', async () => {
    const engine = createFakeSyncEngine();
    await renderNotices(engine);
    await act(() => {
      engine.emitNotice(notice({ label: 'Cena' }));
      engine.emitNotice(notice({ label: 'Taxi' }));
      engine.emitNotice(notice({ label: 'Hotel' }));
    });

    expect(
      await screen.findByText('3 cambios tuyos no se aplicaron. Quedaron como borradores.'),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/Cena/)).toBeNull();
  });

  it('"Revisar" lleva al grupo del aviso y cierra el aviso', async () => {
    const user = userEvent.setup();
    const engine = createFakeSyncEngine();
    await renderNotices(engine);
    await act(() => engine.emitNotice(notice()));

    await user.press(await screen.findByRole('button', { name: 'Revisar' }));
    expect(await screen.findByTestId('group-screen')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Revisar' })).toBeNull();
  });

  it('con avisos de varios grupos, "Revisar" lleva al primero', async () => {
    const user = userEvent.setup();
    const engine = createFakeSyncEngine();
    await renderNotices(engine);
    await act(() => {
      engine.emitNotice(notice({ groupId: OTHER_GROUP }));
      engine.emitNotice(notice({ groupId: GROUP }));
    });

    await user.press(await screen.findByRole('button', { name: 'Revisar' }));
    expect(await screen.findByTestId('group-screen')).toBeOnTheScreen();
  });

  it('se puede cerrar sin revisar', async () => {
    const user = userEvent.setup();
    const engine = createFakeSyncEngine();
    await renderNotices(engine);
    await act(() => engine.emitNotice(notice()));

    await user.press(await screen.findByRole('button', { name: 'Cerrar aviso' }));
    expect(screen.queryByRole('button', { name: 'Revisar' })).toBeNull();
    expect(screen.getByTestId('home')).toBeOnTheScreen();
  });

  it('después de cerrarlo, un aviso nuevo vuelve a mostrarse solo con lo nuevo', async () => {
    const user = userEvent.setup();
    const engine = createFakeSyncEngine();
    await renderNotices(engine);
    await act(() => engine.emitNotice(notice({ label: 'Cena' })));
    await user.press(await screen.findByRole('button', { name: 'Cerrar aviso' }));

    await act(() => engine.emitNotice(notice({ label: 'Taxi' })));
    expect(await screen.findByText(/«Taxi» cambió/)).toBeOnTheScreen();
  });

  it('deja de escuchar al desmontarse', async () => {
    const engine = createFakeSyncEngine();
    const unsubscribe = jest.fn();
    engine.onNotice.mockImplementation(() => unsubscribe);
    await renderNotices(engine);
    expect(engine.onNotice).toHaveBeenCalledTimes(1);

    await act(async () => screen.unmount());
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('habla en inglés', async () => {
    await act(() => changeLanguage('en'));
    const engine = createFakeSyncEngine();
    await renderNotices(engine);
    await act(() => engine.emitNotice(notice()));

    expect(await screen.findByText(/“Cena” was changed on another device/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Review' })).toBeOnTheScreen();
  });
});
