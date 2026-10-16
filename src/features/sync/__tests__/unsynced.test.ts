import { unsyncedCount } from '../unsynced';

describe('unsyncedCount', () => {
  it('suma lo que solo existe en este teléfono: por subir, apartados y borradores', () => {
    expect(unsyncedCount({ pending: 2, failed: 1, conflicts: 3 })).toBe(6);
  });

  it('es cero cuando todo está en la nube', () => {
    expect(unsyncedCount({ pending: 0, failed: 0, conflicts: 0 })).toBe(0);
  });

  it('no cuenta lo que ya está en la nube aunque el estado pida atención', () => {
    // `held` (descarga retenida) y `lastError` no son datos que se pierdan al borrar el teléfono.
    const status = { pending: 0, failed: 0, conflicts: 0, held: 2, lastError: 'server' as const };
    expect(unsyncedCount(status)).toBe(0);
  });
});
