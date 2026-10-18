import { act, renderHook } from '@testing-library/react-native';

import { DEFAULT_PRESS_COOLDOWN_MS, usePressGuard } from '../press-guard';

describe('usePressGuard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('ignora el segundo toque seguido, aunque no haya habido redibujo', async () => {
    const handler = jest.fn();
    const { result } = await renderHook(() => usePressGuard(handler));

    await act(async () => {
      result.current();
      result.current();
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('sin opciones usa la ventana compartida de 300 ms: 299 ignora, 300 acepta', async () => {
    const handler = jest.fn();
    const { result } = await renderHook(() => usePressGuard(handler));
    expect(DEFAULT_PRESS_COOLDOWN_MS).toBe(300);

    await act(async () => {
      result.current();
    });
    await act(async () => {
      jest.advanceTimersByTime(299);
      result.current();
    });
    expect(handler).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(1);
      result.current();
    });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('vuelve a responder cuando pasa el enfriamiento', async () => {
    const handler = jest.fn();
    const { result } = await renderHook(() => usePressGuard(handler, { cooldownMs: 500 }));

    await act(async () => {
      result.current();
    });
    await act(async () => {
      jest.advanceTimersByTime(499);
      result.current();
    });
    expect(handler).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(2);
      result.current();
    });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('con una promesa, bloquea hasta que termine y luego espera el enfriamiento', async () => {
    let finish: () => void = () => undefined;
    const handler = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = await renderHook(() => usePressGuard(handler, { cooldownMs: 500 }));

    await act(async () => {
      result.current();
    });
    // Pasa mucho más que el enfriamiento y la promesa sigue en curso.
    await act(async () => {
      jest.advanceTimersByTime(5000);
      result.current();
    });
    expect(handler).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish();
    });
    await act(async () => {
      result.current();
    });
    expect(handler).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(501);
      result.current();
    });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('se libera aunque el manejador falle (síncrono o con promesa rechazada)', async () => {
    const handler = jest
      .fn()
      .mockImplementationOnce(() => Promise.reject(new Error('falló')))
      .mockImplementation(() => undefined);
    const { result } = await renderHook(() => usePressGuard(handler, { cooldownMs: 100 }));

    await act(async () => {
      await (result.current() as Promise<void>).catch(() => undefined);
    });
    await act(async () => {
      jest.advanceTimersByTime(101);
      result.current();
    });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('usa el manejador más reciente', async () => {
    const first = jest.fn();
    const second = jest.fn();
    const { result, rerender } = await renderHook(
      ({ fn }: { fn: () => void }) => usePressGuard(fn),
      { initialProps: { fn: first } },
    );
    await rerender({ fn: second });

    await act(async () => {
      result.current();
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('pasa los argumentos del toque y devuelve undefined si no hay manejador', async () => {
    const handler = jest.fn();
    const { result } = await renderHook(() => usePressGuard(handler));
    await act(async () => {
      result.current('a', 2);
    });
    expect(handler).toHaveBeenCalledWith('a', 2);

    const { result: none } = await renderHook(() => usePressGuard(undefined));
    expect(none.current).toBeUndefined();
  });
});
