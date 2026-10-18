# Fase 4b — Resumen de la jornada autónoma (2026-10-18)

Rama `fase-4b-invitaciones`. **No se hizo ningún `db push`**, ninguna escritura en Supabase remoto,
ningún build, ninguna instalación en teléfonos y no se usaron contraseñas ni correos de prueba. `main`
no se tocó; no se abrió PR ni se borró ninguna rama. La fase **no** se marca como terminada en
`CLAUDE.md`.

## Estado por tarea

| # | Tarea | Estado |
|---|---|---|
| 1 | Segunda revisión de seguridad adversarial | Hecha: ver abajo |
| 2 | Prueba de concurrencia real del último uso | Hecha en local; falta ver el CI (se sube al cierre) |
| 3 | `log_parameter_max_length_on_error` en el remoto (solo lectura) | Hecha: vale `0` |
| 4 | `guia-manana.md` | Hecha |
| 5 | Borrador del push n.º 3 | Hecha |
| 6 | Auditoría de las pantallas nuevas | Pendiente |

## Tarea 1 — Segunda revisión de seguridad

Informe completo en `revision-seguridad.md`, sección «Segunda revisión». Se leyó el servidor
(`acceso_membresia`, `sync_pull_v2`, `invitaciones`) y el cliente como atacante, y se respondió cada
pregunta del encargo.

- **Servidor: nada de severidad media o superior.** `20261019090000_invitaciones.sql` no cambió (así
  que el dry-run del push n.º 2 sigue siendo el mismo).
- **C12 (media), corregido con TDD:** el enlace pendiente no se borraba al cerrar sesión ni al cambiar
  de cuenta (en un teléfono compartido, la persona siguiente veía el grupo de la anterior). Ahora
  `AuthProvider` lo borra cuando termina una sesión con usuario o cambia el usuario, y al abrir la app
  se purga el vencido. Entrar desde «sin sesión» lo conserva (quien se registra con un enlace).
- **C13 (baja), corregido con TDD:** los tokens locales de enlaces que ya no sirven se borran al cargar
  la lista de invitar.
- **C14 (baja), corregido con TDD:** el aviso de «Quitar acceso» dice que habrá que crear enlaces nuevos.
- Descartados con motivo: I8 a I12, C15 a C17 (en el informe).
- No se pudo usar el grafo de código (el servidor MCP no conectó): se leyó el código real.

## Tarea 2 — Concurrencia real del último uso

- **Script:** `scripts/test-concurrencia.mjs` (`npm run test:concurrencia`). Abre una conexión por
  cuenta, cada una con su transacción y su sesión (`request.jwt.claims` + `set local role authenticated`),
  y llama a la vez a las RPC reales. Cuatro escenarios, 25 rondas cada uno por omisión, en grupos y
  cuentas nuevos:
  1. **Última plaza** (enlace de 1 uso, dos cuentas): exactamente una entra y la otra recibe `SMINV`;
     `use_count = 1`.
  2. **Plaza para dos** (2 usos): entran las dos; `use_count = 2` (el bloqueo no rechaza de más).
  3. **La misma cuenta dos veces a la vez** (miembros nuevos distintos): las dos reciben el grupo, pero
     se gasta un solo uso y queda un solo acceso y un solo miembro vinculado.
  4. **Revocar contra aceptar:** cualquier orden vale, pero el resultado es coherente.
- **Seguridad del script:** se niega a conectarse a algo que no sea `127.0.0.1`/`localhost`; no imprime
  tokens (de los errores solo muestra el código).
- **CI:** nuevo paso en el job «Base de datos y RLS», después de pgTAP (deja cuentas y grupos de
  prueba): `setup-node`, `npm ci --ignore-scripts` y `npm run test:concurrencia`, contra el Postgres de
  `supabase db start` (puerto 54322, `postgres:postgres`). Nueva dependencia de desarrollo: `pg`
  (solo `package.json` y el lock; nada llega al teléfono).
- **Cómo se validó** (sin Docker ni la CLI de Supabase en esta máquina): con un Postgres 18 real
  embebido, instalado en una carpeta temporal fuera del repo, con `plataforma.sql` y las 15 migraciones.
  - Código real: 2 corridas de 50 rondas × 4 escenarios, sin diferencias.
  - **Prueba de mutación:** quitando el bloqueo del contador del grupo y el `FOR UPDATE`, y volviendo no
    atómico el reclamo del uso, el script falla en los escenarios 1, 2 y 3 (entran dos cuentas con una
    sola plaza; `23505` en la misma cuenta). O sea, la prueba detecta la carrera que debe detectar.
- **Pendiente:** ver el paso en el CI real (Postgres 17). Si falla por el entorno (no por las
  invitaciones), el script se queda y el paso del workflow se revierte; ver el cierre abajo.

## Tarea 3 — `log_parameter_max_length_on_error` en el remoto

`npx supabase@2.120.0 db query --linked "show log_parameter_max_length_on_error;"` → **`0`**. Solo
lectura; no se cambió nada. Postgres no registra los parámetros de una petición que falla, así que un
error de programación en `accept_invitation` no deja el token en los registros (hallazgo I5 cerrado en
`revision-seguridad.md`). La CLI abre, como en `db push --dry-run`, un rol temporal de inicio de
sesión para la consulta (aviso «Initialising login role…»).

## Tarea 4 — `guia-manana.md`

Guía para alguien que no lo ha hecho antes (Windows + PowerShell), con pasos numerados y qué debería verse:
A) Cloudflare Pages con `wrangler`; B) huellas SHA-256; C) `EXPO_PUBLIC_INVITE_HOST` en EAS; D) Brevo y
SMTP de Supabase; E) builds de Android y verificación del dominio con `adb`; F) tabla de 15 casos para dos
teléfonos, con el resultado esperado de cada uno. Cada comando lleva ✅ (verificado) o ⚠️ (no verificado).

Decisiones y cosas que conviene saber antes de leerla:

- **No hace falta comprar un dominio para los enlaces:** Cloudflare Pages da `<proyecto>.pages.dev` gratis
  y el plugin de Android lo acepta (probado con su misma validación). El dominio propio solo es
  imprescindible para **Brevo** (sus registros DNS). Elegí `pages.dev` como arranque; cambiar de dominio
  después exige otro build.
- **Posible problema con las huellas de `development`:** ese perfil de `eas.json` usa
  `withoutCredentials: true` y `assembleDebug`, así que `eas credentials` probablemente no muestra una firma
  para él. La guía lee la huella directamente del APK con `keytool -printcert -jarfile` (⚠️ no verificado
  que la firma de depuración sea siempre la misma). Si te estorba, la alternativa es probar los App Links
  solo con el build `preview`.
- **`env:set` o `env:create`:** la documentación actual muestra `eas env:set`, pero la CLI que baja `npx`
  hoy (16.17.4) solo tiene `env:create`. La guía lo explica y los argumentos son los mismos.
- Verificado con la documentación oficial de Cloudflare, Expo y Android (`pm get-app-links`,
  `pm verify-app-links --re-verify`); no se ejecutó nada contra Cloudflare, EAS ni teléfonos.
- El caso de «enlace agotado» (10 cuentas) y el de «vencido» (mínimo 1 día) son incómodos a mano; la guía
  lo dice y apunta a las pruebas automáticas.

## Tarea 5 — Borrador del push n.º 3 (retirar `sync_pull` v1)

En `design/fase-4b/borrador-push3/`, **fuera de `supabase/migrations/`** (no afecta al CI ni a ningún
push): la migración `20261020090000_retirar_sync_pull_v1.sql` (comprueba que existe `sync_pull_v2` y borra
la v1), el `010-sync-pull.test.sql` de reemplazo, y dos parches (`006-privilegios`, `check-data-api`).
README con la advertencia en mayúsculas, el criterio para aplicarlo, los pasos y cómo deshacerlo.
Probado en local copiando los archivos a `supabase/` y corriendo `npm run test:db:local`: **710 pruebas
en verde** (las 40 del 010 viejo pasan a 6 y las demás no cambian); después se revirtió todo. Lo que 010
probaba de la descarga lo cubre `014`. ⚠️ El código `PGRST202` que espera el parche de `check:data-api`
no está verificado contra el remoto.
