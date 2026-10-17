-- sync_push (Fase 4a, design/fase-4a/diseno.md): altas en una llamada, reenvíos idempotentes,
-- concurrencia estricta por versión base, reglas de moneda, validación de datos y límites del
-- servidor. Ana usa sus grupos (viaje, oficina); Caro es dueña de casa. Los ids nuevos son
-- tests.u(n): 100 a 299 para filas y 1000 en adelante para envíos.
begin;
select plan(102);

select tests.crear_mundo();

-- Datos válidos de cada unidad (en el grupo viaje salvo que se indique) -------------------------

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

create function tests.d_categoria(p_over jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', tests.u(120), 'group_id', tests.u(100), 'name', 'Snacks',
    'icon', 'cookie', 'deleted', false) || p_over
$$;

-- Gasto de 3000 pagado por Lola (u110) y repartido entre Lola y Maca (u111), en el grupo Playa.
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

create function tests.d_transf(p_over jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', tests.u(140), 'group_id', tests.u(100),
    'from_member_id', tests.u(111), 'to_member_id', tests.u(110), 'amount', 500,
    'currency', 'USD', 'group_currency', 'USD', 'group_amount', 500, 'exchange_rate', '1',
    'rate_date', null, 'occurred_on', '2026-10-12', 'deleted', false) || p_over
$$;

-- Lo mismo sobre las filas del mundo de prueba (grupo viaje de Ana y Beto).
create function tests.d_gasto_viaje(p_over jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', tests.id('gasto_viaje'), 'group_id', tests.id('viaje'),
    'kind', 'expense', 'title', 'Cena', 'amount', 3000, 'currency', 'USD',
    'group_currency', 'USD', 'group_amount', 3000, 'exchange_rate', '1', 'rate_date', null,
    'split_method', 'equal', 'category_id', tests.id('cat_viaje'),
    'occurred_on', (select occurred_on from public.expenses where id = tests.id('gasto_viaje')),
    'notes', null, 'deleted', false,
    'payers', jsonb_build_array(jsonb_build_object('id', tests.id('pago_viaje'),
      'member_id', tests.id('viaje_ana'), 'amount', 3000, 'group_amount', 3000)),
    'splits', jsonb_build_array(
      jsonb_build_object('id', tests.id('parte_viaje_ana'), 'member_id', tests.id('viaje_ana'),
        'amount', 1500, 'group_amount', 1500, 'input_value', null),
      jsonb_build_object('id', tests.id('parte_viaje_beto'), 'member_id', tests.id('viaje_beto'),
        'amount', 1500, 'group_amount', 1500, 'input_value', null)
    )) || p_over
$$;

create function tests.d_miembro_xime(p_over jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', tests.id('viaje_xime'), 'group_id', tests.id('viaje'),
    'display_name', 'Xime', 'user_id', null, 'role', 'member', 'deleted', false) || p_over
$$;

-- Resultados de cada llamada, por clave.
create temp table res (k text primary key, j jsonb);
grant all on res to authenticated;

create function tests.st(p_k text, p_i integer default 0) returns text language sql as $$
  select j -> p_i ->> 'status' from res where k = p_k
$$;
create function tests.re(p_k text, p_i integer default 0) returns text language sql as $$
  select j -> p_i ->> 'reason' from res where k = p_k
$$;
create function tests.fi(p_k text, p_i integer default 0) returns text language sql as $$
  select j -> p_i ->> 'field' from res where k = p_k
$$;
create function tests.ve(p_k text, p_i integer default 0) returns integer language sql as $$
  select (j -> p_i ->> 'version')::integer from res where k = p_k
$$;
-- Cuántas filas de `current` son de la tabla dada.
create function tests.cur(p_k text, p_i integer, p_table text) returns integer language sql as $$
  select count(*)::integer from res, jsonb_array_elements(j -> p_i -> 'current') c
  where k = p_k and c ->> 'table' = p_table
$$;
create function tests.cur_ver(p_k text, p_i integer) returns integer language sql as $$
  select (j -> p_i -> 'current' -> 0 -> 'row' ->> 'version')::integer from res where k = p_k
$$;

grant execute on all functions in schema tests to authenticated;

-- Alta de un grupo con todo en una llamada -------------------------------------------------------

select tests.autenticar_como(tests.id('ana'));

insert into res select 'alta', public.sync_push(jsonb_build_array(
  tests.mut(1001, 'group', null, tests.d_grupo()),
  tests.mut(1002, 'member', null, tests.d_miembro()),
  tests.mut(1003, 'member', null, tests.d_miembro(jsonb_build_object(
    'id', tests.u(111), 'display_name', 'Maca'))),
  tests.mut(1004, 'category', null, tests.d_categoria()),
  tests.mut(1005, 'expense', null, tests.d_gasto(jsonb_build_object('category_id', tests.u(120)))),
  tests.mut(1006, 'transfer', null, tests.d_transf())
));

select is(
  (select count(*)::integer from res, jsonb_array_elements(j) e where k = 'alta' and e ->> 'status' = 'applied'),
  6,
  'Un grupo, dos miembros, una categoría, un gasto y una transferencia entran en una llamada'
);
select ok(
  (select created_by = tests.id('ana') and version = 1 from public.groups where id = tests.u(100)),
  'El creador del grupo es quien envía, con versión 1'
);
select is(
  (select count(*)::integer from public.group_members where group_id = tests.u(100)),
  2,
  'Los miembros quedan en el grupo'
);
select is(
  (select count(*)::integer from public.expense_payers where expense_id = tests.u(130) and deleted_at is null),
  1,
  'El gasto queda con su pagador'
);
select is(
  (select count(*)::integer from public.expense_splits where expense_id = tests.u(130) and deleted_at is null),
  2,
  'El gasto queda con sus dos partes'
);
select is(
  (select count(*)::integer from public.transfers where id = tests.u(140)),
  1,
  'La transferencia queda guardada'
);
select is(tests.cur('alta', 4, 'expenses'), 1, 'current del gasto trae el gasto');
select is(tests.cur('alta', 4, 'expense_payers'), 1, 'current del gasto trae sus pagadores');
select is(tests.cur('alta', 4, 'expense_splits'), 2, 'current del gasto trae sus partes');
select is(tests.ve('alta', 4), 1, 'La versión que deja un alta es 1');

-- Reenvío idempotente --------------------------------------------------------------------------

create temp table antes as
  select (select count(*) from public.change_log) as log,
         (select count(*) from public.expenses) as gastos,
         (select count(*) from public.expense_splits) as partes;
grant all on antes to authenticated;

insert into res select 'edicion', public.sync_push(jsonb_build_array(
  tests.mut(1010, 'expense', 1, tests.d_gasto(jsonb_build_object('title', 'Cena grande')))
));
select is(tests.ve('edicion'), 2, 'Una edición con la base al día sube la versión a 2');

insert into res select 'reenvio', public.sync_push(jsonb_build_array(
  tests.mut(1005, 'expense', null, tests.d_gasto(jsonb_build_object('category_id', tests.u(120))))
));
select is(tests.st('reenvio'), 'applied', 'Reenviar un envío ya aplicado responde applied');
select is(tests.ve('reenvio'), 1, 'Con la versión que dejó ese envío, aunque otro cambio llegó entre medio');
select is(tests.cur_ver('reenvio', 0), 2, 'Y current trae el estado actual del servidor');
select is(
  (select title from public.expenses where id = tests.u(130)),
  'Cena grande',
  'El reenvío no pisa el cambio posterior'
);
select is(
  (select count(*)::integer from public.change_log),
  (select log::integer + 1 from antes),
  'Ni el reenvío escribe en el historial: solo la edición'
);
select is(
  (select count(*)::integer from public.expense_splits),
  (select partes::integer from antes),
  'Ni crea partes de más'
);

-- Base vieja: nada se aplica ---------------------------------------------------------------------

insert into res select 'vieja_edicion', public.sync_push(jsonb_build_array(
  tests.mut(1011, 'expense', 1, tests.d_gasto(jsonb_build_object('title', 'Pisada')))
));
select is(tests.st('vieja_edicion'), 'rejected', 'Editar con base vieja se rechaza');
select is(tests.re('vieja_edicion'), 'conflict', 'Por conflicto de versión');
select is(tests.cur_ver('vieja_edicion', 0), 2, 'Con el estado actual del servidor');
select is(
  (select title from public.expenses where id = tests.u(130)),
  'Cena grande',
  'Y no escribe nada'
);

insert into res select 'vieja_partes', public.sync_push(jsonb_build_array(
  tests.mut(1012, 'expense', 1, tests.d_gasto(jsonb_build_object(
    'title', 'Cena grande',
    'splits', jsonb_build_array(jsonb_build_object('id', tests.u(134), 'member_id', tests.u(110),
      'amount', 3000, 'group_amount', 3000, 'input_value', null))
  )))
));
select is(tests.re('vieja_partes'), 'conflict', 'Cambiar un gasto con sus partes, con base vieja, es conflicto');
select is(
  (select count(*)::integer from public.expense_splits where expense_id = tests.u(130) and deleted_at is null),
  2,
  'Y las partes siguen como estaban'
);

-- Grupo oficina: sube a la versión 2 y se prueban las demás operaciones con la base 1.
insert into res select 'oficina_v2', public.sync_push(jsonb_build_array(
  tests.mut(1020, 'group', 1, jsonb_build_object('id', tests.id('oficina'), 'name', 'Oficina 2',
    'currency', 'USD', 'emoji', null, 'color', 'teal', 'archived', false, 'deleted', false))
));
select is(tests.ve('oficina_v2'), 2, 'El grupo oficina sube a la versión 2');

create temp table antes_oficina as
  select (select count(*) from public.change_log) as log;
grant all on antes_oficina to authenticated;

insert into res select 'vieja_grupo', public.sync_push(jsonb_build_array(
  tests.mut(1021, 'group', 1, jsonb_build_object('id', tests.id('oficina'), 'name', 'Oficina 2',
    'currency', 'USD', 'emoji', null, 'color', 'teal', 'archived', false, 'deleted', true)),
  tests.mut(1022, 'group', 1, jsonb_build_object('id', tests.id('oficina'), 'name', 'Oficina 2',
    'currency', 'USD', 'emoji', null, 'color', 'teal', 'archived', true, 'deleted', false)),
  tests.mut(1023, 'group', 1, jsonb_build_object('id', tests.id('oficina'), 'name', 'Oficina 2',
    'currency', 'EUR', 'emoji', null, 'color', 'teal', 'archived', false, 'deleted', false))
));
select is(tests.re('vieja_grupo', 0), 'conflict', 'Borrar un grupo con base vieja es conflicto');
select is(tests.re('vieja_grupo', 1), 'conflict', 'Archivar un grupo con base vieja es conflicto');
select is(
  tests.re('vieja_grupo', 2),
  'conflict',
  'Cambiar la moneda con base vieja es conflicto, no moneda bloqueada'
);
select ok(
  (select deleted_at is null and archived_at is null and currency = 'USD' and version = 2
   from public.groups where id = tests.id('oficina')),
  'El grupo queda como estaba'
);
select is(
  (select count(*)::integer from public.change_log),
  (select log::integer from antes_oficina),
  'Los rechazos no escriben historial'
);

-- Miembro Yago: borrar (base 1 -> 2), restaurar con base vieja y con la base al día.
insert into res select 'yago_borrar', public.sync_push(jsonb_build_array(
  tests.mut(1030, 'member', 1, jsonb_build_object('id', tests.id('oficina_yago'),
    'group_id', tests.id('oficina'), 'display_name', 'Yago', 'user_id', null, 'role', 'member',
    'deleted', true))
));
select is(tests.ve('yago_borrar'), 2, 'Borrar un miembro con la base al día lo deja en la versión 2');
select ok(
  (select deleted_at is not null from public.group_members where id = tests.id('oficina_yago')),
  'Queda borrado'
);
insert into res select 'yago_restaurar_vieja', public.sync_push(jsonb_build_array(
  tests.mut(1031, 'member', 1, jsonb_build_object('id', tests.id('oficina_yago'),
    'group_id', tests.id('oficina'), 'display_name', 'Yago', 'user_id', null, 'role', 'member',
    'deleted', false))
));
select is(tests.re('yago_restaurar_vieja'), 'conflict', 'Restaurar con base vieja es conflicto');
select ok(
  (select deleted_at is not null from public.group_members where id = tests.id('oficina_yago')),
  'Y sigue borrado'
);
insert into res select 'yago_restaurar', public.sync_push(jsonb_build_array(
  tests.mut(1032, 'member', 2, jsonb_build_object('id', tests.id('oficina_yago'),
    'group_id', tests.id('oficina'), 'display_name', 'Yago', 'user_id', null, 'role', 'member',
    'deleted', false))
));
select is(tests.ve('yago_restaurar'), 3, 'Restaurar con la base al día deja la versión 3');
select ok(
  (select deleted_at is null from public.group_members where id = tests.id('oficina_yago')),
  'Y el miembro vuelve'
);

-- Una edición de las partes con la base al día crea partes nuevas -------------------------------

insert into res select 'partes', public.sync_push(jsonb_build_array(
  tests.mut(1040, 'expense', 2, tests.d_gasto(jsonb_build_object(
    'title', 'Cena grande',
    'splits', jsonb_build_array(jsonb_build_object('id', tests.u(134), 'member_id', tests.u(110),
      'amount', 3000, 'group_amount', 3000, 'input_value', null))
  )))
));
select is(tests.ve('partes'), 3, 'Cambiar solo las partes también sube la versión del gasto');
select is(
  (select count(*)::integer from public.expense_splits where expense_id = tests.u(130) and deleted_at is null),
  1,
  'Una sola parte activa'
);
select is(
  (select count(*)::integer from public.expense_splits where expense_id = tests.u(130)),
  3,
  'Y las dos anteriores quedan borradas, no eliminadas'
);

-- Restaurar las partes viejas reactiva las mismas filas
insert into res select 'partes_vuelven', public.sync_push(jsonb_build_array(
  tests.mut(1041, 'expense', 3, tests.d_gasto(jsonb_build_object('title', 'Cena grande')))
));
select is(
  (select count(*)::integer from public.expense_splits where expense_id = tests.u(130)),
  3,
  'Volver a las partes anteriores reactiva sus filas: no crea otras'
);
select is(tests.ve('partes_vuelven'), 4, 'Y sube la versión');

-- Borrar y restaurar un gasto
insert into res select 'gasto_borrar', public.sync_push(jsonb_build_array(
  tests.mut(1042, 'expense', 4, tests.d_gasto(jsonb_build_object(
    'title', 'Cena grande', 'deleted', true,
    'payers', '[]'::jsonb, 'splits', '[]'::jsonb)))
));
select is(tests.ve('gasto_borrar'), 5, 'Borrar un gasto lo deja con su pagador y sus partes borrados');
select is(
  (select count(*)::integer from public.expense_splits where expense_id = tests.u(130) and deleted_at is null),
  0,
  'Sin partes activas'
);

-- "Soy yo" -----------------------------------------------------------------------------------------

insert into res select 'yo_ocupado', public.sync_push(jsonb_build_array(
  tests.mut(1050, 'member', 1, tests.d_miembro_xime(jsonb_build_object('user_id', tests.id('ana'))))
));
select is(tests.re('yo_ocupado'), 'conflict', '"Soy yo" sobre otro miembro, cuando el tuyo ya tiene tu cuenta, es conflicto');
select ok(
  (select user_id is null from public.group_members where id = tests.id('viaje_xime')),
  'Y no se vincula'
);

insert into res select 'yo_libre', public.sync_push(jsonb_build_array(
  tests.mut(1051, 'member', 1, jsonb_build_object('id', tests.id('viaje_ana'),
    'group_id', tests.id('viaje'), 'display_name', 'Ana', 'user_id', null, 'role', 'owner',
    'deleted', false)),
  tests.mut(1052, 'member', 1, tests.d_miembro_xime(jsonb_build_object('user_id', tests.id('ana'))))
));
select is(tests.st('yo_libre', 0), 'applied', 'Cada cuenta se desvincula a sí misma');
select is(tests.st('yo_libre', 1), 'applied', 'Y después se vincula a otro miembro');

-- Un cambio que deja todo igual, con base vieja ---------------------------------------------------

insert into res select 'nombre_xime', public.sync_push(jsonb_build_array(
  tests.mut(1060, 'member', 2, tests.d_miembro_xime(jsonb_build_object(
    'user_id', tests.id('ana'), 'display_name', 'Ximena')))
));
select is(tests.ve('nombre_xime'), 3, 'Preparación: Xime queda en la versión 3');
insert into res select 'igual', public.sync_push(jsonb_build_array(
  tests.mut(1061, 'member', 1, tests.d_miembro_xime(jsonb_build_object(
    'user_id', tests.id('ana'), 'display_name', 'Ximena')))
));
select is(tests.st('igual'), 'applied', 'Un cambio que deja todo igual al servidor se acepta con base vieja');
select is(tests.ve('igual'), 3, 'Con la versión actual');
select is(
  (select version from public.group_members where id = tests.id('viaje_xime')),
  3,
  'Sin escribir nada'
);

-- Moneda -------------------------------------------------------------------------------------------

insert into res select 'moneda', public.sync_push(jsonb_build_array(
  tests.mut(1070, 'group', 1, jsonb_build_object('id', tests.id('viaje'), 'name', 'Viaje',
    'currency', 'EUR', 'emoji', null, 'color', 'teal', 'archived', false, 'deleted', false))
));
select is(tests.re('moneda'), 'currency_locked', 'Con movimientos activos, la moneda del grupo no cambia');
select is(tests.cur_ver('moneda', 0), 1, 'Con el grupo como está');
select is((select currency from public.groups where id = tests.id('viaje')), 'USD', 'Y no cambia');

insert into res select 'gcc_nuevo', public.sync_push(jsonb_build_array(
  tests.mut(1071, 'expense', null, tests.d_gasto_viaje(jsonb_build_object(
    'id', tests.u(150), 'group_currency', 'EUR', 'currency', 'EUR',
    'payers', jsonb_build_array(jsonb_build_object('id', tests.u(151),
      'member_id', tests.id('viaje_ana'), 'amount', 3000, 'group_amount', 3000)),
    'splits', jsonb_build_array(jsonb_build_object('id', tests.u(152),
      'member_id', tests.id('viaje_ana'), 'amount', 3000, 'group_amount', 3000,
      'input_value', null)))))
));
select is(tests.re('gcc_nuevo'), 'group_currency_changed', 'Un gasto calculado con otra moneda de grupo se rechaza');
select is(jsonb_array_length((select j -> 0 -> 'current' from res where k = 'gcc_nuevo')), 0, 'Con current vacío si es nuevo');

insert into res select 'gcc_viejo', public.sync_push(jsonb_build_array(
  tests.mut(1072, 'expense', 1, tests.d_gasto_viaje(jsonb_build_object(
    'group_currency', 'EUR', 'currency', 'EUR')))
));
select is(tests.re('gcc_viejo'), 'group_currency_changed', 'Lo mismo al editar uno que existe');
select is(tests.cur('gcc_viejo', 0, 'expenses'), 1, 'Y current trae el gasto del servidor');

-- Datos inválidos que dependen de las reglas --------------------------------------------------------

insert into res select 'reglas', public.sync_push(jsonb_build_array(
  tests.mut(1080, 'expense', 1, tests.d_gasto_viaje(jsonb_build_object('amount', 3001, 'group_amount', 3001))),
  tests.mut(1081, 'expense', 1, tests.d_gasto_viaje(jsonb_build_object('exchange_rate', '2'))),
  tests.mut(1082, 'expense', 1, tests.d_gasto_viaje(jsonb_build_object(
    'splits', jsonb_build_array(
      jsonb_build_object('id', tests.u(160), 'member_id', tests.id('viaje_ana'), 'amount', 1500,
        'group_amount', 1500, 'input_value', null),
      jsonb_build_object('id', tests.u(161), 'member_id', tests.id('viaje_ana'), 'amount', 1500,
        'group_amount', 1500, 'input_value', null))))),
  tests.mut(1083, 'expense', 1, tests.d_gasto_viaje(jsonb_build_object(
    'splits', jsonb_build_array(
      jsonb_build_object('id', tests.id('parte_viaje_ana'), 'member_id', tests.id('viaje_ana'),
        'amount', 1000, 'group_amount', 1000, 'input_value', null),
      jsonb_build_object('id', tests.id('parte_viaje_beto'), 'member_id', tests.id('viaje_beto'),
        'amount', 2000, 'group_amount', 2000, 'input_value', null))))),
  tests.mut(1084, 'expense', 1, tests.d_gasto_viaje(jsonb_build_object('group_id', tests.id('oficina')))),
  tests.mut(1085, 'transfer', null, tests.d_transf(jsonb_build_object(
    'group_id', tests.id('viaje'), 'from_member_id', tests.id('viaje_ana'),
    'to_member_id', tests.id('viaje_ana')))),
  tests.mut(1086, 'expense', 1, tests.d_gasto_viaje(jsonb_build_object(
    'currency', 'EUR', 'exchange_rate', '1.5', 'amount', 3001))),
  tests.mut(1087, 'expense', 1, tests.d_gasto_viaje(jsonb_build_object(
    'currency', 'EUR', 'exchange_rate', '1.5', 'amount', 2000, 'group_amount', 3001,
    'payers', jsonb_build_array(jsonb_build_object('id', tests.u(167),
      'member_id', tests.id('viaje_ana'), 'amount', 2000, 'group_amount', 3000)),
    'splits', jsonb_build_array(
      jsonb_build_object('id', tests.u(165), 'member_id', tests.id('viaje_ana'), 'amount', 1000,
        'group_amount', 1500, 'input_value', null),
      jsonb_build_object('id', tests.u(166), 'member_id', tests.id('viaje_beto'), 'amount', 1000,
        'group_amount', 1501, 'input_value', null)))))
));
select is(tests.st('reglas', 0), 'failed', 'Sumas que no cuadran: failed');
select is(tests.fi('reglas', 0), 'payers', 'Con el campo de los pagadores');
select is(tests.fi('reglas', 1), 'exchange_rate', 'Tasa distinta de 1 en la moneda del grupo: exchange_rate');
select is(tests.fi('reglas', 2), 'splits', 'Miembro repetido entre las partes: splits');
select is(tests.fi('reglas', 3), 'splits', 'Una parte que ya existe con otro monto: splits');
select is(tests.fi('reglas', 4), 'group_id', 'Cambiar el grupo de una fila existente: group_id');
select is(tests.fi('reglas', 5), 'to_member_id', 'Una transferencia a uno mismo: to_member_id');
select is(tests.re('reglas', 0), 'invalid', 'La razón es invalid');
select is(tests.fi('reglas', 6), 'payers', 'Pagadores que no suman el monto original: payers');
select is(tests.fi('reglas', 7), 'payers', 'Pagadores que no suman el monto del grupo: payers');

-- Acceso y existencia ---------------------------------------------------------------------------------

insert into res select 'ajeno', public.sync_push(jsonb_build_array(
  tests.mut(1090, 'member', null, tests.d_miembro(jsonb_build_object(
    'id', tests.u(170), 'group_id', tests.id('casa')))),
  tests.mut(1091, 'group', 1, tests.d_grupo(jsonb_build_object('id', tests.id('casa')))),
  tests.mut(1092, 'member', 7, tests.d_miembro(jsonb_build_object('id', tests.u(171)))),
  tests.mut(1093, 'group', null, tests.d_grupo(jsonb_build_object('id', tests.id('casa'))))
));
select is(tests.re('ajeno', 0), 'forbidden', 'Agregar un miembro a un grupo ajeno: forbidden');
select is(tests.re('ajeno', 1), 'not_found', 'Editar un grupo ajeno: not_found, como si no existiera');
select is(tests.re('ajeno', 2), 'not_found', 'Una base para una fila inexistente: not_found');
select is(tests.re('ajeno', 3), 'forbidden', 'Crear un grupo con el id de uno ajeno: forbidden');

-- Un envío inválido no frena a los demás ----------------------------------------------------------------

insert into res select 'mezcla', public.sync_push(jsonb_build_array(
  tests.mut(1100, 'member', null, tests.d_miembro(jsonb_build_object(
    'id', tests.u(180), 'group_id', tests.id('viaje'), 'display_name', ''))),
  tests.mut(1101, 'member', null, tests.d_miembro(jsonb_build_object(
    'id', tests.u(181), 'group_id', tests.id('viaje'), 'display_name', 'Nico')))
));
select is(tests.st('mezcla', 0), 'failed', 'Un envío inválido falla');
select is(tests.st('mezcla', 1), 'applied', 'Y el siguiente se aplica');
select is(
  (select count(*)::integer from public.group_members where id = tests.u(181)),
  1,
  'Y queda guardado'
);

-- Límites ------------------------------------------------------------------------------------------------

select is(public.sync_push('[]'::jsonb), '[]'::jsonb, 'Una lista vacía responde una lista vacía');
select throws_ok(
  $$
    select public.sync_push((
      select jsonb_agg(tests.mut(2000 + n, 'member', null, tests.d_miembro(jsonb_build_object(
        'id', tests.u(300 + n), 'group_id', tests.id('viaje')))))
      from generate_series(1, 51) n
    ))
  $$,
  '22023', null, '51 envíos son un error de la llamada (400)'
);
select throws_ok(
  $$
    select public.sync_push(jsonb_build_array(tests.mut(2100, 'group', null,
      tests.d_grupo(jsonb_build_object('name', repeat('x', 600000))))))
  $$,
  '54000', null, 'Más de 512 KiB son un error de la llamada (413)'
);
select throws_ok(
  $$ select public.sync_push('{}'::jsonb) $$,
  '22023', null, 'Si no es una lista, es un error de la llamada'
);
select throws_ok(
  $$ select public.sync_push(jsonb_build_array(jsonb_build_object(
    'id', tests.u(2200), 'entity', 'group', 'base', null))) $$,
  '22023', null, 'Un envío sin data es un error de la llamada'
);
select throws_ok(
  $$ select public.sync_push(jsonb_build_array(tests.mut(2201, 'tag', null, '{}'::jsonb))) $$,
  '22023', null, 'Una entidad desconocida es un error de la llamada'
);
select throws_ok(
  $$ select public.sync_push(jsonb_build_array(tests.mut(2202, 'group', 1, tests.d_grupo())
    || jsonb_build_object('base', 1.5))) $$,
  '22023', null, 'Una base decimal es un error de la llamada'
);
select throws_ok(
  $$ select public.sync_push(jsonb_build_array(tests.mut(2203, 'group', 1, tests.d_grupo())
    || jsonb_build_object('base', '1'))) $$,
  '22023', null, 'Una base en texto es un error de la llamada'
);
select throws_ok(
  $$ select public.sync_push(jsonb_build_array(tests.mut(2204, 'group', 0, tests.d_grupo()))) $$,
  '22023', null, 'Una base de 0 es un error de la llamada'
);
select throws_ok(
  $$ select public.sync_push(jsonb_build_array(tests.mut(2205, 'group', null, tests.d_grupo())
    || jsonb_build_object('extra', 1))) $$,
  '22023', null, 'Una clave de más en el envío es un error de la llamada'
);
select throws_ok(
  $$ select public.sync_push(jsonb_build_array(tests.mut(2206, 'group', null, tests.d_grupo())
    || jsonb_build_object('id', 'no-es-uuid'))) $$,
  '22023', null, 'Un id de envío que no es UUID es un error de la llamada'
);

insert into res select 'invalidos', public.sync_push(jsonb_build_array(
  tests.mut(2300, 'group', null, tests.d_grupo(jsonb_build_object('extra', 1))),
  tests.mut(2301, 'group', null, tests.d_grupo(jsonb_build_object('name', repeat('x', 81)))),
  tests.mut(2302, 'group', null, tests.d_grupo(jsonb_build_object('name', E'  \n '))),
  tests.mut(2303, 'expense', null, tests.d_gasto_viaje(jsonb_build_object('id', tests.u(190), 'amount', '3000'))),
  tests.mut(2304, 'expense', null, tests.d_gasto_viaje(jsonb_build_object('id', tests.u(191), 'amount', 10.5))),
  tests.mut(2305, 'expense', null, tests.d_gasto_viaje(jsonb_build_object('id', tests.u(192), 'amount', 100000000000000))),
  tests.mut(2306, 'expense', null, tests.d_gasto_viaje(jsonb_build_object('id', tests.u(193), 'occurred_on', '2026-02-30'))),
  tests.mut(2307, 'group', null, tests.d_grupo(jsonb_build_object('id', 'no-es-uuid'))),
  tests.mut(2308, 'expense', null, tests.d_gasto_viaje(jsonb_build_object('id', tests.u(194), 'kind', 'bono'))),
  tests.mut(2309, 'expense', null, tests.d_gasto_viaje(jsonb_build_object('id', tests.u(195),
    'payers', (select jsonb_agg(jsonb_build_object('id', tests.u(400 + n),
      'member_id', tests.u(500 + n), 'amount', 60, 'group_amount', 60))
      from generate_series(1, 51) n)))),
  tests.mut(2310, 'group', null, tests.d_grupo(jsonb_build_object('color', 'negro'))),
  tests.mut(2311, 'expense', null, tests.d_gasto_viaje(jsonb_build_object('id', tests.u(196), 'title', ''))),
  tests.mut(2312, 'expense', null, tests.d_gasto_viaje(jsonb_build_object('id', tests.u(197), 'notes', repeat('n', 1001)))),
  tests.mut(2313, 'expense', null, tests.d_gasto_viaje(jsonb_build_object('id', tests.u(198), 'rate_date', '2026-13-01'))),
  tests.mut(2314, 'expense', null, tests.d_gasto_viaje(jsonb_build_object('id', tests.u(199),
    'exchange_rate', '0', 'currency', 'EUR', 'group_amount', 3000)))
));
select is(tests.fi('invalidos', 0), 'extra', 'Una clave desconocida en data: failed con la clave');
select is(tests.fi('invalidos', 1), 'name', 'Un texto de 81 caracteres: name');
select is(tests.fi('invalidos', 2), 'name', 'Un texto solo con espacios: name');
select is(tests.fi('invalidos', 3), 'amount', 'Un monto como texto: amount');
select is(tests.fi('invalidos', 4), 'amount', 'Un monto decimal: amount');
select is(tests.fi('invalidos', 5), 'amount', 'Un monto de 100 000 000 000 000: amount');
select is(tests.fi('invalidos', 6), 'occurred_on', 'Una fecha inexistente: occurred_on');
select is(tests.fi('invalidos', 7), 'id', 'Un UUID mal formado: id');
select is(tests.fi('invalidos', 8), 'kind', 'Un enumerado desconocido: kind');
select is(tests.fi('invalidos', 9), 'payers', '51 pagadores: payers');
select is(tests.fi('invalidos', 10), 'color', 'Un color desconocido: color');
select is(tests.fi('invalidos', 11), 'title', 'Un título vacío: title');
select is(tests.fi('invalidos', 12), 'notes', 'Notas de 1001 caracteres: notes');
select is(tests.fi('invalidos', 13), 'rate_date', 'Un mes 13: rate_date');
select is(tests.fi('invalidos', 14), 'exchange_rate', 'Una tasa de 0: exchange_rate');
select is(
  (select count(*)::integer from public.groups where name like 'xxx%') +
  (select count(*)::integer from public.expenses where id between tests.u(190) and tests.u(199)),
  0,
  'Ningún envío inválido escribe'
);

-- Permisos de la RPC ----------------------------------------------------------------------------------------

reset role;
select tests.autenticar_como_anon();
select throws_ok(
  $$ select public.sync_push('[]'::jsonb) $$,
  '42501', null, 'anon no ejecuta sync_push'
);

select * from finish();
rollback;
