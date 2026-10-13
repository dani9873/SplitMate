# Privilegios perdidos en la Data API (2026-10-13)

## Síntoma

El panel mostraba "0 of 8 tables exposed". Por REST, con `prueba1@splitmate.test`, `anon` recibía
401 `42501` en las 8 tablas, como se espera, pero `authenticated` también: 403 `42501`
(`permission denied for table …`) en las 8. Sin esos privilegios la app no puede crear su perfil.
`supabase migration list --linked` mostraba las dos migraciones aplicadas.

## Evidencia

Consultas de solo lectura con `supabase db query --linked` (rol `postgres`, Postgres 17.11):

- **Los GRANT sí se ejecutaron.** En `extensions.pg_stat_statements` (estadísticas desde
  2026-10-11 01:25 UTC, sin entradas descartadas), cada GRANT de `authenticated` tiene
  `calls = 2`: el `db push` del 12 y el de la migración `20261013143100`, el 13.
- **Sin event triggers que revoquen.** `pg_event_trigger` solo tiene los de Supabase:
  `issue_graphql_placeholder`, `issue_pg_cron_access`, `issue_pg_graphql_access`,
  `issue_pg_net_access`, `pgrst_ddl_watch` y `pgrst_drop_watch`.
- **Un REVOKE posterior, generado por el panel.** `pg_stat_statements.stats_since` da el orden:

| UTC | Sentencia (rol `postgres`) |
|---|---|
| 2026-10-12 20:55:07 | Migraciones `esquema` y `seguridad` (`db push`): GRANT de `authenticated` |
| 2026-10-13 07:23:28.199 | `do $$ … for … in select … where c.oid in (8 OID) loop execute format('revoke all on table %I.%I from anon, authenticated, service_role', …)` |
| 2026-10-13 07:23:28.91 | Diez `alter default privileges for role postgres in schema public revoke …`: tablas, secuencias y funciones de `anon`, `authenticated` y `service_role`, más `execute on functions` de `public` |

Los 8 OID son exactamente `profiles`, `groups`, `group_members`, `categories`, `expenses`,
`expense_payers`, `expense_splits` y `transfers`. En la misma lista aparece, varias veces, la
consulta con la que el panel calcula qué tablas están expuestas
(`with table_privileges as (… anon_select …`).

## Causa

Una acción del panel de Data API a las 07:23:28 UTC del 2026-10-13 (01:23 hora local): coincide con
desactivar **Automatically expose new tables**. Esa opción cambia los privilegios por omisión de
`postgres` en `public` (los `alter default privileges`). En la misma acción, el panel ejecutó
`revoke all … from anon, authenticated, service_role` en las 8 tablas que entonces estaban
expuestas. No fue una migración, ni un event trigger, ni el cambio de plataforma del 30 de octubre
(que no toca las tablas existentes).

El SQL es generado (OID fijos y un bloque `do`): no lo escribió una persona en el SQL Editor. El rol
es `postgres` porque el panel ejecuta así sus cambios.

## Corrección

`20261013143100_privilegios_authenticated.sql` repite los GRANT de `authenticated` (tablas,
columnas editables, esquema `private` y las tres funciones de las políticas). Aplicada con
`db push` el 2026-10-13 y comprobada por REST. ACL actual de las 8 tablas:
`{postgres=arwdDxtm/postgres,authenticated=ar/postgres}`, con RLS activado.

## Lo que queda distinto del repo

- **`service_role` sin privilegios en `public`.** Las migraciones le dejan lectura y escritura sin
  DELETE ni TRUNCATE; el panel se los quitó y no se devolvieron (la corrección solo toca
  `authenticated`). No afecta: la Edge Function `delete-account` solo usa
  `auth.admin.deleteUser`, y el borrado en cascada no depende de privilegios. Pendiente en
  CLAUDE.md para la fase de sincronización.
- **Nada nuevo queda expuesto por omisión.** Las tablas, secuencias y funciones que `postgres`
  cree en `public` nacen sin privilegios para `anon`, `authenticated` y `service_role`, y las
  funciones sin EXECUTE para `public`. Cada migración tiene que dar los suyos (regla en CLAUDE.md).

## Prevención

- Regla en CLAUDE.md: GRANT explícitos en la misma migración que crea el objeto, privilegios solo
  por migraciones (nunca desde el panel) y `npm run check:data-api` después de cada `db push`.
- `supabase/tests/database/006-privilegios.test.sql`: matriz exacta de privilegios de
  `authenticated` (faltantes y sobrantes) y ninguno para `anon`. Corre en el CI sobre la base local:
  protege las migraciones, no el remoto.
- `scripts/check-data-api.mjs` (`npm run check:data-api`): repite la prueba REST contra el
  proyecto con el usuario de prueba. Es lo único que detecta un cambio hecho fuera de las
  migraciones, como este.

## Consultas usadas

```sql
-- Privilegios reales de las tablas
select c.relname, c.relowner::regrole, c.relrowsecurity, c.relacl::text
from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by 1;

-- Event triggers
select evtname, evtevent, evtowner::regrole, evtfoid::regprocedure, evtenabled, evttags
from pg_event_trigger order by 1;

-- Privilegios por omisión
select defaclrole::regrole, defaclnamespace::regnamespace, defaclobjtype, defaclacl::text
from pg_default_acl order by 1, 2, 3;

-- Quién cambió privilegios y cuándo (Postgres 17: stats_since)
select stats_since, userid::regrole, calls, left(query, 200)
from extensions.pg_stat_statements
where query ~* '(revoke|grant|alter default privileges)' order by stats_since;
```
