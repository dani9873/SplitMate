-- Perfiles: ves el tuyo y el de quien comparte un grupo contigo, no el de un desconocido. Solo
-- editas el tuyo y solo creas el tuyo.
begin;
select plan(9);

select tests.crear_mundo();

-- Ana comparte el grupo viaje con Beto; Caro no comparte ninguno con ella.
select tests.autenticar_como(tests.id('ana'));

select results_eq(
  $$ select id from public.profiles order by id $$,
  $$ values (tests.id('ana')), (tests.id('beto')) $$,
  'Se ven el perfil propio y el de quien comparte un grupo, no el de un desconocido'
);
select isnt_empty(
  $$ update public.profiles set display_name = 'Ana María' where id = tests.id('ana') returning id $$,
  'Se edita el perfil propio'
);
select is_empty(
  $$ update public.profiles set display_name = 'Hackeado' where id = tests.id('beto') returning id $$,
  'No se edita el perfil de otro miembro'
);
select throws_ok(
  $$ update public.profiles set id = tests.id('dani') where id = tests.id('ana') $$,
  '42501', null, 'No se cambia el id del perfil'
);

-- Si Beto deja el grupo, Ana ya no ve su perfil.
reset role;
update public.group_members set deleted_at = now() where id = tests.id('viaje_beto');
select tests.autenticar_como(tests.id('ana'));

select results_eq(
  $$ select id from public.profiles $$,
  $$ values (tests.id('ana')) $$,
  'Sin un grupo activo en común, el perfil del otro deja de verse'
);

-- Dani tiene cuenta pero todavía no tiene perfil.
reset role;
select tests.autenticar_como(tests.id('dani'));

select throws_ok(
  $$ insert into public.profiles (id, display_name) values (tests.id('caro'), 'Caro falsa') $$,
  '42501', null, 'No se crea el perfil de otra cuenta'
);
select throws_ok(
  $$ insert into public.profiles (id, display_name) values (tests.id('dani'), '') $$,
  '23514', null, 'El nombre del perfil no puede quedar vacío'
);
select lives_ok(
  $$ insert into public.profiles (id, display_name) values (tests.id('dani'), 'Dani') $$,
  'Se crea el perfil propio'
);
select results_eq(
  $$ select display_name from public.profiles $$,
  $$ values ('Dani'::text) $$,
  'Y se ve después de crearlo'
);

select * from finish();
rollback;
