import type { DataChange } from '../changes';
import { recordConflict, type NewConflict } from '../sync/conflicts';
import { markEverythingSynced, rejected, serverRow, setupSync } from '../sync/test-fixtures';

const FIRST = '01990000-0000-7000-8000-0000000000c1';
const SECOND = '01990000-0000-7000-8000-0000000000c2';

const draft = (groupId: string, overrides: Partial<NewConflict> = {}): NewConflict => ({
  id: FIRST,
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

describe('repos.conflicts', () => {
  it('lista los borradores de un grupo, del más antiguo al más nuevo', async () => {
    const s = await setupSync();
    const other = await s.repos.groups.create({
      name: 'Casa',
      currency: 'USD',
      createdBy: s.repos.profile.get()?.id as string,
      members: [{ displayName: 'Ana' }],
    });
    recordConflict(s.db, draft(s.group.id, { id: SECOND, createdAt: 2000 }));
    recordConflict(s.db, draft(s.group.id, { id: FIRST, createdAt: 1000 }));
    recordConflict(
      s.db,
      draft(other.id, { id: '01990000-0000-7000-8000-0000000000c3', createdAt: 500 }),
    );

    expect(s.repos.conflicts.list(s.group.id).map((c) => c.id)).toEqual([FIRST, SECOND]);
    expect(s.repos.conflicts.list(other.id)).toHaveLength(1);
  });

  it('get devuelve el borrador o undefined', async () => {
    const s = await setupSync();
    recordConflict(s.db, draft(s.group.id));

    expect(s.repos.conflicts.get(FIRST)?.data).toEqual({ id: s.group.id, name: 'Playa' });
    expect(s.repos.conflicts.get(SECOND)).toBeUndefined();
  });

  it('discard quita solo ese borrador, avisa en el bus y dice si quitó algo', async () => {
    const s = await setupSync();
    recordConflict(s.db, draft(s.group.id, { id: FIRST }));
    recordConflict(s.db, draft(s.group.id, { id: SECOND, createdAt: 2000 }));
    const changes: DataChange[] = [];
    s.bus.subscribe((change) => changes.push(change));

    expect(s.repos.conflicts.discard(FIRST)).toBe(true);
    expect(s.repos.conflicts.list(s.group.id).map((c) => c.id)).toEqual([SECOND]);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.source).toBe('local');
    expect(changes[0]?.affects({ tables: ['sync_conflicts'], groupId: s.group.id })).toBe(true);

    expect(s.repos.conflicts.discard(FIRST)).toBe(false);
    expect(changes).toHaveLength(1);
  });

  it('un rechazo de la sincronización avisa a quien mira los borradores del grupo', async () => {
    const s = await setupSync();
    markEverythingSynced(s);
    s.repos.groups.rename(s.group.id, s.group.version, 'Playa');
    const [mutation] = s.store.nextBatch({ count: 50, bytes: 262_144 });
    const changes: DataChange[] = [];
    s.bus.subscribe((change) => changes.push(change));

    s.store.applyPushResults([
      rejected(mutation!.id, [
        serverRow('groups', {
          id: s.group.id,
          name: 'Otro',
          currency: 'USD',
          emoji: null,
          color: s.group.color,
          archived_at: null,
          created_by: 'a0000000-0000-7000-8000-000000000000',
          version: 5,
        }),
      ]),
    ]);

    expect(s.repos.conflicts.list(s.group.id)).toHaveLength(1);
    expect(
      changes.some((c) => c.affects({ tables: ['sync_conflicts'], groupId: s.group.id })),
    ).toBe(true);
  });
});
