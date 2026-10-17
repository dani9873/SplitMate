-- Suplantación: nadie crea datos a nombre de otra cuenta, vincula a otra persona ni se mete en un
-- grupo ajeno. Solo el creador de un grupo agrega un dueño, y se agrega a su grupo vacío como su
-- primer miembro.
begin;
select plan(19);

select tests.crear_mundo();

-- Ana es miembro de viaje y de oficina ----------------------------------------------------------

select tests.autenticar_como(tests.id('ana'));

select throws_ok(
  $$
    insert into public.groups (id, name, currency, created_by)
    values (tests.id('nuevo_1'), 'Falso', 'USD', tests.id('caro'))
  $$,
  '42501', null, 'No se crea un grupo a nombre de otra cuenta'
);
select throws_ok(
  $$
    insert into public.groups (id, name, currency, created_by)
    values (tests.id('nuevo_1'), 'Sin dueño', 'USD', null)
  $$,
  '42501', null, 'No se crea un grupo sin creador'
);
select throws_ok(
  $$
    insert into public.group_members (id, group_id, user_id, display_name, role)
    values (tests.id('nuevo_1'), tests.id('viaje'), tests.id('caro'), 'Caro', 'member')
  $$,
  '42501', null, 'Un miembro no agrega a otra cuenta a su grupo'
);
select throws_ok(
  $$ update public.group_members set user_id = tests.id('caro') where id = tests.id('viaje_xime') $$,
  '42501', null, 'Nadie vincula un miembro a otra cuenta editando user_id'
);
select throws_ok(
  $$ update public.group_members set role = 'owner' where id = tests.id('viaje_beto') $$,
  '42501', null, 'Nadie cambia el rol de un miembro'
);
select throws_ok(
  $$ update public.groups set created_by = tests.id('beto') where id = tests.id('viaje') $$,
  '42501', null, 'Nadie cambia el creador de un grupo'
);
select throws_ok(
  $$ update public.expenses set group_id = tests.id('oficina') where id = tests.id('gasto_viaje') $$,
  '42501', null, 'Nadie mueve un gasto a otro grupo'
);
select throws_ok(
  $$
    insert into public.categories (id, group_id, key, icon)
    values (tests.id('nuevo_1'), null, 'pets', 'dog')
  $$,
  '42501', null, 'Nadie crea categorías predefinidas'
);
select is_empty(
  $$ update public.categories set icon = 'pizza' where id = tests.id('cat_comida') returning id $$,
  'Nadie edita categorías predefinidas'
);

-- Beto es miembro de viaje, pero no lo creó ------------------------------------------------------

reset role;
select tests.autenticar_como(tests.id('beto'));

select throws_ok(
  $$
    insert into public.group_members (id, group_id, user_id, display_name, role)
    values (tests.id('nuevo_1'), tests.id('viaje'), null, 'Jefa', 'owner')
  $$,
  '42501', null, 'Un miembro que no creó el grupo no agrega otro dueño'
);

-- Caro intenta entrar al grupo viaje -----------------------------------------------------------

reset role;
select tests.autenticar_como(tests.id('caro'));

select throws_ok(
  $$
    insert into public.group_members (id, group_id, user_id, display_name, role)
    values (tests.id('nuevo_1'), tests.id('viaje'), tests.id('caro'), 'Caro', 'member')
  $$,
  '42501', null, 'Una ajena no se agrega a un grupo con su cuenta'
);
select throws_ok(
  $$
    insert into public.group_members (id, group_id, user_id, display_name, role)
    values (tests.id('nuevo_1'), tests.id('viaje'), null, 'Caro', 'member')
  $$,
  '42501', null, 'Una ajena no se agrega a un grupo sin cuenta'
);
select throws_ok(
  $$ insert into public.profiles (id, display_name) values (tests.id('dani'), 'Dani falso') $$,
  '42501', null, 'Nadie crea el perfil de otra cuenta'
);

-- El creador de un grupo vacío se agrega como primer miembro ------------------------------------

select lives_ok(
  $$
    insert into public.groups (id, name, currency, created_by)
    values (tests.id('nuevo_2'), 'Gimnasio', 'USD', tests.id('caro'))
  $$,
  'Una cuenta crea un grupo a su nombre'
);

reset role;
select tests.autenticar_como(tests.id('ana'));

select throws_ok(
  $$
    insert into public.group_members (id, group_id, user_id, display_name, role)
    values (tests.id('nuevo_3'), tests.id('nuevo_2'), tests.id('ana'), 'Ana', 'owner')
  $$,
  '42501', null, 'Otra cuenta no se apropia de un grupo vacío ajeno'
);

reset role;
select tests.autenticar_como(tests.id('caro'));

select lives_ok(
  $$
    insert into public.group_members (id, group_id, user_id, display_name, role)
    values (tests.id('nuevo_3'), tests.id('nuevo_2'), tests.id('caro'), 'Caro', 'owner')
  $$,
  'El creador se agrega como primer miembro de su grupo vacío'
);
select isnt_empty(
  $$ select id from public.groups where id = tests.id('nuevo_2') $$,
  'Después ya ve su grupo nuevo'
);
select throws_ok(
  $$
    insert into public.group_members (id, group_id, user_id, display_name, role)
    values (tests.id('nuevo_4'), tests.id('nuevo_2'), tests.id('caro'), 'Caro otra vez', 'member')
  $$,
  '23505', null, 'Un solo "yo" por grupo: el creador no se agrega dos veces con su cuenta'
);
select lives_ok(
  $$
    insert into public.group_members (id, group_id, user_id, display_name, role)
    values (tests.id('nuevo_4'), tests.id('nuevo_2'), null, 'Zoe', 'member')
  $$,
  'Y agrega miembros sin cuenta como cualquier miembro'
);

select * from finish();
rollback;
