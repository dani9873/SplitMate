-- Funciones de apoyo para las pruebas pgTAP. Este archivo corre primero (orden alfabético) y
-- hace COMMIT: los demás archivos usan el esquema tests y revierten sus propios datos.
--
-- - tests.id(nombre): ids fijos y legibles para los datos de prueba.
-- - tests.crear_usuario(id, nombre, con_perfil): una cuenta en auth.users y, si se pide, su perfil.
-- - tests.crear_mundo(): tres grupos con miembros, categorías, gastos y transferencias.
-- - tests.autenticar_como(id) y tests.autenticar_como_anon(): cambian de rol como lo hace la
--   API de Supabase. Para volver a postgres, `reset role`.
begin;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

create or replace function tests.id(p_nombre text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case p_nombre
    -- Cuentas
    when 'ana' then '00000000-0000-4000-a000-00000000000a'
    when 'beto' then '00000000-0000-4000-a000-00000000000b'
    when 'caro' then '00000000-0000-4000-a000-00000000000c'
    when 'dani' then '00000000-0000-4000-a000-00000000000d'
    -- Grupos: viaje (Ana, Beto y Xime), oficina (Ana e Yago) y casa (Caro y Zoe)
    when 'viaje' then '01900000-0000-7000-8000-000000000001'
    when 'oficina' then '01900000-0000-7000-8000-000000000002'
    when 'casa' then '01900000-0000-7000-8000-000000000003'
    -- Miembros
    when 'viaje_ana' then '01910000-0000-7000-8000-000000000001'
    when 'viaje_beto' then '01910000-0000-7000-8000-000000000002'
    when 'viaje_xime' then '01910000-0000-7000-8000-000000000003'
    when 'oficina_ana' then '01910000-0000-7000-8000-000000000004'
    when 'oficina_yago' then '01910000-0000-7000-8000-000000000005'
    when 'casa_caro' then '01910000-0000-7000-8000-000000000006'
    when 'casa_zoe' then '01910000-0000-7000-8000-000000000007'
    -- Categorías personalizadas y una predefinida (comida)
    when 'cat_viaje' then '01920000-0000-7000-8000-000000000001'
    when 'cat_oficina' then '01920000-0000-7000-8000-000000000002'
    when 'cat_casa' then '01920000-0000-7000-8000-000000000003'
    when 'cat_comida' then '0199c82c-c000-7000-8000-000000000001'
    -- Gastos con su pagador y sus partes
    when 'gasto_viaje' then '01930000-0000-7000-8000-000000000001'
    when 'gasto_oficina' then '01930000-0000-7000-8000-000000000002'
    when 'gasto_casa' then '01930000-0000-7000-8000-000000000003'
    when 'pago_viaje' then '01940000-0000-7000-8000-000000000001'
    when 'pago_casa' then '01940000-0000-7000-8000-000000000003'
    when 'parte_viaje_ana' then '01950000-0000-7000-8000-000000000001'
    when 'parte_viaje_beto' then '01950000-0000-7000-8000-000000000002'
    when 'parte_casa_caro' then '01950000-0000-7000-8000-000000000003'
    -- Transferencias
    when 'transf_viaje' then '01960000-0000-7000-8000-000000000001'
    when 'transf_casa' then '01960000-0000-7000-8000-000000000003'
    -- Ids libres para filas que crean las pruebas
    when 'nuevo_1' then '01990000-0000-7000-8000-000000000001'
    when 'nuevo_2' then '01990000-0000-7000-8000-000000000002'
    when 'nuevo_3' then '01990000-0000-7000-8000-000000000003'
    when 'nuevo_4' then '01990000-0000-7000-8000-000000000004'
  end::uuid
$$;

create or replace function tests.crear_usuario(
  p_id uuid,
  p_nombre text,
  p_con_perfil boolean default true
)
returns uuid
language plpgsql
set search_path = ''
as $$
begin
  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
  values (
    p_id,
    'authenticated',
    'authenticated',
    lower(p_nombre) || '@example.com',
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    jsonb_build_object('display_name', p_nombre)
  );
  if p_con_perfil then
    insert into public.profiles (id, display_name) values (p_id, p_nombre);
  end if;
  return p_id;
end;
$$;

-- Datos de prueba. Corre como postgres, dueño de las tablas, así que no pasa por RLS.
create or replace function tests.crear_mundo()
returns void
language plpgsql
set search_path = ''
as $$
declare
  hoy date := date '2026-10-11';
begin
  perform tests.crear_usuario(tests.id('ana'), 'Ana');
  perform tests.crear_usuario(tests.id('beto'), 'Beto');
  perform tests.crear_usuario(tests.id('caro'), 'Caro');
  perform tests.crear_usuario(tests.id('dani'), 'Dani', false);

  insert into public.groups (id, name, currency, created_by) values
    (tests.id('viaje'), 'Viaje', 'USD', tests.id('ana')),
    (tests.id('oficina'), 'Oficina', 'USD', tests.id('ana')),
    (tests.id('casa'), 'Casa', 'EUR', tests.id('caro'));

  insert into public.group_members (id, group_id, user_id, display_name, role) values
    (tests.id('viaje_ana'), tests.id('viaje'), tests.id('ana'), 'Ana', 'owner'),
    (tests.id('viaje_beto'), tests.id('viaje'), tests.id('beto'), 'Beto', 'member'),
    (tests.id('viaje_xime'), tests.id('viaje'), null, 'Xime', 'member'),
    (tests.id('oficina_ana'), tests.id('oficina'), tests.id('ana'), 'Ana', 'owner'),
    (tests.id('oficina_yago'), tests.id('oficina'), null, 'Yago', 'member'),
    (tests.id('casa_caro'), tests.id('casa'), tests.id('caro'), 'Caro', 'owner'),
    (tests.id('casa_zoe'), tests.id('casa'), null, 'Zoe', 'member');

  insert into public.categories (id, group_id, name, icon) values
    (tests.id('cat_viaje'), tests.id('viaje'), 'Excursiones', 'mountain'),
    (tests.id('cat_oficina'), tests.id('oficina'), 'Café', 'coffee'),
    (tests.id('cat_casa'), tests.id('casa'), 'Mascotas', 'dog');

  insert into public.expenses
    (id, group_id, kind, title, amount, currency, group_amount, split_method, category_id, occurred_on)
  values
    (tests.id('gasto_viaje'), tests.id('viaje'), 'expense', 'Cena', 3000, 'USD', 3000, 'equal',
      tests.id('cat_viaje'), hoy),
    (tests.id('gasto_oficina'), tests.id('oficina'), 'expense', 'Café', 800, 'USD', 800, 'equal',
      tests.id('cat_oficina'), hoy),
    (tests.id('gasto_casa'), tests.id('casa'), 'expense', 'Luz', 5000, 'EUR', 5000, 'equal',
      tests.id('cat_casa'), hoy);

  insert into public.expense_payers (id, group_id, expense_id, member_id, amount, group_amount) values
    (tests.id('pago_viaje'), tests.id('viaje'), tests.id('gasto_viaje'), tests.id('viaje_ana'), 3000, 3000),
    (tests.id('pago_casa'), tests.id('casa'), tests.id('gasto_casa'), tests.id('casa_caro'), 5000, 5000);

  insert into public.expense_splits (id, group_id, expense_id, member_id, amount, group_amount) values
    (tests.id('parte_viaje_ana'), tests.id('viaje'), tests.id('gasto_viaje'), tests.id('viaje_ana'), 1500, 1500),
    (tests.id('parte_viaje_beto'), tests.id('viaje'), tests.id('gasto_viaje'), tests.id('viaje_beto'), 1500, 1500),
    (tests.id('parte_casa_caro'), tests.id('casa'), tests.id('gasto_casa'), tests.id('casa_caro'), 5000, 5000);

  insert into public.transfers
    (id, group_id, from_member_id, to_member_id, amount, currency, group_amount, occurred_on)
  values
    (tests.id('transf_viaje'), tests.id('viaje'), tests.id('viaje_beto'), tests.id('viaje_ana'), 1500,
      'USD', 1500, hoy),
    (tests.id('transf_casa'), tests.id('casa'), tests.id('casa_zoe'), tests.id('casa_caro'), 2500,
      'EUR', 2500, hoy);
end;
$$;

-- Actúa como la API con el JWT de una cuenta: rol authenticated y sus claims.
create or replace function tests.autenticar_como(p_user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_user_id, 'role', 'authenticated', 'aud', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';
end;
$$;

-- Actúa como la API sin sesión.
create or replace function tests.autenticar_como_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end;
$$;

-- Las pruebas llaman a tests.id() y a las funciones de pgTAP después de cambiar de rol.
grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

select plan(1);
select has_function('tests', 'crear_mundo', 'Las funciones de apoyo de las pruebas existen');
select * from finish();

commit;
