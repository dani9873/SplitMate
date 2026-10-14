import { useCallback, useEffect, useState } from 'react';

/** Espera entre reenvíos de un correo: la misma que exige Supabase. */
export const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Cuenta regresiva para reenviar un correo. Empieza activa: el correo se acaba de enviar.
 * `restart()` la vuelve a empezar después de cada reenvío.
 */
export function useResendCooldown(seconds = RESEND_COOLDOWN_SECONDS) {
  const [endsAt, setEndsAt] = useState(() => Date.now() + seconds * 1000);
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [endsAt]);

  const restart = useCallback(() => setEndsAt(Date.now() + seconds * 1000), [seconds]);

  return { remaining, ready: remaining === 0, restart };
}
