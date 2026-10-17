# Fase 4a — Revisión de seguridad (paso 12a, 2026-10-16)

## Alcance y método

Se revisó la diferencia de `fase-4a-sincronizacion` con `main` (128 archivos, `detect_changes`):

- **Servidor:** las cuatro migraciones de la fase, con `sync_push`, `sync_pull` y el trigger de borrar
  la cuenta.
- **Cliente:** `src/db/sync`, `src/features/sync` y `src/lib/supabase`.
- **Configuración:** `.gitignore`, `.easignore`, `eas.json`, `app.json`, CI, `EXPO_PUBLIC_*`,
  `npm audit --omit=dev` y los permisos de `expo-network`.

Tres subagentes revisaron servidor, cliente y configuración; los hallazgos medios se comprobaron a
mano en el código.

**No hay hallazgos altos.** Ninguna ruta deja a una cuenta leer o escribir en grupos de otra.

## Hallazgos y estado

| Id | Sev. | Hallazgo | Estado |
|---|---|---|---|
| S1 | Media | Un gasto nuevo con ids de pagadores o partes de otro gasto los reactivaba sin versión ni historial, y quedaba sin esas líneas (`sync_push.sql:933-936`, `:950-953`). | Corregido: `20261016120000_gasto_lineas_ajenas.sql` |
| S2 | Media | La marca `splitmate.sync_push` seguía puesta hasta el final de la transacción. Una petición GraphQL con `syncPush` y después un insert directo pasaba la guardia. | Corregido: `20261016120100_sync_push_marca.sql` (falta revisar pg_graphql en el panel) |
| C1 | Media | Una moneda inventada (`QQQ`) entraba por `sync_push` y, al descargarla, rompía los saldos de los demás miembros (`currencyCode` lanza). | Corregido en el servidor (`20261016120200_monedas_conocidas.sql`, 155 monedas) y en el cliente (`currencySchema` en `apply.ts`) |
| S3 | Media | `sync_pull` no tiene tope de filas por grupo y no hay cupos de grupos por cuenta ni de filas por grupo: un miembro puede inflar un grupo compartido. | Pendiente (necesita diseño) |
| K1 | Media | `.gitignore` y `.easignore` no cubrían `credentials.json`, `credentials/` ni `*.keystore`. | Corregido (y Firebase en `.gitignore`) |
| C2 | Baja | Las filas descargadas tenían topes más laxos que el servidor: tasa `"1.."` o `"0"`, días que no están en el calendario, ícono de categoría sin tope. | Corregido: mismos topes que `sync_push`, contados en caracteres |
| C3 | Baja | Se temía que el log de desarrollo registrara los parámetros de la consulta. | Descartado: con drivers síncronos, Drizzle 0.45.3 lanza el error de SQLite sin parámetros. Queda una prueba de guardia. |
| S4 | Baja | `field` repetía sin tope la clave desconocida enviada. | Corregido: `20261016120300_sync_fail_tope.sql` (64 caracteres) |
| S5 | Baja | Un id ajeno con base nula da `forbidden` (choque de la PK): revela que existe. UUID v7 tiene unos 74 bits al azar. | Aceptado |
| S6 | Baja | `private.next_change_seq` es DEFINER y no comprueba acceso; no se puede llamar por la API. | Aceptado |
| C4 | Baja | El cliente aplica por `id` sin comparar `group_id` ni `expense_id`; solo sería explotable con un servidor comprometido (las PK del servidor son globales). | Pendiente |
| C5 | Baja | Una página de `sync_pull` no tiene tope de filas en el cliente; no puede ser `maxRows`, porque el primer grupo entra entero. | Pendiente, junto con S3 |
| C6 | Baja | `sync_conflicts` no tiene limpieza: el borrador de un grupo que ya no está queda guardado (cifrado) y no se ve. | Pendiente |
| K2 | Baja | expo-network pide `ACCESS_WIFI_STATE` y `ACCESS_NETWORK_STATE`, ambos de nivel normal y sin ubicación. La app no usa el Wi-Fi. | Pendiente: valorar `android.blockedPermissions` y comprobarlo en un build |
| K3 | Baja | Las acciones del CI se fijan por etiqueta, no por SHA. | Pendiente |

## Comprobado sin problema

- **RPC y RLS:**
  - `sync_push`, `sync_pull` y las `sync_apply_*` son INVOKER, con RLS por `can_access_group`.
  - Todas las funciones nuevas usan `search_path = ''`. Las DEFINER están en `private`:
    `next_change_seq`, `is_group_creator`, `can_access_group`, `sync_find_mutation`,
    `sync_remember_mutation`, `lock_group_changes`, `record_change` y `delete_unshared_groups`.
  - EXECUTE está revocado a `PUBLIC`, `anon` y `service_role`.
  - `change_log` tiene RLS, solo SELECT y es de solo agregar.
  - `sync_mutations` usa la PK `(user_id, mutation_id)`, así que un envío de otra cuenta no se
    recuerda como propio.
  - No se pueden poner un `created_by` ajeno, mover filas de grupo, usar miembros o categorías de
    otro grupo ni marcar "soy yo" con otra cuenta.
- **Límites del servidor:** 512 KiB, 50 envíos, 50 pagadores y 50 partes, el largo de cada texto,
  los montos, `p_max_rows` 100-5000 y 1000 cursores.
- **Borrar la cuenta:**
  - Se borran los grupos creados por la cuenta o donde tiene su miembro activo, siempre que ninguna
    otra cuenta tenga un miembro activo ni sea la creadora. Esto incluye archivados y borrados.
  - Los demás grupos quedan, con `created_by` y `user_id` en NULL.
  - Un grupo donde el miembro de otra cuenta está borrado lógicamente se borra, porque esa cuenta ya
    no tiene acceso.
- **Validación en el cliente:**
  - zod estricto en las respuestas (`wire.ts`) y en cada fila (`apply.ts`), incluido el `current` de
    un rechazo.
  - Mensajes de error fijos; `lastError` guarda solo el tipo y no hay `console.*`.
  - El texto del servidor se muestra solo con `<Text>`, Toast o Banner, sin WebView ni `openURL`, y
    el color sale de una lista cerrada.
  - Las rutas validan el UUID.
- **Tokens:** la sesión va cifrada con AES-GCM y su clave está en expo-secure-store; esto no cambió
  en la 4a. La sincronización no guarda tokens.
- **Borradores y cola:** `sync_outbox`, `sync_conflicts`, `sync_cursors` y el borrador del
  formulario están en la base SQLCipher de la cuenta. `deleteAccountData` borra el archivo y la
  clave. AsyncStorage solo guarda el idioma y el tema.
- **Configuración:**
  - No hay secretos en el repo ni en el historial; `.env.example` va vacío.
  - Solo hay dos `EXPO_PUBLIC_*`, la URL y la clave publicable, y `env.ts` rechaza `sb_secret_`.
  - `eas.json` no tiene `env`.
  - El CI usa `contents: read` y `pull_request`, sin secretos.
  - PGlite está en devDependencies.
- **`npm audit --omit=dev`:** 68 avisos de los mismos seis paquetes de origen ya aceptados en
  CLAUDE.md; esta fase no agrega ninguno.

## Acceso por creador hasta la Fase 4b

- **El creador**, aunque no tenga miembro vinculado o el suyo esté borrado o desvinculado:
  - lee y descarga todo el grupo, incluido `change_log`;
  - edita y borra el grupo, los gastos, las transferencias y las categorías;
  - agrega miembros, también `owner`;
  - borra lógicamente a cualquier miembro, incluso a uno vinculado a otra cuenta, y así lo expulsa.
- **Cualquier miembro activo:**
  - renombra o borra lógicamente a otros miembros, lo que les quita el acceso salvo al creador;
  - borra o archiva el grupo;
  - cambia la moneda si el grupo no tiene movimientos.
- **Un miembro vinculado borrado lógicamente** pierde todo acceso y no puede restaurarse (su id da
  `forbidden`). Si es el creador, conserva el acceso por `created_by`.
- **Para revisar en la 4b:** un miembro que no es el creador no puede desvincular su "soy yo" ni
  borrarse. `record_change` lanza `insufficient_privilege` al perder el acceso y el envío da
  `forbidden`. Es un tema funcional, no de seguridad.

## Pruebas

- **pgTAP:** `012-revision-seguridad` (15 pruebas), con S1, S2, C1 y S4 en rojo antes de cada
  corrección. `npm run test:db:local` completo: 398 en verde.
- **Jest:**
  - `pull.test.ts` cubre C1 y C2, más la guardia de C3.
  - `server-currencies.test.ts` compara la lista del servidor con `KNOWN_CURRENCIES`.
  - También en verde: `src/db/sync`, `push.int`, `conflicts.int`, `cycle`, `remote.int` y
    `flujo-sincronizacion`.
- **Remoto:** las cuatro migraciones nuevas **no se aplicaron**. En el 12b: `supabase db push`,
  luego `npm run check:data-api`, y revisar en el panel si pg_graphql está activo.
