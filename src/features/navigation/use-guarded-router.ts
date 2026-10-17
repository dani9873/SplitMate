import { useRouter } from 'expo-router';
import { useMemo, useRef } from 'react';

/** Tiempo en que una misma navegación repetida se considera un toque doble. */
export const NAVIGATION_COOLDOWN_MS = 600;

type Router = ReturnType<typeof useRouter>;

/**
 * `useRouter` que ignora la misma navegación repetida: un doble toque no abre dos pantallas ni
 * cierra dos. Es idéntica si coinciden el método (`push`, `replace`, `navigate`, `back`) y el
 * destino, dentro de `NAVIGATION_COOLDOWN_MS`. Dos navegaciones distintas seguidas, como
 * `replace` y luego `push`, pasan las dos.
 */
export function useGuardedRouter(): Router {
  const router = useRouter();
  const last = useRef<{ key: string; at: number } | null>(null);

  return useMemo(() => {
    const allowed = (key: string): boolean => {
      const now = Date.now();
      const previous = last.current;
      if (previous && previous.key === key && now - previous.at < NAVIGATION_COOLDOWN_MS) {
        return false;
      }
      last.current = { key, at: now };
      return true;
    };
    const keyOf = (method: string, href: unknown) => `${method}:${JSON.stringify(href ?? null)}`;

    return {
      ...router,
      push: (...args: Parameters<Router['push']>) => {
        if (allowed(keyOf('push', args[0]))) router.push(...args);
      },
      replace: (...args: Parameters<Router['replace']>) => {
        if (allowed(keyOf('replace', args[0]))) router.replace(...args);
      },
      navigate: (...args: Parameters<Router['navigate']>) => {
        if (allowed(keyOf('navigate', args[0]))) router.navigate(...args);
      },
      back: () => {
        if (allowed('back')) router.back();
      },
    };
  }, [router]);
}
