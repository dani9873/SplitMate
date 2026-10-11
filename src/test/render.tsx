import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { DatabaseProvider } from '@/db/DatabaseProvider';
import { createTestRepositories, type TestRepositories } from '@/db/test-utils';

/**
 * Monta `ui` con una base sql.js real y sus repositorios. Devuelve el contexto para preparar
 * datos o escribir durante la prueba: las escrituras avisan a las pantallas por el bus.
 */
export async function renderWithDatabase(
  ui: ReactElement,
  context?: TestRepositories,
): Promise<TestRepositories> {
  const ctx = context ?? (await createTestRepositories());
  await render(<DatabaseProvider value={{ db: ctx.db, repos: ctx.repos }}>{ui}</DatabaseProvider>);
  return ctx;
}
