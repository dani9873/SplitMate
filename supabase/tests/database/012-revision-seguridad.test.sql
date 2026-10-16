-- Revisión de seguridad de la Fase 4a (design/fase-4a/revision-seguridad.md): cada bloque cubre
-- una corrección. Ana trabaja en su grupo viaje; los ids nuevos son tests.u(n), de 300 en adelante
-- para filas y de 3000 en adelante para envíos.
begin;
select plan(8);

select tests.crear_mundo();

create function tests.u(p_n integer) returns uuid language sql immutable as $$
  select format('01990000-0000-7000-8000-%s', lpad(p_n::text, 12, '0'))::uuid
$$;

-- Un envío de un gasto nuevo en viaje: 3000 pagados por Ana, mitad Ana y mitad Beto.
create function tests.envio_gasto(p_n integer, p_payer uuid, p_split_ana uuid, p_split_beto uuid)
returns jsonb language sql as $$
  select jsonb_build_object('id', tests.u(3000 + p_n), 'entity', 'expense', 'base', null,
    'data', jsonb_build_object('id', tests.u(p_n), 'group_id', tests.id('viaje'),
      'kind', 'expense', 'title', 'Taxi', 'amount', 3000, 'currency', 'USD',
      'group_currency', 'USD', 'group_amount', 3000, 'exchange_rate', '1', 'rate_date', null,
      'split_method', 'equal', 'category_id', null, 'occurred_on', '2026-10-12', 'notes', null,
      'deleted', false,
      'payers', jsonb_build_array(jsonb_build_object('id', p_payer,
        'member_id', tests.id('viaje_ana'), 'amount', 3000, 'group_amount', 3000)),
      'splits', jsonb_build_array(
        jsonb_build_object('id', p_split_ana, 'member_id', tests.id('viaje_ana'), 'amount', 1500,
          'group_amount', 1500, 'input_value', null),
        jsonb_build_object('id', p_split_beto, 'member_id', tests.id('viaje_beto'),
          'amount', 1500, 'group_amount', 1500, 'input_value', null))))
$$;

create temp table res (k text primary key, j jsonb);
grant all on res to authenticated;
grant execute on all functions in schema tests to authenticated;

-- S1. Un gasto nuevo no toma pagadores ni partes de otro gasto --------------------------------------

-- El pagador y la parte de Beto del gasto de viaje quedan borrados (el usuario los cambió antes).
update public.expense_payers set deleted_at = now() where id = tests.id('pago_viaje');
update public.expense_splits set deleted_at = now() where id = tests.id('parte_viaje_beto');
create temp table gasto_viaje_antes as
  select version from public.expenses where id = tests.id('gasto_viaje');

select tests.autenticar_como(tests.id('ana'));
insert into res select 'lineas', public.sync_push(jsonb_build_array(
  -- 0: el pagador borrado del gasto de viaje
  tests.envio_gasto(300, tests.id('pago_viaje'), tests.u(301), tests.u(302)),
  -- 1: la parte activa de Ana en el gasto de viaje
  tests.envio_gasto(310, tests.u(311), tests.id('parte_viaje_ana'), tests.u(312)),
  -- 2: la parte borrada de Beto en el gasto de viaje
  tests.envio_gasto(320, tests.u(321), tests.u(322), tests.id('parte_viaje_beto'))
));
reset role;

select is(
  (select array_agg(e ->> 'reason' order by o) from res, jsonb_array_elements(j) with ordinality x (e, o)
    where k = 'lineas'),
  array['invalid', 'invalid', 'invalid'],
  'Un gasto nuevo con una línea de otro gasto es invalid'
);
select is(
  (select array_agg(e ->> 'field' order by o) from res, jsonb_array_elements(j) with ordinality x (e, o)
    where k = 'lineas'),
  array['payers', 'splits', 'splits'],
  'Con el campo de la línea ajena'
);
select is(
  (select count(*)::integer from public.expenses where id in (tests.u(300), tests.u(310), tests.u(320))),
  0,
  'Ninguno de los gastos nuevos se crea'
);
select ok(
  (select deleted_at is not null and expense_id = tests.id('gasto_viaje')
    from public.expense_payers where id = tests.id('pago_viaje')),
  'El pagador borrado del otro gasto sigue borrado y en su gasto'
);
select ok(
  (select deleted_at is not null from public.expense_splits where id = tests.id('parte_viaje_beto')),
  'La parte borrada del otro gasto sigue borrada'
);
select ok(
  (select deleted_at is null and expense_id = tests.id('gasto_viaje') and amount = 1500
    from public.expense_splits where id = tests.id('parte_viaje_ana')),
  'La parte activa del otro gasto no cambia'
);
select is(
  (select version from public.expenses where id = tests.id('gasto_viaje')),
  (select version from gasto_viaje_antes),
  'El otro gasto conserva su versión'
);
select is(
  (select count(*)::integer from public.expense_payers
    where id in (tests.u(311), tests.u(321)) or expense_id in (tests.u(300), tests.u(310), tests.u(320))),
  0,
  'No quedan líneas sueltas de los envíos rechazados'
);

select * from finish();
rollback;
