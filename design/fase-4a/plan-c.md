# Fase 4a, punto C — Toques repetidos

> Plan corto (modo desatendido, 2026-10-17). Dos commits de código; el segundo según la auditoría.

## Problema

Un doble toque rápido en "Guardar" puede crear dos registros; en "Nuevo gasto" o en una fila, abrir
dos pantallas o dos hojas. El estado de React (`useState`) no basta: entre dos toques del mismo
cuadro todavía no se redibujó, así que el segundo ve el valor viejo. La protección tiene que usar
una **referencia** (`useRef`), que cambia al instante.

## Decisión

Alternativas: (a) arreglar cada pantalla con su `submitting`; (b) una protección central.
Se elige **(b)** y las pantallas solo conservan su estado visual:

1. `src/ui/press-guard.ts`: `usePressGuard(handler, { cooldownMs })`. Ignora toques mientras el
   anterior sigue en curso: si el manejador devuelve una promesa, hasta que termine (más un
   enfriamiento corto); si es síncrono, durante `cooldownMs` (500 ms por omisión). Siempre se
   libera, aunque el manejador lance un error. Sin temporizadores colgados al desmontar.
2. `Button` e `IconButton` usan la protección en su `onPress`: todo botón de la app queda
   protegido sin tocar cada pantalla. `onPressIn/Out` y `onLongPress` no cambian.
3. `src/lib/navigation/use-guarded-router.ts`: `useGuardedRouter()` envuelve `push`, `replace`,
   `navigate` y `back` de Expo Router. Ignora una **misma** llamada idéntica (mismo método y mismo
   destino) dentro de 600 ms; `back` repetido dentro de 600 ms también. Dos navegaciones distintas
   seguidas (replace y luego push) sí pasan.
4. Escrituras prioritarias (commit 1): guardar gasto/ingreso, transferencia, grupo y miembro. Se
   comprueba con pruebas de pantalla que un doble toque da **un** registro y **una** navegación.
5. Commit 2: auditoría del resto (filas que navegan, borrar, confirmaciones, "Sincronizar ahora",
   hojas) y aplicar donde falte.

## Pruebas (TDD, primero en rojo)

- `src/ui/__tests__/press-guard.test.tsx`: dos toques seguidos => una llamada; con promesa, mientras
  no termine no entra otra; tras terminar y pasar el enfriamiento vuelve a responder; si lanza,
  se libera.
- `Button.test` / `IconButton.test`: doble toque => un `onPress`.
- `use-guarded-router.test.tsx`: dos `push` iguales => uno; distintos => dos; `back` doble => uno.
- Pantallas: doble toque en "Guardar" de gasto, transferencia, grupo y miembro => un registro.

Solo se ejecutan los archivos afectados, más `tsc` y eslint de lo tocado.
