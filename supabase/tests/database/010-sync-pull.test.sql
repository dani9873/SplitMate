-- sync_pull (Fase 4a, design/fase-4a/diseno.md): descarga incremental por cursor de cada grupo,
-- completa con cursor 0, borrados incluidos, páginas que nunca parten un grupo, solo grupos con
-- acceso y los límites del sobre. Se descarga como cada cuenta y se revisa como postgres.
begin;
select plan(39);

select tests.crear_mundo();

-- Resultados de cada llamada, por clave.
create temp table res (k text primary key, j jsonb);
grant all on res to authenticated;

create function tests.ids(p_k text) returns uuid[] language sql as $$
  select coalesce(array_agg((g ->> 'id')::uuid order by o), '{}')
  from res, jsonb_array_elements(j -> 'groups') with ordinality x (g, o)
  where k = p_k
$$;
create function tests.grupo(p_k text, p_id uuid) returns jsonb language sql as $$
  select g from res, jsonb_array_elements(j -> 'groups') g
  where k = p_k and (g ->> 'id')::uuid = p_id
$$;
create function tests.filas(p_k text, p_id uuid) returns integer language sql as $$
  select jsonb_array_length(tests.grupo(p_k, p_id) -> 'rows')
$$;
create function tests.cursor(p_k text, p_id uuid) returns bigint language sql as $$
  select (tests.grupo(p_k, p_id) ->> 'cursor')::bigint
$$;
-- { "<grupo>": cursor } de una respuesta, para la llamada siguiente.
create function tests.cursores(p_k text) returns jsonb language sql as $$
  select coalesce(jsonb_object_agg(g ->> 'id', g -> 'cursor'), '{}')
  from res, jsonb_array_elements(j -> 'groups') g
  where k = p_k
$$;
create function tests.mas(p_k text) returns boolean language sql as $$
  select (j ->> 'has_more')::boolean from res where k = p_k
$$;
grant execute on all functions in schema tests to authenticated;

-- Viaje se edita después de sus filas: su change_seq es el más alto, pero igual va primero.
update public.groups set name = 'Viaje largo' where id = tests.id('viaje');
-- Un miembro borrado y un grupo borrado de Ana: también se descargan.
update public.group_members set deleted_at = now() where id = tests.id('oficina_yago');
insert into public.groups (id, name, currency, created_by, deleted_at)
values (tests.id('nuevo_1'), 'Viejo', 'USD', tests.id('ana'), now());

-- Descarga completa ------------------------------------------------------------------------------

select tests.autenticar_como(tests.id('ana'));
insert into res select 'completa', public.sync_pull('{}');
reset role;

select is(
  tests.ids('completa'),
  array[tests.id('viaje'), tests.id('oficina'), tests.id('nuevo_1')],
  'Sin cursores trae cada grupo de la cuenta, ordenados por id'
);
select is(tests.filas('completa', tests.id('viaje')), 10, 'Viaje viene con todas sus filas');
select is(tests.filas('completa', tests.id('oficina')), 5, 'Oficina también');
select is(tests.filas('completa', tests.id('nuevo_1')), 1, 'Y el grupo borrado');
select is(
  tests.cursor('completa', tests.id('viaje')),
  (select last_seq from private.group_changes where group_id = tests.id('viaje')),
  'El cursor de cada grupo es su change_seq más alto'
);
select is(tests.mas('completa'), false, 'Todo cabe en una página: has_more es false');
select is(
  (
    select array_agg(r ->> 'table' order by o)
    from jsonb_array_elements(tests.grupo('completa', tests.id('viaje')) -> 'rows')
      with ordinality x (r, o)
  ),
  array['groups', 'group_members', 'group_members', 'group_members', 'categories', 'expenses',
    'expense_payers', 'expense_splits', 'expense_splits', 'transfers'],
  'Las filas van por tabla: los padres antes que los hijos'
);
select ok(
  (
    select array_agg((r -> 'row' ->> 'change_seq')::bigint order by o)
      = array_agg((r -> 'row' ->> 'change_seq')::bigint order by (r -> 'row' ->> 'change_seq')::bigint)
    from jsonb_array_elements(tests.grupo('completa', tests.id('viaje')) -> 'rows')
      with ordinality x (r, o)
    where r ->> 'table' = 'group_members'
  ),
  'Y dentro de una tabla, por change_seq'
);
select ok(
  (
    select bool_and(r -> 'row' ? 'change_seq' and r -> 'row' ? 'deleted_at' and r -> 'row' ? 'version')
    from jsonb_array_elements(tests.grupo('completa', tests.id('viaje')) -> 'rows') r
  ),
  'Cada fila trae todas sus columnas'
);
select is(
  (
    select count(*)::integer
    from res, jsonb_array_elements(j -> 'groups') g, jsonb_array_elements(g -> 'rows') r
    where k = 'completa' and r ->> 'table' = 'categories' and r -> 'row' ->> 'group_id' is null
  ),
  0,
  'Las categorías predefinidas no se descargan'
);
select ok(
  (
    select r -> 'row' ->> 'deleted_at' is not null
    from jsonb_array_elements(tests.grupo('completa', tests.id('oficina')) -> 'rows') r
    where r -> 'row' ->> 'id' = tests.id('oficina_yago')::text
  ),
  'Un miembro borrado viene con su deleted_at'
);
select ok(
  (tests.grupo('completa', tests.id('nuevo_1')) -> 'rows' -> 0 -> 'row' ->> 'deleted_at') is not null,
  'Un grupo borrado viene con su deleted_at'
);

-- Incremental ------------------------------------------------------------------------------------------

select tests.autenticar_como(tests.id('ana'));
insert into res select 'segunda', public.sync_pull(tests.cursores('completa'));
select public.sync_push(jsonb_build_array(jsonb_build_object(
  'id', gen_random_uuid(), 'entity', 'member', 'base', 1,
  'data', jsonb_build_object('id', tests.id('viaje_xime'), 'group_id', tests.id('viaje'),
    'display_name', 'Ximena', 'user_id', null, 'role', 'member', 'deleted', false))));
insert into res select 'tras_cambio', public.sync_pull(tests.cursores('completa'));
insert into res select 'adelantado', public.sync_pull(jsonb_build_object(
  tests.id('viaje'), 999999, tests.id('oficina'), 999999, tests.id('nuevo_1'), 999999,
  tests.id('casa'), 0));
reset role;

select is(tests.ids('segunda'), '{}'::uuid[], 'Con los cursores devueltos y sin cambios, no trae nada');
select is(tests.ids('tras_cambio'), array[tests.id('viaje')], 'Tras un cambio, solo trae su grupo');
select is(tests.filas('tras_cambio', tests.id('viaje')), 1, 'Y solo la fila que cambió');
select is(
  tests.grupo('tras_cambio', tests.id('viaje')) -> 'rows' -> 0 -> 'row' ->> 'display_name',
  'Ximena',
  'Con su estado actual'
);
select ok(
  tests.cursor('tras_cambio', tests.id('viaje')) > tests.cursor('completa', tests.id('viaje'))
  and tests.cursor('tras_cambio', tests.id('viaje'))
    = (tests.grupo('tras_cambio', tests.id('viaje')) -> 'rows' -> 0 -> 'row' ->> 'change_seq')::bigint,
  'Y el cursor avanza hasta ese cambio'
);
select is(
  tests.ids('adelantado'),
  '{}'::uuid[],
  'Un cursor más alto que el real no trae nada, y el cursor de un grupo ajeno se ignora'
);

-- Cada cuenta ve solo sus grupos -------------------------------------------------------------------------

select tests.autenticar_como(tests.id('caro'));
insert into res select 'caro', public.sync_pull('{}');
reset role;
select tests.autenticar_como(tests.id('beto'));
insert into res select 'beto', public.sync_pull('{}');
reset role;

select is(tests.ids('caro'), array[tests.id('casa')], 'Caro solo descarga su grupo');
select is(tests.ids('beto'), array[tests.id('viaje')], 'Beto solo descarga el grupo que comparte con Ana');

-- Páginas: los cambios de un grupo nunca se parten ---------------------------------------------------------

insert into public.group_members (id, group_id, display_name, role)
select gen_random_uuid(), tests.id('oficina'), 'Persona ' || n, 'member'
from generate_series(1, 150) n;

select tests.autenticar_como(tests.id('ana'));
insert into res select 'pagina_1', public.sync_pull('{}', 100);
insert into res select 'pagina_2', public.sync_pull(tests.cursores('pagina_1'), 100);
insert into res select 'pagina_3',
  public.sync_pull(tests.cursores('pagina_1') || tests.cursores('pagina_2'), 100);
reset role;

select is(tests.ids('pagina_1'), array[tests.id('viaje')], 'Oficina no cabe con viaje: la primera página trae solo viaje');
select is(tests.mas('pagina_1'), true, 'Y avisa que hay más');
select is(tests.ids('pagina_2'), array[tests.id('oficina')], 'Un grupo más grande que el límite sale solo en su página');
select is(tests.filas('pagina_2', tests.id('oficina')), 155, 'Entero, sin partirse');
select is(tests.mas('pagina_2'), true, 'Y todavía queda el grupo borrado');
select is(tests.ids('pagina_3'), array[tests.id('nuevo_1')], 'La última página trae el resto');
select is(tests.mas('pagina_3'), false, 'Sin nada más');

-- Permisos y límites -------------------------------------------------------------------------------------------

select tests.autenticar_como_anon();
select throws_ok(
  $$ select public.sync_pull('{}') $$,
  '42501', null, 'anon no ejecuta sync_pull'
);
reset role;

select tests.autenticar_como(tests.id('ana'));
select throws_ok(
  $$ select public.sync_pull('[]') $$,
  '22023', null, 'Cursores que no son un objeto: error de la llamada (400)'
);
select throws_ok(
  $$ select public.sync_pull((select jsonb_object_agg(gen_random_uuid()::text, 0) from generate_series(1, 1001))) $$,
  '22023', null, '1001 cursores: error de la llamada'
);
select throws_ok(
  $$ select public.sync_pull('{"viaje": 0}') $$,
  '22023', null, 'Una clave que no es UUID: error de la llamada'
);
select throws_ok(
  $$ select public.sync_pull(jsonb_build_object(tests.id('viaje'), -1)) $$,
  '22023', null, 'Un cursor negativo: error de la llamada'
);
select throws_ok(
  $$ select public.sync_pull(jsonb_build_object(tests.id('viaje'), 1.5)) $$,
  '22023', null, 'Un cursor decimal: error de la llamada'
);
select throws_ok(
  $$ select public.sync_pull(jsonb_build_object(tests.id('viaje'), '5')) $$,
  '22023', null, 'Un cursor en texto: error de la llamada'
);
select throws_ok(
  $$ select public.sync_pull(jsonb_build_object(tests.id('viaje'), 9007199254740992)) $$,
  '22023', null, 'Un cursor mayor que 2^53 - 1: error de la llamada'
);
select throws_ok(
  $$ select public.sync_pull('{}', 99) $$,
  '22023', null, 'p_max_rows de 99: error de la llamada'
);
select throws_ok(
  $$ select public.sync_pull('{}', 5001) $$,
  '22023', null, 'p_max_rows de 5001: error de la llamada'
);
select throws_ok(
  $$ select public.sync_pull('{}', null) $$,
  '22023', null, 'p_max_rows nulo: error de la llamada'
);
reset role;

select ok(
  (
    select provolatile = 's' and not prosecdef
    from pg_proc
    where oid = 'public.sync_pull(jsonb, integer)'::regprocedure
  ),
  'sync_pull es STABLE (una sola foto de la base) y corre con los permisos de quien llama'
);

select * from finish();
rollback;
