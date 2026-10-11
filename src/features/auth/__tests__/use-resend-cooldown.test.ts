import { act, renderHook } from '@testing-library/react-native';

import { RESEND_COOLDOWN_SECONDS, useResendCooldown } from '../use-resend-cooldown';

describe('espera para reenviar el correo', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-11T12:00:00Z') });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('empieza esperando los mismos 60 segundos que Supabase', async () => {
    const { result } = await renderHook(() => useResendCooldown());
    expect(RESEND_COOLDOWN_SECONDS).toBe(60);
    expect(result.current).toMatchObject({ remaining: 60, ready: false });
  });

  it('cuenta hacia atrás y queda lista al llegar a cero', async () => {
    const { result } = await renderHook(() => useResendCooldown(3));
    await act(async () => jest.advanceTimersByTime(1000));
    expect(result.current.remaining).toBe(2);
    await act(async () => jest.advanceTimersByTime(2000));
    expect(result.current).toMatchObject({ remaining: 0, ready: true });
  });

  it('reiniciar vuelve a esperar después de un reenvío', async () => {
    const { result } = await renderHook(() => useResendCooldown(3));
    await act(async () => jest.advanceTimersByTime(3000));
    expect(result.current.ready).toBe(true);

    await act(async () => result.current.restart());
    expect(result.current).toMatchObject({ remaining: 3, ready: false });
  });
});
