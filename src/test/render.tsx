import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { DatabaseProvider } from '@/db/DatabaseProvider';
import { createTestRepositories, type TestRepositories } from '@/db/test-utils';
import { AccessServiceProvider } from '@/features/access';
import { createFakeAccessService, type FakeAccessService } from '@/features/access/fake-access';
import { AuthProvider } from '@/features/auth';
import {
  createFakeInvitationService,
  type FakeInvitationService,
} from '@/features/invitations/fake-invitations';
import { InvitationServiceProvider } from '@/features/invitations/InvitationProvider';
import { TEST_SESSION, createFakeAuthService } from '@/features/auth/test-utils';
import { createFakeSyncEngine, type FakeSyncEngine } from '@/features/sync/fake-engine';
import { SyncEngineProvider } from '@/features/sync/SyncProvider';

export interface RenderOptions {
  /** El motor de sincronización falso; por omisión, uno al día. */
  readonly engine?: FakeSyncEngine;
  /** El servicio de acceso falso (salir y quitar acceso); por omisión, uno que sale bien. */
  readonly access?: FakeAccessService;
  /** El servicio de invitaciones falso; por omisión, uno sin enlaces ni vista previa. */
  readonly invitations?: FakeInvitationService;
}

/**
 * Monta `ui` como lo ve la app con sesión: una cuenta (servicio de auth falso) y una base sql.js
 * real con sus repositorios, un motor de sincronización falso y un servicio de acceso falso.
 * Devuelve el contexto para preparar datos o escribir durante la prueba: las escrituras avisan a
 * las pantallas por el bus.
 */
export async function renderWithDatabase(
  ui: ReactElement,
  context?: TestRepositories,
  options: RenderOptions = {},
): Promise<TestRepositories> {
  const ctx = context ?? (await createTestRepositories());
  const service = createFakeAuthService({ restore: async () => TEST_SESSION });
  await render(
    <AuthProvider service={service}>
      <DatabaseProvider value={{ db: ctx.db, repos: ctx.repos, bus: ctx.bus }}>
        <SyncEngineProvider engine={options.engine ?? createFakeSyncEngine()}>
          <AccessServiceProvider service={options.access ?? createFakeAccessService()}>
            <InvitationServiceProvider
              service={options.invitations ?? createFakeInvitationService()}
            >
              {ui}
            </InvitationServiceProvider>
          </AccessServiceProvider>
        </SyncEngineProvider>
      </DatabaseProvider>
    </AuthProvider>,
  );
  return ctx;
}
