import { createSyncRemote, SyncTransportError, type RpcCall } from '../remote';
import type { Mutation } from '../wire';

const A = '01990000-0000-7000-8000-00000000000a';
const B = '01990000-0000-7000-8000-00000000000b';
const GROUP = '01990000-0000-7000-8000-0000000000c1';

const mutation = (id: string): Mutation => ({
  id,
  entity: 'group',
  base: null,
  data: { id: GROUP, name: 'Secreto' },
});

const applied = (id: string) => ({
  id,
  status: 'applied',
  version: 1,
  current: [{ table: 'groups', row: { id: GROUP, version: 1 } }],
});

/** Un RpcCall falso que registra las llamadas y responde lo que se le pida. */
function fakeRpc(
  respond: (name: string, args: Record<string, unknown>) => unknown | Promise<unknown>,
) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const rpc: RpcCall = async (name, args) => {
    calls.push({ name, args: { ...args } });
    return respond(name, { ...args });
  };
  return { rpc, calls };
}

const failureOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return error as SyncTransportError;
  }
  throw new Error('No lanzó');
};

describe('createSyncRemote.push', () => {
  it('manda los envíos como p_mutations y devuelve los resultados en el orden enviado', async () => {
    const { rpc, calls } = fakeRpc(() => [applied(B), applied(A)]);
    const remote = createSyncRemote(rpc);

    const results = await remote.push([mutation(A), mutation(B)]);

    expect(calls).toEqual([
      { name: 'sync_push', args: { p_mutations: [mutation(A), mutation(B)] } },
    ]);
    expect(results.map((result) => result.id)).toEqual([A, B]);
  });

  it('con la lista vacía no llama al servidor', async () => {
    const { rpc, calls } = fakeRpc(() => []);
    expect(await createSyncRemote(rpc).push([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['no cumple el esquema', [{ id: A, status: 'maybe' }]],
    ['no es una lista', { ok: true }],
    ['falta el resultado de un envío', [applied(A)]],
    ['repite el resultado de un envío', [applied(A), applied(A)]],
    ['trae un resultado de un envío que no se mandó', [applied(A), applied(GROUP)]],
  ])('si la respuesta %s, falla con protocol', async (_name, body) => {
    const remote = createSyncRemote(fakeRpc(() => body).rpc);
    const error = await failureOf(() => remote.push([mutation(A), mutation(B)]));
    expect(error).toBeInstanceOf(SyncTransportError);
    expect(error.kind).toBe('protocol');
  });

  it('el error de protocolo no incluye los datos enviados ni los recibidos', async () => {
    const remote = createSyncRemote(fakeRpc(() => [{ id: A, status: 'Secreto' }]).rpc);
    const error = await failureOf(() => remote.push([mutation(A)]));
    expect(error.message).not.toContain('Secreto');
    expect(JSON.stringify(error)).not.toContain('Secreto');
  });

  it('un SyncTransportError del transporte pasa tal cual', async () => {
    const original = new SyncTransportError('offline', 'Sin conexión');
    const remote = createSyncRemote(fakeRpc(() => Promise.reject(original)).rpc);
    expect(await failureOf(() => remote.push([mutation(A)]))).toBe(original);
  });

  it('cualquier otro error inesperado se clasifica como server, sin copiar su mensaje', async () => {
    const remote = createSyncRemote(
      fakeRpc(() => Promise.reject(new Error('boom con Secreto'))).rpc,
    );
    const error = await failureOf(() => remote.push([mutation(A)]));
    expect(error).toBeInstanceOf(SyncTransportError);
    expect(error.kind).toBe('server');
    expect(error.message).not.toContain('Secreto');
  });
});

describe('createSyncRemote.pull', () => {
  const response = {
    groups: [{ id: GROUP, cursor: 7, rows: [{ table: 'groups', row: { id: GROUP } }] }],
    has_more: true,
  };

  it('manda los cursores y el máximo de filas, y devuelve la respuesta en camelCase', async () => {
    const { rpc, calls } = fakeRpc(() => response);

    const pulled = await createSyncRemote(rpc).pull({ [GROUP]: 3 }, 500);

    expect(calls).toEqual([
      { name: 'sync_pull', args: { p_cursors: { [GROUP]: 3 }, p_max_rows: 500 } },
    ]);
    expect(pulled).toEqual({
      groups: [{ id: GROUP, cursor: 7, rows: [{ table: 'groups', row: { id: GROUP } }] }],
      hasMore: true,
    });
  });

  it('una respuesta que no cumple el esquema falla con protocol', async () => {
    const remote = createSyncRemote(fakeRpc(() => ({ groups: [], has_more: 'si' })).rpc);
    const error = await failureOf(() => remote.pull({}, 2000));
    expect(error.kind).toBe('protocol');
  });

  it('clasifica los errores igual que push', async () => {
    const offline = new SyncTransportError('timeout', 'Tardó demasiado');
    expect(
      await failureOf(() =>
        createSyncRemote(fakeRpc(() => Promise.reject(offline)).rpc).pull({}, 100),
      ),
    ).toBe(offline);
    const other = await failureOf(() =>
      createSyncRemote(fakeRpc(() => Promise.reject(new TypeError('x'))).rpc).pull({}, 100),
    );
    expect(other.kind).toBe('server');
  });
});

describe('SyncTransportError', () => {
  it('guarda su clase y es un Error con nombre propio', () => {
    const error = new SyncTransportError('auth', 'Sesión vencida');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SyncTransportError');
    expect(error.kind).toBe('auth');
    expect(error.message).toBe('Sesión vencida');
  });
});
