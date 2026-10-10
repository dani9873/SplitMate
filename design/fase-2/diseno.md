# Fase 2 — Diseño: pantallas del MVP

Aprobado el 2026-10-09 con seis ajustes de la revisión, ya incorporados: fechas de calendario
locales, deshacer en lugar de confirmar, bus de cambios único, casos límite de la
calculadora, borradores y monedas separadas en Actividad.

## Objetivo

Que SplitMate se pueda usar de verdad en un solo teléfono para llevar los gastos de un
grupo, todo local, sin login ni nube. Las pantallas solo llaman a repositorios y al
dominio.

## Navegación

```
(tabs)
  index                              Grupos: tu saldo en cada grupo; archivados al final
  activity                           Actividad de todos los grupos
  settings                           Ajustes
groups/new                           modal: crear grupo
groups/[groupId]                     detalle: Movimientos | Saldos
groups/[groupId]/settings            editar grupo, miembros, "soy yo", archivar
groups/[groupId]/entries/new         modal: gasto, ingreso o transferencia (?type=)
groups/[groupId]/entries/[entryId]   detalle del movimiento (?kind=)
groups/[groupId]/entries/[entryId]/edit   modal de edición
```

- Stack nativo de Expo Router. Los formularios se presentan como modales.
- Los parámetros de ruta se validan con zod antes de consultar: un enlace mal formado
  muestra el estado de "no encontrado", nunca un error.

## Datos

### Migración 0002

Solo `ALTER TABLE … ADD COLUMN` y `CREATE`. No se reconstruyen tablas, para no arriesgar los
datos existentes. Se prueba aplicándola sobre una base con datos de la 0001.

| Cambio                                                   | Para qué                                           |
| -------------------------------------------------------- | -------------------------------------------------- |
| `groups.emoji` (texto, nulo)                             | Ícono del grupo                                    |
| `groups.color` (clave de la paleta, por defecto `teal`)  | Color del grupo, con variantes clara y oscura      |
| `groups.archived_at` (instante, nulo)                    | Archivado: solo lectura y fuera de la lista activa |
| Índice único parcial `group_members (group_id, user_id)` | Un solo "yo" por grupo                             |
| Tabla `local_settings (key, value, updated_at)`          | Datos del dispositivo que **no se sincronizan**    |

`local_settings` guarda el id del usuario local y los borradores de formularios. Vive en la
base cifrada porque los borradores contienen montos y descripciones.

### Usuario actual

- Al crear el primer grupo se crea un `users` local con "Tu nombre" y su id queda en
  `local_settings`.
- Un miembro es "yo" cuando su `user_id` es el del usuario local. Cambiarlo en los ajustes
  del grupo mueve ese vínculo en una transacción.
- Cuando llegue el login, la cuenta se asocia al usuario local y los vínculos ya existen.

### Fechas

- La fecha de un movimiento (`occurred_on`) es un **día de calendario local**,
  `YYYY-MM-DD`, sin hora ni zona: un gasto del 9 de octubre es del 9 de octubre en
  cualquier zona horaria y no cambia de día al sincronizar.
- `created_at`, `updated_at`, `deleted_at` y `archived_at` siguen siendo instantes UTC en
  milisegundos.
- `src/lib/calendar-date.ts` concentra la regla: `today()` usa la fecha local del
  dispositivo (no `toISOString()`, que es UTC), y para mostrar un día se formatea como
  medianoche UTC con `timeZone: 'UTC'`, así nunca se corre. Las pruebas fijan zonas
  extremas (UTC−5 de noche y UTC+14).

### Repositorios nuevos o ampliados

| Repositorio | Métodos                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| `profile`   | `get()`, `ensure(displayName)`: usuario local                                                           |
| `groups`    | `update` (nombre, emoji, color; moneda solo sin movimientos), `archive`, `unarchive`, `listSummaries`   |
| `members`   | `add`, `rename`, `remove` (saldo cero y no el último), `setCurrentMember`, `listAll` (incluye quitados) |
| `expenses`  | `get`, `update` (recrea pagadores y partes con borrado lógico), `restore`                               |
| `transfers` | `get`, `update`, `remove`, `restore`                                                                    |
| `activity`  | `list({ groupId? })`: gastos, ingresos y transferencias normalizados, con nombres de miembros y grupo   |
| `drafts`    | `get`, `save`, `discard`: borradores de "nuevo movimiento" por grupo, validados con zod al leer         |

Errores nuevos con mensaje traducido: `MEMBER_HAS_BALANCE`, `LAST_MEMBER`, `CURRENCY_LOCKED`
y `GROUP_ARCHIVED`.

Reglas:

- **Moneda del grupo:** se bloquea con el primer movimiento. Reconvertir exigiría una tasa
  por movimiento y alteraría montos ya acordados.
- **Archivado:** el grupo pasa a solo lectura (`GROUP_ARCHIVED` en toda escritura) y se
  puede restaurar.
- **Miembros quitados:** se borran lógicamente. Siguen nombrados en el historial. Si luego se
  edita un gasto antiguo en el que participan, se conservan en ese gasto, y si su saldo deja
  de ser cero aparecen en Saldos con la nota "ya no está en el grupo".
- **Restaurar** (para deshacer) revierte un borrado lógico: el movimiento y las filas hijas
  borradas en el mismo instante vuelven, con nueva `version`.

## Bus de cambios

Único mecanismo de notificación de cambios de datos. Se retira el listener nativo de
expo-sqlite (`enableChangeListener` y `useDatabaseChanges`).

```ts
type ChangeSource = 'local' | 'sync';
interface DataChange {
  readonly source: ChangeSource;
  readonly tables: ReadonlySet<TableName>;
  /** Grupos afectados; `null` si el cambio no es de un grupo (por ejemplo, el perfil). */
  readonly groupIds: ReadonlySet<string> | null;
}
interface ChangeBus {
  emit(change: DataChange): void;
  /** Agrupa todas las emisiones de `fn` en un solo evento al terminar. */
  batch<T>(fn: () => T): T;
  subscribe(listener: (change: DataChange) => void): () => void;
}
```

- Cada método de escritura de un repositorio emite **después** de confirmar su
  transacción. Si la transacción falla, no se emite nada.
- `batch` fusiona tablas y grupos de varias escrituras: liquidar varias transferencias o,
  en la Fase 4, aplicar un lote de la sincronización produce un solo evento.
- Un listener que falla se registra en el log y no afecta a la escritura ni a los demás
  listeners.
- La sincronización de la Fase 4 escribirá a través de los repositorios (o de funciones del
  mismo módulo) con `source: 'sync'`, así las pantallas se actualizan igual que con un
  cambio local y la cola de envío puede ignorar los cambios que ella misma aplicó.
- `useLiveQuery(read, { tables, groupId })` lee después del primer render (estado de
  carga), vuelve a leer cuando llega un cambio que toca sus tablas y su grupo, y expone el
  error con `retry`.

Funciona igual en la app (expo-sqlite) y en Jest (sql.js), que es lo que permite probar el
flujo completo.

## Dominio: evaluador del monto

`evaluateAmount(expression, currency)` en `src/domain/expression.ts`, con TDD y cobertura
de 100 %.

- Entrada canónica del teclado: dígitos, `.`, `+`, `-`, `*`, `/`. La UI muestra `,` o `.`
  según el idioma y `×`, `÷`, `−`.
- Precedencia usual (× y ÷ antes que + y −), de izquierda a derecha, sin paréntesis.
- Aritmética racional exacta con `bigint`; un solo redondeo bancario al final a los
  decimales de la moneda.
- Devuelve un resultado, no lanza: el formulario evalúa en cada tecla.

| Motivo              | Ejemplo            | Mensaje (es)                                    |
| ------------------- | ------------------ | ----------------------------------------------- |
| `EMPTY`             | `""`               | Escribe un monto                                |
| `INCOMPLETE`        | `12+`              | Completa la operación                           |
| `MALFORMED`         | `+5`, `1..2`       | Revisa el monto                                 |
| `TOO_MANY_DECIMALS` | `1.234` en USD     | USD admite 2 decimales                          |
| `DIVISION_BY_ZERO`  | `12/0`             | No se puede dividir entre cero                  |
| `NOT_POSITIVE`      | `5-8`, `0`         | El monto debe ser mayor que cero                |
| `TOO_LARGE`         | `99999999999`      | El monto máximo es 9.999.999.999 en esta moneda |
| `TOO_LONG`          | más de 64 símbolos | La operación es demasiado larga                 |

Monto máximo: 9 999 999 999 en la unidad principal de la moneda (diez dígitos enteros). Con
tres decimales, el máximo de las monedas admitidas (KWD, BHD…), son menos de 10¹³ unidades
menores: cientos de gastos máximos suman sin salir del rango seguro de 9 × 10¹⁵. En cualquier motivo, "Guardar" queda deshabilitado
y el mensaje se muestra bajo el monto y se anuncia al lector de pantalla.

## Pantallas

### Grupos

- FlashList v2 con tarjetas: emoji sobre el color del grupo (o la inicial), nombre, número
  de miembros y tu saldo en su moneda: "Te deben 30,00 US$", "Debes 12,00 US$" o "Estás al
  día", siempre con texto, signo y flecha.
- Si el grupo no tiene "yo": "Elige quién eres en este grupo".
- Estado vacío con "Crear grupo"; sección "Archivados (n)" plegable al final.

### Crear y editar grupo

- Nombre, moneda (selector con búsqueda; USD por defecto), emoji (cuadrícula curada) y color
  (8 colores).
- Al crear: "Tu nombre" y los demás miembros en línea.
- Ajustes del grupo: los mismos campos, miembros (agregar, renombrar, quitar), "Soy yo" y
  archivar o restaurar.
- Quitar un miembro con saldo explica el motivo: "Beto debe 12,00 US$. Liquida su saldo
  antes de quitarlo." Quitar y archivar piden confirmación.

### Detalle del grupo

Cabecera con emoji, nombre y tu saldo; control segmentado Movimientos | Saldos; botón
"Añadir". Un grupo archivado muestra el aviso "Grupo archivado" con "Restaurar" y no permite
añadir.

### Formulario de movimiento

Tipo: Gasto | Ingreso | Transferencia.

- **Monto** como protagonista: la expresión arriba y el resultado grande en cifras
  tabulares. Al tocarlo aparece el teclado propio (7 8 9 ÷ / 4 5 6 × / 1 2 3 − / , 0 ⌫ +,
  y "="). Teclas de 48 dp o más con nombre accesible; mantener ⌫ borra todo, también como
  acción accesible. Sin tecla decimal en monedas sin decimales.
- **Descripción**, **categoría** (9 chips con ícono) y **fecha** (Hoy, Ayer u otra fecha
  con el calendario propio).
- **Pagador:** por defecto "yo" (o el primer miembro). "Varios pagadores" muestra un monto
  por pagador y lo que falta o sobra en vivo.
- **División:** Igual | Montos | % | Partes, con la parte de cada uno calculada en vivo con
  `splitAmount`. Si no cuadra, "Guardar" se deshabilita con el motivo.
- **Otra moneda:** selector de moneda y tasa "1 EUR = [ ] US$" con el monto convertido. Se
  guardan la tasa y su fecha (la del movimiento).
- **Ingreso:** "Recibido por" y "Para quién". **Transferencia:** de, para, monto, fecha y
  moneda.
- react-hook-form + zod en el formulario; el repositorio vuelve a validar.

### Borradores

- Si la app pasa a segundo plano, o el formulario de **nuevo** movimiento se cierra sin
  guardar con algo escrito, lo escrito se guarda como borrador de ese grupo.
- Al abrir "Añadir" en ese grupo aparece "Tienes un borrador: Cena · 28,50 US$" con
  Recuperar y Descartar. Guardar el movimiento o descartar borra el borrador.
- Un borrador por grupo, guardado en la base cifrada, con un esquema zod versionado: si no
  valida (por ejemplo, tras una actualización) se descarta en silencio.
- Las ediciones de movimientos existentes no generan borradores.

### Detalle del movimiento

Pagadores, partes por miembro y tasa si aplica. Editar abre el formulario; Borrar lo borra
al instante y muestra el aviso con "Deshacer".

### Saldos

- Cada miembro con una barra que crece desde el centro: a la derecha si le deben, a la
  izquierda si debe. El significado también está en el texto ("le deben", "debe") y en la
  flecha. "Tú" primero.
- Transferencias sugeridas con "Marcar como pagada": crea la transferencia con la fecha de
  hoy y muestra el aviso con "Deshacer".
- Con todo en cero: "Todos están al día".

### Actividad

- En el grupo: lista agrupada por día con un encabezado por día ("Hoy", "Ayer", fecha larga),
  búsqueda por texto sin distinguir mayúsculas ni tildes y filtros por categoría y por
  miembro (participa como pagador, en la división o en la transferencia).
- En la pestaña: lo mismo para todos los grupos, con el grupo en cada fila y sin filtro de
  miembro.
- **Nunca se suman ni se comparan montos de monedas distintas.** Cada fila muestra su
  propia moneda; no hay totales entre grupos y el orden es por fecha.

Los encabezados iban a ser fijos. En el emulador, los fijos de FlashList 2.0.2 mostraban un
día equivocado tras borrar o restaurar un movimiento, hasta desplazar la lista: se recalculan
antes de medir las filas nuevas. Quedan dentro de la lista, y la lista no mantiene su
posición al insertar arriba, para que un movimiento nuevo o restaurado se vea.

## Deshacer

- Borrar un movimiento y marcar una transferencia sugerida como pagada actúan al instante y
  muestran un aviso con "Deshacer" durante 6 segundos.
- Con lector de pantalla activo, el aviso se anuncia ("Gasto borrado. Puedes deshacerlo.") y
  no desaparece solo: se cierra con su botón o con la siguiente acción. Así nadie pierde la
  opción por el tiempo que toma navegar hasta el botón.
- Solo archivar el grupo y quitar miembros piden confirmación.

## Diseño visual

- Se mantiene la identidad de la Fase 0: tokens semánticos, Manrope, verde azulado y coral.
- La única pieza llamativa es el monto: cifra grande con números tabulares, la expresión en
  tono suave encima y los operadores del teclado en el color de acento.
- Paleta de 8 colores de grupo (`teal`, `coral`, `amber`, `plum`, `sky`, `olive`, `rose`,
  `slate`), cada uno con fondo y texto para claro y oscuro.
- Una prueba calcula el contraste WCAG de cada par de texto y fondo en ambos temas: 4,5:1
  para texto y 3:1 para íconos y texto grande.

## Calidad

- FlashList v2 con filas memoizadas, callbacks estables y tipos de ítem para encabezados.
- Formateadores `Intl` creados una vez por idioma y moneda. El locale combina el idioma de la
  app con la región del dispositivo cuando coinciden (es-CO, en-US).
- Cada pantalla: esqueleto mientras carga, vacío con una acción y error con reintento.
- ESLint prohíbe importar `drizzle-orm`, `expo-sqlite` o el esquema desde `app/`,
  `src/features/` y `src/ui/`.
- Áreas táctiles de 44 px o más, etiquetas en todos los controles y filas que se leen como
  una frase.

## Pantalla de desarrollo

Se retiran `/dev`, el benchmark y el panel del cifrado. En Ajustes, solo en desarrollo, queda
"Cargar datos de ejemplo": tres grupos realistas en el idioma activo, para capturas.
`check:bundle` verifica en CI que ese módulo no llegue a producción.

## Pruebas

- Dominio: evaluador con todos los motivos de la tabla, más propiedades con fast-check.
- `calendar-date`: zonas UTC−5 y UTC+14.
- Repositorios: métodos nuevos, reglas, restaurar, bus de cambios (emite tras confirmar, no
  emite si falla, `batch` agrupa) y migración 0002 sobre datos existentes.
- Componentes: teclado, campo de monto, editor de división, filas de saldo, aviso de
  deshacer y formularios.
- Flujo con `expo-router/testing-library` y sql.js: crear grupo, agregar miembros, cuatro
  gastos (uno por método), ver saldos, marcar las sugeridas como pagadas y ver todo en cero.
- Maestro: el mismo flujo en `.maestro/`, con instrucciones para el emulador y el teléfono.

## Fuera de alcance

Categorías personalizadas, estadísticas, gastos recurrentes, recibos y OCR, exportar,
invitaciones, login, sincronización y borrar grupos.
