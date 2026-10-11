import { Stack } from 'expo-router';
import { userEvent } from '@testing-library/react-native';
import { act, renderRouter, screen, within } from 'expo-router/testing-library';

import { DatabaseProvider } from '@/db/DatabaseProvider';
import { createTestRepositories, type TestRepositories } from '@/db/test-utils';
import { changeLanguage } from '@/i18n';

import { UndoProvider } from '../undo';

// Rutas reales de la app, salvo el layout raíz: aquí la base es sql.js y no hay splash.
const route = (path: string) => require(`../../../app/${path}`).default;

// Teléfono en español de Colombia: así lo aplican las preferencias al cargar Ajustes.
jest.mock('expo-localization', () => {
  const locales = [{ languageCode: 'es', languageTag: 'es-CO', regionCode: 'CO' }];
  return { getLocales: () => locales, useLocales: () => locales };
});

let ctx: TestRepositories;

function TestLayout() {
  return (
    <DatabaseProvider value={{ db: ctx.db, repos: ctx.repos }}>
      <UndoProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </UndoProvider>
    </DatabaseProvider>
  );
}

const routes = () => ({
  _layout: TestLayout,
  '(tabs)/_layout': route('(tabs)/_layout'),
  '(tabs)/index': route('(tabs)/index'),
  '(tabs)/activity': route('(tabs)/activity'),
  '(tabs)/settings': route('(tabs)/settings'),
  'groups/new': route('groups/new'),
  'groups/[groupId]/index': route('groups/[groupId]/index'),
  'groups/[groupId]/settings': route('groups/[groupId]/settings'),
  'groups/[groupId]/entries/new': route('groups/[groupId]/entries/new'),
  'groups/[groupId]/entries/[entryId]/index': route('groups/[groupId]/entries/[entryId]/index'),
  'groups/[groupId]/entries/[entryId]/edit': route('groups/[groupId]/entries/[entryId]/edit'),
});

type User = ReturnType<typeof userEvent.setup>;

/** Escribe un monto con el teclado de la calculadora. */
async function typeAmount(user: User, text: string) {
  for (const char of text) {
    await user.press(screen.getByTestId(`keypad-${char}`));
  }
}

async function press(user: User, testID: string) {
  await user.press(await screen.findByTestId(testID));
}

/** Abre el formulario, completa lo común y deja la división para el paso siguiente. */
async function startExpense(user: User, title: string, amount: string) {
  await press(user, 'add-entry');
  await screen.findByTestId('entry-form-screen');
  await typeAmount(user, amount);
  await press(user, 'keypad-done');
  await user.type(screen.getByTestId('entry-title'), title);
}

async function choosePayer(user: User, name: string) {
  await press(user, 'payer-select');
  const picker = await screen.findByTestId('member-picker');
  await user.press(within(picker).getByRole('radio', { name }));
}

describe('flujo completo de un grupo', () => {
  beforeEach(async () => {
    ctx = await createTestRepositories();
    await act(() => changeLanguage('es'));
  });

  afterAll(async () => {
    await act(() => changeLanguage('en'));
  });

  it('crear grupo, gastos con los cuatro métodos, saldos y liquidar hasta cero', async () => {
    const user = userEvent.setup();
    await renderRouter(routes(), { initialUrl: '/' });

    // 1. Crear el grupo con tres personas.
    await user.press(await screen.findByRole('button', { name: 'Crear grupo' }));
    await screen.findByTestId('create-group-screen');
    await user.type(screen.getByTestId('group-name'), 'Viaje');
    await user.type(screen.getByTestId('your-name'), 'Ana');
    await user.type(screen.getByTestId('member-name-0'), 'Beto');
    await user.type(screen.getByTestId('member-name-1'), 'Carla');
    await press(user, 'create-group');
    await screen.findByTestId('group-detail-screen');
    expect(await screen.findByText('Sin movimientos todavía')).toBeOnTheScreen();

    // 2. Hotel, 90, pagó Ana, por igual entre los tres.
    await startExpense(user, 'Hotel', '90');
    await press(user, 'save-entry');
    await screen.findByTestId('group-detail-screen');

    // 3. Cena, 60, pagó Beto, por montos: 10, 20 y 30.
    await startExpense(user, 'Cena', '60');
    await choosePayer(user, 'Beto');
    await press(user, 'split-exact');
    for (const [index, amount] of ['10', '20', '30'].entries()) {
      await press(user, `exact-amount-${index}`);
      await typeAmount(user, amount);
    }
    await press(user, 'keypad-done');
    expect(screen.getByText('Cuadra con el total')).toBeOnTheScreen();
    await press(user, 'save-entry');
    await screen.findByTestId('group-detail-screen');

    // 4. Taxi, 100, pagó Carla, por porcentajes: 50, 25 y 25.
    await startExpense(user, 'Taxi', '100');
    await choosePayer(user, 'Carla');
    await press(user, 'split-percentage');
    await user.type(screen.getByTestId('percent-0'), '50');
    await user.type(screen.getByTestId('percent-1'), '25');
    expect(screen.getByText('Falta 25 %')).toBeOnTheScreen();
    expect(screen.getByTestId('save-entry')).toBeDisabled();
    await user.type(screen.getByTestId('percent-2'), '25');
    await press(user, 'save-entry');
    await screen.findByTestId('group-detail-screen');

    // 5. Museo, 40, pagó Ana, por partes: 1, 2 y 1.
    await startExpense(user, 'Museo', '40');
    await press(user, 'split-shares');
    await user.press(screen.getByRole('button', { name: 'Sumar a partes de Beto' }));
    await press(user, 'save-entry');
    await screen.findByTestId('group-detail-screen');

    // 6. Saldos: Ana +30, Beto −35, Carla +5.
    await press(user, 'section-balances');
    await screen.findByTestId('balances-view');
    // Las filas van con "tú" primero y después en orden de creación.
    const balance = (index: number) =>
      screen.getByTestId(`balance-${index}`).props.accessibilityLabel as string;
    expect(balance(0)).toMatch(/^Ana \(tú\), le deben .*30,00/);
    expect(balance(1)).toMatch(/^Beto, debe .*35,00/);
    expect(balance(2)).toMatch(/^Carla, le deben .*5,00/);

    // 7. Liquidar con las dos transferencias sugeridas.
    const suggested = screen.getAllByRole('button', { name: /^Marcar como pagada: Beto le paga/ });
    expect(suggested).toHaveLength(2);
    for (const button of suggested) {
      await user.press(button);
    }

    // 8. Todos en cero.
    expect(await screen.findByTestId('all-settled')).toBeOnTheScreen();
    for (const index of [0, 1, 2]) {
      expect(balance(index)).toMatch(/al día$/);
    }
    const { balances } = ctx.repos.balances.forGroup(ctx.repos.groups.list()[0]?.id as string);
    expect(balances.every((b) => b.amount.amount === 0)).toBe(true);
    expect(ctx.repos.activity.list()).toHaveLength(6);
  });
});
