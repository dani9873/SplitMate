import { SyncTransportError } from '@/db/sync/remote';

import { createSupabaseClient } from '../create-client';
import { createSupabaseRpc } from '../rpc';
import { apiError, createFakeSupabase, FAKE_SUPABASE_ENV, ok } from '../test-utils';

const PATH = '/rest/v1/rpc/sync_push';

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: async (key: string) => items.get(key) ?? null,
    setItem: async (key: string, value: string) => void items.set(key, value),
    removeItem: async (key: string) => void items.delete(key),
  };
}

function setup(fetch?: typeof globalThis.fetch, timeoutMs?: number) {
  const fake = createFakeSupabase();
  const client = createSupabaseClient({
    env: FAKE_SUPABASE_ENV,
    storage: memoryStorage(),
    fetch: fetch ?? fake.fetch,
  });
  return { fake, rpc: createSupabaseRpc(client, timeoutMs === undefined ? {} : { timeoutMs }) };
}

const failureOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return error as SyncTransportError;
  }
  throw new Error('No lanzó');
};

describe('createSupabaseRpc', () => {
  it('llama a la RPC con los argumentos y devuelve los datos', async () => {
    const { fake, rpc } = setup();
    fake.on('POST', PATH, ok([{ id: 'x', status: 'applied' }]));

    const data = await rpc('sync_push', { p_mutations: [{ id: 'x' }] });

    expect(data).toEqual([{ id: 'x', status: 'applied' }]);
    expect(fake.calls('POST', PATH)).toHaveLength(1);
    expect(fake.calls('POST', PATH)[0]?.body).toEqual({ p_mutations: [{ id: 'x' }] });
  });

  it('manda la clave pública como apikey y nunca una clave secreta', async () => {
    const { fake, rpc } = setup();
    fake.on('POST', PATH, ok([]));
    await rpc('sync_push', { p_mutations: [] });
    const headers = fake.calls('POST', PATH)[0]?.headers;
    expect(headers?.get('apikey')).toBe(FAKE_SUPABASE_ENV.publishableKey);
  });

  it('sin red: offline', async () => {
    const { fake, rpc } = setup();
    fake.setOffline(true);
    const error = await failureOf(() => rpc('sync_push', { p_mutations: [] }));
    expect(error).toBeInstanceOf(SyncTransportError);
    expect(error.kind).toBe('offline');
  });

  it('tiempo agotado: timeout, y cancela la petición', async () => {
    let aborted = false;
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    const { rpc } = setup(hanging, 25);

    const error = await failureOf(() => rpc('sync_push', { p_mutations: [] }));

    expect(error.kind).toBe('timeout');
    expect(aborted).toBe(true);
  });

  it.each([
    [500, 'server'],
    [502, 'server'],
    [503, 'server'],
    [429, 'server'],
    [408, 'server'],
    [401, 'auth'],
    [403, 'auth'],
    [400, 'protocol'],
    [413, 'protocol'],
    [404, 'protocol'],
    [422, 'protocol'],
  ] as const)('HTTP %i se clasifica como %s', async (status, kind) => {
    const { fake, rpc } = setup();
    fake.on('POST', PATH, apiError(status, 'PGRST000', 'mensaje del servidor'));

    const error = await failureOf(() => rpc('sync_push', { p_mutations: [] }));

    expect(error).toBeInstanceOf(SyncTransportError);
    expect(error.kind).toBe(kind);
  });

  it('el error no copia el mensaje del servidor ni los datos enviados (pueden llevar nombres y montos)', async () => {
    const { fake, rpc } = setup();
    fake.on(
      'POST',
      PATH,
      apiError(400, '22023', 'falló con Secreto 12345', { details: 'Secreto' }),
    );

    const error = await failureOf(() => rpc('sync_push', { p_mutations: [{ name: 'Secreto' }] }));

    expect(error.message).not.toContain('Secreto');
    expect(error.message).not.toContain('12345');
    expect(JSON.stringify(error)).not.toContain('Secreto');
  });

  it('conserva solo el código del error de Postgres (SMLST, 42501...), para que se pueda explicar', async () => {
    const { fake, rpc } = setup();
    fake.on('POST', PATH, apiError(400, 'SMLST', 'Eres la única persona con acceso'));
    const error = await failureOf(() => rpc('sync_push', { p_mutations: [] }));
    expect(error.kind).toBe('protocol');
    expect(error.code).toBe('SMLST');
    expect(error.message).not.toContain('única');
  });

  it('un código con otra forma (los de PostgREST) no se conserva', async () => {
    const { fake, rpc } = setup();
    fake.on('POST', PATH, apiError(400, 'PGRST000', 'mensaje'));
    const error = await failureOf(() => rpc('sync_push', { p_mutations: [] }));
    expect(error.code).toBeUndefined();
  });

  it('una respuesta correcta después de un fallo vuelve a funcionar', async () => {
    const { fake, rpc } = setup();
    fake.on('POST', PATH, apiError(503, 'PGRST000', 'x'));
    await failureOf(() => rpc('sync_push', { p_mutations: [] }));
    fake.on('POST', PATH, ok([]));
    expect(await rpc('sync_push', { p_mutations: [] })).toEqual([]);
  });
});
