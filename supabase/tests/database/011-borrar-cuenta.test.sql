-- Borrar la cuenta (Fase 4a, design/fase-4a/diseno.md): se borran en la nube los grupos que nadie
-- más puede abrir, con todas sus filas y su historial; los compartidos quedan, con el miembro de la
-- cuenta sin vincular. Corre como postgres, igual que la cascada de auth.admin.deleteUser.
begin;
select plan(20);

select tests.crear_mundo();

-- Historial y envíos recordados reales: Ana renombra oficina y viaje con sync_push.
select tests.autenticar_como(tests.id('ana'));
select public.sync_push(jsonb_build_array(
  jsonb_build_object('id', gen_random_uuid(), 'entity', 'group', 'base', 1,
    'data', jsonb_build_object('id', tests.id('oficina'), 'name', 'Oficina 2', 'currency', 'USD',
      'emoji', null, 'color', 'teal', 'archived', false, 'deleted', false)),
  jsonb_build_object('id', gen_random_uuid(), 'entity', 'group', 'base', 1,
    'data', jsonb_build_object('id', tests.id('viaje'), 'name', 'Viaje 2', 'currency', 'USD',
      'emoji', null, 'color', 'teal', 'archived', false, 'deleted', false))
));
reset role;

-- Un grupo borrado de Ana, sin otra cuenta, y un grupo de Caro donde Ana tiene su miembro.
insert into public.groups (id, name, currency, created_by, deleted_at)
values (tests.id('nuevo_1'), 'Viejo', 'USD', tests.id('ana'), now());
insert into public.groups (id, name, currency, created_by)
values (tests.id('nuevo_2'), 'De Caro', 'USD', tests.id('caro'));
insert into public.group_members (id, group_id, user_id, display_name, role)
values (tests.id('nuevo_3'), tests.id('nuevo_2'), tests.id('ana'), 'Ana', 'member');

create temp view filas_por_grupo as
  select group_id from public.group_members
  union all select group_id from public.categories where group_id is not null
  union all select group_id from public.expenses
  union all select group_id from public.expense_payers
  union all select group_id from public.expense_splits
  union all select group_id from public.transfers;

create temp table casa_antes as
  select count(*) as n from filas_por_grupo where group_id = tests.id('casa');

select ok(
  (select count(*) > 0 from public.change_log where group_id = tests.id('oficina')),
  'Antes: oficina tiene historial'
);
select ok(
  (select count(*) > 0 from private.sync_mutations where user_id = tests.id('ana')),
  'Antes: Ana tiene envíos recordados'
);
select ok(
  (select count(*) > 0 from filas_por_grupo where group_id = tests.id('oficina')),
  'Antes: oficina tiene miembros, categorías y gastos'
);

select lives_ok(
  $$ delete from auth.users where id = tests.id('ana') $$,
  'Se borra la cuenta de Ana'
);

-- Lo que nadie más puede abrir se borra ---------------------------------------------------------

select is_empty(
  $$ select id from public.groups where id = tests.id('oficina') $$,
  'Oficina (Ana e Yago, sin otra cuenta) se borra'
);
select is(
  (select count(*)::integer from filas_por_grupo where group_id = tests.id('oficina')),
  0,
  'Con todas sus filas'
);
select is(
  (select count(*)::integer from public.change_log where group_id = tests.id('oficina')),
  0,
  'Y su historial'
);
select is_empty(
  $$ select group_id from private.group_changes where group_id = tests.id('oficina') $$,
  'Y su contador de cambios'
);
select is_empty(
  $$ select id from public.groups where id = tests.id('nuevo_1') $$,
  'Un grupo ya borrado de Ana también se borra de la nube'
);
select is(
  (select count(*)::integer from private.sync_mutations where user_id = tests.id('ana')),
  0,
  'Los envíos recordados de Ana se borran'
);

-- Lo que otra cuenta puede abrir queda --------------------------------------------------------------

select isnt_empty(
  $$ select id from public.groups where id = tests.id('viaje') $$,
  'Viaje queda: Beto tiene cuenta en el grupo'
);
select ok(
  (select user_id is null and deleted_at is null from public.group_members where id = tests.id('viaje_ana')),
  'Con el miembro de Ana sin cuenta, pero activo'
);
select ok(
  (select created_by is null from public.groups where id = tests.id('viaje')),
  'Y sin creador'
);
select is(
  (select count(*)::integer from public.change_log where group_id = tests.id('viaje')),
  4,
  'Su historial queda: la entrada de Ana y las tres de su salida (acceso borrado, nuevo dueño y miembro sin cuenta)'
);
select isnt_empty(
  $$ select id from public.groups where id = tests.id('nuevo_2') $$,
  'Un grupo creado por otra cuenta queda, aunque Ana fuera su única cuenta vinculada'
);
select ok(
  (select user_id is null from public.group_members where id = tests.id('nuevo_3')),
  'Con el miembro de Ana sin cuenta'
);
select is(
  (select count(*) from filas_por_grupo where group_id = tests.id('casa')),
  (select n from casa_antes),
  'Los grupos de otras cuentas no se tocan'
);

-- Y si después se borra la última cuenta del grupo compartido ---------------------------------------

select lives_ok(
  $$ delete from auth.users where id = tests.id('beto') $$,
  'Se borra la cuenta de Beto'
);
select is_empty(
  $$ select id from public.groups where id = tests.id('viaje') $$,
  'Viaje ya no tiene quién lo abra: se borra'
);
select is(
  (select count(*)::integer from public.change_log where group_id = tests.id('viaje')),
  0,
  'Con su historial'
);

select * from finish();
rollback;
