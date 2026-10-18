-- sync_pull (v1) ya no existe (Fase 4b, push n.º 3). Reemplaza al 010 de la Fase 4a, que probaba la
-- descarga v1 a fondo: lo mismo, para la v2, está en 014-sync-pull-v2 (grupos por cuenta, ajenos,
-- borrados, cursores, páginas, límites del sobre, `lost`, anon).
begin;
select plan(6);

select hasnt_function('public', 'sync_pull', array['jsonb', 'integer'], 'sync_pull (v1) ya no existe');
select has_function('public', 'sync_pull_v2', array['jsonb', 'integer'], 'sync_pull_v2 sigue');

-- Ninguna otra función se llama sync_pull (ni con otros argumentos).
select is_empty(
  $$ select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'sync_pull' $$,
  'No queda ninguna función sync_pull en public'
);

select tests.crear_mundo();

-- Ni authenticated ni anon pueden llamarla: la función no existe (42883), no es un error de permiso.
select tests.autenticar_como(tests.id('ana'));
select throws_ok(
  $$ select public.sync_pull('{}') $$,
  '42883', null, 'authenticated no puede llamar a sync_pull'
);
reset role;

select tests.autenticar_como_anon();
select throws_ok(
  $$ select public.sync_pull('{}') $$,
  '42883', null, 'anon tampoco'
);
reset role;

-- La descarga que queda funciona para el mismo mundo de pruebas.
select tests.autenticar_como(tests.id('ana'));
select ok(
  (select jsonb_array_length(public.sync_pull_v2('{}') -> 'groups')) = 2,
  'sync_pull_v2 descarga los dos grupos de Ana'
);
reset role;

select * from finish();
rollback;
