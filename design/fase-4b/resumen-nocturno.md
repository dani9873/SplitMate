# Fase 4b — Resumen de la ejecución nocturna (2026-10-18 al 19)

Rama `fase-4b-invitaciones`, 10 commits sobre `9975eca`. **No se hizo ningún `db push`**, ninguna
escritura en Supabase remoto, ningún build, ninguna instalación en teléfonos y no se usaron contraseñas
ni correos de prueba. `main` no se tocó; no se abrió PR ni se borró ninguna rama.

## Estado en una línea

Servidor de invitaciones y todo el cliente de la 4b (pasos 5 a 12) están hechos, probados y subidos a
la rama. Lo único que bloquea probar en el teléfono es **tu aprobación del `db push` n.º 2**, el
dominio/huella de los enlaces, Brevo y los builds.

## Verificación (evidencia de cierre)

| Qué | Resultado |
|---|---|
| `npx tsc --noEmit` | sin errores |
| `npm run lint` | sin avisos |
| `npm test -- --watchAll=false` | 123 suites, **1548 pruebas** en verde |
| pgTAP local (`npm run test:db:local`) | **744 pruebas** en verde (013-invitaciones: 159) |
| `npm run check:bundle` | OK |
| CI del bloque A (commit `fca269d`) | verde, incluida «Base de datos y RLS» en Postgres 17 |
| CI del bloque B (commit `58add3a`, el último de la noche) | **verde**: «Tipos, lint y pruebas» y «Base de datos y RLS» |
| `supabase db push --dry-run` (solo lectura) | «Would push these migrations: `20261019090000_invitaciones.sql`». Solo esa. |

## Qué se hizo por paso

### Bloque A — Servidor (paso 5)

- **Migración `20261019090000_invitaciones.sql`** y pruebas `013-invitaciones`:
  - `private.group_invitations` (solo el SHA-256 del token, con CHECK de vida 1 h a 30 d, 1 a 50 usos) y
    `private.rate_events`, ambas con RLS y sin privilegios para nadie;
  - cinco RPC `SECURITY DEFINER` con `search_path` vacío: `create_invitation`, `preview_invitation`,
    `accept_invitation`, `revoke_invitation` y `list_invitations`; `anon` no ejecuta ninguna;
  - `group_access.invitation_id` con FK a la invitación (`ON DELETE SET NULL`).
- **Condiciones de seguridad:** uso atómico (`private.claim_invitation_use`: un solo `UPDATE ... WHERE
  use_count < max_uses`, con bloqueo del contador del grupo y de la invitación en el mismo orden que
  `leave_group`); mismo `{"error":"SMINV"}` para inexistente, mal formado, nulo, enorme, vencido,
  revocado, agotado y de grupo borrado; vista previa solo con sesión y con el mínimo de datos; 10
  intentos fallidos por hora (`SMRLT`), 20 enlaces por día, 20 activos por grupo, 50 cuentas por grupo,
  200 grupos por cuenta y 200 miembros; el token no sale de la respuesta de `create_invitation`.
- **`check:data-api`** ampliado (anon sin las RPC; token inventado da `SMINV`; `private` no expuesto).
- **Revisión de seguridad** (`revision-seguridad.md`): sin hallazgos críticos ni altos. Un medio, **I1**
  (un expulsado volvía a entrar con otro enlace vigente que conociera), corregido con TDD: `remove_access`
  revoca todos los enlaces vigentes del grupo, y salir revoca los de quien sale.
- `supabase db push --dry-run`: ver arriba.

### Bloque B — Cliente (pasos 7 a 12)

7. **Base local 0005** (`0005_acceso_e_invitaciones.sql`, generada por drizzle-kit, con SQL): `group_access`,
   `groups.access_lost_at`, `users.is_remote`, `invitation_links`, `sync_pull_pages`, columnas de descarga en
   curso en `sync_cursors` y `sync_conflicts` reconstruida para aceptar `member_linked` y `quota`.
8. **Motor con `sync_pull_v2`:** wire estricto ampliado, topes de C5, descarga por páginas con ronda
   extra desde `hw`, `lost`, C4, usuarios remotos y cuenta borrada (`created_by` nulo). Pruebas
   `pull-v2`, `outbox` y `compartir.int` (tres cuentas contra PGlite con las migraciones reales).
9. **Permisos y acceso perdido en pantallas:** `repos.access`, grupo sin acceso de solo lectura, marcas
   «tú / con cuenta / dueño», Quitar acceso, Salir del grupo, Borrar grupo (dueño), aviso con «Quitar de
   este teléfono», conteo aparte en la hoja de sincronización, textos de `member_linked` y `quota`.
10. **Enlaces de entrada:** `INVITE_HOST` con marcador `<dominio>`, validación de `https://<dominio>/i#<token>`
    y `splitmate://i#<token>`, `+native-intent`, token pendiente en memoria y `expo-secure-store` (1 hora),
    plugin de Android con App Link `autoVerify` y `web/links/` (sin desplegar).
11. **Invitar y unirse:** servicio con zod en cada respuesta, pantallas Invitar, Unirme con un enlace y
    `/invite` (vista previa, «¿Quién eres?», «Soy alguien nuevo»).
12. **Doble toque a 300 ms:** una sola constante (`DEFAULT_PRESS_COOLDOWN_MS`), pruebas a 299 y 300 ms.

## Decisiones que tomé (por si quieres cambiarlas)

1. **Errores de negocio como respuesta, no como excepción.** Todas las RPC de invitaciones devuelven
   `{ "error": "SM…" }` con estado 200 (también `create_invitation` para sus topes); solo los errores de
   programación o de permiso se lanzan. Así los intentos fallidos se confirman y el tope sirve.
2. **Expulsar revoca todos los enlaces vigentes del grupo** (hallazgo I1), no solo los del expulsado.
   El dueño crea uno nuevo para quien sí quiera. Salir por voluntad propia revoca solo los de quien sale.
3. **Dependencia de `pgcrypto`** (`gen_random_bytes`). Ya está en Supabase; el arnés de PGlite lo carga ahora.
4. **El token pendiente se limpia** al unirse, al cerrar la pantalla y ante un error que no mejora (enlace
   inválido, límite, grupo lleno); se conserva ante un fallo de red.
5. **Sin dominio, el enlace para compartir es `splitmate://i#<token>`** (funciona solo con la app instalada);
   con `EXPO_PUBLIC_INVITE_HOST` válido pasa a `https://<dominio>/i#<token>`. El App Link no se agrega al
   manifiesto mientras la variable no sea un dominio, para no romper el build.
6. **`created_by` nulo** (la creadora borró su cuenta) se guarda con un usuario remoto fijo.
7. **Un grupo con `lost` deja de pedirse** y, si el servidor lo vuelve a mandar, se levanta el aviso y lo
   pendiente (incluidos los envíos apartados por falta de acceso) vuelve a la cola.
8. **Un grupo nuevo rechazado por cupo** se quita de la vista y de la cola junto con lo que colgaba de él.
9. **Tope de 150 páginas guardadas** por grupo en una descarga (hallazgo C7).
10. **El texto de «Unirme con un enlace» acepta un mensaje entero** con el enlace dentro (WhatsApp).
11. **Quitar de este teléfono** avisa cuántos cambios sin subir se pierden con la copia.

## Lo que falló o quedó incompleto

- **Falla intermitente del CI de 4a, corregida:** `flujo-sincronizacion` tocaba «Sincronizar ahora» dos veces
  y el botón desaparecía mientras sincronizaba; ahora el segundo toque espera a que vuelva (`fca269d`).
- **No probado en un teléfono ni con dos cuentas reales:** todo lo del remoto se probó con PGlite y
  servidores simulados. En especial falta ver en Android el App Link verificado, la hoja de compartir y el
  flujo de registrarse con un enlace pendiente.
- **Concurrencia real de dos sesiones** (último uso del enlace): pgTAP y PGlite tienen una sola conexión.
  La garantía es el bloqueo + `FOR UPDATE` + `UPDATE` condicionado, probados como secuencia.
- **Realtime, historial de `change_log` y Universal Links de iOS** siguen fuera de la 4b, como en el diseño.
- **Sin `INVITE_HOST` real:** `web/links/.well-known/assetlinks.json` lleva los marcadores
  `<SHA-256 de la firma de development (eas credentials)>` y `<…preview…>`; la prueba `web-links` acepta
  el marcador o una huella real.
- **Las filas de acceso que el servidor borra por cascada** (cuenta eliminada) quedan activas en los
  teléfonos de los demás (C9, aceptado: solo afecta a las marcas).

## Lo que te toca en la mañana (en este orden)

1. **Aprobar el `db push` n.º 2.** Es una sola migración: `supabase/migrations/20261019090000_invitaciones.sql`
   (dry-run de arriba). Antes de aprobar puedes leer su diff y la salida de pgTAP (`013`: 159 pruebas;
   total 744). Después del push: `npm run check:data-api` (cuenta de prueba con correo real, contraseña por
   variable de entorno; gasta 2 de los 10 intentos fallidos por hora) y reabrir el teléfono.
2. **Confirmar en el panel de Supabase** que `log_parameter_max_length_on_error` sigue en 0 (hallazgo I5).
3. **Definir el dominio y el hosting gratis** (Cloudflare Pages, proyecto `splitmate-links`, subida directa de
   `web/links`) y **darme el SHA-256 de la firma** de los keystores de development y preview
   (`eas credentials` → Android). Con eso reemplazo los dos marcadores de `assetlinks.json`.
4. **Variable de build:** `EXPO_PUBLIC_INVITE_HOST=<dominio>` en las variables de entorno de EAS
   (development y preview). Sin ella no se agrega el App Link.
5. **Configurar Brevo** (pasos 1 a 9 de la sección c del diseño) y avisarme para pasar `EMAIL_HAS_CODE` a
   `true` en el build del cierre.
6. **Builds** de development y preview para Android (`eas build`), y `adb shell pm get-app-links
   com.devdani.splitmate` para ver el dominio verificado.
7. **Pruebas en el teléfono con los dos usuarios de prueba** (S24 con la cuenta A, Poco con la B, correos
   reales): lista de «En el teléfono, al cierre» del diseño (compartir por WhatsApp, abrir como App Link,
   unirse eligiendo un miembro, gastos de los dos, revocar y probar otro, quitar acceso y volver, salir,
   página de respaldo en un navegador sin la app), más las dos pruebas manuales de la Fase 3.
8. Después, paso 13 (revisión de seguridad final con la skill), **`db push` n.º 3** (retirar `sync_pull` v1,
   solo cuando los dos teléfonos tengan el build de la 4b) y el PR.
