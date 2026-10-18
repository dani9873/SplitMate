import { SyncTransportError, type RpcCall } from '@/db/sync';

import {
  InvitationError,
  createInvitationService,
  invitationErrorKey,
  type InvitationErrorCode,
} from '../invitation-service';

const TOKEN = 'q'.repeat(43);
const GROUP = '01990000-0000-7000-8000-0000000000c1';
const MEMBER = '01990000-0000-7000-8000-0000000000a1';
const NEW_ID = '01990000-0000-7000-8000-0000000000f1';
const INVITATION = '01990000-0000-7000-8000-0000000000b1';
const USER = '01990000-0000-7000-8000-0000000000d1';

function fakeRpc(respond: (name: string, args: Record<string, unknown>) => unknown) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const rpc: RpcCall = async (name, args) => {
    calls.push({ name, args: { ...args } });
    return respond(name, { ...args });
  };
  const service = createInvitationService(rpc, { newId: () => NEW_ID });
  return { service, calls };
}

const failing = (kind: ConstructorParameters<typeof SyncTransportError>[0], code?: string) =>
  fakeRpc(() => Promise.reject(new SyncTransportError(kind, 'fallo', code)));

const codeOf = async (
  run: () => Promise<unknown>,
): Promise<InvitationErrorCode | string | null> => {
  try {
    await run();
  } catch (error) {
    return error instanceof InvitationError ? error.code : String(error);
  }
  return null;
};

const previewJson = (over: Record<string, unknown> = {}) => ({
  group: {
    id: GROUP,
    name: 'Viaje',
    emoji: '🏝️',
    color: 'teal',
    currency: 'USD',
  },
  members: [{ id: MEMBER, display_name: 'Xime' }],
  accounts: 2,
  expires_at: '2026-10-26T12:00:00.123456+00:00',
  already_member: false,
  ...over,
});

describe('create', () => {
  it('manda el grupo, la duración y los usos, y devuelve el token con su vencimiento', async () => {
    const { service, calls } = fakeRpc(() => ({
      id: INVITATION,
      token: TOKEN,
      expires_at: '2026-10-25T12:00:00.5+00:00',
      max_uses: 10,
    }));

    const created = await service.create({ groupId: GROUP });

    expect(calls).toEqual([
      {
        name: 'create_invitation',
        args: { p_group_id: GROUP, p_expires_hours: 168, p_max_uses: 10 },
      },
    ]);
    expect(created).toEqual({
      id: INVITATION,
      token: TOKEN,
      expiresAt: Date.parse('2026-10-25T12:00:00.500Z'),
      maxUses: 10,
    });
  });

  it('acepta duración y usos propios dentro de los topes', async () => {
    const { service, calls } = fakeRpc(() => ({
      id: INVITATION,
      token: TOKEN,
      expires_at: '2026-10-19T12:00:00+00:00',
      max_uses: 1,
    }));
    await service.create({ groupId: GROUP, expiresHours: 24, maxUses: 1 });
    expect(calls[0]?.args).toEqual({ p_group_id: GROUP, p_expires_hours: 24, p_max_uses: 1 });
  });

  it.each([
    ['un grupo que no es UUID', { groupId: 'x' }],
    ['0 horas', { groupId: GROUP, expiresHours: 0 }],
    ['721 horas', { groupId: GROUP, expiresHours: 721 }],
    ['horas con decimales', { groupId: GROUP, expiresHours: 1.5 }],
    ['0 usos', { groupId: GROUP, maxUses: 0 }],
    ['51 usos', { groupId: GROUP, maxUses: 51 }],
  ])('rechaza %s sin llamar al servidor', async (_name, input) => {
    const { service, calls } = fakeRpc(() => null);
    expect(await codeOf(() => service.create(input))).toBe('BAD_INPUT');
    expect(calls).toHaveLength(0);
  });

  it('SMRLT: demasiados enlaces', async () => {
    const { service } = fakeRpc(() => ({ error: 'SMRLT' }));
    expect(await codeOf(() => service.create({ groupId: GROUP }))).toBe('RATE_LIMITED');
  });

  it('un token con mala forma en la respuesta es un error del servidor', async () => {
    const { service } = fakeRpc(() => ({
      id: INVITATION,
      token: 'corto',
      expires_at: '2026-10-25T12:00:00+00:00',
      max_uses: 10,
    }));
    expect(await codeOf(() => service.create({ groupId: GROUP }))).toBe('SERVER');
  });
});

describe('preview', () => {
  it('manda el token y devuelve el grupo, los miembros libres y el vencimiento', async () => {
    const { service, calls } = fakeRpc(() => previewJson());

    const preview = await service.preview(TOKEN);

    expect(calls).toEqual([{ name: 'preview_invitation', args: { p_token: TOKEN } }]);
    expect(preview).toEqual({
      group: { id: GROUP, name: 'Viaje', emoji: '🏝️', color: 'teal', currency: 'USD' },
      members: [{ id: MEMBER, displayName: 'Xime' }],
      accounts: 2,
      expiresAt: Date.parse('2026-10-26T12:00:00.123Z'),
      alreadyMember: false,
    });
  });

  it('un grupo sin emoji', async () => {
    const { service } = fakeRpc(() =>
      previewJson({ group: { ...previewJson().group, emoji: null } }),
    );
    expect((await service.preview(TOKEN)).group.emoji).toBeNull();
  });

  it.each([
    ['un token corto', 'abc'],
    ['un token con caracteres raros', '!'.repeat(43)],
    ['vacío', ''],
  ])('rechaza %s sin llamar al servidor', async (_name, value) => {
    const { service, calls } = fakeRpc(() => previewJson());
    expect(await codeOf(() => service.preview(value))).toBe('BAD_INPUT');
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['una moneda desconocida', { group: { ...previewJson().group, currency: 'QQQ' } }],
    ['un color desconocido', { group: { ...previewJson().group, color: 'fucsia' } }],
    ['un nombre vacío', { group: { ...previewJson().group, name: '' } }],
    ['un nombre larguísimo', { group: { ...previewJson().group, name: 'x'.repeat(81) } }],
    ['un miembro sin nombre', { members: [{ id: MEMBER, display_name: '' }] }],
    ['un miembro con id que no es UUID', { members: [{ id: 'x', display_name: 'Xime' }] }],
    [
      'más de 200 miembros',
      {
        members: Array.from({ length: 201 }, () => ({ id: MEMBER, display_name: 'Xime' })),
      },
    ],
    ['cuentas negativas', { accounts: -1 }],
    ['un vencimiento que no es fecha', { expires_at: 'mañana' }],
    ['already_member como texto', { already_member: 'si' }],
  ])('si la respuesta trae %s, es un error del servidor', async (_name, over) => {
    const { service } = fakeRpc(() => previewJson(over));
    expect(await codeOf(() => service.preview(TOKEN))).toBe('SERVER');
  });

  it('SMINV es INVALID_LINK, igual para un token que nunca existió que para uno vencido', async () => {
    const { service } = fakeRpc(() => ({ error: 'SMINV' }));
    expect(await codeOf(() => service.preview(TOKEN))).toBe('INVALID_LINK');
  });

  it('SMRLT es RATE_LIMITED', async () => {
    const { service } = fakeRpc(() => ({ error: 'SMRLT' }));
    expect(await codeOf(() => service.preview(TOKEN))).toBe('RATE_LIMITED');
  });
});

describe('accept', () => {
  it('eligiendo un miembro: manda su id y devuelve el grupo', async () => {
    const { service, calls } = fakeRpc(() => ({ group_id: GROUP }));
    expect(await service.accept(TOKEN, { kind: 'member', memberId: MEMBER })).toEqual({
      groupId: GROUP,
    });
    expect(calls).toEqual([
      { name: 'accept_invitation', args: { p_token: TOKEN, p_member_id: MEMBER } },
    ]);
  });

  it('como alguien nuevo: el teléfono pone el id (UUID v7) y recorta el nombre', async () => {
    const { service, calls } = fakeRpc(() => ({ group_id: GROUP }));
    await service.accept(TOKEN, { kind: 'new', displayName: '  Zoe  ' });
    expect(calls[0]).toEqual({
      name: 'accept_invitation',
      args: { p_token: TOKEN, p_new_member: { id: NEW_ID, display_name: 'Zoe' } },
    });
  });

  it.each([
    ['un nombre en blanco', { kind: 'new', displayName: '   ' }],
    ['un nombre de más de 80 caracteres', { kind: 'new', displayName: 'x'.repeat(81) }],
    ['un miembro que no es UUID', { kind: 'member', memberId: 'x' }],
  ] as const)('rechaza %s sin llamar al servidor', async (_name, choice) => {
    const { service, calls } = fakeRpc(() => ({ group_id: GROUP }));
    expect(await codeOf(() => service.accept(TOKEN, choice))).toBe('BAD_INPUT');
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['SMINV', { error: 'SMINV' }, 'INVALID_LINK'],
    ['SMTKN', { error: 'SMTKN' }, 'MEMBER_TAKEN'],
    ['SMRLT', { error: 'SMRLT' }, 'RATE_LIMITED'],
    ['SMGFL de cuentas', { error: 'SMGFL', quota: 'accounts' }, 'GROUP_FULL'],
    ['SMGFL de miembros', { error: 'SMGFL', quota: 'members' }, 'GROUP_FULL'],
    ['SMGFL de grupos', { error: 'SMGFL', quota: 'groups' }, 'TOO_MANY_GROUPS'],
  ] as const)('%s se traduce a %s', async (_name, body, expected) => {
    const { service } = fakeRpc(() => body);
    expect(await codeOf(() => service.accept(TOKEN, { kind: 'member', memberId: MEMBER }))).toBe(
      expected,
    );
  });

  it('una respuesta sin group_id es un error del servidor', async () => {
    const { service } = fakeRpc(() => ({}));
    expect(await codeOf(() => service.accept(TOKEN, { kind: 'member', memberId: MEMBER }))).toBe(
      'SERVER',
    );
  });
});

describe('revoke', () => {
  it('llama a revoke_invitation', async () => {
    const { service, calls } = fakeRpc(() => null);
    await service.revoke(INVITATION);
    expect(calls).toEqual([{ name: 'revoke_invitation', args: { p_invitation_id: INVITATION } }]);
  });

  it('un id que no es UUID no sale', async () => {
    const { service, calls } = fakeRpc(() => null);
    expect(await codeOf(() => service.revoke('x'))).toBe('BAD_INPUT');
    expect(calls).toHaveLength(0);
  });

  it('sin permiso (42501): FORBIDDEN', async () => {
    const { service } = failing('auth', '42501');
    expect(await codeOf(() => service.revoke(INVITATION))).toBe('FORBIDDEN');
  });
});

describe('list', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: INVITATION,
    created_by: USER,
    created_at: '2026-10-18T12:00:00+00:00',
    expires_at: '2026-10-25T12:00:00+00:00',
    max_uses: 10,
    use_count: 3,
    revoked_at: null,
    status: 'active',
    ...over,
  });

  it('devuelve los enlaces con sus fechas en milisegundos', async () => {
    const { service, calls } = fakeRpc(() => [
      row(),
      row({ id: GROUP, status: 'revoked', revoked_at: '2026-10-19T08:00:00.25+00:00' }),
    ]);

    const list = await service.list(GROUP);

    expect(calls).toEqual([{ name: 'list_invitations', args: { p_group_id: GROUP } }]);
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({
      id: INVITATION,
      createdBy: USER,
      createdAt: Date.parse('2026-10-18T12:00:00Z'),
      expiresAt: Date.parse('2026-10-25T12:00:00Z'),
      maxUses: 10,
      useCount: 3,
      revokedAt: null,
      status: 'active',
    });
    expect(list[1]?.revokedAt).toBe(Date.parse('2026-10-19T08:00:00.250Z'));
  });

  it('una lista vacía', async () => {
    const { service } = fakeRpc(() => []);
    expect(await service.list(GROUP)).toEqual([]);
  });

  it.each([
    ['un estado desconocido', row({ status: 'rota' })],
    ['usos negativos', row({ use_count: -1 })],
    ['más de 50 usos', row({ max_uses: 51 })],
    ['una fecha rota', row({ expires_at: 'x' })],
  ])('si trae %s, es un error del servidor', async (_name, bad) => {
    const { service } = fakeRpc(() => [bad]);
    expect(await codeOf(() => service.list(GROUP))).toBe('SERVER');
  });

  it('más de 100 enlaces no se acepta', async () => {
    const { service } = fakeRpc(() => Array.from({ length: 101 }, () => row()));
    expect(await codeOf(() => service.list(GROUP))).toBe('SERVER');
  });

  it('no es una lista: error del servidor', async () => {
    const { service } = fakeRpc(() => ({ error: 'otra' }));
    expect(await codeOf(() => service.list(GROUP))).toBe('SERVER');
  });
});

describe('errores de transporte', () => {
  it.each([
    ['sin red', 'offline', undefined, 'OFFLINE'],
    ['sin respuesta a tiempo', 'timeout', undefined, 'OFFLINE'],
    ['sesión inválida', 'auth', undefined, 'AUTH'],
    ['sin permiso', 'protocol', '42501', 'FORBIDDEN'],
    ['error del servidor', 'server', undefined, 'SERVER'],
    ['rechazo con otro código', 'protocol', 'XX000', 'SERVER'],
  ] as const)('%s', async (_name, kind, code, expected) => {
    const { service } = failing(kind, code);
    expect(await codeOf(() => service.preview(TOKEN))).toBe(expected);
  });

  it('un error cualquiera se trata como del servidor y nunca repite el token ni el mensaje', async () => {
    const { service } = fakeRpc(() => {
      throw new Error(`falló con ${TOKEN}`);
    });
    const error = await service.preview(TOKEN).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InvitationError);
    expect((error as InvitationError).code).toBe('SERVER');
    expect((error as InvitationError).message).not.toContain(TOKEN);
    expect(JSON.stringify(error)).not.toContain(TOKEN);
  });

  it('ningún error repite el token que se mandó', async () => {
    for (const body of [{ error: 'SMINV' }, { error: 'SMRLT' }, {}, null]) {
      const { service } = fakeRpc(() => body);
      const error = await service.preview(TOKEN).catch((caught: unknown) => caught);
      expect(String((error as Error).message)).not.toContain(TOKEN);
    }
  });
});

describe('invitationErrorKey', () => {
  it.each([
    ['INVALID_LINK', 'invalidLink'],
    ['RATE_LIMITED', 'rateLimited'],
    ['MEMBER_TAKEN', 'memberTaken'],
    ['GROUP_FULL', 'groupFull'],
    ['TOO_MANY_GROUPS', 'tooManyGroups'],
    ['OFFLINE', 'offline'],
    ['FORBIDDEN', 'forbidden'],
    ['AUTH', 'auth'],
    ['BAD_INPUT', 'generic'],
    ['SERVER', 'generic'],
  ] as const)('%s → %s', (code, key) => {
    expect(invitationErrorKey(new InvitationError(code))).toBe(key);
  });

  it('un error que no es de invitaciones es genérico', () => {
    expect(invitationErrorKey(new Error('x'))).toBe('generic');
  });
});
