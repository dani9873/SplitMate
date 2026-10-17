-- Lo mínimo de la plataforma de Supabase para aplicar supabase/migrations y correr las pruebas en
-- PGlite (Postgres en WASM), sin Docker: los roles de la API, auth.users, auth.uid(), el esquema
-- extensions y los privilegios por omisión que Supabase da en public. Lo usan
-- scripts/test-db-local.mjs (pgTAP) y src/test/supabase-pglite.ts (Jest).
--
-- No reemplaza al CI: el job "Base de datos y RLS" corre las mismas pruebas sobre el Postgres 17 de
-- Supabase, que es la fuente de verdad. PGlite es Postgres 18.

-- Roles de la API. service_role pasa por encima de RLS, como en Supabase.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

-- Auth: solo lo que usan las migraciones y las pruebas.
create schema auth;

create table auth.users (
  id uuid primary key,
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Como en Supabase: el sub del JWT que PostgREST deja en request.jwt.claims.
create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Extensiones (pgTAP) en su propio esquema, como en Supabase.
create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- Privilegios por omisión de Supabase en public: todo para los roles de la API. Las migraciones de
-- SplitMate los quitan y dan solo los necesarios.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
