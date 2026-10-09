import { act, render, screen, userEvent } from '@testing-library/react-native';

import { DatabaseGate, type DatabaseSetup } from '@/db/DatabaseProvider';
import { createRepositories } from '@/db/repositories';
import { createTestDatabase } from '@/db/test-utils';
import { changeLanguage } from '@/i18n';
import { createIdGenerator } from '@/lib/ids';

import { measureSettlement } from '../benchmark';
import { DevScreen } from '../DevScreen';

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  Stack: { Screen: () => null },
}));

async function renderDevScreen() {
  const { db } = await createTestDatabase();
  let time = 1_760_000_000_000;
  const deps = {
    now: () => (time += 1),
    newId: createIdGenerator({ now: () => time, randomBytes: (n) => new Uint8Array(n).fill(3) }),
  };
  const database: DatabaseSetup = {
    state: { status: 'ready', value: { db, repos: createRepositories(db, deps) } },
    settledOnce: true,
    retry: () => {},
  };
  await render(
    <DatabaseGate database={database}>
      <DevScreen />
    </DatabaseGate>,
  );
}

describe('pantalla de desarrollo', () => {
  beforeEach(async () => {
    await act(() => changeLanguage('es'));
  });

  afterEach(async () => {
    await act(() => changeLanguage('en'));
  });

  it('crea el grupo de ejemplo y muestra saldos y transferencias sugeridas', async () => {
    const user = userEvent.setup();
    await renderDevScreen();
    expect(screen.getByText('Todavía no hay un grupo de ejemplo.')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Crear grupo de ejemplo' }));

    expect(await screen.findByText('Viaje de ejemplo')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Saldos' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Transferencias sugeridas' })).toBeOnTheScreen();
    expect(screen.getAllByText(/le paga/).length).toBeGreaterThan(0);
    expect(screen.getByText('Taxi en París')).toBeOnTheScreen();
  });

  it('agrega gastos aleatorios y reinicia los datos', async () => {
    const user = userEvent.setup();
    await renderDevScreen();
    await user.press(screen.getByRole('button', { name: 'Crear grupo de ejemplo' }));
    await user.press(screen.getByRole('button', { name: 'Agregar gasto aleatorio' }));
    expect(await screen.findByText('Gasto aleatorio 1')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Reiniciar datos de ejemplo' }));

    expect(await screen.findByText('Todavía no hay un grupo de ejemplo.')).toBeOnTheScreen();
  });

  it('indica si la base está cifrada', async () => {
    await renderDevScreen();
    expect(
      screen.getByText('Base sin cifrar: SQLCipher no está disponible aquí'),
    ).toBeOnTheScreen();
  });
});

describe('medición de la liquidación', () => {
  it('mide cada tamaño de grupo pedido', () => {
    const results = measureSettlement([4, 6], 1);
    expect(results.map((r) => r.members)).toEqual([4, 6]);
    for (const result of results) {
      expect(result.ms).toBeGreaterThanOrEqual(0);
    }
  });
});
