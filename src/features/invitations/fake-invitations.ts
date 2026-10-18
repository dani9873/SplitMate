import type { InvitationService } from './invitation-service';

export type FakeInvitationService = { [K in keyof InvitationService]: jest.Mock };

/**
 * Servicio de invitaciones falso para probar la interfaz. Por omisión no hay enlaces ni vista
 * previa: cada prueba fija lo que necesita con `mockResolvedValue` o `mockRejectedValue`.
 */
export function createFakeInvitationService(
  overrides: Partial<FakeInvitationService> = {},
): FakeInvitationService {
  return {
    create: jest.fn(),
    preview: jest.fn(),
    accept: jest.fn(),
    revoke: jest.fn(async () => undefined),
    list: jest.fn(async () => []),
    ...overrides,
  };
}
