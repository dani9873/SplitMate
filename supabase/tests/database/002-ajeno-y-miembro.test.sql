-- Ajeno contra miembro, tabla por tabla. Caro es ajena al grupo viaje: no lee, no inserta, no
-- edita ni borra (borrado lógico). Beto es miembro: hace todo eso. Nadie borra filas de verdad,
-- un ex miembro pierde el acceso y anon no llega a nada.
begin;
select plan(69);

select tests.crear_mundo();

-- Caro, ajena al grupo viaje -------------------------------------------------------------------

select tests.autenticar_como(tests.id('caro'));

select is_empty(
  $$ select id from public.groups where id = tests.id('viaje') $$,
  'groups: una ajena no ve el grupo'
);
select is_empty(
  $$ update public.groups set name = 'Hackeado' where id = tests.id('viaje') returning id $$,
  'groups: una ajena no edita el grupo'
);
select is_empty(
  $$ update public.groups set deleted_at = now() where id = tests.id('viaje') returning id $$,
  'groups: una ajena no borra el grupo'
);

select is_empty(
  $$ select id from public.group_members where group_id = tests.id('viaje') $$,
  'group_members: una ajena no ve los miembros'
);
select throws_ok(
  $$
    insert into public.group_members (id, group_id, user_id, display_name, role)
    values (tests.id('nuevo_1'), tests.id('viaje'), null, 'Intruso', 'member')
  $$,
  '42501',
  null,
  'group_members: una ajena no agrega miembros'
);
select is_empty(
  $$ update public.group_members set display_name = 'Hackeado' where id = tests.id('viaje_xime') returning id $$,
  'group_members: una ajena no renombra miembros'
);
select is_empty(
  $$ update public.group_members set deleted_at = now() where id = tests.id('viaje_xime') returning id $$,
  'group_members: una ajena no quita miembros'
);

select is_empty(
  $$ select id from public.categories where id = tests.id('cat_viaje') $$,
  'categories: una ajena no ve las categorías del grupo'
);
select throws_ok(
  $$
    insert into public.categories (id, group_id, name, icon)
    values (tests.id('nuevo_1'), tests.id('viaje'), 'Intrusa', 'tag')
  $$,
  '42501',
  null,
  'categories: una ajena no crea categorías en el grupo'
);
select is_empty(
  $$ update public.categories set name = 'Hackeada' where id = tests.id('cat_viaje') returning id $$,
  'categories: una ajena no edita categorías del grupo'
);
select is_empty(
  $$ update public.categories set deleted_at = now() where id = tests.id('cat_viaje') returning id $$,
  'categories: una ajena no borra categorías del grupo'
);

select is_empty(
  $$ select id from public.expenses where group_id = tests.id('viaje') $$,
  'expenses: una ajena no ve los gastos'
);
select throws_ok(
  $$
    insert into public.expenses
      (id, group_id, kind, title, amount, currency, group_amount, split_method, occurred_on)
    values
      (tests.id('nuevo_1'), tests.id('viaje'), 'expense', 'Intruso', 100, 'USD', 100, 'equal', '2026-10-11')
  $$,
  '42501',
  null,
  'expenses: una ajena no registra gastos'
);
select is_empty(
  $$ update public.expenses set amount = 1 where id = tests.id('gasto_viaje') returning id $$,
  'expenses: una ajena no edita gastos'
);
select is_empty(
  $$ update public.expenses set deleted_at = now() where id = tests.id('gasto_viaje') returning id $$,
  'expenses: una ajena no borra gastos'
);

select is_empty(
  $$ select id from public.expense_payers where group_id = tests.id('viaje') $$,
  'expense_payers: una ajena no ve los pagadores'
);
select throws_ok(
  $$
    insert into public.expense_payers (id, group_id, expense_id, member_id, amount, group_amount)
    values (tests.id('nuevo_1'), tests.id('viaje'), tests.id('gasto_viaje'), tests.id('viaje_beto'), 1, 1)
  $$,
  '42501',
  null,
  'expense_payers: una ajena no agrega pagadores'
);
select is_empty(
  $$ update public.expense_payers set amount = 1 where id = tests.id('pago_viaje') returning id $$,
  'expense_payers: una ajena no edita pagadores'
);
select is_empty(
  $$ update public.expense_payers set deleted_at = now() where id = tests.id('pago_viaje') returning id $$,
  'expense_payers: una ajena no borra pagadores'
);

select is_empty(
  $$ select id from public.expense_splits where group_id = tests.id('viaje') $$,
  'expense_splits: una ajena no ve las partes'
);
select throws_ok(
  $$
    insert into public.expense_splits (id, group_id, expense_id, member_id, amount, group_amount)
    values (tests.id('nuevo_1'), tests.id('viaje'), tests.id('gasto_viaje'), tests.id('viaje_xime'), 1, 1)
  $$,
  '42501',
  null,
  'expense_splits: una ajena no agrega partes'
);
select is_empty(
  $$ update public.expense_splits set amount = 1 where id = tests.id('parte_viaje_ana') returning id $$,
  'expense_splits: una ajena no edita partes'
);
select is_empty(
  $$ update public.expense_splits set deleted_at = now() where id = tests.id('parte_viaje_ana') returning id $$,
  'expense_splits: una ajena no borra partes'
);

select is_empty(
  $$ select id from public.transfers where group_id = tests.id('viaje') $$,
  'transfers: una ajena no ve las transferencias'
);
select throws_ok(
  $$
    insert into public.transfers
      (id, group_id, from_member_id, to_member_id, amount, currency, group_amount, occurred_on)
    values
      (tests.id('nuevo_1'), tests.id('viaje'), tests.id('viaje_ana'), tests.id('viaje_beto'), 1, 'USD', 1, '2026-10-11')
  $$,
  '42501',
  null,
  'transfers: una ajena no registra transferencias'
);
select is_empty(
  $$ update public.transfers set amount = 1 where id = tests.id('transf_viaje') returning id $$,
  'transfers: una ajena no edita transferencias'
);
select is_empty(
  $$ update public.transfers set deleted_at = now() where id = tests.id('transf_viaje') returning id $$,
  'transfers: una ajena no borra transferencias'
);

select results_eq(
  $$ select id from public.groups $$,
  $$ values (tests.id('casa')) $$,
  'groups: la ajena sí ve su propio grupo'
);
select is(
  (select count(*)::int from public.categories where key is not null),
  9,
  'categories: todos ven las 9 predefinidas'
);

-- Beto, miembro del grupo viaje ----------------------------------------------------------------

reset role;
select tests.autenticar_como(tests.id('beto'));

select results_eq(
  $$ select id from public.groups $$,
  $$ values (tests.id('viaje')) $$,
  'groups: un miembro ve su grupo y ningún otro'
);
select isnt_empty(
  $$ update public.groups set name = 'Viaje a Lima', version = version + 1 where id = tests.id('viaje') returning id $$,
  'groups: un miembro edita el grupo'
);
select lives_ok(
  $$
    insert into public.groups (id, name, currency, created_by)
    values (tests.id('nuevo_1'), 'Nuevo', 'USD', tests.id('beto'))
  $$,
  'groups: una cuenta crea un grupo a su nombre'
);

select is(
  (select count(*)::int from public.group_members),
  3,
  'group_members: un miembro ve los miembros de su grupo y de ningún otro'
);
select lives_ok(
  $$
    insert into public.group_members (id, group_id, user_id, display_name, role)
    values (tests.id('nuevo_2'), tests.id('viaje'), null, 'Nico', 'member')
  $$,
  'group_members: un miembro agrega un miembro sin cuenta'
);
select isnt_empty(
  $$ update public.group_members set display_name = 'Ximena' where id = tests.id('viaje_xime') returning id $$,
  'group_members: un miembro renombra a otro'
);
select isnt_empty(
  $$ update public.group_members set deleted_at = now() where id = tests.id('viaje_xime') returning id $$,
  'group_members: un miembro quita a otro (borrado lógico)'
);

select is(
  (select count(*)::int from public.categories),
  10,
  'categories: un miembro ve las predefinidas y las de su grupo, no las de otros'
);
select lives_ok(
  $$
    insert into public.categories (id, group_id, name, icon)
    values (tests.id('nuevo_2'), tests.id('viaje'), 'Museos', 'landmark')
  $$,
  'categories: un miembro crea una categoría en su grupo'
);
select isnt_empty(
  $$ update public.categories set name = 'Paseos' where id = tests.id('cat_viaje') returning id $$,
  'categories: un miembro edita una categoría de su grupo'
);
select isnt_empty(
  $$ update public.categories set deleted_at = now() where id = tests.id('cat_viaje') returning id $$,
  'categories: un miembro borra una categoría de su grupo'
);

select results_eq(
  $$ select id from public.expenses $$,
  $$ values (tests.id('gasto_viaje')) $$,
  'expenses: un miembro ve los gastos de su grupo y de ningún otro'
);
select lives_ok(
  $$
    insert into public.expenses
      (id, group_id, kind, title, amount, currency, group_amount, split_method, category_id, occurred_on)
    values
      (tests.id('nuevo_3'), tests.id('viaje'), 'income', 'Reembolso', 500, 'USD', 500, 'equal',
        tests.id('cat_comida'), '2026-10-11')
  $$,
  'expenses: un miembro registra un ingreso con una categoría predefinida'
);
select isnt_empty(
  $$ update public.expenses set title = 'Cena de despedida' where id = tests.id('gasto_viaje') returning id $$,
  'expenses: un miembro edita un gasto'
);
select isnt_empty(
  $$ update public.expenses set deleted_at = now() where id = tests.id('gasto_viaje') returning id $$,
  'expenses: un miembro borra un gasto (borrado lógico)'
);

select results_eq(
  $$ select id from public.expense_payers $$,
  $$ values (tests.id('pago_viaje')) $$,
  'expense_payers: un miembro ve los pagadores de su grupo y de ningún otro'
);
select lives_ok(
  $$
    insert into public.expense_payers (id, group_id, expense_id, member_id, amount, group_amount)
    values (tests.id('nuevo_1'), tests.id('viaje'), tests.id('gasto_viaje'), tests.id('viaje_beto'), 1000, 1000)
  $$,
  'expense_payers: un miembro agrega un pagador'
);
select isnt_empty(
  $$ update public.expense_payers set amount = 2000, group_amount = 2000 where id = tests.id('pago_viaje') returning id $$,
  'expense_payers: un miembro edita un pagador'
);
select isnt_empty(
  $$ update public.expense_payers set deleted_at = now() where id = tests.id('pago_viaje') returning id $$,
  'expense_payers: un miembro borra un pagador (borrado lógico)'
);

select results_eq(
  $$ select id from public.expense_splits order by id $$,
  $$ values (tests.id('parte_viaje_ana')), (tests.id('parte_viaje_beto')) $$,
  'expense_splits: un miembro ve las partes de su grupo y de ningún otro'
);
select lives_ok(
  $$
    insert into public.expense_splits (id, group_id, expense_id, member_id, amount, group_amount)
    values (tests.id('nuevo_1'), tests.id('viaje'), tests.id('gasto_viaje'), tests.id('viaje_xime'), 0, 0)
  $$,
  'expense_splits: un miembro agrega una parte'
);
select isnt_empty(
  $$ update public.expense_splits set input_value = 1 where id = tests.id('parte_viaje_ana') returning id $$,
  'expense_splits: un miembro edita una parte'
);
select isnt_empty(
  $$ update public.expense_splits set deleted_at = now() where id = tests.id('parte_viaje_ana') returning id $$,
  'expense_splits: un miembro borra una parte (borrado lógico)'
);

select results_eq(
  $$ select id from public.transfers $$,
  $$ values (tests.id('transf_viaje')) $$,
  'transfers: un miembro ve las transferencias de su grupo y de ningún otro'
);
select lives_ok(
  $$
    insert into public.transfers
      (id, group_id, from_member_id, to_member_id, amount, currency, group_amount, occurred_on)
    values
      (tests.id('nuevo_1'), tests.id('viaje'), tests.id('viaje_ana'), tests.id('viaje_beto'), 700, 'USD', 700, '2026-10-11')
  $$,
  'transfers: un miembro registra una transferencia'
);
select isnt_empty(
  $$ update public.transfers set amount = 1600, group_amount = 1600 where id = tests.id('transf_viaje') returning id $$,
  'transfers: un miembro edita una transferencia'
);
select isnt_empty(
  $$ update public.transfers set deleted_at = now() where id = tests.id('transf_viaje') returning id $$,
  'transfers: un miembro borra una transferencia (borrado lógico)'
);

-- Ni un miembro borra filas de verdad.
select throws_ok(
  $$ delete from public.groups where id = tests.id('viaje') $$,
  '42501', null, 'groups: nadie borra filas'
);
select throws_ok(
  $$ delete from public.group_members where id = tests.id('viaje_xime') $$,
  '42501', null, 'group_members: nadie borra filas'
);
select throws_ok(
  $$ delete from public.categories where id = tests.id('cat_viaje') $$,
  '42501', null, 'categories: nadie borra filas'
);
select throws_ok(
  $$ delete from public.expenses where id = tests.id('gasto_viaje') $$,
  '42501', null, 'expenses: nadie borra filas'
);
select throws_ok(
  $$ delete from public.expense_payers where id = tests.id('pago_viaje') $$,
  '42501', null, 'expense_payers: nadie borra filas'
);
select throws_ok(
  $$ delete from public.expense_splits where id = tests.id('parte_viaje_beto') $$,
  '42501', null, 'expense_splits: nadie borra filas'
);
select throws_ok(
  $$ delete from public.transfers where id = tests.id('transf_viaje') $$,
  '42501', null, 'transfers: nadie borra filas'
);

-- Beto, ya quitado del grupo -------------------------------------------------------------------

reset role;
update public.group_members set deleted_at = now() where id = tests.id('viaje_beto');
select tests.autenticar_como(tests.id('beto'));

select is_empty(
  $$ select id from public.groups where id = tests.id('viaje') $$,
  'Un ex miembro ya no ve el grupo'
);
select is_empty(
  $$ select id from public.expenses where group_id = tests.id('viaje') $$,
  'Un ex miembro ya no ve los gastos'
);
select throws_ok(
  $$
    insert into public.expenses
      (id, group_id, kind, title, amount, currency, group_amount, split_method, occurred_on)
    values
      (tests.id('nuevo_4'), tests.id('viaje'), 'expense', 'Tarde', 100, 'USD', 100, 'equal', '2026-10-11')
  $$,
  '42501',
  null,
  'Un ex miembro ya no registra gastos'
);

-- anon -----------------------------------------------------------------------------------------

reset role;
select tests.autenticar_como_anon();

select throws_ok(
  $$ select id from public.groups $$,
  '42501', null, 'anon no lee ninguna tabla'
);
select throws_ok(
  $$ insert into public.profiles (id, display_name) values (tests.id('dani'), 'Dani') $$,
  '42501', null, 'anon no inserta en ninguna tabla'
);
select throws_ok(
  $$ select private.is_group_member(tests.id('viaje')) $$,
  '42501', null, 'anon no llama a las funciones de private'
);

select * from finish();
rollback;
