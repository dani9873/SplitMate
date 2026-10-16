import {
  discardConflict,
  getConflict,
  listConflicts,
  recordConflict,
  type NewConflict,
} from '../conflicts';
import { setupSync } from '../test-fixtures';

const base = (groupId: string, overrides: Partial<NewConflict> = {}): NewConflict => ({
  id: '01990000-0000-7000-8000-0000000000c1',
  entity: 'group',
  entityId: groupId,
  groupId,
  reason: 'conflict',
  data: { id: groupId, name: 'Playa' },
  serverDeleted: false,
  wasNew: false,
  wasDeletion: false,
  createdAt: 1_790_000_000_000,
  ...overrides,
});

describe('borradores por revisar', () => {
  it('guarda un borrador y lo lee tal como se guardó', async () => {
    const s = await setupSync();
    recordConflict(s.db, base(s.group.id, { serverDeleted: true, wasDeletion: true }));

    expect(getConflict(s.db, '01990000-0000-7000-8000-0000000000c1')).toEqual({
      id: '01990000-0000-7000-8000-0000000000c1',
      entity: 'group',
      entityId: s.group.id,
      groupId: s.group.id,
      reason: 'conflict',
      data: { id: s.group.id, name: 'Playa' },
      serverDeleted: true,
      wasNew: false,
      wasDeletion: true,
      createdAt: 1_790_000_000_000,
    });
  });

  it('la lista va del más antiguo al más nuevo y puede filtrarse por grupo', async () => {
    const s = await setupSync();
    const otherGroup = '01990000-0000-7000-8000-0000000000d1';
    recordConflict(
      s.db,
      base(s.group.id, { id: '01990000-0000-7000-8000-0000000000c2', createdAt: 2000 }),
    );
    recordConflict(
      s.db,
      base(s.group.id, { id: '01990000-0000-7000-8000-0000000000c1', createdAt: 1000 }),
    );
    recordConflict(
      s.db,
      base(otherGroup, { id: '01990000-0000-7000-8000-0000000000c3', createdAt: 3000 }),
    );

    expect(listConflicts(s.db).map((c) => c.createdAt)).toEqual([1000, 2000, 3000]);
    expect(listConflicts(s.db, s.group.id).map((c) => c.createdAt)).toEqual([1000, 2000]);
    expect(listConflicts(s.db, otherGroup)).toHaveLength(1);
    expect(listConflicts(s.db, '01990000-0000-7000-8000-0000000000d9')).toEqual([]);
  });

  it('un id que no existe no se encuentra', async () => {
    const s = await setupSync();
    expect(getConflict(s.db, '01990000-0000-7000-8000-0000000000ee')).toBeUndefined();
  });

  it('solo discardConflict quita un borrador, y solo ese', async () => {
    const s = await setupSync();
    recordConflict(s.db, base(s.group.id));
    recordConflict(s.db, base(s.group.id, { id: '01990000-0000-7000-8000-0000000000c2' }));

    expect(discardConflict(s.db, '01990000-0000-7000-8000-0000000000c1')).toBe(true);
    expect(listConflicts(s.db).map((c) => c.id)).toEqual(['01990000-0000-7000-8000-0000000000c2']);
    expect(discardConflict(s.db, '01990000-0000-7000-8000-0000000000c1')).toBe(false);
    expect(s.store.counts().conflicts).toBe(1);
  });

  it('descartar no toca los movimientos', async () => {
    const s = await setupSync();
    const before = s.sqlite.exec(`SELECT count(*) FROM groups`)[0]?.values[0]?.[0];
    recordConflict(s.db, base(s.group.id));
    discardConflict(s.db, '01990000-0000-7000-8000-0000000000c1');
    expect(s.sqlite.exec(`SELECT count(*) FROM groups`)[0]?.values[0]?.[0]).toBe(before);
  });

  it('el store expone lo mismo', async () => {
    const s = await setupSync();
    recordConflict(s.db, base(s.group.id));
    expect(s.store.listConflicts().map((c) => c.id)).toEqual([
      '01990000-0000-7000-8000-0000000000c1',
    ]);
    expect(s.store.getConflict('01990000-0000-7000-8000-0000000000c1')?.entityId).toBe(s.group.id);
    expect(s.store.discardConflict('01990000-0000-7000-8000-0000000000c1')).toBe(true);
    expect(s.store.listConflicts()).toEqual([]);
  });

  it('un dato guardado que no es un objeto JSON no rompe la lista', async () => {
    const s = await setupSync();
    s.sqlite.run(
      `INSERT INTO sync_conflicts (id, entity, entity_id, group_id, reason, data, created_at)
       VALUES ('01990000-0000-7000-8000-0000000000c9', 'group', 'x', 'y', 'conflict', 'no es json', 1)`,
    );
    expect(listConflicts(s.db)).toEqual([]);
  });
});
