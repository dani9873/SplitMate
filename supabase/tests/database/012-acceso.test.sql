-- Acceso por membresía (Fase 4b, design/fase-4b/diseno.md, sección b): group_access manda sobre
-- quién abre un grupo. Cubre el relleno de los grupos existentes (con datos reales y repetido), la
-- lectura y la escritura de la tabla, el INSERT ... RETURNING del creador, el dueño único, las
-- reglas nuevas de sync_push, leave_group, remove_access y borrar una cuenta con grupos
-- compartidos. Los ids nuevos son tests.mid(n); los grupos son 301 a 312.
begin;
select plan(81);

select tests.crear_mundo();

create function tests.mid(p_n integer) returns uuid language sql immutable as $$
  select format('01990000-0000-7000-8000-%s', lpad(p_n::text, 12, '0'))::uuid
$$;
create function tests.mt(p_n integer, p_entity text, p_base integer, p_data jsonb)
returns jsonb language sql as $$
  select jsonb_build_object('id', tests.mid(p_n), 'entity', p_entity, 'base', p_base, 'data', p_data)
$$;
-- El grupo viaje del mundo de prueba (versión 1) con los cambios que se pidan.
create function tests.d_viaje(p_over jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', tests.id('viaje'), 'name', 'Viaje', 'currency', 'USD',
    'emoji', null, 'color', 'teal', 'archived', false, 'deleted', false) || p_over
$$;
create function tests.d_miembro_viaje(p_nombre text, p_over jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object('id', tests.id(p_nombre), 'group_id', tests.id('viaje'),
    'display_name', initcap(split_part(p_nombre, '_', 2)), 'user_id', null, 'role', 'member',
    'deleted', false) || p_over
$$;
create temp table res (k text primary key, j jsonb);
grant all on res to authenticated;
create function tests.st(p_k text, p_i integer default 0) returns text language sql as $$
  select j -> p_i ->> 'status' from res where k = p_k
$$;
create function tests.re(p_k text, p_i integer default 0) returns text language sql as $$
  select j -> p_i ->> 'reason' from res where k = p_k
$$;
create function tests.acc(p_group uuid, p_user uuid) returns text language sql as $$
  select role || case when deleted_at is null then '' else '/fuera' end
  from public.group_access where group_id = p_group and user_id = p_user
$$;
grant execute on all functions in schema tests to authenticated;

-- Relleno de los grupos existentes, con datos reales ----------------------------------------------

insert into public.profiles (id, display_name) values (tests.id('dani'), 'Dani');

-- G1: solo el creador. G2: creadora Caro con tres cuentas vinculadas y una borrada. G3: grupo
-- borrado lógicamente. G4: sin creador (su cuenta se borró) y con dos cuentas. G5: sin nadie.
insert into public.groups (id, name, currency, created_by, deleted_at) values
  (tests.mid(301), 'Solo creador', 'USD', tests.id('ana'), null),
  (tests.mid(302), 'Varios', 'USD', tests.id('caro'), null),
  (tests.mid(303), 'Borrado', 'USD', tests.id('beto'), now()),
  (tests.mid(304), 'Sin creador', 'USD', null, null),
  (tests.mid(305), 'Vacío', 'USD', null, null);
insert into public.group_members (id, group_id, user_id, display_name, role, deleted_at) values
  (tests.mid(321), tests.mid(302), tests.id('caro'), 'Caro', 'owner', null),
  (tests.mid(322), tests.mid(302), tests.id('ana'), 'Ana', 'member', null),
  (tests.mid(323), tests.mid(302), tests.id('beto'), 'Beto', 'member', null),
  (tests.mid(324), tests.mid(302), tests.id('dani'), 'Dani', 'member', now()),
  (tests.mid(331), tests.mid(303), tests.id('beto'), 'Beto', 'owner', null),
  (tests.mid(341), tests.mid(304), tests.id('ana'), 'Ana', 'member', null),
  (tests.mid(342), tests.mid(304), tests.id('beto'), 'Beto', 'member', null);

-- Como estaba la base antes de esta migración: nadie tiene filas de acceso.
delete from public.group_access;

select is(
  private.backfill_group_access(),
  11,
  'El relleno crea las 11 filas de acceso que corresponden'
);
select set_eq(
  $$ select group_id, user_id, role from public.group_access $$,
  $$
    values
      (tests.id('viaje'), tests.id('ana'), 'owner'),
      (tests.id('viaje'), tests.id('beto'), 'member'),
      (tests.id('oficina'), tests.id('ana'), 'owner'),
      (tests.id('casa'), tests.id('caro'), 'owner'),
      (tests.mid(301), tests.id('ana'), 'owner'),
      (tests.mid(302), tests.id('caro'), 'owner'),
      (tests.mid(302), tests.id('ana'), 'member'),
      (tests.mid(302), tests.id('beto'), 'member'),
      (tests.mid(303), tests.id('beto'), 'owner'),
      (tests.mid(304), tests.id('ana'), 'owner'),
      (tests.mid(304), tests.id('beto'), 'member')
  $$,
  'Dueño el creador (también en un grupo borrado), miembro cada cuenta vinculada activa, y sin creador el vínculo más antiguo es el dueño'
);
select is_empty(
  $$ select 1 from public.group_access where group_id = tests.mid(305) $$,
  'Un grupo sin creador ni cuentas vinculadas queda sin acceso'
);
select is(
  private.backfill_group_access(),
  0,
  'Repetir el relleno no agrega nada'
);
select is(
  (select count(*)::integer from public.group_access),
  11,
  'Y no duplica filas'
);
select is_empty(
  $$ select 1 from public.group_access where change_seq < 1 or version <> 1 $$,
  'Las filas del relleno pasaron por el trigger de columnas: tienen change_seq'
);
select is_empty(
  $$
    select group_id from public.group_access
    where role = 'owner' and deleted_at is null
    group by group_id having count(*) > 1
  $$,
  'Ningún grupo queda con dos dueños'
);

update public.group_access set deleted_at = now()
where group_id = tests.id('viaje') and user_id = tests.id('beto');
select private.backfill_group_access();
select is(
  tests.acc(tests.id('viaje'), tests.id('beto')),
  'member/fuera',
  'El relleno no devuelve el acceso a quien ya lo perdió'
);
update public.group_access set deleted_at = null
where group_id = tests.id('viaje') and user_id = tests.id('beto');

-- Lectura de group_access --------------------------------------------------------------------------

select tests.autenticar_como(tests.id('ana'));
select is(
  (select count(*)::integer from public.group_access where group_id in (tests.id('viaje'), tests.id('oficina'))),
  3,
  'Ana lee el acceso de sus grupos (viaje: ella y Beto; oficina: ella)'
);
select is_empty(
  $$ select 1 from public.group_access where group_id = tests.id('casa') $$,
  'Y nada del de casa, que no es suyo'
);
select isnt_empty(
  $$ select id from public.groups where id = tests.id('viaje') $$,
  'Ana ve su grupo'
);
select is_empty(
  $$ select id from public.groups where id = tests.id('casa') $$,
  'Y no el ajeno'
);

reset role;
select tests.autenticar_como(tests.id('beto'));
select is_empty(
  $$
    select 1 from public.group_access
    where group_id not in (tests.id('viaje'), tests.mid(302), tests.mid(303), tests.mid(304))
  $$,
  'Beto lee solo el acceso de los grupos donde tiene el suyo'
);
select is_empty(
  $$ select id from public.groups where id = tests.id('oficina') $$,
  'Beto no ve oficina'
);

-- Escritura de group_access ------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.group_access (group_id, user_id, role) values (tests.id('viaje'), tests.id('beto'), 'member') $$,
  '42501', null, 'authenticated no inserta en group_access'
);
select throws_ok(
  $$ update public.group_access set role = 'owner' where group_id = tests.id('viaje') $$,
  '42501', null, 'authenticated no edita group_access'
);
select throws_ok(
  $$ delete from public.group_access where group_id = tests.id('viaje') $$,
  '42501', null, 'authenticated no borra de group_access'
);

reset role;
select tests.autenticar_como_anon();
select throws_ok(
  $$ select 1 from public.group_access $$,
  '42501', null, 'anon no lee group_access'
);
select throws_ok(
  $$ select public.leave_group(tests.id('viaje')) $$,
  '42501', null, 'anon no ejecuta leave_group'
);
select throws_ok(
  $$ select public.remove_access(tests.id('viaje'), tests.id('beto')) $$,
  '42501', null, 'anon no ejecuta remove_access'
);
reset role;

-- El creador de un grupo nuevo ----------------------------------------------------------------------

select tests.autenticar_como(tests.id('caro'));
select lives_ok(
  $$
    with nuevo as (
      insert into public.groups (id, name, currency, created_by)
      values (tests.mid(307), 'Nuevo', 'USD', tests.id('caro'))
      returning id
    )
    select id from nuevo
  $$,
  'El creador inserta su grupo con RETURNING aunque todavía no tenga acceso'
);
select is(
  tests.acc(tests.mid(307), tests.id('caro')),
  'owner',
  'Y queda como dueño por el trigger del grupo'
);
select isnt_empty(
  $$ select id from public.groups where id = tests.mid(307) $$,
  'Después ve su grupo por su acceso'
);

reset role;
alter table public.groups disable trigger groups_owner_access;
insert into public.groups (id, name, currency, created_by)
values (tests.mid(306), 'Sin filas', 'USD', tests.id('caro'));
alter table public.groups enable trigger groups_owner_access;
select tests.autenticar_como(tests.id('caro'));
select isnt_empty(
  $$ select id from public.groups where id = tests.mid(306) $$,
  'Un grupo sin ninguna fila de acceso lo ve su creador (así nace)'
);
reset role;
select tests.autenticar_como(tests.id('beto'));
select is_empty(
  $$ select id from public.groups where id = tests.mid(306) $$,
  'Y no otra cuenta'
);
reset role;

-- Dueño único --------------------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.group_access (group_id, user_id, role) values (tests.id('viaje'), tests.id('caro'), 'owner') $$,
  '23505', null, 'Un grupo no tiene dos dueños activos'
);
select lives_ok(
  $$ insert into public.group_access (group_id, user_id, role) values (tests.id('viaje'), tests.id('caro'), 'member') $$,
  'Pero sí otras cuentas como miembro'
);
delete from public.group_access where group_id = tests.id('viaje') and user_id = tests.id('caro');

-- Reglas de sync_push --------------------------------------------------------------------------------

-- Borrar o restaurar un grupo: solo el dueño. Archivarlo, cualquiera con acceso.
select tests.autenticar_como(tests.id('beto'));
insert into res select 'borrar_beto', public.sync_push(jsonb_build_array(
  tests.mt(1001, 'group', 1, tests.d_viaje(jsonb_build_object('deleted', true)))
));
select is(tests.re('borrar_beto'), 'forbidden', 'Un miembro no borra el grupo: forbidden');
insert into res select 'archivar_beto', public.sync_push(jsonb_build_array(
  tests.mt(1002, 'group', 1, tests.d_viaje(jsonb_build_object('archived', true)))
));
select is(tests.st('archivar_beto'), 'applied', 'Pero sí lo archiva');

reset role;
select tests.autenticar_como(tests.id('ana'));
insert into res select 'borrar_ana', public.sync_push(jsonb_build_array(
  tests.mt(1003, 'group', 2, tests.d_viaje(jsonb_build_object('archived', true, 'deleted', true)))
));
select is(tests.st('borrar_ana'), 'applied', 'El dueño borra el grupo');

reset role;
select tests.autenticar_como(tests.id('beto'));
insert into res select 'restaurar_beto', public.sync_push(jsonb_build_array(
  tests.mt(1004, 'group', 3, tests.d_viaje(jsonb_build_object('archived', true)))
));
select is(tests.re('restaurar_beto'), 'forbidden', 'Un miembro no restaura el grupo: forbidden');

reset role;
select tests.autenticar_como(tests.id('ana'));
insert into res select 'restaurar_ana', public.sync_push(jsonb_build_array(
  tests.mt(1005, 'group', 3, tests.d_viaje(jsonb_build_object('archived', true)))
));
select is(tests.st('restaurar_ana'), 'applied', 'El dueño lo restaura');

-- Borrar un miembro vinculado a una cuenta con acceso: rejected member_linked. El "yo" propio se
-- desvincula sin perder el acceso.
reset role;
insert into public.group_members (id, group_id, user_id, display_name, role)
values (tests.mid(381), tests.id('viaje'), tests.id('dani'), 'Dani', 'member');
select tests.autenticar_como(tests.id('ana'));
insert into res select 'borrar_con_cuenta', public.sync_push(jsonb_build_array(
  tests.mt(1010, 'member', 1, tests.d_miembro_viaje('viaje_beto', jsonb_build_object('user_id', tests.id('beto'), 'deleted', true))),
  tests.mt(1011, 'member', 1, tests.d_miembro_viaje('viaje_xime', jsonb_build_object('deleted', true))),
  tests.mt(1012, 'member', 1, jsonb_build_object('id', tests.mid(381), 'group_id', tests.id('viaje'),
    'display_name', 'Dani', 'user_id', tests.id('dani'), 'role', 'member', 'deleted', true)),
  tests.mt(1013, 'member', 1, tests.d_miembro_viaje('viaje_beto', jsonb_build_object('user_id', null)))
));
select is(tests.st('borrar_con_cuenta', 0), 'rejected', 'Borrar el miembro de una cuenta con acceso se rechaza');
select is(tests.re('borrar_con_cuenta', 0), 'member_linked', 'Con el motivo member_linked');
select is(
  (select jsonb_array_length(j -> 0 -> 'current') from res where k = 'borrar_con_cuenta'),
  1,
  'Y trae el miembro actual para el borrador'
);
select is(tests.st('borrar_con_cuenta', 1), 'applied', 'Un miembro sin cuenta se borra');
select is(tests.st('borrar_con_cuenta', 2), 'applied', 'Y también el vinculado a una cuenta que ya no tiene acceso');
select is(tests.re('borrar_con_cuenta', 3), 'forbidden', 'Nadie desvincula la cuenta de otra persona');
select ok(
  (select deleted_at is null and user_id = tests.id('beto') from public.group_members where id = tests.id('viaje_beto')),
  'Y el miembro de Beto no cambió'
);

reset role;
select tests.autenticar_como(tests.id('beto'));
insert into res select 'beto_yo', public.sync_push(jsonb_build_array(
  tests.mt(1020, 'member', 1, tests.d_miembro_viaje('viaje_beto', jsonb_build_object('user_id', tests.id('beto'), 'deleted', true))),
  tests.mt(1021, 'member', 1, tests.d_miembro_viaje('viaje_beto', jsonb_build_object('user_id', null)))
));
select is(tests.re('beto_yo', 0), 'member_linked', 'Tampoco se borra su propio miembro mientras tenga acceso');
select is(tests.st('beto_yo', 1), 'applied', 'Pero sí desvincula su propio "soy yo"');
select isnt_empty(
  $$ select id from public.groups where id = tests.id('viaje') $$,
  'Y desvincularse no le quita el acceso'
);
insert into res select 'beto_borra', public.sync_push(jsonb_build_array(
  tests.mt(1022, 'member', 2, tests.d_miembro_viaje('viaje_beto', jsonb_build_object('deleted', true)))
));
select is(tests.st('beto_borra'), 'applied', 'Ya sin vínculo, ese miembro se borra como cualquier otro');
reset role;

-- leave_group ---------------------------------------------------------------------------------------

-- Equipo: Ana (dueña), Beto y Caro, cada una con su miembro vinculado.
insert into public.groups (id, name, currency, created_by)
values (tests.mid(310), 'Equipo', 'USD', tests.id('ana'));
insert into public.group_members (id, group_id, user_id, display_name, role) values
  (tests.mid(351), tests.mid(310), tests.id('ana'), 'Ana', 'owner'),
  (tests.mid(352), tests.mid(310), tests.id('beto'), 'Beto', 'member'),
  (tests.mid(353), tests.mid(310), tests.id('caro'), 'Caro', 'member');
insert into public.group_access (group_id, user_id, role) values
  (tests.mid(310), tests.id('beto'), 'member'),
  (tests.mid(310), tests.id('caro'), 'member');

select tests.autenticar_como(tests.id('caro'));
select lives_ok(
  $$ select public.leave_group(tests.mid(310)) $$,
  'Una cuenta sale del grupo'
);
select is_empty(
  $$ select id from public.groups where id = tests.mid(310) $$,
  'Y deja de verlo'
);
reset role;
select is(tests.acc(tests.mid(310), tests.id('caro')), 'member/fuera', 'Su acceso queda marcado como borrado');
select ok(
  (select user_id is null and deleted_at is null from public.group_members where id = tests.mid(353)),
  'Su miembro queda sin cuenta, activo y en los movimientos'
);
select is(tests.acc(tests.mid(310), tests.id('ana')), 'owner', 'La dueña sigue siendo la dueña');
select is(
  (select array_agg(entity || ':' || action order by id) from public.change_log
   where group_id = tests.mid(310) and actor = tests.id('caro')),
  array['access:delete', 'member:update'],
  'Quedan en el historial el acceso borrado y el miembro desvinculado, a nombre de Caro'
);
select tests.autenticar_como(tests.id('caro'));
select throws_ok(
  $$ select public.leave_group(tests.mid(310)) $$,
  '42501', null, 'Salir sin tener acceso: forbidden'
);
reset role;
select tests.autenticar_como(tests.id('beto'));
select throws_ok(
  $$ select public.remove_access(tests.mid(310), tests.id('ana')) $$,
  '42501', null, 'Un miembro no quita el acceso a nadie'
);
reset role;
select tests.autenticar_como(tests.id('ana'));
select throws_ok(
  $$ select public.remove_access(tests.mid(310), tests.id('ana')) $$,
  '42501', null, 'Ni el dueño se quita el acceso a sí mismo'
);
select lives_ok(
  $$ select public.leave_group(tests.mid(310)) $$,
  'El dueño sale si queda alguien'
);
reset role;
select is(tests.acc(tests.mid(310), tests.id('ana')), 'member/fuera', 'Su acceso queda borrado');
select is(tests.acc(tests.mid(310), tests.id('beto')), 'owner', 'El rol de dueño pasa a la cuenta que queda');
select is(
  (select count(*)::integer from public.group_access
   where group_id = tests.mid(310) and role = 'owner' and deleted_at is null),
  1,
  'Hay exactamente un dueño activo'
);
select is(
  (select array_agg(entity || ':' || action order by id) from public.change_log
   where group_id = tests.mid(310) and actor = tests.id('ana')),
  array['access:delete', 'access:update', 'member:update'],
  'El historial registra la salida, el nuevo dueño y el miembro desvinculado'
);
select tests.autenticar_como(tests.id('beto'));
select throws_ok(
  $$ select public.leave_group(tests.mid(310)) $$,
  'SMLST', null, 'La última cuenta no puede salir: SMLST'
);
reset role;
select is(tests.acc(tests.mid(310), tests.id('beto')), 'owner', 'Y conserva su acceso');

-- remove_access y el creador expulsado ---------------------------------------------------------------

-- Club: Ana creó el grupo; Caro es la dueña, Ana y Beto son miembros.
insert into public.groups (id, name, currency, created_by)
values (tests.mid(311), 'Club', 'USD', tests.id('ana'));
insert into public.group_members (id, group_id, user_id, display_name, role) values
  (tests.mid(361), tests.mid(311), tests.id('ana'), 'Ana', 'owner'),
  (tests.mid(362), tests.mid(311), tests.id('beto'), 'Beto', 'member'),
  (tests.mid(363), tests.mid(311), tests.id('caro'), 'Caro', 'member');
insert into public.categories (id, group_id, name, icon)
values (tests.mid(364), tests.mid(311), 'Cuotas', 'ticket');
insert into public.group_access (group_id, user_id, role) values
  (tests.mid(311), tests.id('beto'), 'member'),
  (tests.mid(311), tests.id('caro'), 'member');
update public.group_access set role = 'member' where group_id = tests.mid(311) and user_id = tests.id('ana');
update public.group_access set role = 'owner' where group_id = tests.mid(311) and user_id = tests.id('caro');

select tests.autenticar_como(tests.id('caro'));
select lives_ok(
  $$ select public.remove_access(tests.mid(311), tests.id('beto')) $$,
  'La dueña quita el acceso a otra cuenta'
);
select lives_ok(
  $$ select public.remove_access(tests.mid(311), tests.id('dani')) $$,
  'Quitárselo a quien no lo tiene no hace nada'
);
reset role;
select is(tests.acc(tests.mid(311), tests.id('beto')), 'member/fuera', 'El acceso de Beto queda borrado');
select ok(
  (select user_id is null from public.group_members where id = tests.mid(362)),
  'Su miembro queda sin cuenta'
);
select is(
  (select array_agg(entity || ':' || action order by id) from public.change_log
   where group_id = tests.mid(311) and actor = tests.id('caro')),
  array['access:delete', 'member:update'],
  'El historial lo registra a nombre de la dueña'
);

select tests.autenticar_como(tests.id('beto'));
select is_empty(
  $$ select id from public.groups where id = tests.mid(311) $$,
  'Beto, ya sin acceso, no ve el grupo'
);
select throws_ok(
  $$ select public.remove_access(tests.mid(311), tests.id('caro')) $$,
  '42501', null, 'Ni usa remove_access'
);
reset role;

select tests.autenticar_como(tests.id('caro'));
select lives_ok(
  $$ select public.remove_access(tests.mid(311), tests.id('ana')) $$,
  'La dueña quita el acceso a la creadora'
);
reset role;
select tests.autenticar_como(tests.id('ana'));
select is_empty(
  $$ select id from public.groups where id = tests.mid(311) $$,
  'La creadora expulsada no ve ni la fila del grupo'
);
select is_empty(
  $$ select id from public.group_members where group_id = tests.mid(311) $$,
  'Ni sus miembros'
);
select is_empty(
  $$ select id from public.categories where group_id = tests.mid(311) $$,
  'Ni sus categorías'
);
select is_empty(
  $$ select id from public.group_access where group_id = tests.mid(311) $$,
  'Ni su acceso'
);
select is_empty(
  $$ select id from public.change_log where group_id = tests.mid(311) $$,
  'Ni su historial'
);
select throws_ok(
  $$
    insert into public.group_members (id, group_id, user_id, display_name, role)
    values (tests.mid(365), tests.mid(311), null, 'Colado', 'member')
  $$,
  '42501', null, 'Ni agrega miembros'
);
insert into res select 'expulsada', public.sync_push(jsonb_build_array(
  tests.mt(1030, 'group', 1, jsonb_build_object('id', tests.mid(311), 'name', 'Mío', 'currency', 'USD',
    'emoji', null, 'color', 'teal', 'archived', false, 'deleted', false)),
  tests.mt(1031, 'group', null, jsonb_build_object('id', tests.mid(311), 'name', 'Mío', 'currency', 'USD',
    'emoji', null, 'color', 'teal', 'archived', false, 'deleted', false))
));
select is(tests.re('expulsada', 0), 'not_found', 'Para sync_push, el grupo ya no existe');
select is(tests.re('expulsada', 1), 'forbidden', 'Y no puede crearlo de nuevo con el mismo id');
reset role;

-- Borrar una cuenta con grupos compartidos -------------------------------------------------------------

-- Taller: Ana (dueña) y Beto.
insert into public.groups (id, name, currency, created_by)
values (tests.mid(312), 'Taller', 'USD', tests.id('ana'));
insert into public.group_members (id, group_id, user_id, display_name, role) values
  (tests.mid(371), tests.mid(312), tests.id('ana'), 'Ana', 'owner'),
  (tests.mid(372), tests.mid(312), tests.id('beto'), 'Beto', 'member');
insert into public.group_access (group_id, user_id, role)
values (tests.mid(312), tests.id('beto'), 'member');

select lives_ok(
  $$ delete from auth.users where id = tests.id('ana') $$,
  'Se borra la cuenta de la dueña de un grupo compartido'
);
select is(tests.acc(tests.mid(312), tests.id('beto')), 'owner', 'El rol de dueño pasa a la otra cuenta');
select is_empty(
  $$ select 1 from public.group_access where user_id = tests.id('ana') $$,
  'Y no queda ninguna fila de acceso de la cuenta borrada'
);
select ok(
  (select user_id is null and deleted_at is null from public.group_members where id = tests.mid(371)),
  'Su miembro queda sin cuenta, con sus gastos'
);
select is_empty(
  $$ select 1 from public.groups where id = tests.mid(301) $$,
  'Un grupo sin otra cuenta con acceso se borra'
);
select isnt_empty(
  $$ select 1 from public.groups where id = tests.mid(302) $$,
  'Uno donde otra cuenta tiene acceso queda'
);

select * from finish();
rollback;
