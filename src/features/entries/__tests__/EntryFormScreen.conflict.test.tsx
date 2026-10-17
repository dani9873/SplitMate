import { userEvent } from '@testing-library/react-native';
import { Slot, router } from 'expo-router';
import { act, renderRouter, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';
import { z } from 'zod';

import { DatabaseProvider } from '@/db/DatabaseProvider';
import { recordConflict, type NewConflict } from '@/db/sync/conflicts';
import { createTestGroup, createTestRepositories, type TestRepositories } from '@/db/test-utils';
import { AuthProvider } from '@/features/auth';
import { TEST_SESSION, createFakeAuthService } from '@/features/auth/test-utils';
import { changeLanguage } from '@/i18n';

import { EntryFormScreen } from '../EntryFormScreen';

const DRAFT_ID = '01990000-0000-7000-8000-0000000000c1';

let ctx: TestRepositories;
let group: ReturnType<typeof createTestGroup>;

function Providers() {
  const service = createFakeAuthService({ restore: async () => TEST_SESSION });
  return (
    <AuthProvider service={service}>
      <DatabaseProvider value={{ db: ctx.db, repos: ctx.repos, bus: ctx.bus }}>
        <Slot />
      </DatabaseProvider>
    </AuthProvider>
  );
}

/** Abre el grupo y desde ahí el formulario, como en la app: así `back()` tiene a dónde volver. */
async function open(url: string) {
  await renderRouter(
    {
      _layout: Providers,
      'groups/[groupId]/index': () => <Text testID="group-detail-screen">grupo</Text>,
      'groups/[groupId]/entries/new': EntryFormScreen,
      'groups/[groupId]/entries/[entryId]/edit': EntryFormScreen,
    },
    { initialUrl: `/groups/${group.group.id}` },
  );
  await screen.findByTestId('group-detail-screen');
  await act(() => router.push(url as never));
}

/** El gasto del usuario, tal como lo guarda la sincronización en el borrador. */
const myExpense = (groupId: string, ids: string[], overrides: Record<string, unknown> = {}) => ({
  group_id: groupId,
  kind: 'expense',
  title: 'Cena de mi parte',
  amount: 4000,
  currency: 'USD',
  group_currency: 'USD',
  group_amount: 4000,
  exchange_rate: '1',
  rate_date: null,
  split_method: 'equal',
  category_id: null,
  occurred_on: '2026-10-08',
  notes: null,
  deleted: false,
  payers: [{ id: 'p1', member_id: ids[1], amount: 4000, group_amount: 4000 }],
  splits: [
    { id: 's1', member_id: ids[0], amount: 2000, group_amount: 2000, input_value: null },
    { id: 's2', member_id: ids[1], amount: 2000, group_amount: 2000, input_value: null },
  ],
  ...overrides,
});

function draftFor(entityId: string, data: Record<string, unknown>, o: Partial<NewConflict> = {}) {
  recordConflict(ctx.db, {
    id: DRAFT_ID,
    entity: 'expense',
    entityId,
    groupId: group.group.id,
    reason: 'conflict',
    data: { id: entityId, ...data },
    serverDeleted: false,
    wasNew: false,
    wasDeletion: false,
    createdAt: 1_790_000_000_000,
    ...o,
  });
}

const dinner = () =>
  ctx.repos.expenses.add({
    groupId: group.group.id,
    title: 'Cena',
    amount: 3000,
    currency: 'USD',
    payers: [{ memberId: group.ids[0] as string, amount: 3000 }],
    split: { method: 'equal', participants: [group.ids[0] as string, group.ids[1] as string] },
    occurredOn: '2026-10-08',
  });

describe('formulario de movimiento abierto desde un borrador de conflicto', () => {
  beforeEach(async () => {
    await act(() => changeLanguage('es'));
    ctx = await createTestRepositories();
    group = createTestGroup(ctx);
  });

  it('con el gasto activo abre una edición con tu versión y, al guardar, descarta el borrador', async () => {
    const user = userEvent.setup();
    const expense = dinner();
    // En el servidor alguien lo subió a la versión 2; aquí ya está así.
    const current = ctx.repos.expenses.get(expense.id);
    draftFor(expense.id, myExpense(group.group.id, group.ids));

    await open(`/groups/${group.group.id}/entries/${expense.id}/edit?fromConflict=${DRAFT_ID}`);

    const title = await screen.findByTestId('entry-title');
    expect(title.props.value).toBe('Cena de mi parte');
    expect(ctx.repos.conflicts.get(DRAFT_ID)).toBeDefined();

    await user.press(screen.getByTestId('save-entry'));
    await screen.findByTestId('group-detail-screen');

    const saved = ctx.repos.expenses.get(expense.id);
    expect(saved?.title).toBe('Cena de mi parte');
    expect(saved?.amount).toBe(4000);
    expect(saved?.version).toBe((current?.version ?? 0) + 1);
    expect(ctx.repos.conflicts.get(DRAFT_ID)).toBeUndefined();
  });

  it('si se sale sin guardar, el borrador sigue y el gasto no cambia', async () => {
    const expense = dinner();
    draftFor(expense.id, myExpense(group.group.id, group.ids));

    await open(`/groups/${group.group.id}/entries/${expense.id}/edit?fromConflict=${DRAFT_ID}`);
    await screen.findByTestId('entry-title');
    await act(() => router.back());
    await screen.findByTestId('group-detail-screen');

    expect(ctx.repos.conflicts.get(DRAFT_ID)).toBeDefined();
    expect(ctx.repos.expenses.get(expense.id)?.title).toBe('Cena');
  });

  it('con el gasto borrado en el servidor abre un alta y no guarda sobre el borrado', async () => {
    const user = userEvent.setup();
    const expense = dinner();
    ctx.repos.expenses.remove(expense.id, expense.version);
    draftFor(expense.id, myExpense(group.group.id, group.ids), { serverDeleted: true });

    await open(`/groups/${group.group.id}/entries/new?fromConflict=${DRAFT_ID}`);
    const title = await screen.findByTestId('entry-title');
    expect(title.props.value).toBe('Cena de mi parte');

    await user.press(screen.getByTestId('save-entry'));
    await screen.findByTestId('group-detail-screen');

    const active = ctx.repos.activity.list({ groupId: group.group.id });
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ title: 'Cena de mi parte' });
    expect(active[0]).not.toMatchObject({ id: expense.id });
    expect(ctx.repos.conflicts.get(DRAFT_ID)).toBeUndefined();
  });

  it('un alta abandonada no deja un borrador de formulario aparte', async () => {
    draftFor('01990000-0000-7000-8000-0000000000e9', myExpense(group.group.id, group.ids), {
      wasNew: true,
    });

    await open(`/groups/${group.group.id}/entries/new?fromConflict=${DRAFT_ID}`);
    await screen.findByTestId('entry-title');
    await act(() => router.back());
    await screen.findByTestId('group-detail-screen');

    expect(ctx.repos.conflicts.get(DRAFT_ID)).toBeDefined();
    expect(ctx.repos.drafts.get(group.group.id, z.unknown())).toBeNull();
  });

  it('ignora un borrador de otro grupo o de otro movimiento y abre el formulario normal', async () => {
    const expense = dinner();
    const other = dinner();
    draftFor(other.id, myExpense(group.group.id, group.ids));

    await open(`/groups/${group.group.id}/entries/${expense.id}/edit?fromConflict=${DRAFT_ID}`);
    const title = await screen.findByTestId('entry-title');
    expect(title.props.value).toBe('Cena');
  });
});
