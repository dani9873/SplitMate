import { useCallback, useEffect, useRef } from 'react';

export interface PressGuardOptions {
  /** Tiempo, en ms, que el toque sigue bloqueado después de que el manejador termina. */
  cooldownMs?: number;
}

export const DEFAULT_PRESS_COOLDOWN_MS = 500;

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * Protege un manejador de toque contra toques repetidos.
 *
 * Mientras el manejador sigue en curso (si devuelve una promesa) y durante `cooldownMs` después,
 * los toques nuevos se ignoran. Usa una referencia y no estado de React: dos toques del mismo
 * cuadro llegan antes de que haya un redibujo, así que un estado `submitting` los dejaría pasar.
 *
 * Devuelve lo que devuelva el manejador (para que quien llama pueda esperar su promesa) o
 * `undefined` si el toque se ignoró. Un rechazo no deja la protección puesta. Sin manejador,
 * devuelve `undefined`, para que el botón siga sin `onPress`.
 */
export function usePressGuard<A extends unknown[], R>(
  handler: (...args: A) => R,
  options?: PressGuardOptions,
): (...args: A) => R | undefined;
export function usePressGuard<A extends unknown[], R>(
  handler: ((...args: A) => R) | null | undefined,
  options?: PressGuardOptions,
): ((...args: A) => R | undefined) | undefined;
export function usePressGuard<A extends unknown[], R>(
  handler: ((...args: A) => R) | null | undefined,
  { cooldownMs = DEFAULT_PRESS_COOLDOWN_MS }: PressGuardOptions = {},
): ((...args: A) => R | undefined) | undefined {
  const latest = useRef(handler);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latest.current = handler;
  }, [handler]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      busy.current = false;
    },
    [],
  );

  const guarded = useCallback(
    (...args: A): R | undefined => {
      const fn = latest.current;
      if (!fn || busy.current) return undefined;
      busy.current = true;

      const release = () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          busy.current = false;
          timer.current = null;
        }, cooldownMs);
      };

      let result: R;
      try {
        result = fn(...args);
      } catch (error) {
        release();
        throw error;
      }
      if (isPromiseLike(result)) {
        // Quien llama recibe la promesa original y decide qué hacer con un rechazo.
        result.then(release, release);
      } else {
        release();
      }
      return result;
    },
    [cooldownMs],
  );

  return handler ? guarded : undefined;
}
