# Fase 4a — Progreso

> Se actualiza con el commit de cada paso. Si una sesión se corta, se retoma desde
> "Siguiente paso". Tareas en `plan.md`; decisiones en `diseno.md`. El usuario pide detenerse cada
> 2 pasos.

**Siguiente paso:** paso 3, servidor: `sync_push` con concurrencia estricta, límites e historial
(pruebas primero en `008-sync-push` y `009-historial`).

## Pasos

- [x] Diseño y plan aprobados el 2026-10-14, con siete ajustes ya incorporados: borradores en vez
      de borrar datos, concurrencia optimista estricta, historial `change_log`, cerrar sesión con
      "Sincronizar primero", descarga incremental, límites validados en el servidor y el pendiente
      del acceso del creador para la 4b (también en CLAUDE.md).
- [x] 1. Parches de Expo y perfil preview de EAS:
  - `npx expo install --fix`: expo 57.0.28, expo-crypto 57.0.4, expo-dev-client 57.0.20,
    expo-router 57.0.26, expo-splash-screen 57.0.10 y jest-expo 57.0.6. expo-doctor 21/21.
    `npm audit --omit=dev` sin cambios: 68 avisos de los mismos seis paquetes aceptados.
  - Perfil `preview` con `environment: preview`. `EXPO_PUBLIC_SUPABASE_URL` y
    `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` creadas en el entorno `preview` de EAS como sensibles
    (`eas env:set`), comparadas con `.env` sin mostrarlas: iguales.
  - Keystore: eas-cli 24.12.1 lo genera al azar y lo guarda en EAS sin preguntar en modo no
    interactivo (`CreateKeystore.provideOrGenerateAsync`). Lo crea el primer build de preview, al
    cierre; no hace falta que el usuario corra nada antes.
  - `flujo-grupo.test.tsx` pasaba el límite de 20 s con todas las suites en paralelo. No es por los
    parches: con `main` en una copia fuera de OneDrive tardó 15,2 s y en la rama 14,6 s. Ese archivo
    usa `jest.setTimeout(60_000)`. tsc, lint y 676 pruebas en verde.
- [x] 2. Servidor: migración base `20261014093549_sincronizacion_base.sql`:
  - columnas del servidor (`created_at`, `updated_at`, `version`, `deleted_at`, `archived_at`) y
    `change_seq` por grupo con `private.group_changes` y `private.next_change_seq`;
  - guardia: sin la marca de `sync_push`, `authenticated` no escribe en las 7 tablas de grupo;
  - reglas: moneda bloqueada (`SMCUR`), `group_currency` en gastos y transferencias (`SMGCC`) y
    "soy yo" solo con la cuenta propia;
  - RLS con `private.can_access_group` (creador o miembro vinculado); `owner` solo lo agrega el
    creador; sale `can_bootstrap_group`;
  - privilegios: `authenticated` sin `UPDATE` de `updated_at` ni `version`, con `user_id` y
    `group_currency`, y en pagadores y partes solo `deleted_at`; `service_role` sin privilegios en
    `public`, igual que el remoto.

  Banco local `npm run test:db:local` (PGlite 0.5.8 y pgTAP 0.0.9, con
  `supabase/pglite/plataforma.sql`): 178 pruebas en verde, antes 128. `007-sync-columnas`
  es nuevo (46) y `000` a `006` se ajustaron a las reglas nuevas. 12 mutaciones de la migración
  detectadas (guardia, `version`, fechas, moneda, `group_currency`, "soy yo", acceso del creador,
  `owner`, `change_seq`, `service_role` y columnas editables).

- [ ] 3. Servidor: `sync_push` con concurrencia estricta, límites e historial.
- [ ] 4. Servidor: `sync_pull` incremental, borrar la cuenta borra sus grupos no compartidos y
      `check:data-api` ampliado.
- [ ] Punto de control: permiso para `supabase db push` y `check:data-api` contra el remoto.
- [ ] 5. Base local: columnas y tablas de sincronización (migración 0004).
- [ ] 6. Banco de pruebas con PGlite y cliente remoto.
- [ ] 7. Motor, parte 1 (TDD): envío y borradores de conflicto.
- [ ] 8. Motor, parte 2 (TDD): descarga y conflictos entre dos dispositivos.
- [ ] 9. Motor, parte 3 (TDD): cuándo sincronizar y estado.
- [ ] 10. Pantallas: indicador, avisos, sesión y reinicio de la base.
- [ ] 11. Pantallas: borradores por revisar.
- [ ] 12. Cierre: verificaciones, revisión de seguridad, CLAUDE.md, PR, builds y prueba en el
      teléfono.

## Notas para retomar

- Rama `fase-4a-sincronizacion`, creada desde `main` en `5217e74` (merge del PR #4).
- expo-doctor marcó 6 parches el 2026-10-14 (lista en el paso 1 de `plan.md`).
- PGlite: 0.5.8 (del 2026-08-26, el mismo de la Fase 3). La 0.5.9 salió el 2026-10-12 y no se usa
  todavía. `@electric-sql/pglite` trae build CommonJS (`require`), así que puede cargarse en Jest.
- `expo-network` 57.0.2 es la versión del SDK 57 (del 2026-09-11).
- El remoto tiene 2 perfiles y 0 grupos: los rellenos de las migraciones no tocan datos reales.
- El formulario de movimientos ya tiene `valuesFromExpense` y `valuesFromTransfer`: el paso 11 los
  usa para abrir un borrador.
- La app acepta montos hasta `Number.MAX_SAFE_INTEGER` y el servidor hasta 99 999 999 999 999: el
  paso 5 alinea la app con el servidor.
- `eas env:list` oculta los valores sensibles (`***** (...)`): para comparar con `.env` sin
  mostrarlos, `--include-sensitive` y la comparación dentro del mismo comando.
- pgTAP en la PC: `npm run test:db:local` (unos 3 s) o `npm run test:db:local -- 007` para un
  archivo (000-setup corre siempre). El CI sigue siendo la fuente de verdad.
- En las pruebas, para preparar fechas o versiones viejas hay que apagar el trigger
  `<tabla>_sync_stamp` como `postgres` (`alter table ... disable trigger`), porque el trigger
  también corre para `postgres`.
- `has_column_privilege` sobre una columna que no está en todas las tablas va dentro de un `CASE`:
  el orden del `WHERE` no está fijo (pasó con `deleted_at` y `auth.users`).
- `EXECUTE` para `PUBLIC` en funciones nuevas no se quita por esquema: cada función lo revoca.
- `supabase test db` corre como prueba todo `.sql` bajo `supabase/tests`: los archivos de apoyo
  van fuera (`supabase/pglite/plataforma.sql`). El primer CI del paso 2 (run 38544389269) falló por
  eso, con las 178 pruebas pgTAP en verde sobre Postgres 17.
