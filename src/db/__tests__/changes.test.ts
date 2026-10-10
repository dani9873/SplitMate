import { createChangeBus, type DataChange } from '../changes';

const tables = (change: DataChange) => [...change.tables].sort();
const groups = (change: DataChange) => (change.groupIds ? [...change.groupIds].sort() : null);

describe('bus de cambios', () => {
  it('entrega cada cambio a los suscriptores', () => {
    const bus = createChangeBus();
    const received: DataChange[] = [];
    bus.subscribe((change) => received.push(change));

    bus.emit({ source: 'local', tables: ['expenses'], groupIds: ['g1'] });

    expect(received).toHaveLength(1);
    expect(received[0]?.source).toBe('local');
    expect(tables(received[0] as DataChange)).toEqual(['expenses']);
    expect(groups(received[0] as DataChange)).toEqual(['g1']);
  });

  it('deja de entregar al cancelar la suscripción', () => {
    const bus = createChangeBus();
    const listener = jest.fn();
    const unsubscribe = bus.subscribe(listener);
    unsubscribe();
    bus.emit({ source: 'local', tables: ['groups'], groupIds: ['g1'] });
    expect(listener).not.toHaveBeenCalled();
  });

  it('agrupa las emisiones de un lote, aunque esté anidado, en un solo cambio', () => {
    const bus = createChangeBus();
    const listener = jest.fn();
    bus.subscribe(listener);

    const result = bus.batch(() => {
      bus.emit({ source: 'local', tables: ['transfers'], groupIds: ['g1'] });
      bus.batch(() => {
        bus.emit({ source: 'local', tables: ['expenses', 'expense_splits'], groupIds: ['g2'] });
      });
      expect(listener).not.toHaveBeenCalled();
      return 42;
    });

    expect(result).toBe(42);
    expect(listener).toHaveBeenCalledTimes(1);
    const change = listener.mock.calls[0]?.[0] as DataChange;
    expect(tables(change)).toEqual(['expense_splits', 'expenses', 'transfers']);
    expect(groups(change)).toEqual(['g1', 'g2']);
  });

  it('un cambio sin grupo en el lote marca el lote como global', () => {
    const bus = createChangeBus();
    const listener = jest.fn();
    bus.subscribe(listener);
    bus.batch(() => {
      bus.emit({ source: 'local', tables: ['expenses'], groupIds: ['g1'] });
      bus.emit({ source: 'local', tables: ['users'], groupIds: null });
    });
    expect(groups(listener.mock.calls[0]?.[0] as DataChange)).toBeNull();
  });

  it('un lote que falla no emite nada', () => {
    const bus = createChangeBus();
    const listener = jest.fn();
    bus.subscribe(listener);
    expect(() =>
      bus.batch(() => {
        bus.emit({ source: 'local', tables: ['expenses'], groupIds: ['g1'] });
        throw new Error('falló la transacción');
      }),
    ).toThrow('falló la transacción');
    expect(listener).not.toHaveBeenCalled();

    bus.emit({ source: 'local', tables: ['groups'], groupIds: ['g1'] });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('si un lote interno falla y el externo continúa, no se pierde lo anterior', () => {
    const bus = createChangeBus();
    const listener = jest.fn();
    bus.subscribe(listener);
    bus.batch(() => {
      bus.emit({ source: 'local', tables: ['transfers'], groupIds: ['g1'] });
      try {
        bus.batch(() => {
          throw new Error('falló un paso');
        });
      } catch {
        // El lote externo decide seguir.
      }
      bus.emit({ source: 'local', tables: ['expenses'], groupIds: ['g1'] });
    });
    expect(tables(listener.mock.calls[0]?.[0] as DataChange)).toEqual(['expenses', 'transfers']);
  });

  it('un lote de la sincronización conserva su origen; si se mezclan, gana local', () => {
    const bus = createChangeBus();
    const listener = jest.fn();
    bus.subscribe(listener);
    bus.batch(() => bus.emit({ source: 'sync', tables: ['groups'], groupIds: ['g1'] }));
    bus.batch(() => {
      bus.emit({ source: 'sync', tables: ['groups'], groupIds: ['g1'] });
      bus.emit({ source: 'local', tables: ['groups'], groupIds: ['g1'] });
    });
    expect(listener.mock.calls.map(([change]) => (change as DataChange).source)).toEqual([
      'sync',
      'local',
    ]);
  });

  it('un suscriptor que falla no impide que los demás reciban el cambio', () => {
    const log = jest.fn();
    const bus = createChangeBus(log);
    const after = jest.fn();
    bus.subscribe(() => {
      throw new Error('pantalla rota');
    });
    bus.subscribe(after);

    expect(() => bus.emit({ source: 'local', tables: ['groups'], groupIds: ['g1'] })).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.any(String), expect.any(Error));
  });

  it('afecta a un grupo si lo incluye o si el cambio es global', () => {
    const bus = createChangeBus();
    const received: DataChange[] = [];
    bus.subscribe((change) => received.push(change));
    bus.emit({ source: 'local', tables: ['expenses'], groupIds: ['g1'] });
    bus.emit({ source: 'local', tables: ['users'], groupIds: null });
    const [scoped, global] = received as [DataChange, DataChange];

    expect(scoped.affects({ tables: ['expenses'], groupId: 'g1' })).toBe(true);
    expect(scoped.affects({ tables: ['expenses'], groupId: 'g2' })).toBe(false);
    expect(scoped.affects({ tables: ['transfers'], groupId: 'g1' })).toBe(false);
    expect(scoped.affects({ tables: ['expenses'] })).toBe(true);
    expect(global.affects({ tables: ['users'], groupId: 'g2' })).toBe(true);
  });
});
