import { OTHER_CATEGORY_ID } from '../../repositories';
import { listPendingUnits, readUnit } from '../units';
import { markEverythingSynced, setupSync, type SyncSetup } from '../test-fixtures';

const dinner = (s: SyncSetup, amount = 3000) =>
  s.repos.expenses.add({
    groupId: s.group.id,
    title: 'Cena',
    amount,
    currency: 'USD',
    payers: [{ memberId: s.ids[0] as string, amount }],
    split: { method: 'equal', participants: [s.ids[0] as string, s.ids[1] as string] },
    occurredOn: '2026-10-09',
  });

describe('unidades de sincronización', () => {
  it('un grupo nuevo es pendiente: primero el grupo y después sus miembros, en orden', async () => {
    const s = await setupSync();
    expect(listPendingUnits(s.db)).toEqual([
      { entity: 'group', id: s.group.id, groupId: s.group.id },
      ...s.ids.map((id) => ({ entity: 'member', id, groupId: s.group.id })),
    ]);
  });

  it('no lista lo que ya está al día', async () => {
    const s = await setupSync();
    markEverythingSynced(s);
    expect(listPendingUnits(s.db)).toEqual([]);
  });

  it('una edición vuelve pendiente solo esa unidad', async () => {
    const s = await setupSync();
    markEverythingSynced(s);
    s.repos.groups.rename(s.group.id, s.group.version, 'Playa');
    expect(listPendingUnits(s.db)).toEqual([
      { entity: 'group', id: s.group.id, groupId: s.group.id },
    ]);
  });

  it('el orden es por grupo, después entidad (grupo, miembro, gasto, transferencia) y creación', async () => {
    const s = await setupSync();
    markEverythingSynced(s);
    const expense = dinner(s);
    const transfer = s.repos.transfers.add({
      groupId: s.group.id,
      fromMemberId: s.ids[1] as string,
      toMemberId: s.ids[0] as string,
      amount: 500,
      currency: 'USD',
      occurredOn: '2026-10-10',
    });
    const member = s.repos.members.add(s.group.id, 'Dani');
    s.repos.groups.rename(s.group.id, s.group.version, 'Playa');

    expect(listPendingUnits(s.db).map((u) => [u.entity, u.id])).toEqual([
      ['group', s.group.id],
      ['member', member.id],
      ['expense', expense.id],
      ['transfer', transfer.id],
    ]);
  });

  it('con varios grupos, agrupa por grupo', async () => {
    const s = await setupSync();
    const other = s.repos.groups.create({
      name: 'Casa',
      currency: 'EUR',
      createdBy: s.repos.profile.get()!.id,
      members: [{ displayName: 'Ana' }, { displayName: 'Luis' }],
    });
    const groupIds = listPendingUnits(s.db).map((u) => u.groupId);
    const sorted = [...groupIds].sort();
    expect(groupIds).toEqual(sorted);
    expect(new Set(groupIds)).toEqual(new Set([s.group.id, other.id]));
  });

  it('las categorías predefinidas nunca se envían, aunque suban de versión', async () => {
    const s = await setupSync();
    markEverythingSynced(s);
    s.sqlite.run(`UPDATE categories SET version = version + 1 WHERE group_id IS NULL`);
    expect(listPendingUnits(s.db).filter((u) => u.entity === 'category')).toEqual([]);
  });

  describe('contenido de cada envío', () => {
    it('grupo: archivado y borrado son booleanos, no instantes', async () => {
      const s = await setupSync();
      expect(readUnit(s.db, { entity: 'group', id: s.group.id })).toEqual({
        entity: 'group',
        id: s.group.id,
        groupId: s.group.id,
        base: null,
        data: {
          id: s.group.id,
          name: 'Viaje',
          currency: 'USD',
          emoji: null,
          color: s.group.color,
          archived: false,
          deleted: false,
        },
      });

      markEverythingSynced(s);
      s.repos.groups.archive(s.group.id, s.group.version);
      const archived = readUnit(s.db, { entity: 'group', id: s.group.id });
      expect(archived?.base).toBe(s.group.version);
      expect(archived?.data).toMatchObject({ archived: true, deleted: false });
    });

    it('miembro: lleva su grupo, su cuenta y su rol', async () => {
      const s = await setupSync();
      const me = s.members[0]!;
      expect(readUnit(s.db, { entity: 'member', id: me.id })?.data).toEqual({
        id: me.id,
        group_id: s.group.id,
        display_name: 'Ana',
        user_id: me.userId,
        role: 'owner',
        deleted: false,
      });
      expect(readUnit(s.db, { entity: 'member', id: s.ids[1] as string })?.data).toMatchObject({
        display_name: 'Beto',
        user_id: null,
        role: 'member',
      });
    });

    it('gasto: lleva solo los pagadores y partes activos, ordenados por id', async () => {
      const s = await setupSync();
      const expense = dinner(s);
      const edited = s.repos.expenses.update(expense.id, expense.version, {
        groupId: s.group.id,
        title: 'Cena grande',
        amount: 4000,
        currency: 'USD',
        notes: 'Con propina',
        payers: [{ memberId: s.ids[1] as string, amount: 4000 }],
        split: {
          method: 'exact',
          amounts: [
            { memberId: s.ids[0] as string, amount: 1000 },
            { memberId: s.ids[2] as string, amount: 3000 },
          ],
        },
        occurredOn: '2026-10-09',
      });

      const unit = readUnit(s.db, { entity: 'expense', id: expense.id });
      expect(unit?.groupId).toBe(s.group.id);
      expect(unit?.data).toMatchObject({
        id: expense.id,
        group_id: s.group.id,
        kind: 'expense',
        title: 'Cena grande',
        amount: 4000,
        currency: 'USD',
        group_currency: 'USD',
        group_amount: 4000,
        exchange_rate: '1',
        rate_date: null,
        split_method: 'exact',
        category_id: OTHER_CATEGORY_ID,
        occurred_on: '2026-10-09',
        notes: 'Con propina',
        deleted: false,
      });
      const data = unit!.data as {
        payers: { id: string }[];
        splits: { id: string }[];
      };
      expect(data.payers.map((p) => p.id)).toEqual(edited.payers.map((p) => p.id).sort());
      expect(data.splits.map((p) => p.id)).toEqual(edited.splits.map((p) => p.id).sort());
      expect(data.payers).toEqual([
        { id: edited.payers[0]!.id, member_id: s.ids[1], amount: 4000, group_amount: 4000 },
      ]);
      expect(data.splits).toEqual(
        [...edited.splits]
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .map((p) => ({
            id: p.id,
            member_id: p.memberId,
            amount: p.amount,
            group_amount: p.groupAmount,
            input_value: p.amount,
          })),
      );
    });

    it('gasto borrado: sin pagadores ni partes y con deleted en true', async () => {
      const s = await setupSync();
      const expense = dinner(s);
      s.repos.expenses.remove(expense.id, expense.version);
      const unit = readUnit(s.db, { entity: 'expense', id: expense.id });
      expect(unit?.data).toMatchObject({ deleted: true, payers: [], splits: [] });
    });

    it('gasto restaurado: vuelven los pagadores y partes borrados con él', async () => {
      const s = await setupSync();
      const expense = dinner(s);
      s.repos.expenses.remove(expense.id, expense.version);
      s.repos.expenses.restore(expense.id, expense.version + 1);
      const data = readUnit(s.db, { entity: 'expense', id: expense.id })!.data as {
        deleted: boolean;
        payers: unknown[];
        splits: unknown[];
      };
      expect(data.deleted).toBe(false);
      expect(data.payers).toHaveLength(1);
      expect(data.splits).toHaveLength(2);
    });

    it('gasto en otra moneda: lleva la tasa, su fecha y la moneda del grupo', async () => {
      const s = await setupSync();
      const expense = s.repos.expenses.add({
        groupId: s.group.id,
        title: 'Hotel',
        amount: 10000,
        currency: 'EUR',
        exchangeRate: '1.1',
        rateDate: '2026-10-08',
        payers: [{ memberId: s.ids[0] as string, amount: 10000 }],
        split: { method: 'equal', participants: [s.ids[0] as string] },
        occurredOn: '2026-10-09',
      });
      expect(readUnit(s.db, { entity: 'expense', id: expense.id })?.data).toMatchObject({
        currency: 'EUR',
        group_currency: 'USD',
        amount: 10000,
        group_amount: 11000,
        exchange_rate: '1.1',
        rate_date: '2026-10-08',
      });
    });

    it('transferencia', async () => {
      const s = await setupSync();
      const transfer = s.repos.transfers.add({
        groupId: s.group.id,
        fromMemberId: s.ids[1] as string,
        toMemberId: s.ids[0] as string,
        amount: 500,
        currency: 'USD',
        occurredOn: '2026-10-10',
      });
      expect(readUnit(s.db, { entity: 'transfer', id: transfer.id })?.data).toEqual({
        id: transfer.id,
        group_id: s.group.id,
        from_member_id: s.ids[1],
        to_member_id: s.ids[0],
        amount: 500,
        currency: 'USD',
        group_currency: 'USD',
        group_amount: 500,
        exchange_rate: '1',
        rate_date: null,
        occurred_on: '2026-10-10',
        deleted: false,
      });
    });

    it('lee una unidad que no existe como indefinida', async () => {
      const s = await setupSync();
      expect(readUnit(s.db, { entity: 'expense', id: s.group.id })).toBeUndefined();
    });
  });
});
