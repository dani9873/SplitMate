-- sync_pull_v2 (Fase 4b, design/fase-4b/diseno.md, sección e): la descarga de la 4a con
-- group_access, un tope duro de filas por llamada, páginas dentro de un grupo grande (con hw y
-- after), cursores enteros u objeto y `lost` para los grupos que la cuenta ya no ve. Se descarga
-- como cada cuenta y se revisa como postgres.
begin;
select plan(68);

select tests.crear_mundo();

create function tests.mid(p_n integer) returns uuid language sql immutable as $$
  select format('01990000-0000-7000-8000-%s', lpad(p_n::text, 12, '0'))::uuid
$$;

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
create function tests.mas(p_k text) returns boolean language sql as $$
  select (j ->> 'has_more')::boolean from res where k = p_k
$$;
create function tests.perdidos(p_k text) returns uuid[] language sql as $$
  select coalesce(array_agg(x::uuid order by x), '{}')
  from res, jsonb_array_elements_text(j -> 'lost') x
  where k = p_k
$$;
-- { "<grupo>": cursor } con los cursores enteros de una respuesta.
create function tests.cursores(p_k text) returns jsonb language sql as $$
  select coalesce(jsonb_object_agg(g ->> 'id', g -> 'cursor'), '{}')
  from res, jsonb_array_elements(j -> 'groups') g
  where k = p_k
$$;
-- { "<grupo>": next } de la página parcial de una respuesta, para pedir la siguiente.
create function tests.siguiente(p_k text) returns jsonb language sql as $$
  select jsonb_build_object(g ->> 'id', g -> 'next')
  from res, jsonb_array_elements(j -> 'groups') g
  where k = p_k and (g ->> 'partial')::boolean
$$;
create function tests.tablas(p_k text, p_id uuid) returns text[] language sql as $$
  select array_agg(distinct r ->> 'table' order by r ->> 'table')
  from jsonb_array_elements(tests.grupo(p_k, p_id) -> 'rows') r
$$;
grant execute on all functions in schema tests to authenticated;

-- Descarga completa, con group_access ------------------------------------------------------------

select tests.autenticar_como(tests.id('ana'));
insert into res select 'completa', public.sync_pull_v2('{}');
reset role;

select is(
  tests.ids('completa'),
  array[tests.id('viaje'), tests.id('oficina')],
  'Sin cursores trae cada grupo de la cuenta, ordenados por id'
);
select is(tests.filas('completa', tests.id('viaje')), 12, 'Viaje trae sus diez filas y las dos de acceso');
select is(tests.filas('completa', tests.id('oficina')), 6, 'Oficina, sus cinco y la del dueño');
select is(
  (
    select array_agg(r -> 'row' ->> 'role' order by r -> 'row' ->> 'role')
    from jsonb_array_elements(tests.grupo('completa', tests.id('viaje')) -> 'rows') r
    where r ->> 'table' = 'group_access'
  ),
  array['member', 'owner'],
  'Las filas de group_access vienen en las filas del grupo'
);
select is(
  tests.tablas('completa', tests.id('viaje')),
  array['categories', 'expense_payers', 'expense_splits', 'expenses', 'group_access',
    'group_members', 'groups', 'transfers'],
  'Con las ocho tablas'
);
select is(
  (
    select array_agg(r ->> 'table' order by o)
    from jsonb_array_elements(tests.grupo('completa', tests.id('viaje')) -> 'rows')
      with ordinality x (r, o)
    where r ->> 'table' in ('groups', 'group_access', 'group_members')
  ),
  array['groups', 'group_access', 'group_access', 'group_members', 'group_members', 'group_members'],
  'Los padres van antes que los hijos: el grupo, el acceso y los miembros'
);
select is(
  (select (tests.grupo('completa', tests.id('viaje')) ->> 'partial')::boolean),
  false,
  'Un grupo que cabe no es parcial'
);
select is(tests.grupo('completa', tests.id('viaje')) -> 'next', 'null'::jsonb, 'Y no trae next');
select is(
  tests.cursor('completa', tests.id('viaje')),
  (select last_seq from private.group_changes where group_id = tests.id('viaje')),
  'Su cursor es su change_seq más alto'
);
select is(tests.mas('completa'), false, 'has_more es false');
select is(tests.perdidos('completa'), '{}'::uuid[], 'Y lost va vacío');

-- Cada cuenta ve lo suyo --------------------------------------------------------------------------

select tests.autenticar_como(tests.id('beto'));
insert into res select 'beto', public.sync_pull_v2('{}');
reset role;
select tests.autenticar_como(tests.id('caro'));
insert into res select 'caro', public.sync_pull_v2('{}');
reset role;
select is(tests.ids('beto'), array[tests.id('viaje')], 'Beto, con acceso solo a viaje, recibe viaje');
select is(tests.ids('caro'), array[tests.id('casa')], 'Caro recibe casa');
select tests.autenticar_como(tests.id('dani'));
select is(
  public.sync_pull_v2('{}') -> 'groups',
  '[]'::jsonb,
  'Una cuenta sin grupos recibe una lista vacía'
);
reset role;

-- Cursores enteros ----------------------------------------------------------------------------------

select tests.autenticar_como(tests.id('ana'));
insert into res select 'repetida', public.sync_pull_v2(tests.cursores('completa'));
reset role;
select is(tests.ids('repetida'), '{}'::uuid[], 'Con los cursores de la respuesta no llega nada');

update public.group_members set display_name = 'Beto B.' where id = tests.id('viaje_beto');
select tests.autenticar_como(tests.id('ana'));
insert into res select 'cambio', public.sync_pull_v2(tests.cursores('completa'));
reset role;
select is(tests.filas('cambio', tests.id('viaje')), 1, 'Un cambio llega solo, con una fila');
select ok(
  tests.cursor('cambio', tests.id('viaje')) > tests.cursor('completa', tests.id('viaje')),
  'Y mueve el cursor');

-- El nuevo acceso también llega: Caro entra a viaje como miembro
insert into public.group_access (group_id, user_id, role) values (tests.id('viaje'), tests.id('caro'), 'member');
select tests.autenticar_como(tests.id('ana'));
insert into res select 'acceso_nuevo', public.sync_pull_v2(tests.cursores('completa') || tests.cursores('cambio'));
reset role;
select is(
  tests.tablas('acceso_nuevo', tests.id('viaje')),
  array['group_access'],
  'Un acceso nuevo llega como una fila de group_access'
);
select tests.autenticar_como(tests.id('caro'));
select is(
  (select count(*)::integer from jsonb_array_elements(public.sync_pull_v2('{}') -> 'groups') g
   where g ->> 'id' = tests.id('viaje')::text),
  1,
  'Y Caro, ya con acceso, descarga viaje'
);
reset role;

-- Grupos borrados y acceso perdido ------------------------------------------------------------------

update public.groups set deleted_at = now() where id = tests.id('oficina');
select tests.autenticar_como(tests.id('ana'));
insert into res select 'borrado', public.sync_pull_v2(jsonb_build_object(tests.id('oficina'), 0));
reset role;
select ok(
  tests.id('oficina') = any (tests.ids('borrado')),
  'Un grupo borrado se sigue descargando'
);
select is(tests.perdidos('borrado'), '{}'::uuid[], 'Y no está perdido');

select tests.autenticar_como(tests.id('beto'));
insert into res select 'perdidos', public.sync_pull_v2(jsonb_build_object(
  tests.id('oficina'), 3,
  tests.id('casa'), 0,
  tests.id('viaje'), 1,
  upper(tests.mid(999)::text), 0
));
reset role;
select is(
  tests.perdidos('perdidos'),
  array[tests.id('oficina'), tests.id('casa'), tests.mid(999)],
  'lost trae los grupos del cursor que la cuenta no ve: ajenos, borrados del todo o inexistentes'
);
select is(tests.ids('perdidos'), array[tests.id('viaje')], 'Y el que sí ve se descarga');

delete from public.group_access where group_id = tests.id('viaje') and user_id = tests.id('beto');
update public.group_access set deleted_at = now() where group_id = tests.id('viaje') and user_id = tests.id('caro');
select tests.autenticar_como(tests.id('beto'));
select is(
  (public.sync_pull_v2(jsonb_build_object(tests.id('viaje'), 1)) -> 'lost'),
  jsonb_build_array(tests.id('viaje')),
  'Quien perdió el acceso recibe el grupo en lost'
);
reset role;
select tests.autenticar_como(tests.id('caro'));
select is(
  (public.sync_pull_v2(jsonb_build_object(tests.id('viaje'), 1)) -> 'lost'),
  jsonb_build_array(tests.id('viaje')),
  'También quien salió, con su acceso marcado como borrado'
);
reset role;

-- Un grupo grande, por páginas ------------------------------------------------------------------------

-- Ana crea un grupo con 2500 miembros, una categoría y un gasto con su pagador y su parte: 2506
-- filas con el grupo y el acceso. Su id queda después de viaje y oficina.
insert into public.groups (id, name, currency, created_by)
values (tests.mid(401), 'Grande', 'USD', tests.id('ana'));
insert into public.group_members (id, group_id, display_name)
select tests.mid(10000 + n), tests.mid(401), 'Miembro ' || n from generate_series(1, 2500) n;
insert into public.categories (id, group_id, name, icon)
values (tests.mid(5001), tests.mid(401), 'Varios', 'tag');
insert into public.expenses
  (id, group_id, kind, title, amount, currency, group_currency, group_amount, split_method,
    category_id, occurred_on)
values (tests.mid(5002), tests.mid(401), 'expense', 'Cena', 3000, 'USD', 'USD', 3000, 'equal',
  tests.mid(5001), '2026-10-11');
insert into public.expense_payers (id, group_id, expense_id, member_id, amount, group_amount)
values (tests.mid(5003), tests.mid(401), tests.mid(5002), tests.mid(10001), 3000, 3000);
insert into public.expense_splits (id, group_id, expense_id, member_id, amount, group_amount)
values (tests.mid(5004), tests.mid(401), tests.mid(5002), tests.mid(10001), 3000, 3000);

-- Viaje y oficina (grupos chicos) van primero y el grande queda para la llamada siguiente.
select tests.autenticar_como(tests.id('ana'));
insert into res select 'chicos', public.sync_pull_v2('{}', 1000);
reset role;
select is(
  tests.ids('chicos'),
  array[tests.id('viaje'), tests.id('oficina')],
  'Los grupos chicos se juntan en una página'
);
select is(tests.mas('chicos'), true, 'Y el grande no cabe: has_more');

select tests.autenticar_como(tests.id('ana'));
insert into res select 'p1', public.sync_pull_v2(tests.cursores('chicos'), 1000);
reset role;

select is(tests.ids('p1'), array[tests.mid(401)], 'Un grupo que no cabe sale solo');
select is(tests.filas('p1', tests.mid(401)), 1000, 'Con exactamente p_max_rows filas');
select is(
  (tests.grupo('p1', tests.mid(401)) ->> 'partial')::boolean,
  true,
  'Es parcial'
);
select is(tests.grupo('p1', tests.mid(401)) -> 'cursor', 'null'::jsonb, 'Sin cursor todavía');
select is(tests.mas('p1'), true, 'Y has_more');
select ok(
  (tests.grupo('p1', tests.mid(401)) -> 'next' ->> 'hw')::bigint
    = (select last_seq from private.group_changes where group_id = tests.mid(401)),
  'next fija hw en el change_seq más alto del grupo al empezar'
);
select is(
  (tests.grupo('p1', tests.mid(401)) -> 'next' ->> 'seq')::bigint,
  0::bigint,
  'Y guarda el cursor confirmado'
);
select is(
  (
    select array_agg(r ->> 'table' order by o)
    from jsonb_array_elements(tests.grupo('p1', tests.mid(401)) -> 'rows') with ordinality x (r, o)
    where o <= 3
  ),
  array['groups', 'group_access', 'group_members'],
  'Las páginas empiezan por los padres'
);

-- Una fila editada entre páginas no entra en las páginas: llega en la ronda siguiente.
update public.group_members set display_name = 'Editado' where id = tests.mid(12500);

select tests.autenticar_como(tests.id('ana'));
insert into res select 'p2', public.sync_pull_v2(tests.cursores('chicos') || tests.siguiente('p1'), 1000);
reset role;
select is(tests.filas('p2', tests.mid(401)), 1000, 'La segunda página trae otras 1000 filas');
select is(
  (tests.grupo('p2', tests.mid(401)) ->> 'partial')::boolean,
  true,
  'Sigue parcial'
);

select tests.autenticar_como(tests.id('ana'));
insert into res select 'p3', public.sync_pull_v2(tests.cursores('chicos') || tests.siguiente('p2'), 1000);
reset role;
select is(tests.filas('p3', tests.mid(401)), 505, 'La tercera trae las 505 que faltan, sin la editada');
select is(
  (tests.grupo('p3', tests.mid(401)) ->> 'partial')::boolean,
  false,
  'Y cierra el grupo'
);
select is(
  tests.cursor('p3', tests.mid(401)),
  (tests.grupo('p1', tests.mid(401)) -> 'next' ->> 'hw')::bigint,
  'Su cursor es hw, no el change_seq más alto de lo que trajo'
);
select is(tests.mas('p3'), false, 'Sin has_more');
select is(
  (
    select count(*)::integer from (
      select r -> 'row' ->> 'id' as id
      from res, jsonb_array_elements(j -> 'groups') g, jsonb_array_elements(g -> 'rows') r
      where k in ('p1', 'p2', 'p3')
      group by 1
    ) s
  ),
  2505,
  'Entre las tres páginas no se repite ninguna fila: 2505 de 2506, sin el miembro editado'
);
select is(
  (
    select count(*)::integer
    from res, jsonb_array_elements(j -> 'groups') g, jsonb_array_elements(g -> 'rows') r
    where k in ('p1', 'p2', 'p3') and r -> 'row' ->> 'id' = tests.mid(12500)::text
  ),
  0,
  'La fila editada entre páginas no vino en ellas'
);
select is(
  (
    select array_agg(distinct r ->> 'table')
    from jsonb_array_elements(tests.grupo('p3', tests.mid(401)) -> 'rows') r
    where r ->> 'table' <> 'group_members'
  ),
  array['categories', 'expense_payers', 'expense_splits', 'expenses'],
  'Los hijos de otras tablas llegan al final, después de los miembros'
);

select tests.autenticar_como(tests.id('ana'));
insert into res select 'ronda', public.sync_pull_v2(tests.cursores('chicos') || tests.cursores('p3'), 1000);
reset role;
select is(tests.filas('ronda', tests.mid(401)), 1, 'La ronda desde hw trae solo la fila editada');
select is(
  tests.grupo('ronda', tests.mid(401)) -> 'rows' -> 0 -> 'row' ->> 'display_name',
  'Editado',
  'Con su cambio'
);
select is(
  (tests.grupo('ronda', tests.mid(401)) ->> 'partial')::boolean,
  false,
  'Y no es parcial'
);

-- Un tope duro para cualquier grupo ----------------------------------------------------------------------

select tests.autenticar_como(tests.id('ana'));
insert into res select 'tope', public.sync_pull_v2(
  tests.cursores('chicos') || jsonb_build_object(tests.mid(401), 0), 100
);
reset role;
select is(tests.filas('tope', tests.mid(401)), 100, 'Con p_max_rows = 100 un solo grupo trae 100 filas, no 2506');

-- Cursor en curso con una página vacía al final: cierra el grupo en hw
select tests.autenticar_como(tests.id('ana'));
insert into res select 'vacia', public.sync_pull_v2(tests.cursores('chicos') || jsonb_build_object(
  tests.mid(401), jsonb_build_object('seq', 0, 'hw', 3, 'after', jsonb_build_object('t', 8, 'id', tests.mid(1)))
), 1000);
reset role;
select is(tests.filas('vacia', tests.mid(401)), 0, 'Sin nada más después de after, la página sale vacía');
select is(tests.cursor('vacia', tests.mid(401)), 3::bigint, 'Y el grupo cierra con cursor = hw');

-- Límites del sobre ---------------------------------------------------------------------------------------

select tests.autenticar_como(tests.id('ana'));
select throws_ok($$ select public.sync_pull_v2('{}', 99) $$, '22023', null, 'p_max_rows menor que 100: 22023');
select throws_ok($$ select public.sync_pull_v2('{}', 2001) $$, '22023', null, 'p_max_rows mayor que 2000: 22023');
select throws_ok($$ select public.sync_pull_v2('{}', null) $$, '22023', null, 'p_max_rows nulo: 22023');
select lives_ok($$ select public.sync_pull_v2('{}', 2000) $$, 'Con 2000 sí');
select throws_ok($$ select public.sync_pull_v2('[]') $$, '22023', null, 'p_cursors debe ser un objeto');
select throws_ok($$ select public.sync_pull_v2(null) $$, '22023', null, 'Un p_cursors nulo se rechaza');
select throws_ok(
  $$ select public.sync_pull_v2(jsonb_build_object('no-es-uuid', 0)) $$,
  '22023', null, 'La clave del cursor debe ser un UUID'
);
select throws_ok(
  $$ select public.sync_pull_v2(jsonb_build_object(tests.id('viaje'), -1)) $$,
  '22023', null, 'Un cursor negativo se rechaza'
);
select throws_ok(
  $$ select public.sync_pull_v2(jsonb_build_object(tests.id('viaje'), '5')) $$,
  '22023', null, 'Un cursor de texto se rechaza'
);
select throws_ok(
  $$ select public.sync_pull_v2(jsonb_build_object(tests.id('viaje'), 9007199254740992)) $$,
  '22023', null, 'Un cursor que no cabe en un número seguro se rechaza'
);
select throws_ok(
  $$ select public.sync_pull_v2(jsonb_build_object(tests.id('viaje'), jsonb_build_object('seq', 0, 'hw', 5))) $$,
  '22023', null, 'Un cursor objeto sin after se rechaza'
);
select throws_ok(
  $$
    select public.sync_pull_v2(jsonb_build_object(tests.id('viaje'),
      jsonb_build_object('seq', 9, 'hw', 5, 'after', jsonb_build_object('t', 2, 'id', tests.id('viaje')))))
  $$,
  '22023', null, 'Un cursor con seq mayor que hw se rechaza'
);
select throws_ok(
  $$
    select public.sync_pull_v2(jsonb_build_object(tests.id('viaje'),
      jsonb_build_object('seq', 0, 'hw', 5, 'after', jsonb_build_object('t', 9, 'id', tests.id('viaje')))))
  $$,
  '22023', null, 'Un after con una tabla que no existe se rechaza'
);
select throws_ok(
  $$
    select public.sync_pull_v2(jsonb_build_object(tests.id('viaje'),
      jsonb_build_object('seq', 0, 'hw', 5, 'after', jsonb_build_object('t', 2, 'id', 'xx'))))
  $$,
  '22023', null, 'Un after con un id que no es UUID se rechaza'
);
select throws_ok(
  $$
    select public.sync_pull_v2(jsonb_build_object(tests.id('viaje'),
      jsonb_build_object('seq', 0, 'hw', 5, 'extra', 1,
        'after', jsonb_build_object('t', 2, 'id', tests.id('viaje')))))
  $$,
  '22023', null, 'Un cursor objeto con claves de más se rechaza'
);
select throws_ok(
  $$
    select public.sync_pull_v2(jsonb_build_object(
      '0190000a-0000-7000-8000-00000000000a', 0, '0190000A-0000-7000-8000-00000000000A', 1))
  $$,
  '22023', null, 'El mismo grupo dos veces, con otra capitalización, se rechaza'
);
select throws_ok(
  $$ select public.sync_pull_v2((select jsonb_object_agg(tests.mid(n), 0) from generate_series(1, 1001) n)) $$,
  '22023', null, 'Hasta 1000 cursores'
);
reset role;

-- anon -----------------------------------------------------------------------------------------------------

select tests.autenticar_como_anon();
select throws_ok(
  $$ select public.sync_pull_v2('{}') $$,
  '42501', null, 'anon no ejecuta sync_pull_v2'
);
reset role;

select * from finish();
rollback;
