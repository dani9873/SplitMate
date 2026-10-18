import { RepositoryError } from '../repositories';
import { createTestGroup, createTestRepositories, type TestRepositories } from '../test-utils';

const NOW = 1_790_000_000_000;
const OTHER = '01990000-0000-7000-8000-0000000000aa';
const THIRD = '01990000-0000-7000-8000-0000000000bb';

/** Un grupo con Ana (yo), Beto y Carla; Beto tiene cuenta y acceso, y Ana es la dueña. */
async function setup() {
  const ctx = await createTestRepositories();
  const { group, ids } = createTestGroup(ctx);
  const me = ctx.repos.profile.get()!;
  const [, betoId] = ids;
  ctx.sqlite.run(
    `INSERT INTO users (id, created_at, updated_at, display_name, is_remote)
     VALUES ('${OTHER}', ${NOW}, ${NOW}, '?', 1)`,
  );
  ctx.sqlite.run(
    `UPDATE group_members SET user_id = '${OTHER}', version = version + 1, synced_version = version + 1
     WHERE id = '${betoId}'`,
  );
  grantAccess(ctx, group.id, me.id, 'owner', 'a-ana');
  grantAccess(ctx, group.id, OTHER, 'member', 'a-beto');
  return { ...ctx, group, me, ids, betoId: betoId as string };
}

function grantAccess(
  ctx: TestRepositories,
  groupId: string,
  userId: string,
  role: 'owner' | 'member',
  id: string,
  deletedAt: number | null = null,
) {
  ctx.sqlite.run(
    `INSERT INTO group_access (id, group_id, user_id, role, created_at, updated_at, deleted_at, version)
     VALUES ('${id}', '${groupId}', '${userId}', '${role}', ${NOW}, ${NOW}, ${deletedAt ?? 'NULL'}, 1)`,
  );
}

const loseAccess = (ctx: TestRepositories, groupId: string) =>
  ctx.sqlite.run(`UPDATE groups SET access_lost_at = ${NOW} WHERE id = '${groupId}'`);

const codeOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof RepositoryError ? error.code : String(error);
  }
  return null;
};

describe('repos.access: quién tiene acceso', () => {
  it('lista el acceso activo con el rol y marca cuál es el mío', async () => {
    const s = await setup();
    const entries = s.repos.access.listActive(s.group.id);
    expect(entries.map((e) => [e.userId, e.role, e.isMe])).toEqual(
      expect.arrayContaining([
        [s.me.id, 'owner', true],
        [OTHER, 'member', false],
      ]),
    );
    expect(entries).toHaveLength(2);
  });

  it('no incluye a quien perdió el acceso', async () => {
    const s = await setup();
    s.sqlite.run(
      `INSERT INTO users (id, created_at, updated_at, display_name, is_remote) VALUES ('${THIRD}', 1, 1, '?', 1)`,
    );
    grantAccess(s, s.group.id, THIRD, 'member', 'a-fuera', NOW);
    expect(s.repos.access.listActive(s.group.id).map((e) => e.userId)).not.toContain(THIRD);
  });

  it('mi rol: dueña, miembro o ninguno', async () => {
    const s = await setup();
    expect(s.repos.access.myRole(s.group.id)).toBe('owner');
    s.sqlite.run(`UPDATE group_access SET role = 'member' WHERE id = 'a-ana'`);
    expect(s.repos.access.myRole(s.group.id)).toBe('member');
    s.sqlite.run(`UPDATE group_access SET deleted_at = ${NOW} WHERE id = 'a-ana'`);
    expect(s.repos.access.myRole(s.group.id)).toBeNull();
  });

  it('un grupo que todavía no se sube (sin filas de acceso) se trata como mío', async () => {
    const ctx = await createTestRepositories();
    const { group } = createTestGroup(ctx);
    expect(ctx.repos.access.myRole(group.id)).toBe('owner');
    expect(ctx.repos.access.listActive(group.id)).toEqual([]);
  });

  it('dice si el grupo perdió el acceso', async () => {
    const s = await setup();
    expect(s.repos.access.isLost(s.group.id)).toBe(false);
    loseAccess(s, s.group.id);
    expect(s.repos.access.isLost(s.group.id)).toBe(true);
  });
});

describe('un grupo sin acceso es de solo lectura', () => {
  it('se puede leer todo', async () => {
    const s = await setup();
    loseAccess(s, s.group.id);
    expect(s.repos.groups.get(s.group.id)).toMatchObject({ accessLostAt: NOW });
    expect(s.repos.members.listByGroup(s.group.id)).toHaveLength(3);
    expect(s.repos.balances.forGroup(s.group.id)).toBeDefined();
  });

  it.each([
    [
      'agregar un miembro',
      (s: Awaited<ReturnType<typeof setup>>) => s.repos.members.add(s.group.id, 'Dani'),
    ],
    [
      'renombrar un miembro',
      (s: Awaited<ReturnType<typeof setup>>) => {
        const m = s.repos.members.listByGroup(s.group.id)[0]!;
        return s.repos.members.rename(m.id, m.version, 'Otro');
      },
    ],
    [
      'cambiar el grupo',
      (s: Awaited<ReturnType<typeof setup>>) =>
        s.repos.groups.rename(s.group.id, s.group.version, 'Nuevo nombre'),
    ],
    [
      'archivar el grupo',
      (s: Awaited<ReturnType<typeof setup>>) => s.repos.groups.archive(s.group.id, s.group.version),
    ],
    [
      'borrar el grupo',
      (s: Awaited<ReturnType<typeof setup>>) => s.repos.groups.remove(s.group.id, s.group.version),
    ],
    [
      'agregar un gasto',
      (s: Awaited<ReturnType<typeof setup>>) =>
        s.repos.expenses.add({
          groupId: s.group.id,
          title: 'Cena',
          amount: 1000,
          currency: 'USD',
          payers: [{ memberId: s.ids[0] as string, amount: 1000 }],
          split: { method: 'equal', participants: [s.ids[0] as string, s.ids[2] as string] },
          occurredOn: '2026-10-09',
        }),
    ],
    [
      'agregar una transferencia',
      (s: Awaited<ReturnType<typeof setup>>) =>
        s.repos.transfers.add({
          groupId: s.group.id,
          fromMemberId: s.ids[1] as string,
          toMemberId: s.ids[0] as string,
          amount: 500,
          currency: 'USD',
          occurredOn: '2026-10-09',
        }),
    ],
  ])('no deja %s: GROUP_ACCESS_LOST', async (_name, write) => {
    const s = await setup();
    loseAccess(s, s.group.id);
    expect(codeOf(() => write(s))).toBe('GROUP_ACCESS_LOST');
  });

  it('con acceso las mismas escrituras sí pasan', async () => {
    const s = await setup();
    expect(codeOf(() => s.repos.members.add(s.group.id, 'Dani'))).toBeNull();
  });
});

describe('un miembro con cuenta y acceso no se borra', () => {
  it('members.remove da MEMBER_LINKED: primero se le quita el acceso', async () => {
    const s = await setup();
    const beto = s.repos.members.listByGroup(s.group.id).find((m) => m.id === s.betoId)!;
    expect(codeOf(() => s.repos.members.remove(beto.id, beto.version))).toBe('MEMBER_LINKED');
    expect(s.repos.members.listByGroup(s.group.id).map((m) => m.id)).toContain(s.betoId);
  });

  it('el propio "yo" con acceso tampoco se borra', async () => {
    const s = await setup();
    const me = s.repos.members.listByGroup(s.group.id).find((m) => m.userId === s.me.id)!;
    expect(codeOf(() => s.repos.members.remove(me.id, me.version))).toBe('MEMBER_LINKED');
  });

  it('un miembro sin cuenta se borra como siempre', async () => {
    const s = await setup();
    const carla = s.repos.members.listByGroup(s.group.id).find((m) => m.displayName === 'Carla')!;
    expect(codeOf(() => s.repos.members.remove(carla.id, carla.version))).toBeNull();
  });

  it('si la cuenta ya perdió el acceso, su miembro (sin cuenta) se borra', async () => {
    const s = await setup();
    s.sqlite.run(`UPDATE group_access SET deleted_at = ${NOW} WHERE id = 'a-beto'`);
    s.sqlite.run(`UPDATE group_members SET user_id = NULL WHERE id = '${s.betoId}'`);
    const beto = s.repos.members.listByGroup(s.group.id).find((m) => m.id === s.betoId)!;
    expect(codeOf(() => s.repos.members.remove(beto.id, beto.version))).toBeNull();
  });
});

describe('repos.access.removeFromPhone', () => {
  const count = (s: TestRepositories, table: string, where = '1') =>
    Number(s.sqlite.exec(`SELECT count(*) FROM ${table} WHERE ${where}`)[0]?.values[0]?.[0]);

  it('no borra un grupo al que todavía se tiene acceso', async () => {
    const s = await setup();
    expect(codeOf(() => s.repos.access.removeFromPhone(s.group.id))).toBe('VALIDATION');
    expect(s.repos.groups.get(s.group.id)).toBeDefined();
  });

  it('borra de este teléfono todo lo del grupo sin acceso y nada de los otros grupos', async () => {
    const s = await setup();
    const other = createTestGroup(s, { names: ['Ana', 'Zoe'] });
    const expense = s.repos.expenses.add({
      groupId: s.group.id,
      title: 'Cena',
      amount: 1000,
      currency: 'USD',
      payers: [{ memberId: s.ids[0] as string, amount: 1000 }],
      split: { method: 'equal', participants: [s.ids[0] as string, s.ids[2] as string] },
      occurredOn: '2026-10-09',
    });
    s.repos.transfers.add({
      groupId: s.group.id,
      fromMemberId: s.ids[1] as string,
      toMemberId: s.ids[0] as string,
      amount: 500,
      currency: 'USD',
      occurredOn: '2026-10-09',
    });
    const mine = (table: string) => `group_id = '${s.group.id}'`;
    s.sqlite.run(
      `INSERT INTO categories (id, created_at, updated_at, group_id, name, icon)
       VALUES ('01990000-0000-7000-8000-0000000000c1', 1, 1, '${s.group.id}', 'Snacks', 'cookie')`,
    );
    s.sqlite.run(
      `INSERT INTO sync_outbox (id, entity, entity_id, group_id, base, data, created_at)
       VALUES ('o1', 'expense', '${expense.id}', '${s.group.id}', NULL, '{}', 1)`,
    );
    s.sqlite.run(
      `INSERT INTO sync_conflicts (id, entity, entity_id, group_id, reason, data, created_at)
       VALUES ('d1', 'expense', '${expense.id}', '${s.group.id}', 'conflict', '{}', 1)`,
    );
    s.sqlite.run(
      `INSERT INTO sync_cursors (group_id, cursor, updated_at) VALUES ('${s.group.id}', 5, 1)`,
    );
    s.sqlite.run(
      `INSERT INTO sync_pull_pages (group_id, page, rows, created_at) VALUES ('${s.group.id}', 1, '[]', 1)`,
    );
    s.sqlite.run(
      `INSERT INTO invitation_links (id, group_id, token, expires_at, max_uses, created_at)
       VALUES ('i1', '${s.group.id}', '${'x'.repeat(43)}', ${NOW}, 10, 1)`,
    );
    loseAccess(s, s.group.id);

    s.repos.access.removeFromPhone(s.group.id);

    for (const table of [
      'groups',
      'group_members',
      'group_access',
      'expenses',
      'transfers',
      'categories',
      'sync_outbox',
      'sync_conflicts',
      'sync_cursors',
      'sync_pull_pages',
      'invitation_links',
    ]) {
      const where = table === 'groups' ? `id = '${s.group.id}'` : mine(table);
      expect(count(s, table, where)).toBe(0);
    }
    expect(count(s, 'expense_payers', `expense_id = '${expense.id}'`)).toBe(0);
    expect(count(s, 'expense_splits', `expense_id = '${expense.id}'`)).toBe(0);
    // El otro grupo y las categorías predefinidas siguen.
    expect(s.repos.groups.get(other.group.id)).toBeDefined();
    expect(count(s, 'group_members', `group_id = '${other.group.id}'`)).toBe(2);
    expect(count(s, 'categories', 'key IS NOT NULL')).toBe(9);
    expect(s.sqlite.exec('PRAGMA foreign_key_check')).toEqual([]);
  });

  it('avisa a las pantallas por el bus', async () => {
    const s = await setup();
    loseAccess(s, s.group.id);
    const seen: string[] = [];
    s.bus.subscribe((change) => change.groupIds?.forEach((id) => seen.push(id)));
    s.repos.access.removeFromPhone(s.group.id);
    expect(seen).toContain(s.group.id);
  });

  it('un grupo que no existe da NOT_FOUND', async () => {
    const s = await setup();
    expect(
      codeOf(() => s.repos.access.removeFromPhone('01990000-0000-7000-8000-00000000ffff')),
    ).toBe('NOT_FOUND');
  });
});
