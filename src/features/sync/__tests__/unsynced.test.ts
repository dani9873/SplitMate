import { onlyDrafts, unsyncedCount } from '../unsynced';

describe('onlyDrafts', () => {
  it('es verdadero cuando lo único sin subir son borradores por revisar', () => {
    expect(onlyDrafts({ pending: 0, failed: 0, conflicts: 2 })).toBe(true);
  });

  it('es falso si además hay algo por subir o apartado: ahí sincronizar sí sirve', () => {
    expect(onlyDrafts({ pending: 1, failed: 0, conflicts: 2 })).toBe(false);
    expect(onlyDrafts({ pending: 0, failed: 1, conflicts: 2 })).toBe(false);
  });

  it('es falso sin borradores', () => {
    expect(onlyDrafts({ pending: 0, failed: 0, conflicts: 0 })).toBe(false);
  });
});

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
