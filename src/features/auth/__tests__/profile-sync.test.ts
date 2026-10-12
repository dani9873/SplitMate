import type { SupabaseClient } from '@supabase/supabase-js';

import { SESSION_STORAGE_KEY, createSupabaseClient } from '@/lib/supabase/create-client';
import {
  FAKE_SUPABASE_ENV,
  apiError,
  createFakeSupabase,
  fakeSessionBody,
  memorySupportedStorage,
} from '@/lib/supabase/test-utils';

import { ensureRemoteProfile, profileName, type RemoteProfile } from '../profile-sync';

const PROFILE: RemoteProfile = {
  userId: '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  displayName: 'Ana García',
};

const clients: SupabaseClient[] = [];

/** Cliente con una sesión guardada, como después de entrar. */
async function signedInClient(server = createFakeSupabase()) {
  const storage = memorySupportedStorage();
  await storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(fakeSessionBody()));
  const client = createSupabaseClient({ env: FAKE_SUPABASE_ENV, storage, fetch: server.fetch });
  clients.push(client);
  return { server, client };
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  for (const client of clients.splice(0)) {
    await client.auth.stopAutoRefresh();
  }
  jest.restoreAllMocks();
});

describe('perfil remoto', () => {
  it('asegura la fila de profiles con el nombre de la cuenta, sin pisar una que ya exista', async () => {
    const { server, client } = await signedInClient();
    server.on('POST', '/rest/v1/profiles', { status: 201, body: undefined });

    await expect(ensureRemoteProfile(client, PROFILE)).resolves.toBe('synced');

    const [request] = server.calls('POST', '/rest/v1/profiles');
    expect(request!.body).toEqual({ id: PROFILE.userId, display_name: 'Ana García' });
    expect(request!.query.get('on_conflict')).toBe('id');
    expect(request!.headers.get('prefer')).toContain('resolution=ignore-duplicates');
    // Con la sesión de la cuenta: RLS solo deja crear el perfil propio.
    expect(request!.headers.get('authorization')).toMatch(/^Bearer /);
  });

  it('sin red queda pendiente, sin lanzar: se reintenta en el siguiente arranque', async () => {
    const { server, client } = await signedInClient();
    server.setOffline(true);
    await expect(ensureRemoteProfile(client, PROFILE)).resolves.toBe('pending');
  });

  it('un rechazo de la base también queda pendiente', async () => {
    const { server, client } = await signedInClient();
    server.on(
      'POST',
      '/rest/v1/profiles',
      apiError(403, '42501', 'new row violates row-level security'),
    );
    await expect(ensureRemoteProfile(client, PROFILE)).resolves.toBe('pending');
  });

  describe('nombre del perfil', () => {
    it('usa el nombre resuelto, sin espacios sobrantes', () => {
      expect(profileName('  Ana García ')).toBe('Ana García');
    });

    it('recorta a 80 caracteres sin partir un emoji', () => {
      const name = `${'a'.repeat(79)}😀😀`;
      const result = profileName(name);
      expect(Array.from(result)).toHaveLength(80);
      expect(result.endsWith('😀')).toBe(true);
    });
  });
});
