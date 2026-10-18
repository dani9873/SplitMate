import type { AccessService } from './access-service';

export type FakeAccessService = { [K in keyof AccessService]: jest.Mock };

/** Servicio de acceso falso para probar la interfaz: las acciones se espían y salen bien. */
export function createFakeAccessService(
  overrides: Partial<FakeAccessService> = {},
): FakeAccessService {
  return {
    leaveGroup: jest.fn(async () => undefined),
    removeAccess: jest.fn(async () => undefined),
    ...overrides,
  };
}
