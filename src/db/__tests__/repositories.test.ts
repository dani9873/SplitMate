import { createIdGenerator } from '@/lib/ids';

import { createRepositories, RepositoryError, type Repositories } from '../repositories';
import { createTestDatabase, type TestDatabase } from '../test-utils';

const code = (expected: string) => expect.objectContaining({ code: expected });
const sumOf = (rows: readonly { groupAmount: number }[]) =>
  rows.reduce((s, r) => s + r.groupAmount, 0);

interface Context {
  db: TestDatabase;
  repos: Repositories;
  userId: string;
}

async function setup(options: { newId?: () => string } = {}): Promise<Context> {
  const { db } = await createTestDatabase();
  let time = 1_760_000_000_000;
  const clock = () => (time += 1);
  const newId =
    options.newId ??
    createIdGenerator({ now: clock, randomBytes: (n) => new Uint8Array(n).fill(7) });
  const repos = createRepositories(db, { now: clock, newId });
  const user = repos.users.create({ displayName: 'Ana' });
  return { db, repos, userId: user.id };
}

function createTrip(ctx: Context, currency = 'USD') {
  return ctx.repos.groups.create({
    name: 'Viaje',
    currency,
    createdBy: ctx.userId,
    members: [
      { displayName: 'Ana', userId: ctx.userId },
      { displayName: 'Beto' },
      { displayName: 'Carla' },
    ],
  });
}

describe('repositorios', () => {
  describe('grupos', () => {
    it('crea un grupo con sus miembros, el primero como dueño', async () => {
      const ctx = await setup();
      const group = createTrip(ctx);
      expect(group).toMatchObject({ name: 'Viaje', currency: 'USD', version: 1 });
      const members = ctx.repos.members.listByGroup(group.id);
      expect(members.map((m) => [m.displayName, m.role])).toEqual([
        ['Ana', 'owner'],
        ['Beto', 'member'],
        ['Carla', 'member'],
      ]);
      expect(ctx.repos.groups.list().map((g) => g.id)).toEqual([group.id]);
    });

    it('valida la entrada con zod', async () => {
      const ctx = await setup();
      const base = {
        name: 'Viaje',
        currency: 'USD',
        createdBy: ctx.userId,
        members: [{ displayName: 'Ana' }],
      };
      expect(() => ctx.repos.groups.create({ ...base, name: '  ' })).toThrow(code('VALIDATION'));
      expect(() => ctx.repos.groups.create({ ...base, currency: 'XYZ' })).toThrow(
        code('VALIDATION'),
      );
      expect(() => ctx.repos.groups.create({ ...base, members: [] })).toThrow(code('VALIDATION'));
      expect(() => ctx.repos.groups.create({ ...base, createdBy: 'nadie' })).toThrow(
        code('NOT_FOUND'),
      );
    });

    it('renombra con bloqueo optimista', async () => {
      const ctx = await setup();
      const group = createTrip(ctx);
      const renamed = ctx.repos.groups.rename(group.id, 1, 'Viaje a la costa');
      expect(renamed).toMatchObject({ name: 'Viaje a la costa', version: 2 });
      expect(() => ctx.repos.groups.rename(group.id, 1, 'Otro')).toThrow(code('CONFLICT'));
      expect(() => ctx.repos.groups.rename('no-existe', 1, 'Otro')).toThrow(code('NOT_FOUND'));
    });

    it('el borrado es lógico y saca el grupo de los listados', async () => {
      const ctx = await setup();
      const group = createTrip(ctx);
      ctx.repos.groups.remove(group.id, 1);
      expect(ctx.repos.groups.list()).toEqual([]);
      expect(ctx.repos.groups.get(group.id)).toBeUndefined();
    });
  });

  describe('gastos', () => {
    it('guarda un gasto con varios pagadores y sus partes', async () => {
      const ctx = await setup();
      const group = createTrip(ctx);
      const [ana, beto, carla] = ctx.repos.members.listByGroup(group.id);
      const expense = ctx.repos.expenses.add({
        groupId: group.id,
        title: 'Cena',
        amount: 1000,
        currency: 'USD',
        payers: [
          { memberId: ana!.id, amount: 600 },
          { memberId: beto!.id, amount: 400 },
        ],
        split: { method: 'equal', participants: [ana!.id, beto!.id, carla!.id] },
        occurredOn: '2026-10-09',
      });
      expect(expense).toMatchObject({ amount: 1000, groupAmount: 1000, exchangeRate: '1' });
      expect(expense.payers.map((p) => p.groupAmount)).toEqual([600, 400]);
      expect(expense.splits.map((s) => s.groupAmount)).toEqual([334, 333, 333]);
      expect(ctx.repos.expenses.listByGroup(group.id)).toHaveLength(1);
    });

    it('convierte a la moneda del grupo y las partes suman el total convertido', async () => {
      const ctx = await setup();
      const group = createTrip(ctx);
      const [ana, beto, carla] = ctx.repos.members.listByGroup(group.id);
      const expense = ctx.repos.expenses.add({
        groupId: group.id,
        title: 'Taxi en París',
        amount: 1000,
        currency: 'EUR',
        exchangeRate: '1.0853',
        rateDate: '2026-10-08',
        payers: [{ memberId: carla!.id, amount: 1000 }],
        split: { method: 'equal', participants: [ana!.id, beto!.id, carla!.id] },
        occurredOn: '2026-10-09',
      });
      expect(expense).toMatchObject({ currency: 'EUR', groupAmount: 1085, exchangeRate: '1.0853' });
      expect(sumOf(expense.splits)).toBe(1085);
      expect(sumOf(expense.payers)).toBe(1085);
    });

    it('exige tasa cuando la moneda no es la del grupo', async () => {
      const ctx = await setup();
      const group = createTrip(ctx);
      const [ana] = ctx.repos.members.listByGroup(group.id);
      expect(() =>
        ctx.repos.expenses.add({
          groupId: group.id,
          title: 'Taxi',
          amount: 1000,
          currency: 'EUR',
          payers: [{ memberId: ana!.id, amount: 1000 }],
          split: { method: 'equal', participants: [ana!.id] },
          occurredOn: '2026-10-09',
        }),
      ).toThrow(code('VALIDATION'));
    });

    it('rechaza miembros que no son del grupo y pagos que no suman el total', async () => {
      const ctx = await setup();
      const group = createTrip(ctx);
      const other = createTrip(ctx);
      const [ana] = ctx.repos.members.listByGroup(group.id);
      const [outsider] = ctx.repos.members.listByGroup(other.id);
      const base = {
        groupId: group.id,
        title: 'Cena',
        amount: 1000,
        currency: 'USD',
        split: { method: 'equal' as const, participants: [ana!.id] },
        occurredOn: '2026-10-09',
      };
      expect(() =>
        ctx.repos.expenses.add({ ...base, payers: [{ memberId: outsider!.id, amount: 1000 }] }),
      ).toThrow(code('VALIDATION'));
      expect(() =>
        ctx.repos.expenses.add({ ...base, payers: [{ memberId: ana!.id, amount: 999 }] }),
      ).toThrow(code('INVALID_PAYERS'));
      expect(() =>
        ctx.repos.expenses.add({
          ...base,
          occurredOn: '09/10/2026',
          payers: [{ memberId: ana!.id, amount: 1000 }],
        }),
      ).toThrow(code('VALIDATION'));
    });

    it('guarda todo o nada: si falla una fila, no queda el gasto a medias', async () => {
      // Mientras `duplicate` está activo, todos los ids se repiten: la segunda parte del
      // gasto viola la clave primaria a mitad de la transacción.
      let duplicate = false;
      const ids = createIdGenerator({
        now: () => 1_760_000_000_000,
        randomBytes: (n) => new Uint8Array(n),
      });
      const ctx = await setup({ newId: () => (duplicate ? 'duplicado' : ids()) });
      const group = createTrip(ctx);
      const [ana, beto] = ctx.repos.members.listByGroup(group.id);
      duplicate = true;
      expect(() =>
        ctx.repos.expenses.add({
          groupId: group.id,
          title: 'Cena',
          amount: 1000,
          currency: 'USD',
          payers: [{ memberId: ana!.id, amount: 1000 }],
          split: { method: 'equal', participants: [ana!.id, beto!.id] },
          occurredOn: '2026-10-09',
        }),
      ).toThrow(/UNIQUE constraint failed/);
      duplicate = false;
      expect(ctx.repos.expenses.listByGroup(group.id)).toEqual([]);
    });

    it('el borrado lógico saca el gasto de los listados y los saldos', async () => {
      const ctx = await setup();
      const group = createTrip(ctx);
      const [ana, beto] = ctx.repos.members.listByGroup(group.id);
      const expense = ctx.repos.expenses.add({
        groupId: group.id,
        title: 'Cena',
        amount: 1000,
        currency: 'USD',
        payers: [{ memberId: ana!.id, amount: 1000 }],
        split: { method: 'equal', participants: [ana!.id, beto!.id] },
        occurredOn: '2026-10-09',
      });
      ctx.repos.expenses.remove(expense.id, expense.version);
      expect(ctx.repos.expenses.listByGroup(group.id)).toEqual([]);
      expect(ctx.repos.balances.forGroup(group.id).settlement).toEqual([]);
      expect(() => ctx.repos.expenses.remove(expense.id, expense.version)).toThrow(
        code('NOT_FOUND'),
      );
    });
  });

  describe('saldos y transferencias', () => {
    it('calcula saldos, sugiere transferencias y queda en cero al pagarlas', async () => {
      const ctx = await setup();
      const group = createTrip(ctx);
      const [ana, beto, carla] = ctx.repos.members.listByGroup(group.id);
      const everyone = [ana!.id, beto!.id, carla!.id];
      ctx.repos.expenses.add({
        groupId: group.id,
        title: 'Hotel',
        amount: 30000,
        currency: 'USD',
        payers: [{ memberId: ana!.id, amount: 30000 }],
        split: { method: 'equal', participants: everyone },
        occurredOn: '2026-10-09',
      });
      ctx.repos.expenses.add({
        groupId: group.id,
        kind: 'income',
        title: 'Reembolso',
        amount: 3000,
        currency: 'USD',
        payers: [{ memberId: beto!.id, amount: 3000 }],
        split: { method: 'shares', shares: everyone.map((memberId) => ({ memberId, shares: 1 })) },
        occurredOn: '2026-10-10',
      });

      const { balances, settlement } = ctx.repos.balances.forGroup(group.id);
      const byMember = Object.fromEntries(balances.map((b) => [b.memberId, b.amount.amount]));
      expect(byMember).toEqual({ [ana!.id]: 21000, [beto!.id]: -12000, [carla!.id]: -9000 });
      expect(settlement.map((t) => [t.from, t.to, t.amount.amount])).toEqual([
        [beto!.id, ana!.id, 12000],
        [carla!.id, ana!.id, 9000],
      ]);

      for (const t of settlement) {
        ctx.repos.transfers.add({
          groupId: group.id,
          fromMemberId: t.from,
          toMemberId: t.to,
          amount: t.amount.amount,
          currency: 'USD',
          occurredOn: '2026-10-11',
        });
      }
      const after = ctx.repos.balances.forGroup(group.id);
      expect(after.balances.every((b) => b.amount.amount === 0)).toBe(true);
      expect(after.settlement).toEqual([]);
      expect(ctx.repos.transfers.listByGroup(group.id)).toHaveLength(2);
    });

    it('rechaza transferencias a uno mismo o demasiado pequeñas tras convertir', async () => {
      const ctx = await setup();
      const group = createTrip(ctx);
      const [ana, beto] = ctx.repos.members.listByGroup(group.id);
      const base = { groupId: group.id, currency: 'USD', occurredOn: '2026-10-09' };
      expect(() =>
        ctx.repos.transfers.add({
          ...base,
          fromMemberId: ana!.id,
          toMemberId: ana!.id,
          amount: 100,
        }),
      ).toThrow(code('VALIDATION'));
      expect(() =>
        ctx.repos.transfers.add({
          ...base,
          currency: 'JPY',
          exchangeRate: '0.0001',
          fromMemberId: ana!.id,
          toMemberId: beto!.id,
          amount: 1,
        }),
      ).toThrow(code('VALIDATION'));
    });

    it('lanza NOT_FOUND para grupos inexistentes', async () => {
      const ctx = await setup();
      expect(() => ctx.repos.balances.forGroup('no-existe')).toThrow(RepositoryError);
      expect(() => ctx.repos.balances.forGroup('no-existe')).toThrow(code('NOT_FOUND'));
    });
  });
});
