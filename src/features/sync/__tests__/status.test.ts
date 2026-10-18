import { BACKOFF_MS, deriveStatus, nextBackoff, type StatusInput } from '../status';

const base: StatusInput = {
  counts: { pending: 0, failed: 0, conflicts: 0, lost: 0 },
  online: true,
  held: 0,
  lastError: null,
  syncing: false,
  lastSyncedAt: null,
};
const status = (
  patch: Partial<Omit<StatusInput, 'counts'>> & { counts?: Partial<StatusInput['counts']> } = {},
) => deriveStatus({ ...base, ...patch, counts: { ...base.counts, ...patch.counts } });

describe('deriveStatus', () => {
  it('sin nada por subir y sin errores está al día', () => {
    expect(status().state).toBe('synced');
  });

  it('con envíos por subir está pendiente', () => {
    expect(status({ counts: { pending: 2 } })).toMatchObject({ state: 'pending', pending: 2 });
  });

  it('sin red está sin conexión, aunque haya pendientes o errores', () => {
    expect(status({ online: false, counts: { pending: 3, failed: 1 } }).state).toBe('offline');
    expect(status({ online: false, held: 1 }).state).toBe('offline');
  });

  it('un error de transporte «offline» también es sin conexión', () => {
    expect(status({ lastError: 'offline' }).state).toBe('offline');
  });

  it('envíos apartados son error', () => {
    expect(status({ counts: { failed: 1 } })).toMatchObject({ state: 'error', failed: 1 });
  });

  it('grupos retenidos son error y se exponen', () => {
    expect(status({ held: 2 })).toMatchObject({ state: 'error', held: 2 });
  });

  it('protocolo y autenticación son error', () => {
    expect(status({ lastError: 'protocol' }).state).toBe('error');
    expect(status({ lastError: 'auth' }).state).toBe('error');
  });

  it('un fallo del servidor o de tiempo se reintenta solo: sigue pendiente, no es error', () => {
    expect(status({ lastError: 'server', counts: { pending: 1 } }).state).toBe('pending');
    expect(status({ lastError: 'timeout' }).state).toBe('pending');
  });

  it('los borradores por revisar no cambian el estado, pero se cuentan', () => {
    expect(status({ counts: { conflicts: 3 } })).toMatchObject({ state: 'synced', conflicts: 3 });
  });

  it('sincronizando es aparte del estado', () => {
    expect(status({ syncing: true, counts: { pending: 1 } })).toMatchObject({
      state: 'pending',
      syncing: true,
    });
  });

  it('conserva la última sincronización', () => {
    expect(status({ lastSyncedAt: 123 }).lastSyncedAt).toBe(123);
  });
});

describe('nextBackoff', () => {
  const middle = () => 0.5;

  it('sigue 5 s, 15 s, 45 s, 2 min y 5 min sin variación al medio', () => {
    expect([1, 2, 3, 4, 5].map((n) => nextBackoff(n, middle))).toEqual([
      5_000, 15_000, 45_000, 120_000, 300_000,
    ]);
  });

  it('se queda en 5 min después del quinto intento', () => {
    expect(nextBackoff(6, middle)).toBe(300_000);
    expect(nextBackoff(50, middle)).toBe(300_000);
  });

  it('varía ±20 %', () => {
    expect(nextBackoff(1, () => 0)).toBe(4_000);
    expect(nextBackoff(1, () => 0.999999)).toBeCloseTo(6_000, -1);
    expect(nextBackoff(5, () => 0)).toBe(240_000);
  });

  it('un intento menor que 1 usa el primero', () => {
    expect(nextBackoff(0, middle)).toBe(BACKOFF_MS[0]);
  });
});
