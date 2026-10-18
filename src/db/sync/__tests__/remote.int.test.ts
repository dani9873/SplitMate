/** @jest-environment node */
import { createSupabaseTestServer, type SupabaseTestServer } from '@/test/supabase-pglite';

import { createSyncRemote, SyncTransportError } from '../remote';
import type { Mutation } from '../wire';

let server: SupabaseTestServer;

beforeAll(async () => {
  server = await createSupabaseTestServer();
}, 90_000);

afterAll(async () => {
  await server.close();
});

let sequence = 5000;
const uuid = () => `01990000-0000-7000-8000-${String(sequence++).padStart(12, '0')}`;

const newGroup = (name = 'Playa'): { groupId: string; mutation: Mutation } => {
  const groupId = uuid();
  return {
    groupId,
    mutation: {
      id: uuid(),
      entity: 'group',
      base: null,
      data: {
        id: groupId,
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

describe('createSyncRemote contra el servidor de prueba (migraciones reales)', () => {
  it('push: las respuestas reales del servidor cumplen el esquema', async () => {
    const remote = createSyncRemote(server.rpcFor(await server.createUser('Ana')));
    const { groupId, mutation } = newGroup();

    const [result] = await remote.push([mutation]);

    expect(result).toMatchObject({ id: mutation.id, status: 'applied', version: 1 });
    expect(result?.status === 'applied' && result.current.map((r) => r.table)).toEqual(['groups']);
    expect(result?.status === 'applied' && result.current[0]?.row.id).toBe(groupId);
  });

  it('push: acepta un rechazo por conflicto y un envío fallido', async () => {
    const remote = createSyncRemote(server.rpcFor(await server.createUser('Ana')));
    const { mutation } = newGroup();
    await remote.push([mutation]);

    const stale: Mutation = {
      id: uuid(),
      entity: 'group',
      base: 1,
      data: { ...mutation.data, name: 'Otro' },
    };
    const edited: Mutation = {
      ...stale,
      id: uuid(),
      base: 1,
      data: { ...mutation.data, name: 'Nuevo' },
    };
    const invalid: Mutation = {
      id: uuid(),
      entity: 'group',
      base: null,
      data: { ...newGroup().mutation.data, name: '   ' },
    };

    const [first] = await remote.push([edited]);
    expect(first).toMatchObject({ status: 'applied', version: 2 });
    const [conflict, failed] = await remote.push([stale, invalid]);
    expect(conflict).toMatchObject({ status: 'rejected', reason: 'conflict' });
    expect(failed).toMatchObject({ status: 'failed', reason: 'invalid' });
    expect(failed?.status === 'failed' && failed.field).toEqual(expect.any(String));
  });

  it('pull: trae lo del grupo con su cursor y, con el cursor, solo lo nuevo', async () => {
    const remote = createSyncRemote(server.rpcFor(await server.createUser('Ana')));
    const { groupId, mutation } = newGroup();
    await remote.push([mutation]);

    const first = await remote.pull({}, 2000);
    expect(first.hasMore).toBe(false);
    const changes = first.groups.find((group) => group.id === groupId);
    expect(changes?.cursor).toBeGreaterThan(0);
    // El grupo y la fila de acceso de su dueño (sync_pull_v2 manda group_access).
    expect(changes?.rows.map((row) => row.table)).toEqual(['groups', 'group_access']);

    const second = await remote.pull({ [groupId]: changes?.cursor ?? 0 }, 2000);
    expect(second.groups.find((group) => group.id === groupId)).toBeUndefined();
  });

  it('pull: una cuenta no recibe los grupos de otra', async () => {
    const ana = createSyncRemote(server.rpcFor(await server.createUser('Ana')));
    const beto = createSyncRemote(server.rpcFor(await server.createUser('Beto')));
    const { groupId, mutation } = newGroup();
    await ana.push([mutation]);

    expect((await beto.pull({}, 2000)).groups.map((group) => group.id)).not.toContain(groupId);
  });

  it('un sobre inválido del servidor (más de 50 envíos) llega como error, no como respuesta', async () => {
    const remote = createSyncRemote(server.rpcFor(await server.createUser('Ana')));
    const many = Array.from({ length: 51 }, () => newGroup().mutation);
    const error = await remote.push(many).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncTransportError);
    expect((error as SyncTransportError).kind).toBe('protocol');
  });

  it('lost-response: el error de red llega y el reintento recibe el mismo resultado', async () => {
    const rpc = server.rpcFor(await server.createUser('Ana'));
    const remote = createSyncRemote(rpc);
    const { mutation } = newGroup();
    rpc.faults.failNext('lost-response');

    const lost = await remote.push([mutation]).catch((e: unknown) => e);
    expect((lost as SyncTransportError).kind).toBe('offline');
    const [retry] = await remote.push([mutation]);
    expect(retry).toMatchObject({ id: mutation.id, status: 'applied', version: 1 });
  });
});
