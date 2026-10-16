import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { DatabaseProvider } from '@/db/DatabaseProvider';
import { createTestRepositories, type TestRepositories } from '@/db/test-utils';
import { AuthProvider } from '@/features/auth';
import { TEST_SESSION, createFakeAuthService } from '@/features/auth/test-utils';
import { createFakeSyncEngine } from '@/features/sync/fake-engine';
import { SyncEngineProvider } from '@/features/sync/SyncProvider';

/**
 * Monta `ui` como lo ve la app con sesión: una cuenta (servicio de auth falso) y una base sql.js
 * real con sus repositorios y un motor de sincronización falso. Devuelve el contexto para preparar datos o escribir durante la
 * prueba: las escrituras avisan a las pantallas por el bus.
 */
export async function renderWithDatabase(
  ui: ReactElement,
  context?: TestRepositories,
): Promise<TestRepositories> {
  const ctx = context ?? (await createTestRepositories());
  const service = createFakeAuthService({ restore: async () => TEST_SESSION });
  await render(
    <AuthProvider service={service}>
      <DatabaseProvider value={{ db: ctx.db, repos: ctx.repos, bus: ctx.bus }}>
        <SyncEngineProvider engine={createFakeSyncEngine()}>{ui}</SyncEngineProvider>
      </DatabaseProvider>
    </AuthProvider>,
  );
  return ctx;
}
