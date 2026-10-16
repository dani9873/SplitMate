-- Historial de cambios (Fase 4a, design/fase-4a/diseno.md): public.change_log es de solo agregar.
-- Lo escribe sync_push, una entrada por cambio aplicado; lo lee quien abre el grupo; nadie lo edita
-- ni lo borra, ni siquiera postgres, salvo la cascada de borrar el grupo.
begin;
select plan(44);

select tests.crear_mundo();

create function tests.u(p_n integer) returns uuid language sql immutable as $$
  select format('01990000-0000-7000-8000-%s', lpad(p_n::text, 12, '0'))::uuid
$$;

create function tests.mut(p_n integer, p_entity text, p_base integer, p_data jsonb)
returns jsonb language sql as $$
  select jsonb_build_object('id', tests.u(p_n), 'entity', p_entity, 'base', p_base, 'data', p_data)
$$;

create function tests.d_grupo(p_over jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', tests.u(100), 'name', 'Playa', 'currency', 'USD', 'emoji', null,
    'color', 'teal', 'archived', false, 'deleted', false) || p_over
$$;

create function tests.d_miembro(p_over jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', tests.u(110), 'group_id', tests.u(100), 'display_name', 'Lola',
    'user_id', null, 'role', 'member', 'deleted', false) || p_over
$$;

create function tests.d_gasto(p_over jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', tests.u(130), 'group_id', tests.u(100), 'kind', 'expense',
    'title', 'Cena', 'amount', 3000, 'currency', 'USD', 'group_currency', 'USD',
    'group_amount', 3000, 'exchange_rate', '1', 'rate_date', null, 'split_method', 'equal',
    'category_id', null, 'occurred_on', '2026-10-12', 'notes', null, 'deleted', false,
    'payers', jsonb_build_array(jsonb_build_object('id', tests.u(131), 'member_id', tests.u(110),
      'amount', 3000, 'group_amount', 3000)),
    'splits', jsonb_build_array(
      jsonb_build_object('id', tests.u(132), 'member_id', tests.u(110), 'amount', 1500,
        'group_amount', 1500, 'input_value', null),
      jsonb_build_object('id', tests.u(133), 'member_id', tests.u(111), 'amount', 1500,
        'group_amount', 1500, 'input_value', null)
    )) || p_over
$$;

grant execute on all functions in schema tests to authenticated;

create temp table antes (n bigint);
grant all on antes to authenticated;

-- Un alta, una edición, un borrado y una restauración -----------------------------------------------

select tests.autenticar_como(tests.id('ana'));

select public.sync_push(jsonb_build_array(
  tests.mut(1001, 'group', null, tests.d_grupo()),
  tests.mut(1002, 'member', null, tests.d_miembro()),
  tests.mut(1003, 'member', null, tests.d_miembro(jsonb_build_object(
    'id', tests.u(111), 'display_name', 'Maca'))),
  tests.mut(1005, 'expense', null, tests.d_gasto())
));
select public.sync_push(jsonb_build_array(
  tests.mut(1010, 'member', 1, tests.d_miembro(jsonb_build_object('display_name', 'Lolita')))));
select public.sync_push(jsonb_build_array(
  tests.mut(1011, 'member', 2, tests.d_miembro(jsonb_build_object(
    'display_name', 'Lolita', 'deleted', true)))));
select public.sync_push(jsonb_build_array(
  tests.mut(1012, 'member', 3, tests.d_miembro(jsonb_build_object('display_name', 'Lolita')))));

select is(
  (select array_agg(action order by id) from public.change_log where entity_id = tests.u(110)),
  array['create', 'update', 'delete', 'restore'],
  'Un alta, una edición, un borrado y una restauración escriben una entrada cada uno'
);
select is(
  (select array_agg(version order by id) from public.change_log where entity_id = tests.u(110)),
  array[1, 2, 3, 4],
  'Con la versión que dejó cada cambio'
);
select is(
  (select array_agg(mutation_id order by id) from public.change_log where entity_id = tests.u(110)),
  array[tests.u(1002), tests.u(1010), tests.u(1011), tests.u(1012)],
  'Y el envío que lo produjo'
);
select is(
  (select count(*)::integer from public.change_log
   where entity_id = tests.u(110) and actor = tests.id('ana') and group_id = tests.u(100)
     and entity = 'member'),
  4,
  'Con su autor, la entidad y el grupo'
);
select is(
  (select fields from public.change_log where entity_id = tests.u(110) and action = 'update'),
  array['display_name'],
  'Una edición guarda solo los campos que cambiaron'
);
select is(
  (select array_agg(fields order by id) from public.change_log
   where entity_id = tests.u(110) and action in ('delete', 'restore')),
  array[array['deleted'], array['deleted']],
  'Borrar y restaurar guardan el campo deleted'
);
select ok(
  (select 'display_name' = any (fields) and 'role' = any (fields) and 'group_id' = any (fields)
   from public.change_log where entity_id = tests.u(110) and action = 'create'),
  'Un alta guarda todos los campos de la unidad'
);
select is(
  (select snapshot -> 0 ->> 'table' from public.change_log
   where entity_id = tests.u(110) and action = 'restore'),
  'group_members',
  'La instantánea trae la tabla de la unidad'
);
select is(
  (select snapshot -> 0 -> 'row' ->> 'display_name' from public.change_log
   where entity_id = tests.u(110) and action = 'update'),
  'Lolita',
  'Y la fila después del cambio'
);
select is(
  (select jsonb_array_length(snapshot) from public.change_log where entity_id = tests.u(130)),
  4,
  'La instantánea de un gasto trae el gasto, su pagador y sus dos partes'
);
select is(
  (select snapshot -> 0 ->> 'table' from public.change_log where entity_id = tests.u(130)),
  'expenses',
  'Con el gasto primero'
);
select ok(
  (select 'payers' = any (fields) and 'splits' = any (fields) and 'title' = any (fields)
   from public.change_log where entity_id = tests.u(130)),
  'Y los campos del alta incluyen pagadores y partes'
);

select public.sync_push(jsonb_build_array(
  tests.mut(1020, 'expense', 1, tests.d_gasto(jsonb_build_object(
    'splits', jsonb_build_array(jsonb_build_object('id', tests.u(134), 'member_id', tests.u(110),
      'amount', 3000, 'group_amount', 3000, 'input_value', null)))))));
select is(
  (select fields from public.change_log where entity_id = tests.u(130) and action = 'update'),
  array['splits'],
  'Cambiar solo las partes de un gasto registra el campo splits'
);
select is(
  (select jsonb_array_length(snapshot) from public.change_log
   where entity_id = tests.u(130) and action = 'update'),
  5,
  'Y la instantánea trae también las partes borradas'
);

-- Reenvíos, cambios idénticos y rechazos no escriben ------------------------------------------------

reset role;
insert into antes select count(*) from public.change_log;
select tests.autenticar_como(tests.id('ana'));

select public.sync_push(jsonb_build_array(
  tests.mut(1010, 'member', 1, tests.d_miembro(jsonb_build_object('display_name', 'Lolita')))));
select is(
  (select count(*) from public.change_log),
  (select n from antes),
  'Un reenvío no escribe en el historial'
);
select public.sync_push(jsonb_build_array(
  tests.mut(1030, 'member', 1, tests.d_miembro(jsonb_build_object('display_name', 'Lolita')))));
select is(
  (select count(*) from public.change_log),
  (select n from antes),
  'Un cambio idéntico al servidor, con base vieja, tampoco'
);
select public.sync_push(jsonb_build_array(
  tests.mut(1031, 'member', 1, tests.d_miembro(jsonb_build_object('display_name', 'Otra')))));
select is(
  (select count(*) from public.change_log),
  (select n from antes),
  'Un conflicto de versión tampoco'
);
select public.sync_push(jsonb_build_array(
  tests.mut(1032, 'member', 4, tests.d_miembro(jsonb_build_object('display_name', '')))));
select is(
  (select count(*) from public.change_log),
  (select n from antes),
  'Un envío inválido tampoco'
);
select public.sync_push(jsonb_build_array(
  tests.mut(1033, 'member', null, tests.d_miembro(jsonb_build_object(
    'id', tests.u(112), 'group_id', tests.id('casa'))))));
select is(
  (select count(*) from public.change_log),
  (select n from antes),
  'Ni uno prohibido'
);

-- Quién lo lee -----------------------------------------------------------------------------------------------

select public.sync_push(jsonb_build_array(
  tests.mut(1040, 'expense', 1, jsonb_build_object(
    'id', tests.id('gasto_viaje'), 'group_id', tests.id('viaje'), 'kind', 'expense',
    'title', 'Cena con Beto', 'amount', 3000, 'currency', 'USD', 'group_currency', 'USD',
    'group_amount', 3000, 'exchange_rate', '1', 'rate_date', null, 'split_method', 'equal',
    'category_id', tests.id('cat_viaje'),
    'occurred_on', (select occurred_on from public.expenses where id = tests.id('gasto_viaje')),
    'notes', null, 'deleted', false,
    'payers', jsonb_build_array(jsonb_build_object('id', tests.id('pago_viaje'),
      'member_id', tests.id('viaje_ana'), 'amount', 3000, 'group_amount', 3000)),
    'splits', jsonb_build_array(
      jsonb_build_object('id', tests.id('parte_viaje_ana'), 'member_id', tests.id('viaje_ana'),
        'amount', 1500, 'group_amount', 1500, 'input_value', null),
      jsonb_build_object('id', tests.id('parte_viaje_beto'), 'member_id', tests.id('viaje_beto'),
        'amount', 1500, 'group_amount', 1500, 'input_value', null))))));

select ok(
  (select count(*) > 0 from public.change_log where group_id = tests.u(100)),
  'Ana lee el historial de su grupo nuevo'
);
select is(
  (select count(*)::integer from public.change_log where group_id = tests.id('viaje')),
  1,
  'Y el del grupo que comparte con Beto'
);

reset role;
select tests.autenticar_como(tests.id('beto'));
select is(
  (select count(*)::integer from public.change_log where group_id = tests.id('viaje')),
  1,
  'Beto lee el historial del grupo que comparte con Ana'
);
select is(
  (select count(*)::integer from public.change_log where group_id = tests.u(100)),
  0,
  'Y no el de un grupo al que no pertenece'
);

reset role;
select tests.autenticar_como(tests.id('caro'));
select is(
  (select count(*)::integer from public.change_log),
  0,
  'Caro no lee ninguna entrada: ninguno de sus grupos tiene cambios'
);

reset role;
select tests.autenticar_como_anon();
select throws_ok(
  $$ select * from public.change_log $$,
  '42501', null, 'anon no lee el historial'
);

-- Nadie lo edita -------------------------------------------------------------------------------------------------

reset role;
select tests.autenticar_como(tests.id('ana'));
select throws_ok(
  $$
    insert into public.change_log (group_id, entity, entity_id, action, fields, snapshot, version, actor)
    values (tests.id('viaje'), 'group', tests.id('viaje'), 'update', '{}', '[]', 1, tests.id('ana'))
  $$,
  '42501', null, 'authenticated no inserta en el historial'
);
select throws_ok(
  $$ update public.change_log set action = 'delete' $$,
  '42501', null, 'authenticated no edita el historial'
);
select throws_ok(
  $$ delete from public.change_log $$,
  '42501', null, 'authenticated no borra del historial'
);
select ok(
  has_table_privilege('authenticated', 'public.change_log', 'SELECT')
  and not has_table_privilege('authenticated', 'public.change_log', 'INSERT')
  and not has_table_privilege('authenticated', 'public.change_log', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.change_log', 'DELETE')
  and not has_table_privilege('authenticated', 'public.change_log', 'TRUNCATE'),
  'authenticated solo tiene SELECT'
);
select ok(
  not has_table_privilege('service_role', 'public.change_log', 'SELECT')
  and not has_table_privilege('service_role', 'public.change_log', 'INSERT')
  and not has_table_privilege('service_role', 'public.change_log', 'UPDATE')
  and not has_table_privilege('service_role', 'public.change_log', 'DELETE')
  and not has_table_privilege('service_role', 'public.change_log', 'TRUNCATE'),
  'service_role no tiene ningún privilegio'
);
select ok(
  not has_table_privilege('anon', 'public.change_log', 'SELECT')
  and not has_table_privilege('anon', 'public.change_log', 'INSERT'),
  'anon no tiene ningún privilegio'
);
select ok(
  not has_function_privilege('authenticated', 'private.reject_change_log_edit()', 'EXECUTE'),
  'La función del trigger no se ejecuta a mano'
);

reset role;
select throws_ok(
  $$ update public.change_log set action = 'delete' $$,
  '42501', null, 'Ni postgres edita el historial'
);
select throws_ok(
  $$ delete from public.change_log $$,
  '42501', null, 'Ni postgres borra del historial'
);
select throws_ok(
  $$ truncate public.change_log $$,
  '42501', null, 'Ni postgres lo vacía'
);
select throws_ok(
  $$ delete from public.change_log where group_id = tests.u(100) $$,
  '42501', null, 'Ni con un filtro'
);

-- El historial de un grupo se borra con el grupo ------------------------------------------------------------------

select ok(
  (select count(*) > 0 from public.change_log where group_id = tests.u(100)),
  'Antes de borrar el grupo, su historial existe'
);
select lives_ok(
  $$ delete from public.groups where id = tests.u(100) $$,
  'Borrar el grupo en cascada borra también su historial'
);
select is(
  (select count(*)::integer from public.change_log where group_id = tests.u(100)),
  0,
  'Y no queda ninguna entrada'
);
select is(
  (select count(*)::integer from public.change_log where group_id = tests.id('viaje')),
  1,
  'Las de otros grupos siguen'
);

-- Borrar la cuenta borra sus envíos recordados ---------------------------------------------------------------------

select ok(
  (select count(*) > 0 from private.sync_mutations where user_id = tests.id('ana')),
  'Los envíos aplicados de Ana están recordados'
);
select lives_ok(
  $$ delete from auth.users where id = tests.id('ana') $$,
  'Borrar la cuenta funciona aunque tenga envíos recordados e historial'
);
select is(
  (select count(*)::integer from private.sync_mutations where user_id = tests.id('ana')),
  0,
  'Sus envíos recordados se borran en cascada con la cuenta'
);
select is(
  (select count(*)::integer from public.change_log where actor = tests.id('ana')),
  1,
  'Su historial queda: el autor no tiene clave foránea'
);

select * from finish();
rollback;
