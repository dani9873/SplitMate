import { RepositoryError } from '../repositories';
import { createTestGroup, createTestRepositories } from '../test-utils';

const TOKEN = 'a'.repeat(43);
const OTHER_TOKEN = 'b'.repeat(43);
const ID_1 = '01990000-0000-7000-8000-0000000000b1';
const ID_2 = '01990000-0000-7000-8000-0000000000b2';
const NOW = 1_790_000_000_000;

async function setup() {
  const ctx = await createTestRepositories();
  const { group } = createTestGroup(ctx);
  return { ...ctx, group };
}

const codeOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof RepositoryError ? error.code : String(error);
  }
  return null;
};

describe('repos.invitationLinks', () => {
  it('guarda el enlace con su token y lo lee', async () => {
    const s = await setup();
    const saved = s.repos.invitationLinks.save({
      id: ID_1,
      groupId: s.group.id,
      token: TOKEN,
      expiresAt: NOW,
      maxUses: 10,
    });
    expect(saved).toMatchObject({ id: ID_1, groupId: s.group.id, token: TOKEN, maxUses: 10 });
    expect(s.repos.invitationLinks.get(ID_1)).toEqual(saved);
    expect(s.repos.invitationLinks.get(ID_2)).toBeUndefined();
  });

  it('guardar otra vez el mismo id reemplaza el token y los usos', async () => {
    const s = await setup();
    const base = { id: ID_1, groupId: s.group.id, expiresAt: NOW, maxUses: 10 };
    s.repos.invitationLinks.save({ ...base, token: TOKEN });
    s.repos.invitationLinks.save({ ...base, token: OTHER_TOKEN, maxUses: 3 });
    expect(s.repos.invitationLinks.listByGroup(s.group.id)).toHaveLength(1);
    expect(s.repos.invitationLinks.get(ID_1)).toMatchObject({ token: OTHER_TOKEN, maxUses: 3 });
  });

  it('lista los de un grupo del más nuevo al más viejo, y solo los de ese grupo', async () => {
    const s = await setup();
    const other = createTestGroup(s, { names: ['Ana', 'Zoe'] });
    s.repos.invitationLinks.save({
      id: ID_1,
      groupId: s.group.id,
      token: TOKEN,
      expiresAt: NOW,
      maxUses: 10,
    });
    s.repos.invitationLinks.save({
      id: ID_2,
      groupId: s.group.id,
      token: OTHER_TOKEN,
      expiresAt: NOW,
      maxUses: 10,
    });
    s.repos.invitationLinks.save({
      id: '01990000-0000-7000-8000-0000000000b3',
      groupId: other.group.id,
      token: 'c'.repeat(43),
      expiresAt: NOW,
      maxUses: 10,
    });
    expect(s.repos.invitationLinks.listByGroup(s.group.id).map((l) => l.id)).toEqual([ID_2, ID_1]);
  });

  it('quita un enlace', async () => {
    const s = await setup();
    s.repos.invitationLinks.save({
      id: ID_1,
      groupId: s.group.id,
      token: TOKEN,
      expiresAt: NOW,
      maxUses: 10,
    });
    s.repos.invitationLinks.remove(ID_1);
    expect(s.repos.invitationLinks.get(ID_1)).toBeUndefined();
  });

  it.each([
    ['un token corto', { token: 'corto' }],
    ['un token con caracteres raros', { token: '!'.repeat(43) }],
    ['un id que no es UUID', { id: 'x' }],
    ['0 usos', { maxUses: 0 }],
    ['51 usos', { maxUses: 51 }],
    ['un vencimiento negativo', { expiresAt: -1 }],
  ])('rechaza %s', async (_name, patch) => {
    const s = await setup();
    const base = { id: ID_1, groupId: s.group.id, token: TOKEN, expiresAt: NOW, maxUses: 10 };
    expect(codeOf(() => s.repos.invitationLinks.save({ ...base, ...patch }))).toBe('VALIDATION');
    expect(s.repos.invitationLinks.listByGroup(s.group.id)).toEqual([]);
  });
});
