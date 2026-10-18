# Fase 4b — Progreso

- [x] 0. Diseño y plan (`diseno.md`, `plan.md`): escritos y aprobados con ajustes (2026-10-17)
- [x] 1. Acceso por membresía (servidor): migración `20261018090000_acceso_membresia.sql`, pruebas `012-acceso` (81)
- [x] 2. `sync_pull_v2`: migración `20261018100000_sync_pull_v2.sql`, pruebas `014-sync-pull-v2` (68)
- [x] 3. Cupos en `sync_push`: migración `20261018110000_cupos.sql`, pruebas `015-cupos` (37)
- [x] 4a. `check:data-api` con los casos nuevos (commit d99235b)
- [ ] 4. 🔒 `db push` n.º 1: **aplicado el 2026-10-18** (commit de la rama `d99235b`); **verificado en teléfono y con `check:data-api` el 2026-10-18** (reporte del usuario). Remoto: 2 grupos activos, 2 filas de `group_access`, un dueño por grupo y el grupo nuevo es de su creador (usuario +splitmate)
- [x] 5. Invitaciones (servidor): migración `20261019090000_invitaciones.sql`, pruebas `013-invitaciones` (159), revisión de seguridad hecha (`revision-seguridad.md`), dry-run limpio (solo esa migración)
- [ ] 6. 🔒 `db push` n.º 2: **pendiente de aprobación del usuario** (no se ejecuta de noche; el dry-run lista solo `20261019090000_invitaciones.sql`)
- [x] 7. Base local 0005: `0005_acceso_e_invitaciones.sql` (generada por drizzle-kit, con SQL; sin `--custom`), `users.is_remote`, `groups.access_lost_at`, `group_access`, `invitation_links`, `sync_pull_pages` y las columnas de descarga en curso de `sync_cursors`; pruebas `migration-0005`
- [x] 8. Motor con `sync_pull_v2`: wire estricto ampliado (`member_linked`, `quota`, `group_access`, `partial`/`next`/`lost`), topes de C5 en `remote.pull`, páginas parciales en `sync_pull_pages` con ronda extra desde `hw`, `lost`, C4, usuarios remotos, cuenta borrada (`created_by` nulo); pruebas `pull-v2`, `outbox` y `compartir.int` (tres cuentas contra PGlite)
- [x] 9. Permisos y acceso perdido en pantallas: `repos.access`, grupos sin acceso de solo lectura (`GROUP_ACCESS_LOST`), `MEMBER_LINKED`, servicio `src/features/access` (salir y quitar acceso, con el código `SMLST`/`42501` del servidor), marcas «tú / con cuenta / dueño», Quitar acceso, Salir del grupo, Borrar grupo, aviso y «Quitar de este teléfono», conteo aparte en la hoja de sincronización, textos de `member_linked` y `quota`, texto de borrar la cuenta; RNTL en es y en
- [x] 10. Enlaces de entrada y página de respaldo: `src/features/invitations` (`INVITE_HOST` con marcador `<dominio>`, validación zod/regex de `https://<dominio>/i#<token>` y `splitmate://i#<token>`, token pendiente en memoria y `expo-secure-store` con vencimiento de 1 hora), `app/+native-intent.tsx`, plugin `plugins/with-invite-links.js` (App Link con `autoVerify` solo si `EXPO_PUBLIC_INVITE_HOST` es un dominio), `web/links/` (página estática, `_headers`, `assetlinks.json` con marcadores de huella; sin desplegar). La ruta `/invite` y el montaje de `PendingInviteRedirect` llegan con el paso 11
- [x] 11. Invitar y unirse: servicio `invitation-service` (zod en cada respuesta, errores `SM*` traducidos, sin token en errores), `repos.invitationLinks` (token guardado solo en la base cifrada del teléfono que creó el enlace), pantallas Invitar (`/groups/[id]/invite`: duración 1/7/30 días, hoja de compartir, lista con Revocar y Compartir de nuevo, sin conexión), Unirme con un enlace (`/join`) y `/invite` (vista previa, «¿Quién eres?», «Soy alguien nuevo», cursor del grupo en 0 y un ciclo); `PendingInviteRedirect` montado en el layout; pruebas RNTL en es y en y contra PGlite
- [ ] 12. Doble toque a 300 ms
- [ ] 13. Verificación, revisión de seguridad y builds
- [ ] 14. 🔒 `db push` n.º 3: retiro de `sync_pull` v1
- [ ] 15. Documentación y PR

**Siguiente paso (noche del 18 al 19):** bloque B, paso 12 (doble toque a 300 ms). El push n.º 2 espera tu aprobación. Antes: paso 5, invitaciones (servidor): pgTAP `013-invitaciones` primero, con las condiciones de seguridad de `plan.md` (uso atómico, mismo `SMINV`, vista previa mínima y con límite, token fuera de los registros). Esperar el «sí» tras el dry-run de las tres migraciones (nuevos: `20261018090000`, `20261018100000`, `20261018110000`). Antes del `check:data-api` hacen falta los usuarios de prueba con correo real (tarea del usuario).

**Notas del paso 3:**

- Cupos: groups 200 (acceso activo de la cuenta; salir libera), members 200 y categories 100 por grupo (borrados incluidos), movements 20 000 por grupo (gastos + transferencias, borrados incluidos). Las categorías cuentan también las borradas: el diseño no lo decía y se eligió lo más estricto contra el abuso.
- La respuesta es `{ status: 'rejected', reason: 'quota', quota: 'groups'|'members'|'categories'|'movements', current: [] }`.
- Medición: el conteo de movimientos con 20 000 filas tarda ~10 ms de mediana (máx. 19 ms) en PGlite, más lento que Postgres nativo; no hace falta pasar a contadores.
- Los cupos de la aceptación de una invitación (50 cuentas por grupo, 200 grupos por cuenta) se revisan en `accept_invitation` (paso 5).

**Notas del paso 2:**

- Respuesta de `sync_pull_v2`: `{ groups: [{ id, cursor, partial, next, rows }], has_more, lost }`. `cursor` es nulo en una página parcial; `next` es el cursor objeto `{ seq, hw, after: { t, id } }` (t: 1 groups, 2 group_access, 3 group_members, 4 categories, 5 expenses, 6 expense_payers, 7 expense_splits, 8 transfers).
- Un grupo en curso o que no cabe sale solo; el cliente debe mandar siempre los cursores de todos los grupos que tiene (si omite alguno, esa llamada lo descarga desde 0 y le quita el turno al grupo grande).
- Cursores repetidos con otra capitalización dan 22023. `010` ganó una prueba (v1 no devuelve `group_access`); `006` suma la RPC.

**Notas del paso 1:**

- Nombre: ya existía `012-revision-seguridad`; la prueba nueva se llama `012-acceso` como en el plan (ambas corren con `-- 012`).
- Ajustes a pruebas existentes: `000-setup` (Beto, miembro de viaje, tiene acceso en `crear_mundo`), `001`, `006` (tabla y funciones nuevas; sin `is_group_creator`), `002` y `005` (un ex miembro es quien perdió su `group_access`), `009` y `011` (el historial suma 3 entradas de la salida de Ana al borrar su cuenta). `007`, `008`, `010` y `012-revision-seguridad` pasan sin tocarse: la descarga vieja no cambió.
- Decisiones: `leave_group` y `remove_access` escriben `change_log` directo (record_change exige acceso de quien llama); la cascada de borrar la cuenta borra la fila de acceso ya marcada (el cliente de la 4b debe tolerar una fila de acceso que desaparece); `shares_group_with` ahora usa `group_access`; sin creador, el dueño del relleno es la cuenta vinculada más antigua.
- Jest completo (1126), `tsc` y `lint` en verde.
