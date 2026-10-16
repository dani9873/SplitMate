import { act, screen, userEvent, within } from '@testing-library/react-native';

import { recordConflict, type NewConflict } from '@/db/sync/conflicts';
import { createTestGroup, createTestRepositories, type TestRepositories } from '@/db/test-utils';
import { changeLanguage } from '@/i18n';
import { renderWithDatabase } from '@/test/render';

import { ConflictBanner } from '../ConflictBanner';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: mockPush }),
}));

const ID1 = '01990000-0000-7000-8000-0000000000c1';
const ID2 = '01990000-0000-7000-8000-0000000000c2';

let ctx: TestRepositories;
let setup: ReturnType<typeof createTestGroup>;

function draft(id: string, overrides: Partial<NewConflict>) {
  recordConflict(ctx.db, {
    id,
    entity: 'group',
    entityId: setup.group.id,
    groupId: setup.group.id,
    reason: 'conflict',
    data: {},
    serverDeleted: false,
    wasNew: false,
    wasDeletion: false,
    createdAt: id === ID1 ? 1 : 2,
    ...overrides,
  });
}

const dinner = () =>
  ctx.repos.expenses.add({
    groupId: setup.group.id,
    title: 'Cena',
    amount: 3000,
    currency: 'USD',
    payers: [{ memberId: setup.ids[0] as string, amount: 3000 }],
    split: { method: 'equal', participants: [setup.ids[0] as string, setup.ids[1] as string] },
    occurredOn: '2026-10-08',
  });

async function mount() {
  await renderWithDatabase(<ConflictBanner groupId={setup.group.id} />, ctx);
}

async function openSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.press(await screen.findByRole('button', { name: 'Revisar' }));
  return screen.findByTestId('conflict-sheet');
}

describe('borradores por revisar en el detalle del grupo', () => {
  beforeEach(async () => {
    mockPush.mockClear();
    await act(() => changeLanguage('es'));
    ctx = await createTestRepositories();
    setup = createTestGroup(ctx);
  });

  afterEach(async () => {
    await act(() => changeLanguage('en'));
  });

  it('no aparece si no hay borradores', async () => {
    await mount();

    expect(screen.queryByTestId('conflict-banner')).not.toBeOnTheScreen();
  });

  it('cuenta los cambios por revisar y se actualiza cuando llega otro', async () => {
    draft(ID1, { data: { name: 'Playa' } });
    await mount();
    expect(await screen.findByText('1 cambio por revisar')).toBeOnTheScreen();

    draft(ID2, { data: { name: 'Monte' } });
    await act(async () => {
      ctx.bus.emit({ source: 'sync', tables: ['sync_conflicts'], groupIds: [setup.group.id] });
    });

    expect(await screen.findByText('2 cambios por revisar')).toBeOnTheScreen();
  });

  it('al resolver el último cierra la hoja y un borrador nuevo no la reabre sola', async () => {
    const user = userEvent.setup();
    const lockedGroup = {
      name: setup.group.name,
      currency: 'EUR',
      emoji: setup.group.emoji,
      color: setup.group.color,
      archived: false,
      deleted: false,
    };
    draft(ID1, { reason: 'currency_locked', data: lockedGroup });
    await mount();
    await openSheet(user);

    await user.press(screen.getByTestId(`conflict-understood-${ID1}`));
    expect(screen.queryByTestId('conflict-banner')).not.toBeOnTheScreen();

    draft(ID2, { reason: 'currency_locked', data: lockedGroup });
    await act(async () => {
      ctx.bus.emit({ source: 'sync', tables: ['sync_conflicts'], groupIds: [setup.group.id] });
    });

    expect(await screen.findByTestId('conflict-banner')).toBeOnTheScreen();
    expect(screen.queryByTestId('conflict-sheet')).not.toBeOnTheScreen();
  });

  it('un movimiento abre el formulario con la versión del usuario', async () => {
    const user = userEvent.setup();
    const expense = dinner();
    draft(ID1, {
      entity: 'expense',
      entityId: expense.id,
      data: { title: 'Cena mía' },
    });
    await mount();
    await openSheet(user);

    expect(screen.getByText('Cena mía')).toBeOnTheScreen();
    await user.press(screen.getByTestId(`conflict-open-${ID1}`));

    expect(mockPush).toHaveBeenCalledWith(
      `/groups/${setup.group.id}/entries/${expense.id}/edit?fromConflict=${ID1}`,
    );
    // Abrir el formulario no descarta nada.
    expect(ctx.repos.conflicts.get(ID1)).toBeDefined();
  });

  it('descartar pide confirmar y no toca el movimiento', async () => {
    const user = userEvent.setup();
    const expense = dinner();
    draft(ID1, { entity: 'expense', entityId: expense.id, data: { title: 'Cena mía' } });
    await mount();
    await openSheet(user);

    await user.press(screen.getByTestId(`conflict-discard-${ID1}`));
    await user.press(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(ctx.repos.conflicts.get(ID1)).toBeDefined();

    await user.press(screen.getByTestId(`conflict-discard-${ID1}`));
    await user.press(await screen.findByTestId(`conflict-discard-confirm-${ID1}`));

    expect(ctx.repos.conflicts.get(ID1)).toBeUndefined();
    expect(ctx.repos.expenses.get(expense.id)).toMatchObject({
      title: 'Cena',
      version: expense.version,
    });
    expect(screen.queryByTestId('conflict-banner')).not.toBeOnTheScreen();
  });

  it('"Borrar ahora" borra el movimiento y quita el borrador', async () => {
    const user = userEvent.setup();
    const expense = dinner();
    draft(ID1, {
      entity: 'expense',
      entityId: expense.id,
      wasDeletion: true,
      data: { title: 'Cena', deleted: true },
    });
    await mount();
    await openSheet(user);

    await user.press(screen.getByTestId(`conflict-delete-now-${ID1}`));

    expect(ctx.repos.expenses.get(expense.id)).toBeUndefined();
    expect(ctx.repos.conflicts.get(ID1)).toBeUndefined();
  });

  it('"Mantener" conserva el movimiento y quita el borrador de borrado', async () => {
    const user = userEvent.setup();
    const expense = dinner();
    draft(ID1, {
      entity: 'expense',
      entityId: expense.id,
      wasDeletion: true,
      data: { title: 'Cena', deleted: true },
    });
    await mount();
    await openSheet(user);

    await user.press(screen.getByTestId(`conflict-keep-${ID1}`));

    expect(ctx.repos.expenses.get(expense.id)).toBeDefined();
    expect(ctx.repos.conflicts.get(ID1)).toBeUndefined();
  });

  it('si ya no existe, solo ofrece "Entendido"', async () => {
    const user = userEvent.setup();
    const expense = dinner();
    ctx.repos.expenses.remove(expense.id, expense.version);
    draft(ID1, {
      entity: 'expense',
      entityId: expense.id,
      wasDeletion: true,
      data: { title: 'Cena', deleted: true },
    });
    await mount();
    await openSheet(user);

    expect(screen.queryByTestId(`conflict-delete-now-${ID1}`)).not.toBeOnTheScreen();
    await user.press(screen.getByTestId(`conflict-understood-${ID1}`));

    expect(ctx.repos.conflicts.get(ID1)).toBeUndefined();
  });

  it('un borrado que no se puede aplicar lo explica y deja el borrador', async () => {
    const user = userEvent.setup();
    const [ana, beto] = setup.ids as [string, string];
    ctx.repos.expenses.add({
      groupId: setup.group.id,
      title: 'Taxi',
      amount: 1000,
      currency: 'USD',
      payers: [{ memberId: ana, amount: 1000 }],
      split: { method: 'equal', participants: [ana, beto] },
      occurredOn: '2026-10-08',
    });
    draft(ID1, {
      entity: 'member',
      entityId: beto,
      wasDeletion: true,
      data: { display_name: 'Beto' },
    });
    await mount();
    await openSheet(user);

    await user.press(screen.getByTestId(`conflict-delete-now-${ID1}`));

    expect(await screen.findByTestId(`conflict-error-${ID1}`)).toBeOnTheScreen();
    expect(ctx.repos.conflicts.get(ID1)).toBeDefined();
  });

  it('en un grupo muestra tu versión y la actual, y "Usar la mía" la aplica', async () => {
    const user = userEvent.setup();
    draft(ID1, {
      data: {
        name: 'Playa',
        currency: setup.group.currency,
        emoji: setup.group.emoji,
        color: setup.group.color,
        archived: false,
        deleted: false,
      },
    });
    await mount();
    await openSheet(user);

    const item = screen.getByTestId(`conflict-item-${ID1}`);
    expect(within(item).getByTestId('conflict-diff-name-mine')).toHaveTextContent('Playa');
    expect(within(item).getByTestId('conflict-diff-name-current')).toHaveTextContent('Viaje');

    await user.press(screen.getByTestId(`conflict-use-mine-${ID1}`));

    expect(ctx.repos.groups.get(setup.group.id)?.name).toBe('Playa');
    expect(ctx.repos.conflicts.get(ID1)).toBeUndefined();
  });

  it('"Entendido" en un grupo descarta el borrador sin cambiar el grupo', async () => {
    const user = userEvent.setup();
    draft(ID1, {
      reason: 'currency_locked',
      data: {
        name: setup.group.name,
        currency: 'EUR',
        emoji: setup.group.emoji,
        color: setup.group.color,
        archived: false,
        deleted: false,
      },
    });
    await mount();
    await openSheet(user);

    expect(screen.queryByTestId(`conflict-use-mine-${ID1}`)).not.toBeOnTheScreen();
    await user.press(screen.getByTestId(`conflict-understood-${ID1}`));

    expect(ctx.repos.groups.get(setup.group.id)).toMatchObject({ currency: 'USD' });
    expect(ctx.repos.conflicts.get(ID1)).toBeUndefined();
  });
});
