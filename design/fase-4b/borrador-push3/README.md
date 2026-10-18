# Borrador del `db push` n.º 3: retirar `sync_pull` (v1)

> # ⚠️ NO APLICAR HASTA QUE LOS TELÉFONOS DE PRUEBAS TENGAN EL BUILD NUEVO DE LA 4b ⚠️
>
> **ESTA MIGRACIÓN BORRA `sync_pull`. LA APP DE LA FASE 4a LLAMA A ESA FUNCIÓN: EN CUANTO SE APLIQUE, UN
> TELÉFONO CON LA APP VIEJA DEJA DE PODER DESCARGAR (NO SE PIERDEN SUS DATOS LOCALES, PERO NO SINCRONIZA).**
> **NO MOVER ESTOS ARCHIVOS A `supabase/migrations/` NI A `supabase/tests/` ANTES.** Mientras esté en esta
> carpeta no afecta al CI, a `supabase db push` ni a las pruebas.

Nada de esta carpeta está en uso: es solo el borrador, probado en local (PGlite, 710 pruebas pgTAP en verde
con los cambios aplicados) y revertido.

## Qué contiene

| Archivo | Para qué |
|---|---|
| `20261020090000_retirar_sync_pull_v1.sql` | La migración: comprueba que existe `sync_pull_v2` y hace `drop function public.sync_pull(jsonb, integer)` (los privilegios se van con la función). El nombre usa una fecha posterior a la de `invitaciones` (`20261019090000`); si el push se hace más tarde, cámbiale la fecha a la del día. |
| `010-sync-pull.test.sql` | Reemplaza al `010` de la 4a (40 pruebas de la descarga v1): 6 pruebas de que v1 ya no existe (`42883` para `authenticated` y `anon`) y de que v2 sigue. Lo que 010 probaba de la descarga lo cubre `014-sync-pull-v2` (68 pruebas: grupos por cuenta, ajenos, borrados, cursores, páginas, límites, `lost`, anon). |
| `006-privilegios.patch` | Quita `sync_pull(jsonb,integer)` de la lista de funciones que `authenticated` ejecuta. |
| `check-data-api.patch` | `npm run check:data-api` pasa a comprobar que `sync_pull` ya no existe (PostgREST responde 404 con `PGRST202`; ⚠️ ese código exacto no está verificado contra el remoto: si el primer `check:data-api` falla justo en esas dos líneas, ajusta `missing`). |

`001-estructura` no menciona `sync_pull`, y el cliente de la 4b no la usa (`src/db/sync/remote.ts` solo
llama a `sync_pull_v2`).

## Cuándo se puede aplicar

Todas, sin excepción:

1. El build nuevo de la 4b (development o preview) está instalado en **los dos** teléfonos de prueba (S24 y
   Poco) y cada uno sincroniza bien (la hoja de sincronización dice «Sincronizado»).
2. La prueba con dos cuentas de `guia-manana.md` (sección F) pasó.
3. No queda ningún otro dispositivo con la app de la 4a que quieras seguir usando.
4. Tu aprobación explícita después del `--dry-run`.

## Pasos (cuando se cumplan)

1. Mover los archivos y aplicar los cambios:

   ```powershell
   Copy-Item design\fase-4b\borrador-push3\20261020090000_retirar_sync_pull_v1.sql supabase\migrations\
   Copy-Item design\fase-4b\borrador-push3\010-sync-pull.test.sql supabase\tests\database\010-sync-pull.test.sql
   git apply design\fase-4b\borrador-push3\006-privilegios.patch
   git apply design\fase-4b\borrador-push3\check-data-api.patch
   ```

2. Probar en local y en el CI: `npm run test:db:local` (esperado: **710 pruebas en verde** si el resto de la
   rama no cambió; el número cambia si se añaden pruebas), `npx tsc --noEmit`, `npm run lint`,
   `npm test -- --watchAll=false`.
3. Commit, push de la rama y CI en verde.
4. `npx supabase@2.120.0 db push --dry-run`: debe listar **solo** `20261020090000_retirar_sync_pull_v1.sql`.
5. Con tu aprobación: `npx supabase@2.120.0 db push`.
6. `npm run check:data-api` (cuenta de prueba; la contraseña por variable de entorno).
7. Abrir la app en los dos teléfonos y sincronizar: debe seguir funcionando.

## Cómo deshacerlo

Una migración nueva que vuelva a crear `sync_pull`: copiar la definición de
`supabase/migrations/20261016100000_sync_pull.sql` y los `revoke`/`grant` del final. No se edita la
migración aplicada. Solo hace falta si aparece un teléfono con la app vieja que no se puede actualizar.
