import { SyncTransportError, type RpcCall } from '@/db/sync';

import { AccessError, createAccessService } from '../access-service';

const GROUP = '01990000-0000-7000-8000-0000000000c1';
const USER = '01990000-0000-7000-8000-0000000000a1';

function fakeRpc(result: () => unknown = () => null) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const rpc: RpcCall = async (name, args) => {
    calls.push({ name, args: { ...args } });
    return result();
  };
  return { rpc, calls };
}

const failing = (kind: ConstructorParameters<typeof SyncTransportError>[0], code?: string) =>
  fakeRpc(() => Promise.reject(new SyncTransportError(kind, 'fallo', code)));

const codeOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return error instanceof AccessError ? error.code : String(error);
  }
  return null;
};

describe('createAccessService', () => {
  it('leaveGroup llama a leave_group con el grupo', async () => {
    const { rpc, calls } = fakeRpc();
    await createAccessService(rpc).leaveGroup(GROUP);
    expect(calls).toEqual([{ name: 'leave_group', args: { p_group_id: GROUP } }]);
  });

  it('removeAccess llama a remove_access con el grupo y la cuenta', async () => {
    const { rpc, calls } = fakeRpc();
    await createAccessService(rpc).removeAccess(GROUP, USER);
    expect(calls).toEqual([
      { name: 'remove_access', args: { p_group_id: GROUP, p_user_id: USER } },
    ]);
  });

  it.each([
    ['sin red', 'offline', undefined, 'OFFLINE'],
    ['sin respuesta a tiempo', 'timeout', undefined, 'OFFLINE'],
    ['la única persona con acceso (SMLST)', 'protocol', 'SMLST', 'LAST_ACCOUNT'],
    ['sin permiso (42501)', 'auth', '42501', 'FORBIDDEN'],
    ['sin permiso por otro estado', 'protocol', '42501', 'FORBIDDEN'],
    ['sesión inválida', 'auth', undefined, 'AUTH'],
    ['error del servidor', 'server', undefined, 'SERVER'],
    ['rechazo sin código conocido', 'protocol', 'XX000', 'SERVER'],
  ] as const)('traduce %s a %s', async (_name, kind, code, expected) => {
    const { rpc } = failing(kind, code);
    expect(await codeOf(() => createAccessService(rpc).leaveGroup(GROUP))).toBe(expected);
  });

  it('un error que no es de transporte se trata como del servidor, sin copiar su mensaje', async () => {
    const { rpc } = fakeRpc(() => Promise.reject(new Error('mensaje con Secreto')));
    const error = await createAccessService(rpc)
      .leaveGroup(GROUP)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AccessError);
    expect((error as AccessError).code).toBe('SERVER');
    expect((error as AccessError).message).not.toContain('Secreto');
  });

  it.each([
    ['un grupo que no es UUID', 'x', USER],
    ['una cuenta que no es UUID', GROUP, 'x'],
  ])('rechaza %s sin llamar al servidor', async (_name, group, user) => {
    const { rpc, calls } = fakeRpc();
    expect(await codeOf(() => createAccessService(rpc).removeAccess(group, user))).toBe('INVALID');
    expect(calls).toHaveLength(0);
  });

  it('el código de SyncTransportError solo conserva la forma de un código de error', () => {
    expect(new SyncTransportError('protocol', 'x', 'SMLST').code).toBe('SMLST');
    expect(new SyncTransportError('protocol', 'x', '42501').code).toBe('42501');
    expect(new SyncTransportError('protocol', 'x', 'mensaje con datos').code).toBeUndefined();
    expect(new SyncTransportError('protocol', 'x').code).toBeUndefined();
  });
});
