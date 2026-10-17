-- Base de la sincronización (Fase 4a, design/fase-4a/diseno.md): columnas que pone el servidor,
-- secuencia de cambios por grupo, guardia de escritura, moneda del grupo, "soy yo" y acceso del
-- creador. Como authenticated, las escrituras llevan la marca de sync_push (tests.autenticar_como);
-- la guardia se prueba sin ella. Para preparar valores viejos se apaga un trigger como postgres.
begin;
select plan(46);

select tests.crear_mundo();

-- Columnas que pone el servidor ----------------------------------------------------------------

select tests.autenticar_como(tests.id('ana'));

insert into public.group_members
  (id, group_id, display_name, role, created_at, updated_at, version, change_seq)
values
  (tests.id('nuevo_1'), tests.id('viaje'), 'Nico', 'member', '2000-01-01', '2000-01-01', 99, 999999);

select ok(
  (
    select created_at = now() and updated_at = now() and version = 1
      and change_seq between 1 and 999998
    from public.group_members
    where id = tests.id('nuevo_1')
  ),
  'Al insertar, el servidor pone created_at, updated_at, version 1 y change_seq aunque el cliente mande otros'
);

reset role;
alter table public.group_members disable trigger group_members_sync_stamp;
update public.group_members
set created_at = '2001-01-01', updated_at = '2001-01-01', version = 5
where id = tests.id('nuevo_1');
alter table public.group_members enable trigger group_members_sync_stamp;
select tests.autenticar_como(tests.id('ana'));

update public.group_members set display_name = 'Nicolás' where id = tests.id('nuevo_1');
select ok(
  (
    select created_at = '2001-01-01'::timestamptz and updated_at = now() and version = 6
    from public.group_members
    where id = tests.id('nuevo_1')
  ),
  'Al editar, version sube en 1, created_at no cambia y updated_at es la hora del servidor'
);

update public.group_members set deleted_at = '2001-01-01' where id = tests.id('nuevo_1');
select ok(
  (select deleted_at = now() from public.group_members where id = tests.id('nuevo_1')),
  'Al borrar, deleted_at es la hora del servidor, no la del cliente'
);

reset role;
alter table public.group_members disable trigger group_members_sync_stamp;
update public.group_members set deleted_at = '2001-01-01' where id = tests.id('nuevo_1');
alter table public.group_members enable trigger group_members_sync_stamp;
select tests.autenticar_como(tests.id('ana'));

update public.group_members
set display_name = 'Nico', deleted_at = '2002-02-02'
where id = tests.id('nuevo_1');
select ok(
  (
    select deleted_at = '2001-01-01'::timestamptz
    from public.group_members
    where id = tests.id('nuevo_1')
  ),
  'Una fila ya borrada conserva el instante de su borrado'
);

update public.group_members set deleted_at = null where id = tests.id('nuevo_1');
select ok(
  (select deleted_at is null from public.group_members where id = tests.id('nuevo_1')),
  'Restaurar deja deleted_at nulo'
);

update public.groups set archived_at = '2001-01-01' where id = tests.id('oficina');
select ok(
  (select archived_at = now() from public.groups where id = tests.id('oficina')),
  'Al archivar, archived_at es la hora del servidor'
);

reset role;
alter table public.groups disable trigger groups_sync_stamp;
update public.groups set archived_at = '2001-01-01' where id = tests.id('oficina');
alter table public.groups enable trigger groups_sync_stamp;
select tests.autenticar_como(tests.id('ana'));

update public.groups
set name = 'Oficina central', archived_at = '2003-03-03'
where id = tests.id('oficina');
select ok(
  (select archived_at = '2001-01-01'::timestamptz from public.groups where id = tests.id('oficina')),
  'Un grupo ya archivado conserva el instante de su archivado'
);

-- Secuencia de cambios por grupo ---------------------------------------------------------------

select tests.autenticar_como(tests.id('ana'));
insert into public.group_members (id, group_id, display_name, role) values
  (tests.id('nuevo_2'), tests.id('viaje'), 'Olga', 'member'),
  (tests.id('nuevo_3'), tests.id('viaje'), 'Pepe', 'member');

reset role;

create temp view cambios_viaje as
  select change_seq from public.groups where id = tests.id('viaje')
  union all select change_seq from public.group_members where group_id = tests.id('viaje')
  union all select change_seq from public.categories where group_id = tests.id('viaje')
  union all select change_seq from public.expenses where group_id = tests.id('viaje')
  union all select change_seq from public.expense_payers where group_id = tests.id('viaje')
  union all select change_seq from public.expense_splits where group_id = tests.id('viaje')
  union all select change_seq from public.transfers where group_id = tests.id('viaje');

select is(
  (select last_seq from private.group_changes where group_id = tests.id('viaje')),
  (select max(change_seq) from cambios_viaje),
  'El contador del grupo es el change_seq más alto de sus filas'
);
select is(
  (select (count(*) - count(distinct change_seq))::int from cambios_viaje),
  0,
  'Cada cambio de un grupo tiene su propio change_seq, en todas sus tablas'
);
select ok(
  (
    select b.change_seq = a.change_seq + 1
    from public.group_members a, public.group_members b
    where a.id = tests.id('nuevo_2') and b.id = tests.id('nuevo_3')
  ),
  'Dos filas de una misma escritura reciben números seguidos'
);

create temp table contadores_antes as select group_id, last_seq from private.group_changes;
update public.expenses set title = 'Luz y agua' where id = tests.id('gasto_casa');
select ok(
  (
    select bool_and(
      g.last_seq = a.last_seq + case when g.group_id = tests.id('casa') then 1 else 0 end
    )
    from private.group_changes g
    join contadores_antes a using (group_id)
  ),
  'Un cambio en un grupo avanza solo su contador'
);
select is(
  (select count(*)::int from public.categories where group_id is null and change_seq <> 0),
  0,
  'Las categorías predefinidas no entran en ninguna secuencia'
);

-- Guardia: authenticated escribe solo dentro de sync_push ---------------------------------------

select tests.autenticar_como(tests.id('ana'));
select tests.sin_marca_sync();

select throws_ok(
  $$
    insert into public.groups (id, name, currency, created_by)
    values (tests.id('nuevo_4'), 'Directo', 'USD', tests.id('ana'))
  $$,
  '42501', null, 'Guardia: sin sync_push no se inserta en groups'
);
select throws_ok(
  $$ update public.groups set name = 'Directo' where id = tests.id('viaje') $$,
  '42501', null, 'Guardia: sin sync_push no se edita groups'
);
select throws_ok(
  $$
    insert into public.group_members (id, group_id, display_name, role)
    values (tests.id('nuevo_4'), tests.id('viaje'), 'Directo', 'member')
  $$,
  '42501', null, 'Guardia: sin sync_push no se inserta en group_members'
);
select throws_ok(
  $$ update public.group_members set display_name = 'Directo' where id = tests.id('viaje_xime') $$,
  '42501', null, 'Guardia: sin sync_push no se edita group_members'
);
select throws_ok(
  $$
    insert into public.categories (id, group_id, name, icon)
    values (tests.id('nuevo_4'), tests.id('viaje'), 'Directa', 'tag')
  $$,
  '42501', null, 'Guardia: sin sync_push no se inserta en categories'
);
select throws_ok(
  $$ update public.categories set name = 'Directa' where id = tests.id('cat_viaje') $$,
  '42501', null, 'Guardia: sin sync_push no se edita categories'
);
select throws_ok(
  $$
    insert into public.expenses
      (id, group_id, kind, title, amount, currency, group_currency, group_amount, split_method,
        occurred_on)
    values
      (tests.id('nuevo_4'), tests.id('viaje'), 'expense', 'Directo', 100, 'USD', 'USD', 100, 'equal',
        '2026-10-12')
  $$,
  '42501', null, 'Guardia: sin sync_push no se inserta en expenses'
);
select throws_ok(
  $$ update public.expenses set title = 'Directo' where id = tests.id('gasto_viaje') $$,
  '42501', null, 'Guardia: sin sync_push no se edita expenses'
);
select throws_ok(
  $$
    insert into public.expense_payers (id, group_id, expense_id, member_id, amount, group_amount)
    values (tests.id('nuevo_4'), tests.id('viaje'), tests.id('gasto_viaje'), tests.id('viaje_beto'), 1, 1)
  $$,
  '42501', null, 'Guardia: sin sync_push no se inserta en expense_payers'
);
select throws_ok(
  $$ update public.expense_payers set deleted_at = now() where id = tests.id('pago_viaje') $$,
  '42501', null, 'Guardia: sin sync_push no se edita expense_payers'
);
select throws_ok(
  $$
    insert into public.expense_splits (id, group_id, expense_id, member_id, amount, group_amount)
    values (tests.id('nuevo_4'), tests.id('viaje'), tests.id('gasto_viaje'), tests.id('viaje_xime'), 0, 0)
  $$,
  '42501', null, 'Guardia: sin sync_push no se inserta en expense_splits'
);
select throws_ok(
  $$ update public.expense_splits set deleted_at = now() where id = tests.id('parte_viaje_ana') $$,
  '42501', null, 'Guardia: sin sync_push no se edita expense_splits'
);
select throws_ok(
  $$
    insert into public.transfers
      (id, group_id, from_member_id, to_member_id, amount, currency, group_currency, group_amount,
        occurred_on)
    values
      (tests.id('nuevo_4'), tests.id('viaje'), tests.id('viaje_ana'), tests.id('viaje_beto'), 1,
        'USD', 'USD', 1, '2026-10-12')
  $$,
  '42501', null, 'Guardia: sin sync_push no se inserta en transfers'
);
select throws_ok(
  $$ update public.transfers set amount = 1 where id = tests.id('transf_viaje') $$,
  '42501', null, 'Guardia: sin sync_push no se edita transfers'
);

reset role;
select lives_ok(
  $$ update public.groups set name = 'Viaje' where id = tests.id('viaje') $$,
  'postgres escribe sin pasar por sync_push (migraciones y cascadas)'
);

-- Moneda del grupo y de sus movimientos --------------------------------------------------------

select tests.autenticar_como(tests.id('ana'));

select throws_ok(
  $$ update public.groups set currency = 'EUR' where id = tests.id('viaje') $$,
  'SMCUR', null, 'La moneda de un grupo no cambia si tiene movimientos activos'
);

reset role;
update public.expenses set deleted_at = now() where id = tests.id('gasto_oficina');
select tests.autenticar_como(tests.id('ana'));

select lives_ok(
  $$ update public.groups set currency = 'EUR' where id = tests.id('oficina') $$,
  'Con sus movimientos borrados, la moneda sí cambia'
);
select throws_ok(
  $$
    insert into public.expenses
      (id, group_id, kind, title, amount, currency, group_currency, group_amount, split_method,
        occurred_on)
    values
      (tests.id('nuevo_4'), tests.id('viaje'), 'expense', 'Taxi', 100, 'USD', 'EUR', 100, 'equal',
        '2026-10-12')
  $$,
  'SMGCC', null, 'Un gasto calculado con otra moneda de grupo no entra'
);
select throws_ok(
  $$
    insert into public.transfers
      (id, group_id, from_member_id, to_member_id, amount, currency, group_currency, group_amount,
        occurred_on)
    values
      (tests.id('nuevo_4'), tests.id('viaje'), tests.id('viaje_ana'), tests.id('viaje_beto'), 100,
        'USD', 'EUR', 100, '2026-10-12')
  $$,
  'SMGCC', null, 'Una transferencia calculada con otra moneda de grupo no entra'
);
select lives_ok(
  $$
    insert into public.expenses
      (id, group_id, kind, title, amount, currency, group_currency, group_amount, split_method,
        occurred_on)
    values
      (tests.id('nuevo_4'), tests.id('viaje'), 'expense', 'Taxi', 100, 'USD', 'USD', 100, 'equal',
        '2026-10-12')
  $$,
  'Con la moneda del grupo, sí entra'
);
select throws_ok(
  $$ update public.expenses set deleted_at = null where id = tests.id('gasto_oficina') $$,
  'SMGCC', null, 'Un movimiento borrado no vuelve si la moneda de su grupo cambió'
);
select lives_ok(
  $$ update public.expenses set title = 'Café viejo' where id = tests.id('gasto_oficina') $$,
  'Un movimiento borrado con otra moneda se puede seguir editando: no está activo'
);

-- "Soy yo": cada cuenta vincula y desvincula solo la suya --------------------------------------

select throws_ok(
  $$ update public.group_members set user_id = tests.id('caro') where id = tests.id('viaje_xime') $$,
  '42501', null, 'Nadie vincula un miembro a otra cuenta'
);
select throws_ok(
  $$ update public.group_members set user_id = null where id = tests.id('viaje_beto') $$,
  '42501', null, 'Nadie desvincula la cuenta de otra persona'
);
select lives_ok(
  $$ update public.group_members set user_id = null where id = tests.id('viaje_ana') $$,
  'Cada cuenta se desvincula a sí misma'
);
select lives_ok(
  $$ update public.group_members set user_id = tests.id('ana') where id = tests.id('viaje_xime') $$,
  'Y se vincula a otro miembro: "soy yo" cambia de miembro'
);
select throws_ok(
  $$ update public.group_members set user_id = tests.id('ana') where id = tests.id('nuevo_1') $$,
  '23505', null, 'Un solo "yo" por grupo'
);

-- Acceso del creador ---------------------------------------------------------------------------

reset role;
update public.group_members set user_id = null where id = tests.id('oficina_ana');
select tests.autenticar_como(tests.id('ana'));

select isnt_empty(
  $$ select id from public.groups where id = tests.id('oficina') $$,
  'El creador ve su grupo aunque no tenga un miembro vinculado'
);
select isnt_empty(
  $$ select id from public.group_members where group_id = tests.id('oficina') $$,
  'Y ve sus miembros'
);
select lives_ok(
  $$
    insert into public.group_members (id, group_id, user_id, display_name, role)
    values (tests.id('nuevo_5'), tests.id('oficina'), null, 'Quique', 'member')
  $$,
  'Y escribe en él'
);

reset role;
select tests.autenticar_como(tests.id('beto'));
select throws_ok(
  $$
    insert into public.group_members (id, group_id, user_id, display_name, role)
    values (tests.id('nuevo_6'), tests.id('viaje'), null, 'Jefa', 'owner')
  $$,
  '42501', null, 'Un miembro que no creó el grupo no agrega un dueño'
);

reset role;
select tests.autenticar_como(tests.id('ana'));
select lives_ok(
  $$
    insert into public.group_members (id, group_id, user_id, display_name, role)
    values (tests.id('nuevo_6'), tests.id('viaje'), null, 'Jefa', 'owner')
  $$,
  'El creador sí agrega un dueño'
);
select throws_ok(
  $$ select * from private.group_changes $$,
  '42501', null, 'authenticated no lee los contadores de cambios'
);

-- Borrar una cuenta también cuenta como cambio -------------------------------------------------

reset role;
create temp table beto_antes as
  select change_seq, version from public.group_members where id = tests.id('viaje_beto');
delete from auth.users where id = tests.id('beto');
select ok(
  (
    select m.user_id is null and m.change_seq > a.change_seq and m.version = a.version + 1
    from public.group_members m, beto_antes a
    where m.id = tests.id('viaje_beto')
  ),
  'Borrar una cuenta deja su miembro sin cuenta, con un change_seq y una versión nuevos'
);

select * from finish();
rollback;
