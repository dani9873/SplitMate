/** @jest-environment node */
import { SyncTransportError } from '@/db/sync/remote';

import { createSupabaseTestServer, type SupabaseTestServer } from '../supabase-pglite';

let server: SupabaseTestServer;

beforeAll(async () => {
  server = await createSupabaseTestServer();
}, 90_000);

afterAll(async () => {
  await server.close();
});

let sequence = 1000;
/** UUID único por llamada, con la forma de los que genera la app (versión 7). */
const uuid = () => `01990000-0000-7000-8000-${String(sequence++).padStart(12, '0')}`;

/** Envío de un grupo nuevo, con los campos que valida `sync_push`. */
const newGroup = (name = 'Playa') => {
  const id = uuid();
  return {
    groupId: id,
    mutation: {
      id: uuid(),
      entity: 'group',
      base: null,
      data: {
        id,
        name,
        currency: 'USD',
        emoji: null,
        color: 'teal',
        archived: false,
        deleted: false,
      },
    },
  };
};

const count = async (sql: string, params: unknown[] = []) =>
  Number((await server.query<{ n: string }>(sql, params))[0]?.n);

const pull = (rpc: ReturnType<SupabaseTestServer['rpcFor']>) =>
  rpc('sync_pull', { p_cursors: {}, p_max_rows: 2000 }) as Promise<{
    groups: { id: string }[];
    has_more: boolean;
  }>;

describe('servidor de prueba con PGlite', () => {
  it('aplica las migraciones del repo: existen las tablas y las RPC de sincronización', async () => {
    const tables = (
      await server.query<{ table_name: string }>(
        `select table_name from information_schema.tables where table_schema = 'public'`,
      )
    ).map((row) => row.table_name);
    expect(tables).toEqual(
      expect.arrayContaining(['groups', 'expenses', 'change_log', 'profiles']),
    );
    const functions = (
      await server.query<{ routine_name: string }>(
        `select routine_name from information_schema.routines where routine_schema = 'public'`,
      )
    ).map((row) => row.routine_name);
    expect(functions).toEqual(expect.arrayContaining(['sync_push', 'sync_pull']));
  });

  it('query corre como postgres', async () => {
    expect(await server.query<{ u: string }>(`select current_user as u`)).toEqual([
      { u: 'postgres' },
    ]);
  });

  it('createUser crea la cuenta y su perfil, con ids distintos', async () => {
    const ana = await server.createUser('Ana');
    const beto = await server.createUser('Beto');
    expect(ana).not.toBe(beto);
    expect(ana).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      await count(`select count(*) as n from auth.users where id in ($1, $2)`, [ana, beto]),
    ).toBe(2);
    expect(
      await server.query<{ display_name: string }>(
        `select display_name from public.profiles where id = $1`,
        [ana],
      ),
    ).toEqual([{ display_name: 'Ana' }]);
  });

  it('rpcFor corre como authenticated con el sub de la cuenta', async () => {
    const ana = server.rpcFor(await server.createUser('Ana'));
    const beto = server.rpcFor(await server.createUser('Beto'));
    expect(await ana('sync_push', { p_mutations: [] })).toEqual([]);

    const { groupId, mutation } = newGroup();
    const [result] = (await ana('sync_push', { p_mutations: [mutation] })) as { status: string }[];
    expect(result?.status).toBe('applied');

    // Cada cuenta ve solo lo suyo: lo decide RLS con el sub, no la prueba.
    expect((await pull(ana)).groups.map((group) => group.id)).toContain(groupId);
    expect((await pull(beto)).groups).toEqual([]);
  });

  it('una llamada es una transacción: si falla, no deja nada ni deja el rol cambiado', async () => {
    const ana = server.rpcFor(await server.createUser('Ana'));
    await expect(ana('sync_push', { p_mutations: 'no es una lista' })).rejects.toBeDefined();
    // La conexión sigue siendo la de postgres y la siguiente llamada funciona.
    expect(await server.query<{ u: string }>(`select current_user as u`)).toEqual([
      { u: 'postgres' },
    ]);
    expect(await ana('sync_push', { p_mutations: [] })).toEqual([]);
  });

  it('solo deja llamar a las RPC de sincronización', async () => {
    const ana = server.rpcFor(await server.createUser('Ana'));
    await expect(
      (ana as unknown as (name: string, args: object) => Promise<unknown>)('drop_everything', {}),
    ).rejects.toThrow();
  });

  describe('fallas a propósito', () => {
    it('offline: lanza un error de red y no llega a la base', async () => {
      const ana = server.rpcFor(await server.createUser('Ana'));
      const { groupId, mutation } = newGroup();
      ana.faults.failNext('offline');

      const error = await ana('sync_push', { p_mutations: [mutation] }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SyncTransportError);
      expect((error as SyncTransportError).kind).toBe('offline');
      expect(await count(`select count(*) as n from public.groups where id = $1`, [groupId])).toBe(
        0,
      );
    });

    it('server-error: lanza un error de servidor y no llega a la base', async () => {
      const ana = server.rpcFor(await server.createUser('Ana'));
      const { groupId, mutation } = newGroup();
      ana.faults.failNext('server-error');

      const error = await ana('sync_push', { p_mutations: [mutation] }).catch((e: unknown) => e);
      expect((error as SyncTransportError).kind).toBe('server');
      expect(await count(`select count(*) as n from public.groups where id = $1`, [groupId])).toBe(
        0,
      );
    });

    it('lost-response: se aplica en la base y llega el error de red; reenviar no duplica', async () => {
      const ana = server.rpcFor(await server.createUser('Ana'));
      const { groupId, mutation } = newGroup();
      ana.faults.failNext('lost-response');

      const error = await ana('sync_push', { p_mutations: [mutation] }).catch((e: unknown) => e);
      expect((error as SyncTransportError).kind).toBe('offline');
      // El servidor sí lo aplicó y lo confirmó.
      expect(await count(`select count(*) as n from public.groups where id = $1`, [groupId])).toBe(
        1,
      );
      const stored = await server.query<{ version: number }>(
        `select version from public.groups where id = $1`,
        [groupId],
      );
      const version = stored[0]?.version;
      expect(version).toBe(1);

      // El reintento con el mismo envío es idempotente: misma versión, sin historial de más.
      const [retry] = (await ana('sync_push', { p_mutations: [mutation] })) as {
        status: string;
        version: number;
      }[];
      expect(retry).toMatchObject({ status: 'applied', version });
      expect(
        await count(`select count(*) as n from public.change_log where group_id = $1`, [groupId]),
      ).toBe(1);
    });

    it('failNext(modo, veces) falla ese número de llamadas y después vuelve a funcionar', async () => {
      const ana = server.rpcFor(await server.createUser('Ana'));
      ana.faults.failNext('offline', 2);

      await expect(ana('sync_push', { p_mutations: [] })).rejects.toBeInstanceOf(
        SyncTransportError,
      );
      await expect(ana('sync_push', { p_mutations: [] })).rejects.toBeInstanceOf(
        SyncTransportError,
      );
      expect(await ana('sync_push', { p_mutations: [] })).toEqual([]);
    });

    it('las fallas de una cuenta no afectan a la otra', async () => {
      const ana = server.rpcFor(await server.createUser('Ana'));
      const beto = server.rpcFor(await server.createUser('Beto'));
      ana.faults.failNext('offline');
      expect(await beto('sync_push', { p_mutations: [] })).toEqual([]);
      await expect(ana('sync_push', { p_mutations: [] })).rejects.toBeInstanceOf(
        SyncTransportError,
      );
    });
  });
});
