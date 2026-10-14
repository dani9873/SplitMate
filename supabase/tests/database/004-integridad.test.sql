-- Integridad entre grupos: aunque una cuenta sea miembro de dos grupos, un pagador, una parte,
-- una transferencia o una categoría no cruzan de uno a otro.
begin;
select plan(8);

select tests.crear_mundo();

-- Ana es miembro de viaje y de oficina.
select tests.autenticar_como(tests.id('ana'));

select throws_ok(
  $$
    insert into public.expense_payers (id, group_id, expense_id, member_id, amount, group_amount)
    values (tests.id('nuevo_1'), tests.id('viaje'), tests.id('gasto_viaje'), tests.id('oficina_yago'), 1, 1)
  $$,
  '23503', null, 'Un pagador de otro grupo no entra'
);
select throws_ok(
  $$
    insert into public.expense_payers (id, group_id, expense_id, member_id, amount, group_amount)
    values (tests.id('nuevo_1'), tests.id('oficina'), tests.id('gasto_viaje'), tests.id('oficina_yago'), 1, 1)
  $$,
  '23503', null, 'Un pagador no apunta al gasto de otro grupo cambiando su group_id'
);
select throws_ok(
  $$
    insert into public.expense_splits (id, group_id, expense_id, member_id, amount, group_amount)
    values (tests.id('nuevo_1'), tests.id('viaje'), tests.id('gasto_viaje'), tests.id('oficina_yago'), 1, 1)
  $$,
  '23503', null, 'Una parte de otro grupo no entra'
);
select throws_ok(
  $$
    insert into public.transfers
      (id, group_id, from_member_id, to_member_id, amount, currency, group_amount, occurred_on)
    values
      (tests.id('nuevo_1'), tests.id('viaje'), tests.id('viaje_ana'), tests.id('oficina_yago'), 1, 'USD', 1, '2026-10-11')
  $$,
  '23503', null, 'Una transferencia no va a un miembro de otro grupo'
);
select throws_ok(
  $$
    insert into public.expenses
      (id, group_id, kind, title, amount, currency, group_amount, split_method, category_id, occurred_on)
    values
      (tests.id('nuevo_1'), tests.id('viaje'), 'expense', 'Café', 100, 'USD', 100, 'equal',
        tests.id('cat_oficina'), '2026-10-11')
  $$,
  '23503', null, 'Un gasto no usa la categoría de otro grupo'
);
select throws_ok(
  $$ update public.expenses set category_id = tests.id('cat_oficina') where id = tests.id('gasto_viaje') $$,
  '23503', null, 'Un gasto no cambia a la categoría de otro grupo'
);
select throws_ok(
  $$ update public.expenses set category_id = tests.id('cat_casa') where id = tests.id('gasto_viaje') $$,
  '23503', null, 'Un gasto no usa la categoría de un grupo ajeno'
);
select lives_ok(
  $$ update public.expenses set category_id = tests.id('cat_comida') where id = tests.id('gasto_viaje') $$,
  'Un gasto sí usa una categoría predefinida'
);

select * from finish();
rollback;
