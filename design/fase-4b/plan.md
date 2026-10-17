# Fase 4b — Plan

Diseño: `diseno.md`. Avance: `progreso.md`.

**Orden:** de más riesgo a menos, sin romper dependencias. Primero el servidor, que define la
seguridad y el protocolo. Después el cliente. Al final lo pequeño. Cada paso termina con sus pruebas
en verde, un commit en español y `progreso.md` al día.

**Puntos de aprobación:** 🔒 marca un paso que termina en `supabase db push`. Antes de cada push te
muestro las migraciones y la salida de pgTAP, y espero tu aprobación. Después de cada push corre
`npm run check:data-api`. Ningún otro paso toca el remoto.

**Archivos:** las rutas de `supabase/`, `src/db/` y `src/ui/` siguen la estructura de CLAUDE.md. Las
exactas se confirman al empezar cada paso leyendo el código; en esta etapa no se leyó.

**En todos los pasos:**

- `npx tsc --noEmit`, `npm run lint` y `npm test -- --watchAll=false` antes del commit;
- `supabase test db` en los pasos de servidor;
- cero textos fijos (`es` y `en`);
- zod en cada frontera;
- montos en enteros.

## Tareas tuyas, en paralelo

| Cuándo            | Qué                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| Antes del paso 4  | Cambiar la contraseña de `prueba1@splitmate.test` y dármela solo por la variable de entorno de `check:data-api` |
| Antes del paso 10 | Comprar `<dominio>` en Cloudflare y pasarme el nombre (sección c del diseño)                                    |
| Antes del paso 13 | Brevo y el SMTP de Supabase (diseño, c, pasos 2 a 9)                                                            |
| En el paso 10     | Cloudflare Pages con `web/links`                                                                                |
| En el paso 13     | Las dos pruebas manuales de la Fase 3                                                                           |

## Servidor

### Paso 1 — Acceso por membresía

- **Migración** `<fecha>_acceso_membresia.sql`:
  - la tabla `group_access`, con el trigger de columnas, `change_seq`, RLS y `GRANT SELECT` a
    `authenticated`;
  - el relleno;
  - `can_access_group` nueva y `private.group_has_access_rows`;
  - la política de `groups`;
  - el trigger del dueño;
  - las reglas nuevas de `sync_push` (borrar el grupo solo el dueño, `member_linked`, la propia
    desvinculación);
  - `leave_group` y `remove_access`, con su `revoke` y `grant`;
  - el trigger de `profiles` para grupos compartidos.
- **pgTAP:**
  - `012-acceso` (ver la lista de `diseno.md`);
  - ajustes a `007`, `008` y `011`;
  - `001-estructura` y `006-privilegios` con la tabla y las funciones nuevas.
- **Jest:** las pruebas del motor contra PGlite pasan sin cambios, porque la app de la 4a sigue
  funcionando con la migración nueva.
- **Hecho cuando** un creador expulsado no ve nada del grupo y todo lo de la 4a sigue en verde.

### Paso 2 — `sync_pull_v2`

- **Migración** `<fecha>_sync_pull_v2.sql`:
  - páginas dentro del grupo con `hw` y `after`;
  - el tope de 100 a 2000 filas;
  - `lost`;
  - `group_access` en el orden de tablas;
  - cursores enteros u objeto;
  - el `revoke` y el `grant`.
    `sync_pull` (v1) no se toca.
- **pgTAP:**
  - `014-sync-pull-v2`;
  - ajuste a `010` (v1 igual y sin `group_access`);
  - `001` y `006`.
- **Hecho cuando** un grupo de 2500 filas baja en tres páginas con `p_max_rows = 1000` y una fila
  editada entre páginas llega en la ronda siguiente.

### Paso 3 — Cupos en `sync_push`

- **Migración** `<fecha>_cupos.sql`: los cupos de la tabla del diseño, que responden
  `rejected: quota`.
- **pgTAP:** `015-cupos`, con el tope exacto y uno más para cada cupo.
- **Hecho cuando** cada cupo rechaza justo en su límite. Se mide el tiempo del conteo con 20 000
  movimientos y, si pasa de 50 ms, se cambia a contadores.

### Paso 4 — 🔒 `db push` n.º 1 (pasos 1 a 3)

- Te muestro el diff de las tres migraciones y la salida de `supabase test db`. Espero tu aprobación.
- `supabase db push`.
- `check:data-api` con los casos nuevos:
  - `anon` sin `group_access` ni RPC nuevas;
  - `authenticated` lee `group_access` y no le escribe;
  - `sync_pull_v2` responde 200.
- En el teléfono, la app de la 4a sigue sincronizando (abrir, crear un gasto y ver «sincronizado»).

### Paso 5 — Invitaciones

- **Migración** `<fecha>_invitaciones.sql`:
  - `private.group_invitations` y `private.rate_events`;
  - las cinco RPC con sus errores `SM*`, los topes y `change_log`;
  - el `revoke` y el `grant` de cada una.
- **pgTAP:**
  - `013-invitaciones`, incluidas dos sesiones que aceptan el último uso a la vez;
  - `001` y `006`.
- **`check:data-api`:**
  - `anon` no ejecuta las RPC;
  - un token inventado con `prueba1` devuelve `{ error: "SMINV" }`. Gasta 1 de los 10 intentos por
    hora; el script lo dice.

### Paso 6 — 🔒 `db push` n.º 2 (paso 5)

Igual que el paso 4: diff, pgTAP, tu aprobación, push y `check:data-api`.

## Cliente

### Paso 7 — Base local 0005

- **Migración** `--custom` con su SQL dentro (regla de CLAUDE.md; módulo `.sql` vía
  `scripts/sql-module.js`):
  - `group_access`;
  - `groups.access_lost_at`;
  - `invitation_links`;
  - `sync_pull_pages`;
  - el soporte para filas remotas en `users`.
- Esquema Drizzle y tipos.
- **Jest:**
  - la migración sobre una base de la 4a con datos;
  - las filas remotas en `users` respetan las FK;
  - nada se marca como pendiente.

### Paso 8 — Motor con `sync_pull_v2` (TDD)

- **Transporte:** `sync_pull_v2`.
- **zod** de la respuesta con topes (C5): filas, grupos, textos y `next`.
- **Páginas parciales** a `sync_pull_pages`. Al terminar, la ronda desde `hw` y la aplicación en una
  transacción.
- **`lost`:** pone `access_lost_at`, saca del envío lo pendiente de ese grupo y lo cuenta aparte.
- **C4:** el `group_id` y el `expense_id` de una fila no pueden cambiar.
- **`group_access`:** se aplica como fila de solo bajada.
- **Pruebas, primero en rojo, contra PGlite con tres cuentas:** cada caso de «Motor con TDD» del
  diseño. Las de la 4a siguen en verde.

### Paso 9 — Permisos y acceso perdido en pantallas

- **Repositorios y servicios:** `leaveGroup` y `removeAccess`, que llaman a las RPC y después piden
  un ciclo. La UI no permite borrar un miembro vinculado con acceso.
- **Pantallas:**
  - en Miembros, las marcas «tú», «tiene cuenta» y «dueño», **Quitar acceso** y **Salir del grupo**;
  - **Borrar grupo**, solo para el dueño;
  - el aviso de acceso perdido, con **Quitar de este teléfono** y la vista de solo lectura;
  - el conteo aparte en la hoja de sincronización;
  - el texto nuevo de borrar la cuenta.
- **RNTL** de cada estado, en `es` y `en`.

### Paso 10 — Enlaces de entrada

- `<dominio>` como constante pública. En `app.json`, el `intentFilter` con `autoVerify` para
  `https://<dominio>/i`.
- `app/+native-intent.tsx`: el esquema zod del enlace y el paso a `/invite`. Los enlaces de Auth de la
  Fase 3 siguen pasando.
- El token pendiente en `expo-secure-store`, con vencimiento de 1 hora y consumo después de entrar.
- **`web/links/`:**
  - `index.html` de `/i`;
  - `_headers` con CSP y `no-referrer`;
  - `.well-known/assetlinks.json` con las huellas de `eas credentials` de development y preview.
- **Jest:** las URL del diseño (válida, larga, mal codificada, otro host, Auth) y el token pendiente.
- **Tú:** Cloudflare Pages (diseño, c).

### Paso 11 — Invitar y unirse

- **Servicio** `src/features/invitations/`: `createInvitation`, `previewInvitation`,
  `acceptInvitation`, `revokeInvitation` y `listInvitations`, con zod en cada respuesta y los
  errores `SM*` traducidos.
- **Pantallas:**
  - **Invitar**: duración y hoja de compartir, sin conexión con su aviso;
  - la lista de enlaces con **Revocar** y **Compartir de nuevo** (`invitation_links`);
  - **Unirme con un enlace** (pegar);
  - `/invite`: vista previa, «¿Quién eres?», **Soy alguien nuevo**, aceptar, cursor en 0 y un ciclo.
- **RNTL:** cada camino y cada error.

### Paso 12 — Doble toque a 300 ms

- Una constante compartida en `src/ui` para `Button` e `IconButton`.
- **Jest** con temporizadores falsos: a los 299 ms se ignora y a los 300 ms se acepta, en los dos
  componentes. Se actualizan las pruebas de 500 ms.

## Cierre

### Paso 13 — Verificación, revisión y builds

- **SMTP:** con tus pasos de Brevo terminados, `EMAIL_HAS_CODE = true` y su prueba.
- **Verificación:** `npx tsc --noEmit`, `npm run lint`, `npm test -- --watchAll=false`,
  `supabase test db` y `npm run check:bundle`, con la salida a la vista.
- **Revisión de seguridad:** `detect_changes` y la skill security-code-review. El informe va en
  `design/fase-4b/revision-seguridad.md` y se corrige lo que salga.
- **Builds:** `eas build` de development y preview para Android (el `intentFilter` es nativo).
- **En el teléfono:** la lista de «En el teléfono, al cierre» del diseño, más las dos pruebas manuales
  de la Fase 3. `adb shell pm get-app-links` confirma que el dominio quedó verificado.

### Paso 14 — 🔒 `db push` n.º 3: retiro de `sync_pull` v1

- Solo cuando los dos teléfonos tengan el build de la 4b.
- **Migración** `<fecha>_retirar_sync_pull_v1.sql` y sus pruebas: `010` pasa a probar que v1 ya no
  existe, más `006`.
- Tu aprobación, push y `check:data-api`.

### Paso 15 — Documentación y PR

- CLAUDE.md: «Estado» y «Pendientes técnicos» (Realtime pasa a la 4c, S3 y C4/C5 cerrados, el acceso
  del creador resuelto).
- El PR en español. El merge, cuando confirmes la prueba en el teléfono y el CI esté en verde.
