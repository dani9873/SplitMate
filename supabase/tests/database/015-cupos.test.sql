-- Cupos de sync_push (Fase 4b, design/fase-4b/diseno.md, sección e): al crear algo, sync_push lo
-- rechaza con rejected / quota si el grupo o la cuenta ya llegó al tope. Se prueba cada cupo con el
-- tope exacto (el último que cabe se aplica) y uno más (se rechaza). Los cupos cuentan los borrados
-- (borrar no libera cupo), no frenan editar ni reenviar lo ya aplicado, y no tocan a otras cuentas.
begin;
select plan(37);

select tests.crear_mundo();

create function tests.mid(p_n integer) returns uuid language sql immutable as $$
  select format('01990000-0000-7000-8000-%s', lpad(p_n::text, 12, '0'))::uuid
$$;
create function tests.mt(p_n integer, p_entity text, p_base integer, p_data jsonb)
returns jsonb language sql as $$
  select jsonb_build_object('id', tests.mid(p_n), 'entity', p_entity, 'base', p_base, 'data', p_data)
$$;
create function tests.miembro(p_n integer, p_group uuid, p_over jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object('id', tests.mid(p_n), 'group_id', p_group, 'display_name', 'M' || p_n,
    'user_id', null, 'role', 'member', 'deleted', false) || p_over
$$;
create function tests.categoria(p_n integer, p_group uuid)
returns jsonb language sql as $$
  select jsonb_build_object('id', tests.mid(p_n), 'group_id', p_group, 'name', 'C' || p_n,
    'icon', 'tag', 'deleted', false)
$$;
-- Un gasto de viaje pagado y repartido por Ana.
create function tests.gasto(p_n integer) returns jsonb language sql as $$
  select jsonb_build_object('id', tests.mid(p_n), 'group_id', tests.id('viaje'), 'kind', 'expense',
    'title', 'Gasto', 'amount', 3000, 'currency', 'USD', 'group_currency', 'USD',
    'group_amount', 3000, 'exchange_rate', '1', 'rate_date', null, 'split_method', 'equal',
    'category_id', null, 'occurred_on', '2026-10-12', 'notes', null, 'deleted', false,
    'payers', jsonb_build_array(jsonb_build_object('id', tests.mid(p_n + 300000),
      'member_id', tests.id('viaje_ana'), 'amount', 3000, 'group_amount', 3000)),
    'splits', jsonb_build_array(jsonb_build_object('id', tests.mid(p_n + 600000),
      'member_id', tests.id('viaje_ana'), 'amount', 3000, 'group_amount', 3000,
      'input_value', null)))
$$;
create function tests.transf(p_n integer) returns jsonb language sql as $$
  select jsonb_build_object('id', tests.mid(p_n), 'group_id', tests.id('viaje'),
    'from_member_id', tests.id('viaje_beto'), 'to_member_id', tests.id('viaje_ana'),
    'amount', 500, 'currency', 'USD', 'group_currency', 'USD', 'group_amount', 500,
    'exchange_rate', '1', 'rate_date', null, 'occurred_on', '2026-10-12', 'deleted', false)
$$;
create function tests.grupo(p_n integer) returns jsonb language sql as $$
  select jsonb_build_object('id', tests.mid(p_n), 'name', 'G' || p_n, 'currency', 'USD',
    'emoji', null, 'color', 'teal', 'archived', false, 'deleted', false)
$$;
create temp table res (k text primary key, j jsonb);
grant all on res to authenticated;
create function tests.st(p_k text, p_i integer default 0) returns text language sql as $$
  select j -> p_i ->> 'status' from res where k = p_k
$$;
create function tests.re(p_k text, p_i integer default 0) returns text language sql as $$
  select j -> p_i ->> 'reason' from res where k = p_k
$$;
create function tests.qu(p_k text, p_i integer default 0) returns text language sql as $$
  select j -> p_i ->> 'quota' from res where k = p_k
$$;
grant execute on all functions in schema tests to authenticated;

-- Miembros por grupo: 200, borrados incluidos --------------------------------------------------------

-- Oficina tiene 2 miembros. Con 197 más son 199: el siguiente es el 200 y todavía cabe.
insert into public.group_members (id, group_id, display_name)
select tests.mid(1000 + n), tests.id('oficina'), 'Relleno ' || n from generate_series(1, 197) n;

select tests.autenticar_como(tests.id('ana'));
insert into res select 'm200', public.sync_push(jsonb_build_array(
  tests.mt(1, 'member', null, tests.miembro(1, tests.id('oficina')))
));
select is(tests.st('m200'), 'applied', 'El miembro 200 de un grupo todavía cabe');
insert into res select 'm201', public.sync_push(jsonb_build_array(
  tests.mt(2, 'member', null, tests.miembro(2, tests.id('oficina')))
));
select is(tests.st('m201'), 'rejected', 'El miembro 201 se rechaza');
select is(tests.re('m201'), 'quota', 'Con el motivo quota');
select is(tests.qu('m201'), 'members', 'Y dice cuál cupo');
select is(
  (select j -> 0 -> 'current' from res where k = 'm201'),
  '[]'::jsonb,
  'Sin fila actual: no se creó'
);
reset role;
select is(
  (select count(*)::integer from public.group_members where group_id = tests.id('oficina')),
  200,
  'Y el grupo se queda con 200'
);

select tests.autenticar_como(tests.id('ana'));
insert into res select 'm_reenvio', public.sync_push(jsonb_build_array(
  tests.mt(1, 'member', null, tests.miembro(1, tests.id('oficina')))
));
select is(tests.st('m_reenvio'), 'applied', 'Reenviar lo ya aplicado en el tope sigue respondiendo applied');
insert into res select 'm_edita', public.sync_push(jsonb_build_array(
  tests.mt(3, 'member', 1, tests.miembro(1, tests.id('oficina'), jsonb_build_object('display_name', 'Nuevo nombre')))
));
select is(tests.st('m_edita'), 'applied', 'Editar un miembro en el tope no se frena');
insert into res select 'm_borra', public.sync_push(jsonb_build_array(
  tests.mt(4, 'member', 2, tests.miembro(1, tests.id('oficina'), jsonb_build_object('display_name', 'Nuevo nombre', 'deleted', true)))
));
select is(tests.st('m_borra'), 'applied', 'Borrar un miembro en el tope se aplica');
insert into res select 'm_tras_borrar', public.sync_push(jsonb_build_array(
  tests.mt(5, 'member', null, tests.miembro(5, tests.id('oficina')))
));
select is(tests.re('m_tras_borrar'), 'quota', 'Pero borrar no libera cupo: los borrados cuentan');
insert into res select 'm_otro_grupo', public.sync_push(jsonb_build_array(
  tests.mt(6, 'member', null, tests.miembro(6, tests.id('viaje')))
));
select is(tests.st('m_otro_grupo'), 'applied', 'Otro grupo de la misma cuenta no se ve afectado');
reset role;

-- Categorías personalizadas por grupo: 100 -----------------------------------------------------------

insert into public.categories (id, group_id, name, icon)
select tests.mid(2000 + n), tests.id('viaje'), 'Relleno ' || n, 'tag' from generate_series(1, 98) n;

-- Viaje ya tiene 1 (cat_viaje): con 98 más son 99, y la siguiente es la 100.
select tests.autenticar_como(tests.id('ana'));
insert into res select 'c100', public.sync_push(jsonb_build_array(
  tests.mt(10, 'category', null, tests.categoria(10, tests.id('viaje')))
));
select is(tests.st('c100'), 'applied', 'La categoría 100 todavía cabe');
insert into res select 'c101', public.sync_push(jsonb_build_array(
  tests.mt(11, 'category', null, tests.categoria(11, tests.id('viaje')))
));
select is(tests.re('c101'), 'quota', 'La 101 se rechaza');
select is(tests.qu('c101'), 'categories', 'Con su cupo');
insert into res select 'c_otro', public.sync_push(jsonb_build_array(
  tests.mt(12, 'category', null, tests.categoria(12, tests.id('oficina')))
));
select is(tests.st('c_otro'), 'applied', 'Otro grupo tiene sus propias 100');
reset role;

-- Gastos más transferencias por grupo: 20 000, borrados incluidos -------------------------------------

-- Viaje tiene 1 gasto y 1 transferencia. Con 19 997 gastos más son 19 999.
insert into public.expenses
  (id, group_id, kind, title, amount, currency, group_currency, group_amount, split_method, occurred_on)
select tests.mid(1000000 + n), tests.id('viaje'), 'expense', 'Relleno', 100, 'USD', 'USD', 100,
  'equal', '2026-10-12'
from generate_series(1, 19997) n;

select tests.autenticar_como(tests.id('ana'));
insert into res select 'g20000', public.sync_push(jsonb_build_array(
  tests.mt(20, 'expense', null, tests.gasto(20))
));
select is(tests.st('g20000'), 'applied', 'El movimiento 20 000 todavía cabe');
insert into res select 'g20001', public.sync_push(jsonb_build_array(
  tests.mt(21, 'expense', null, tests.gasto(21))
));
select is(tests.re('g20001'), 'quota', 'Un gasto más se rechaza');
select is(tests.qu('g20001'), 'movements', 'Con su cupo');
insert into res select 't20001', public.sync_push(jsonb_build_array(
  tests.mt(22, 'transfer', null, tests.transf(22))
));
select is(tests.re('t20001'), 'quota', 'Una transferencia también: comparten cupo');
select is(tests.qu('t20001'), 'movements', 'El mismo cupo');
reset role;
select is(
  (select count(*)::integer from public.expenses where id = tests.mid(21))
    + (select count(*)::integer from public.transfers where id = tests.mid(22)),
  0,
  'Y no se creó ninguno'
);

-- Un gasto borrado cuenta: borrarlo no libera cupo
update public.expenses set deleted_at = now() where id = tests.mid(1000001);
select tests.autenticar_como(tests.id('ana'));
insert into res select 'g_tras_borrar', public.sync_push(jsonb_build_array(
  tests.mt(23, 'expense', null, tests.gasto(23))
));
select is(tests.re('g_tras_borrar'), 'quota', 'Con un gasto borrado, el cupo sigue lleno');
reset role;

-- Grupos con acceso por cuenta: 200 -------------------------------------------------------------------

-- Caro tiene casa. Con 198 grupos más son 199 (cada grupo nuevo le da su acceso de dueña).
insert into public.groups (id, name, currency, created_by)
select tests.mid(3000 + n), 'Grupo ' || n, 'USD', tests.id('caro') from generate_series(1, 198) n;

select tests.autenticar_como(tests.id('caro'));
insert into res select 'grp200', public.sync_push(jsonb_build_array(
  tests.mt(30, 'group', null, tests.grupo(30))
));
select is(tests.st('grp200'), 'applied', 'El grupo 200 de una cuenta todavía cabe');
insert into res select 'grp201', public.sync_push(jsonb_build_array(
  tests.mt(31, 'group', null, tests.grupo(31))
));
select is(tests.re('grp201'), 'quota', 'El 201 se rechaza');
select is(tests.qu('grp201'), 'groups', 'Con su cupo');
reset role;
select is_empty(
  $$ select 1 from public.groups where id = tests.mid(31) $$,
  'Y no se creó'
);
select is(
  (select count(*)::integer from public.group_access where user_id = tests.id('caro') and deleted_at is null),
  200,
  'Caro se queda con 200 accesos'
);

-- Salir de un grupo libera cupo de grupos
insert into public.group_access (group_id, user_id, role)
values (tests.mid(3001), tests.id('ana'), 'member');
select tests.autenticar_como(tests.id('caro'));
select lives_ok(
  $$ select public.leave_group(tests.mid(3001)) $$,
  'Caro sale de uno de sus grupos'
);
insert into res select 'grp_tras_salir', public.sync_push(jsonb_build_array(
  tests.mt(32, 'group', null, tests.grupo(32))
));
select is(tests.st('grp_tras_salir'), 'applied', 'Y puede crear otro: salir libera cupo');
reset role;

-- El cupo es por cuenta: Ana tiene pocos grupos
select tests.autenticar_como(tests.id('ana'));
insert into res select 'grp_ana', public.sync_push(jsonb_build_array(
  tests.mt(33, 'group', null, tests.grupo(33))
));
select is(tests.st('grp_ana'), 'applied', 'Otra cuenta no se ve afectada');
reset role;

-- Una validación inválida gana al cupo; el cupo no frena a los demás envíos ---------------------------------------

select tests.autenticar_como(tests.id('ana'));
insert into res select 'mezcla', public.sync_push(jsonb_build_array(
  tests.mt(40, 'member', null, tests.miembro(40, tests.id('oficina'))),
  tests.mt(41, 'member', null, tests.miembro(41, tests.id('viaje')))
));
select is(tests.re('mezcla', 0), 'quota', 'Un envío en el tope se rechaza');
select is(tests.st('mezcla', 1), 'applied', 'Y el siguiente, en otro grupo, se aplica');
insert into res select 'invalido', public.sync_push(jsonb_build_array(
  tests.mt(42, 'member', null, tests.miembro(42, tests.id('oficina'), jsonb_build_object('display_name', ''))
)));
select is(tests.re('invalido'), 'invalid', 'Un dato inválido se dice inválido, no quota');
reset role;

-- Un grupo ajeno no revela su cupo -------------------------------------------------------------------------

select tests.autenticar_como(tests.id('beto'));
insert into res select 'ajeno', public.sync_push(jsonb_build_array(
  tests.mt(50, 'member', null, tests.miembro(50, tests.id('oficina')))
));
select is(tests.re('ajeno'), 'forbidden', 'En un grupo ajeno lleno se responde forbidden, no quota');
reset role;

-- Los límites son los de la tabla de cupos --------------------------------------------------------------------

select is(
  (select count(*)::integer from public.group_members where group_id = tests.id('oficina')),
  200,
  'Oficina quedó en 200 miembros'
);
select is(
  (select count(*)::integer from public.categories where group_id = tests.id('viaje')),
  100,
  'Viaje, en 100 categorías'
);
select is(
  (select count(*)::integer from public.expenses where group_id = tests.id('viaje'))
    + (select count(*)::integer from public.transfers where group_id = tests.id('viaje')),
  20000,
  'Y en 20 000 movimientos'
);

select * from finish();
rollback;
