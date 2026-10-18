-- Invitaciones por enlace (Fase 4b, design/fase-4b/diseno.md, sección a): create_invitation,
-- preview_invitation, accept_invitation, revoke_invitation y list_invitations, con sus topes.
-- Cubre las condiciones de seguridad de plan.md:
-- - contador de usos atómico (private.claim_invitation_use y el último uso entre dos cuentas);
-- - el mismo { "error": "SMINV" } para token inexistente, mal formado, vencido, revocado, agotado o
--   de un grupo borrado, en la vista previa y al aceptar;
-- - vista previa solo con sesión, solo lo mínimo, y con el tope de 10 intentos fallidos por hora;
-- - el token solo sale en la respuesta de create_invitation: ni en la base (solo su SHA-256), ni
--   en el historial, ni en las respuestas de error.
-- Los grupos 301 en adelante y los ids nuevos son tests.mid(n).
begin;
select plan(155);

select tests.crear_mundo();

create function tests.mid(p_n integer) returns uuid language sql immutable as $$
  select format('01990000-0000-7000-8000-%s', lpad(p_n::text, 12, '0'))::uuid
$$;
-- Cuentas nuevas (con perfil) de estas pruebas.
create function tests.u(p_nombre text) returns uuid language sql immutable as $$
  select case p_nombre
    when 'eva' then '00000000-0000-4000-a000-0000000000e1'
    when 'fran' then '00000000-0000-4000-a000-0000000000f1'
    when 'gabi' then '00000000-0000-4000-a000-0000000000b1'
    when 'hugo' then '00000000-0000-4000-a000-0000000000c1'
  end::uuid
$$;
select tests.crear_usuario(tests.u('eva'), 'Eva');
select tests.crear_usuario(tests.u('fran'), 'Fran');
select tests.crear_usuario(tests.u('gabi'), 'Gabi');
select tests.crear_usuario(tests.u('hugo'), 'Hugo');

-- Un token de 43 caracteres reconocible, y una invitación con ese token escrita como postgres.
create function tests.tk(p_label text) returns text language sql immutable as $$
  select rpad(p_label, 43, 'x')
$$;
create function tests.inv(
  p_label text,
  p_group uuid,
  p_creator uuid,
  p_created_ago interval default '0 seconds',
  p_ttl interval default '7 days',
  p_max_uses integer default 10,
  p_use_count integer default 0,
  p_revoked boolean default false
)
returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into private.group_invitations
    (id, group_id, token_hash, created_by, created_at, expires_at, max_uses, use_count, revoked_at,
      revoked_by)
  values (
    v_id, p_group, sha256(convert_to(tests.tk(p_label), 'UTF8')), p_creator,
    now() - p_created_ago, now() - p_created_ago + p_ttl, p_max_uses, p_use_count,
    case when p_revoked then now() end, case when p_revoked then p_creator end
  );
  return v_id;
end;
$$;

create temp table res (k text primary key, j jsonb);
grant all on res to authenticated;
-- El token que devolvió create_invitation (guardado en res).
create function tests.tkn(p_k text) returns text language sql as $$
  select j ->> 'token' from res where k = p_k
$$;
create function tests.err(p_k text) returns text language sql as $$
  select j ->> 'error' from res where k = p_k
$$;
-- Intentos fallidos de la última hora de una cuenta.
create function tests.fallos(p_user uuid) returns integer language sql as $$
  select count(*)::integer from private.rate_events
  where user_id = p_user and action = 'inv_fail' and created_at > now() - interval '1 hour'
$$;
create function tests.usos(p_id uuid) returns integer language sql as $$
  select use_count from private.group_invitations where id = p_id
$$;
create function tests.acc(p_group uuid, p_user uuid) returns text language sql as $$
  select role || case when deleted_at is null then '' else '/fuera' end
  from public.group_access where group_id = p_group and user_id = p_user
$$;
grant execute on all functions in schema tests to authenticated;

-- Estructura --------------------------------------------------------------------------------------

select has_table('private', 'group_invitations', 'Existe private.group_invitations');
select has_table('private', 'rate_events', 'Existe private.rate_events');
select hasnt_column(
  'private', 'group_invitations', 'token',
  'La tabla de invitaciones no tiene columna de token: solo su hash'
);
select ok(
  (
    select bool_and(c.relrowsecurity)
    from pg_class c
    where c.relnamespace = 'private'::regnamespace
      and c.relname in ('group_invitations', 'rate_events')
  ),
  'Las dos tablas de private tienen RLS activado'
);
select is_empty(
  $$
    select 1 from pg_policy p
    where p.polrelid in ('private.group_invitations'::regclass, 'private.rate_events'::regclass)
  $$,
  'Y ninguna política: solo las RPC las tocan'
);
select fk_ok(
  'public', 'group_access', 'invitation_id', 'private', 'group_invitations', 'id',
  'group_access.invitation_id apunta a la invitación'
);

-- create_invitation -------------------------------------------------------------------------------

select tests.autenticar_como_anon();
select throws_ok(
  $$ select public.create_invitation(tests.id('viaje')) $$,
  '42501',
  null,
  'anon no ejecuta create_invitation'
);
select throws_ok(
  $$ select public.preview_invitation('x') $$,
  '42501', null, 'anon no ejecuta preview_invitation'
);
select throws_ok(
  $$ select public.accept_invitation('x', tests.id('viaje_xime')) $$,
  '42501', null, 'anon no ejecuta accept_invitation'
);
select throws_ok(
  $$ select public.revoke_invitation(gen_random_uuid()) $$,
  '42501', null, 'anon no ejecuta revoke_invitation'
);
select throws_ok(
  $$ select public.list_invitations(tests.id('viaje')) $$,
  '42501', null, 'anon no ejecuta list_invitations'
);
reset role;

-- Una sesión sin sub (token sin cuenta): las cinco paran en seco.
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.create_invitation(tests.id('viaje')) $$,
  '42501', 'Se necesita una sesión', 'Sin cuenta en la sesión, create_invitation se niega'
);
select throws_ok(
  $$ select public.preview_invitation('x') $$,
  '42501', 'Se necesita una sesión', 'Y preview_invitation'
);
reset role;

select tests.autenticar_como(tests.id('ana'));
insert into res select 'c1', public.create_invitation(tests.id('viaje'));
reset role;
select matches(tests.tkn('c1'), '^[A-Za-z0-9_-]{43}$', 'El token son 43 caracteres base64url');
select is(
  (select j ->> 'max_uses' from res where k = 'c1'),
  '10',
  'Por omisión admite 10 usos'
);
select is(
  (select (j ->> 'expires_at')::timestamptz from res where k = 'c1'),
  now() + interval '168 hours',
  'Y vence en 7 días'
);
select is(
  (select array_agg(key order by key) from res, jsonb_object_keys(j) key where res.k = 'c1'),
  array['expires_at', 'id', 'max_uses', 'token'],
  'La respuesta trae id, token, expires_at y max_uses'
);
select is(
  (
    select count(*)::integer from private.group_invitations
    where id = (select (j ->> 'id')::uuid from res where k = 'c1')
      and token_hash = sha256(convert_to(tests.tkn('c1'), 'UTF8'))
      and group_id = tests.id('viaje') and created_by = tests.id('ana')
      and use_count = 0 and revoked_at is null
  ),
  1,
  'En la base queda el SHA-256 del token, el grupo, la creadora y 0 usos'
);

select tests.autenticar_como(tests.id('beto'));
insert into res select 'c2', public.create_invitation(tests.id('viaje'), 24, 1);
reset role;
select is(
  (select (j ->> 'expires_at')::timestamptz from res where k = 'c2'),
  now() + interval '24 hours',
  'Un miembro (no solo el dueño) crea enlaces; la duración y los usos se eligen'
);
select is((select j ->> 'max_uses' from res where k = 'c2'), '1', 'Con un solo uso');

select tests.autenticar_como(tests.id('caro'));
select throws_ok(
  $$ select public.create_invitation(tests.id('viaje')) $$,
  '42501', null, 'Quien no tiene acceso al grupo no crea enlaces'
);
select throws_ok(
  $$ select public.create_invitation(gen_random_uuid()) $$,
  '42501', null, 'Ni de un grupo que no existe (el mismo error)'
);
reset role;

select tests.autenticar_como(tests.id('ana'));
select throws_ok(
  $$ select public.create_invitation(tests.id('viaje'), 0, 10) $$,
  '22023', null, 'Menos de 1 hora es un error de programación'
);
select throws_ok(
  $$ select public.create_invitation(tests.id('viaje'), 721, 10) $$,
  '22023', null, 'Más de 720 horas, también'
);
select throws_ok(
  $$ select public.create_invitation(tests.id('viaje'), 24, 0) $$,
  '22023', null, 'Cero usos, también'
);
select throws_ok(
  $$ select public.create_invitation(tests.id('viaje'), 24, 51) $$,
  '22023', null, 'Más de 50 usos, también'
);
select throws_ok(
  $$ select public.create_invitation(null) $$,
  '22023', null, 'Sin grupo, también'
);
reset role;

update public.groups set deleted_at = now() where id = tests.id('oficina');
select tests.autenticar_como(tests.id('ana'));
select throws_ok(
  $$ select public.create_invitation(tests.id('oficina')) $$,
  '42501', null, 'Un grupo borrado no admite enlaces nuevos'
);
reset role;
update public.groups set deleted_at = null where id = tests.id('oficina');

-- Tope de 20 enlaces activos por grupo. Los vencidos, revocados o agotados no cuentan.
select tests.inv('relleno' || n, tests.id('oficina'), tests.id('ana'))
from generate_series(1, 20) n;
select tests.autenticar_como(tests.id('ana'));
insert into res select 'c_tope_grupo', public.create_invitation(tests.id('oficina'));
reset role;
select is(
  tests.err('c_tope_grupo'),
  'SMRLT',
  'Con 20 enlaces activos en el grupo, el 21 responde SMRLT'
);
update private.group_invitations
set revoked_at = now(), revoked_by = created_by
where token_hash = sha256(convert_to(tests.tk('relleno1'), 'UTF8'));
update private.group_invitations
set use_count = max_uses
where token_hash = sha256(convert_to(tests.tk('relleno2'), 'UTF8'));
select tests.autenticar_como(tests.id('ana'));
insert into res select 'c_oficina', public.create_invitation(tests.id('oficina'));
insert into res select 'c_oficina2', public.create_invitation(tests.id('oficina'));
insert into res select 'c_tope_grupo2', public.create_invitation(tests.id('oficina'));
reset role;
select ok(
  tests.tkn('c_oficina') is not null and tests.tkn('c_oficina2') is not null,
  'Con dos liberados (uno revocado y uno agotado) caben dos más'
);
select is(tests.err('c_tope_grupo2'), 'SMRLT', 'Y el siguiente vuelve a toparse');

-- Tope de 20 enlaces creados por cuenta y día (Beto lleva 1).
insert into private.rate_events (user_id, action, created_at)
select tests.id('beto'), 'inv_create', now() from generate_series(1, 19);
select tests.autenticar_como(tests.id('beto'));
insert into res select 'c_tope_dia', public.create_invitation(tests.id('viaje'));
reset role;
select is(tests.err('c_tope_dia'), 'SMRLT', 'La cuenta con 20 enlaces creados hoy recibe SMRLT');
select is(
  (select count(*)::integer from private.rate_events where user_id = tests.id('beto')),
  20,
  'Y un intento rechazado no suma otro evento'
);
update private.rate_events set created_at = now() - interval '2 days'
where id in (
  select id from private.rate_events where user_id = tests.id('beto') order by id offset 1
);
select tests.autenticar_como(tests.id('beto'));
insert into res select 'c3', public.create_invitation(tests.id('viaje'));
reset role;
select ok(tests.tkn('c3') is not null, 'Pasado el día, los eventos viejos ya no cuentan');
select is(
  (select count(*)::integer from private.rate_events where user_id = tests.id('beto')),
  2,
  'Y create_invitation borró los eventos de más de 1 día (quedan 2: c2 y c3)'
);

-- preview_invitation -------------------------------------------------------------------------------

select tests.autenticar_como(tests.id('caro'));
insert into res select 'p_caro', public.preview_invitation(tests.tkn('c1'));
reset role;
select is(
  (select j -> 'group' ->> 'name' from res where k = 'p_caro'),
  'Viaje',
  'La vista previa muestra el nombre del grupo'
);
select is(
  (select array_agg(key order by key) from res, jsonb_object_keys(j) key where res.k = 'p_caro'),
  array['accounts', 'already_member', 'expires_at', 'group', 'members'],
  'Con solo estas claves: group, members, accounts, expires_at y already_member'
);
select is(
  (select array_agg(key order by key) from res, jsonb_object_keys(j -> 'group') key where res.k = 'p_caro'),
  array['color', 'currency', 'emoji', 'id', 'name'],
  'El grupo, solo con id, nombre, emoji, color y moneda'
);
select is(
  (select j -> 'members' from res where k = 'p_caro'),
  jsonb_build_array(jsonb_build_object('id', tests.id('viaje_xime'), 'display_name', 'Xime')),
  'Los miembros son solo los activos sin cuenta, con id y nombre (ni cuentas ni roles)'
);
select is((select j ->> 'accounts' from res where k = 'p_caro'), '2', 'Cuenta las cuentas con acceso (Ana y Beto)');
select is((select j ->> 'already_member' from res where k = 'p_caro'), 'false', 'Caro todavía no es del grupo');
select is(tests.fallos(tests.id('caro')), 0, 'Una vista previa válida no cuenta como intento fallido');

select tests.autenticar_como(tests.id('beto'));
insert into res select 'p_beto', public.preview_invitation(tests.tkn('c1'));
reset role;
select is((select j ->> 'already_member' from res where k = 'p_beto'), 'true', 'Beto, que ya es del grupo, lo ve');

-- Fixtures de enlaces que no sirven.
select tests.inv('vencido', tests.id('viaje'), tests.id('ana'), interval '10 days', interval '9 days');
select tests.inv('revocado', tests.id('viaje'), tests.id('ana'), interval '0 seconds', interval '7 days', 10, 0, true);
select tests.inv('agotado', tests.id('viaje'), tests.id('ana'), interval '0 seconds', interval '7 days', 1, 1);
select tests.inv('grupoborrado', tests.id('casa'), tests.id('caro'));
update public.groups set deleted_at = now() where id = tests.id('casa');

-- Dani (sin perfil) hace 8 intentos fallidos distintos: todos dan exactamente lo mismo.
select tests.autenticar_como(tests.id('dani'));
insert into res select 'f_inexistente', public.preview_invitation(tests.tk('inexistente'));
insert into res select 'f_corto', public.preview_invitation('abc');
insert into res select 'f_nulo', public.preview_invitation(null);
insert into res select 'f_largo', public.preview_invitation(repeat('a', 5000));
insert into res select 'f_vencido', public.preview_invitation(tests.tk('vencido'));
insert into res select 'f_revocado', public.preview_invitation(tests.tk('revocado'));
insert into res select 'f_agotado', public.preview_invitation(tests.tk('agotado'));
insert into res select 'f_borrado', public.preview_invitation(tests.tk('grupoborrado'));
reset role;
update public.groups set deleted_at = null where id = tests.id('casa');
select is(
  (select count(distinct j)::integer from res where k like 'f\_%'),
  1,
  'Inexistente, mal formado, nulo, larguísimo, vencido, revocado, agotado y de grupo borrado dan la misma respuesta'
);
select is(
  (select j from res where k = 'f_vencido'),
  '{"error": "SMINV"}'::jsonb,
  'Y es { "error": "SMINV" } con estado 200 (no una excepción)'
);
select is(
  (select j::text like '%' || tests.tk('inexistente') || '%' from res where k = 'f_inexistente'),
  false,
  'La respuesta de error no repite el token'
);
select is(tests.fallos(tests.id('dani')), 8, 'Cada intento fallido deja un evento');

-- Tope de 10 intentos fallidos por hora.
select tests.autenticar_como(tests.id('dani'));
insert into res select 'f9', public.preview_invitation(tests.tk('otro1'));
insert into res select 'f10', public.preview_invitation(tests.tk('otro2'));
insert into res select 'p_dani_bloqueado', public.preview_invitation(tests.tkn('c1'));
insert into res select 'a_dani_bloqueado', public.accept_invitation(tests.tkn('c1'), tests.id('viaje_xime'));
reset role;
select is(
  tests.err('p_dani_bloqueado'),
  'SMRLT',
  'Con 10 fallidos en la hora, la vista previa responde SMRLT incluso con un token válido'
);
select is(tests.err('a_dani_bloqueado'), 'SMRLT', 'Y aceptar, también');
select is(tests.fallos(tests.id('dani')), 10, 'Y estar bloqueado no suma eventos');
update private.rate_events set created_at = now() - interval '2 hours' where user_id = tests.id('dani');
select tests.autenticar_como(tests.id('dani'));
insert into res select 'p_dani_libre', public.preview_invitation(tests.tkn('c1'));
reset role;
select is(
  (select j -> 'group' ->> 'name' from res where k = 'p_dani_libre'),
  'Viaje',
  'Pasada la hora, los intentos viejos ya no cuentan'
);
select is(
  (select count(*)::integer from private.rate_events where user_id = tests.id('dani')),
  10,
  'La vista previa no borra los eventos de menos de 1 día'
);

-- accept_invitation: argumentos ---------------------------------------------------------------------

select tests.autenticar_como(tests.id('caro'));
select throws_ok(
  $$ select public.accept_invitation(tests.tkn('c1'), tests.id('viaje_xime'), '{"id": "01990000-0000-7000-8000-000000000999", "display_name": "X"}') $$,
  '22023', null, 'Elegir un miembro y crear uno nuevo a la vez es un error de programación'
);
select throws_ok(
  $$ select public.accept_invitation(tests.tkn('c1')) $$,
  '22023', null, 'No elegir ninguno, también'
);
select throws_ok(
  $$ select public.accept_invitation(tests.tkn('c1'), null, '{"id": "01990000-0000-7000-8000-000000000999"}') $$,
  '22023', null, 'Un miembro nuevo sin nombre'
);
select throws_ok(
  $$ select public.accept_invitation(tests.tkn('c1'), null, '{"id": "01990000-0000-7000-8000-000000000999", "display_name": "X", "role": "owner"}') $$,
  '22023', null, 'Con una clave de más (no se elige el rol)'
);
select throws_ok(
  $$ select public.accept_invitation(tests.tkn('c1'), null, '{"id": "no-es-uuid", "display_name": "X"}') $$,
  '22023', null, 'Con un id que no es UUID'
);
select throws_ok(
  $$ select public.accept_invitation(tests.tkn('c1'), null, '{"id": "01990000-0000-7000-8000-000000000999", "display_name": "   "}') $$,
  '22023', null, 'Con un nombre en blanco'
);
select throws_ok(
  $$ select public.accept_invitation(tests.tkn('c1'), null, '[1]') $$,
  '22023', null, 'Con algo que no es un objeto'
);
select throws_ok(
  format($f$ select public.accept_invitation(tests.tkn('c1'), null, '{"id": "%s", "display_name": "X"}') $f$, tests.id('viaje_xime')),
  '22023', null, 'Con el id de un miembro que ya existe'
);
reset role;
select is(
  (select count(*)::integer from public.group_access where user_id = tests.id('caro') and group_id = tests.id('viaje')),
  0,
  'Ninguno de esos intentos dio acceso'
);

-- accept_invitation: unirse eligiendo un miembro ----------------------------------------------------

select tests.autenticar_como(tests.id('caro'));
insert into res select 'a_caro', public.accept_invitation(tests.tkn('c1'), tests.id('viaje_xime'));
reset role;
select is(
  (select j from res where k = 'a_caro'),
  jsonb_build_object('group_id', tests.id('viaje')),
  'Aceptar devuelve { group_id }'
);
select is(tests.acc(tests.id('viaje'), tests.id('caro')), 'member', 'Caro queda con acceso como member');
select is(
  (select invitation_id from public.group_access where group_id = tests.id('viaje') and user_id = tests.id('caro')),
  (select (j ->> 'id')::uuid from res where k = 'c1'),
  'Su acceso guarda por qué invitación entró'
);
select is(
  (select user_id from public.group_members where id = tests.id('viaje_xime')),
  tests.id('caro'),
  'Y queda vinculada al miembro que eligió'
);
select is(
  tests.usos((select (j ->> 'id')::uuid from res where k = 'c1')),
  1,
  'Se gastó 1 uso'
);
select is(
  (
    select count(*)::integer from public.change_log
    where group_id = tests.id('viaje') and actor = tests.id('caro')
      and ((entity = 'access' and action = 'create')
        or (entity = 'member' and action = 'update' and fields = array['user_id']
          and entity_id = tests.id('viaje_xime')))
  ),
  2,
  'El historial anota el acceso (create) y la vinculación del miembro (update de user_id), a nombre de Caro'
);
select ok(
  (select a.change_seq > 1 and m.change_seq > a.change_seq
    from public.group_access a, public.group_members m
    where a.group_id = tests.id('viaje') and a.user_id = tests.id('caro')
      and m.id = tests.id('viaje_xime')),
  'Las dos filas pasaron por el trigger de columnas: tienen change_seq y llegan a los demás'
);
select is(
  (select m.change_seq from public.group_members m where m.id = tests.id('viaje_xime')),
  (select last_seq from private.group_changes where group_id = tests.id('viaje')),
  'Y la última coincide con el contador del grupo'
);

select tests.autenticar_como(tests.id('caro'));
select is(
  (select count(*)::integer from public.groups where id = tests.id('viaje')),
  1,
  'Caro ya ve el grupo (RLS)'
);
select is(
  (select count(*)::integer from public.group_members where group_id = tests.id('viaje')),
  3,
  'Y sus miembros'
);
reset role;

create temp table cl as select count(*)::integer as n from public.change_log;
select tests.autenticar_como(tests.id('caro'));
insert into res select 'a_caro2', public.accept_invitation(tests.tkn('c1'), tests.id('viaje_beto'));
reset role;
select is(
  (select j from res where k = 'a_caro2'),
  jsonb_build_object('group_id', tests.id('viaje')),
  'Aceptar otra vez devuelve lo mismo (un reintento no hace nada nuevo)'
);
select is(
  tests.usos((select (j ->> 'id')::uuid from res where k = 'c1')),
  1,
  'Sin gastar otro uso'
);
select is(
  (select user_id from public.group_members where id = tests.id('viaje_beto')),
  tests.id('beto'),
  'Ni tocar el miembro que pidió la segunda vez'
);
select is(
  (select count(*)::integer from public.change_log),
  (select n from cl),
  'Ni escribir en el historial'
);

-- accept_invitation: unirse como alguien nuevo ------------------------------------------------------

select tests.autenticar_como(tests.u('eva'));
insert into res select 'a_eva', public.accept_invitation(
  tests.tkn('c1'), null, jsonb_build_object('id', tests.mid(401), 'display_name', 'Eva')
);
reset role;
select is(
  (select j ->> 'group_id' from res where k = 'a_eva'),
  tests.id('viaje')::text,
  'Eva se une como miembro nuevo'
);
select results_eq(
  $$
    select group_id, user_id, display_name, role, version, deleted_at is null
    from public.group_members where id = tests.mid(401)
  $$,
  $$ values (tests.id('viaje'), tests.u('eva'), 'Eva', 'member', 1, true) $$,
  'Con su cuenta, su nombre, rol member y como fila nueva'
);
select is(tests.acc(tests.id('viaje'), tests.u('eva')), 'member', 'Y con acceso como member');
select is(
  tests.usos((select (j ->> 'id')::uuid from res where k = 'c1')),
  2,
  'Segundo uso'
);
select is(
  (
    select count(*)::integer from public.change_log
    where group_id = tests.id('viaje') and actor = tests.u('eva')
      and ((entity = 'access' and action = 'create')
        or (entity = 'member' and action = 'create' and entity_id = tests.mid(401)))
  ),
  2,
  'El historial anota el acceso y el miembro nuevo (create)'
);

-- SMTKN: el miembro ya no está libre. No cuenta como intento fallido ni gasta un uso.
select tests.autenticar_como(tests.u('fran'));
insert into res select 'smtkn_tomado', public.accept_invitation(tests.tkn('c1'), tests.id('viaje_xime'));
insert into res select 'smtkn_otro_grupo', public.accept_invitation(tests.tkn('c1'), tests.id('oficina_yago'));
insert into res select 'smtkn_inexistente', public.accept_invitation(tests.tkn('c1'), gen_random_uuid());
reset role;
insert into public.group_members (id, group_id, display_name, deleted_at)
values (tests.mid(402), tests.id('viaje'), 'Borrado', now());
select tests.autenticar_como(tests.u('fran'));
insert into res select 'smtkn_borrado', public.accept_invitation(tests.tkn('c1'), tests.mid(402));
reset role;
select is(tests.err('smtkn_tomado'), 'SMTKN', 'Un miembro que ya tiene cuenta da SMTKN');
select is(tests.err('smtkn_otro_grupo'), 'SMTKN', 'Uno de otro grupo, también (no se distingue)');
select is(tests.err('smtkn_inexistente'), 'SMTKN', 'Uno que no existe, también');
select is(tests.err('smtkn_borrado'), 'SMTKN', 'Uno borrado, también');
select is(
  tests.usos((select (j ->> 'id')::uuid from res where k = 'c1')),
  2,
  'Ninguno gastó un uso'
);
select is(tests.acc(tests.id('viaje'), tests.u('fran')), null, 'Ni dio acceso a Fran');
select is(tests.fallos(tests.u('fran')), 0, 'Y SMTKN no es un intento fallido de token');

-- El último uso: dos cuentas, un cupo. ---------------------------------------------------------------

select tests.autenticar_como(tests.u('fran'));
insert into res select 'a_fran_c2', public.accept_invitation(
  tests.tkn('c2'), null, jsonb_build_object('id', tests.mid(403), 'display_name', 'Fran')
);
reset role;
select tests.autenticar_como(tests.u('gabi'));
insert into res select 'a_gabi_c2', public.accept_invitation(
  tests.tkn('c2'), null, jsonb_build_object('id', tests.mid(404), 'display_name', 'Gabi')
);
reset role;
select is((select j ->> 'group_id' from res where k = 'a_fran_c2'), tests.id('viaje')::text, 'La primera cuenta se lleva el último uso');
select is(tests.err('a_gabi_c2'), 'SMINV', 'La segunda recibe SMINV, el mismo error que un token inexistente');
select is(
  tests.usos((select (j ->> 'id')::uuid from res where k = 'c2')),
  1,
  'El contador se queda en max_uses (nunca lo pasa)'
);
select is(tests.acc(tests.id('viaje'), tests.u('gabi')), null, 'Gabi no tiene acceso');
select is(
  (select count(*)::integer from public.group_members where id = tests.mid(404)),
  0,
  'Ni se creó su miembro'
);
select is(tests.fallos(tests.u('gabi')), 1, 'Y su intento cuenta como fallido');

-- La reclamación del uso es un solo UPDATE con condición: aunque una lectura anterior viera un
-- cupo libre, la segunda reclamación no pasa.
select tests.inv('carrera', tests.id('viaje'), tests.id('ana'), interval '0 seconds', interval '7 days', 2, 0);
select is(
  private.claim_invitation_use((select id from private.group_invitations where token_hash = sha256(convert_to(tests.tk('carrera'), 'UTF8')))),
  true, 'Primera reclamación del enlace de 2 usos'
);
select is(
  private.claim_invitation_use((select id from private.group_invitations where token_hash = sha256(convert_to(tests.tk('carrera'), 'UTF8')))),
  true, 'Segunda'
);
select is(
  private.claim_invitation_use((select id from private.group_invitations where token_hash = sha256(convert_to(tests.tk('carrera'), 'UTF8')))),
  false, 'Tercera: no hay cupo y no se suma'
);
select is(
  (select use_count from private.group_invitations where token_hash = sha256(convert_to(tests.tk('carrera'), 'UTF8'))),
  2, 'El contador se queda en 2'
);
select is(
  private.claim_invitation_use((select id from private.group_invitations where token_hash = sha256(convert_to(tests.tk('revocado'), 'UTF8')))),
  false, 'Un enlace revocado no se reclama'
);
select is(
  private.claim_invitation_use((select id from private.group_invitations where token_hash = sha256(convert_to(tests.tk('vencido'), 'UTF8')))),
  false, 'Uno vencido, tampoco'
);
select ok(
  pg_get_functiondef('public.accept_invitation(text,uuid,jsonb)'::regprocedure) ~ 'claim_invitation_use',
  'accept_invitation reclama el uso con esa función, no con una lectura y una escritura'
);
select ok(
  pg_get_functiondef('private.claim_invitation_use(uuid)'::regprocedure)
    ~* 'use_count\s*=\s*use_count\s*\+\s*1[^;]*use_count\s*<\s*max_uses',
  'private.claim_invitation_use suma y compara use_count < max_uses en el mismo UPDATE'
);

-- accept_invitation: cupos ----------------------------------------------------------------------------

-- 50 cuentas por grupo: casa tiene a Caro; se suman 49.
select tests.crear_usuario(format('00000000-0000-4000-a000-%s', lpad(to_hex(1000 + n), 12, '0'))::uuid, 'Cuenta ' || n)
from generate_series(1, 49) n;
insert into public.group_access (group_id, user_id, role)
select tests.id('casa'), format('00000000-0000-4000-a000-%s', lpad(to_hex(1000 + n), 12, '0'))::uuid, 'member'
from generate_series(1, 49) n;
select tests.autenticar_como(tests.id('caro'));
insert into res select 'c_casa', public.create_invitation(tests.id('casa'));
reset role;
select tests.autenticar_como(tests.u('fran'));
insert into res select 'q_cuentas', public.accept_invitation(tests.tkn('c_casa'), tests.id('casa_zoe'));
reset role;
select is(tests.err('q_cuentas'), 'SMGFL', 'Un grupo con 50 cuentas con acceso responde SMGFL');
select is((select j ->> 'quota' from res where k = 'q_cuentas'), 'accounts', 'Con quota = accounts');
select is(
  tests.usos((select (j ->> 'id')::uuid from res where k = 'c_casa')),
  0,
  'Sin gastar el uso'
);
select is(tests.fallos(tests.u('fran')), 0, 'Ni contar como intento fallido');
-- Una cuenta que ya está en el grupo con 50 sigue pasando (no es una cuenta nueva).
select tests.autenticar_como(format('00000000-0000-4000-a000-%s', lpad(to_hex(1001), 12, '0'))::uuid);
insert into res select 'q_cuentas_ya', public.accept_invitation(tests.tkn('c_casa'), tests.id('casa_zoe'));
reset role;
select is(
  (select j ->> 'group_id' from res where k = 'q_cuentas_ya'),
  tests.id('casa')::text,
  'Quien ya tiene acceso recibe su group_id aunque el grupo esté lleno'
);

-- 200 grupos por cuenta.
insert into public.groups (id, name, currency, created_by)
select tests.mid(5000 + n), 'G' || n, 'USD', tests.u('hugo') from generate_series(1, 200) n;
select tests.autenticar_como(tests.u('hugo'));
insert into res select 'q_grupos', public.accept_invitation(tests.tkn('c1'), tests.mid(401));
reset role;
select is(tests.err('q_grupos'), 'SMGFL', 'Una cuenta con 200 grupos responde SMGFL');
select is((select j ->> 'quota' from res where k = 'q_grupos'), 'groups', 'Con quota = groups');
select is(tests.acc(tests.id('viaje'), tests.u('hugo')), null, 'Y no entra');

-- 200 miembros por grupo: solo frena crear uno nuevo, no elegir uno existente.
insert into public.group_members (id, group_id, display_name)
select tests.mid(6000 + n), tests.id('viaje'), 'R' || n
from generate_series(1, 200 - (select count(*)::integer from public.group_members where group_id = tests.id('viaje'))) n;
select tests.autenticar_como(tests.u('gabi'));
insert into res select 'q_miembros', public.accept_invitation(
  tests.tkn('c1'), null, jsonb_build_object('id', tests.mid(405), 'display_name', 'Gabi')
);
reset role;
select is(tests.err('q_miembros'), 'SMGFL', 'Con 200 miembros no se crea uno nuevo (SMGFL)');
select is((select j ->> 'quota' from res where k = 'q_miembros'), 'members', 'Con quota = members');
select tests.autenticar_como(tests.u('gabi'));
insert into res select 'q_miembros_ok', public.accept_invitation(tests.tkn('c1'), tests.mid(6001));
reset role;
select is(
  (select j ->> 'group_id' from res where k = 'q_miembros_ok'),
  tests.id('viaje')::text,
  'Pero elegir un miembro que ya existe sí entra'
);

-- Quitar el acceso y volver a entrar --------------------------------------------------------------------

select tests.autenticar_como(tests.id('ana'));
select public.remove_access(tests.id('viaje'), tests.u('eva'));
reset role;
select is(tests.acc(tests.id('viaje'), tests.u('eva')), 'member/fuera', 'Ana le quita el acceso a Eva');
select tests.autenticar_como(tests.u('eva'));
insert into res select 'p_eva_fuera', public.preview_invitation(tests.tkn('c1'));
reset role;
select is((select j ->> 'already_member' from res where k = 'p_eva_fuera'), 'false', 'Eva ya no figura como miembro');
select tests.autenticar_como(tests.u('eva'));
insert into res select 'a_eva2', public.accept_invitation(tests.tkn('c1'), tests.mid(401));
reset role;
select is(tests.acc(tests.id('viaje'), tests.u('eva')), 'member', 'Eva vuelve con otro uso del enlace: se reactiva su fila');
select is(
  (select count(*)::integer from public.group_access where group_id = tests.id('viaje') and user_id = tests.u('eva')),
  1,
  'Sin duplicar la fila de acceso'
);
select is(
  (select invitation_id from public.group_access where group_id = tests.id('viaje') and user_id = tests.u('eva')),
  (select (j ->> 'id')::uuid from res where k = 'c1'),
  'Con la invitación por la que volvió'
);
select is(
  (select user_id from public.group_members where id = tests.mid(401)),
  tests.u('eva'),
  'Y vinculada de nuevo a su miembro'
);
select ok(
  exists (
    select 1 from public.change_log
    where group_id = tests.id('viaje') and entity = 'access' and action = 'restore' and actor = tests.u('eva')
  ),
  'El historial anota la reactivación como restore'
);

-- revoke_invitation -------------------------------------------------------------------------------------

select tests.autenticar_como(tests.id('caro'));
select throws_ok(
  format($f$ select public.revoke_invitation('%s') $f$, (select (j ->> 'id')::uuid from res where k = 'c1')),
  '42501', null, 'Un miembro que no creó el enlace ni es el dueño no lo revoca'
);
reset role;
select tests.autenticar_como(tests.u('hugo'));
select throws_ok(
  format($f$ select public.revoke_invitation('%s') $f$, (select (j ->> 'id')::uuid from res where k = 'c1')),
  '42501', null, 'Quien no tiene acceso al grupo tampoco'
);
select throws_ok(
  $$ select public.revoke_invitation(gen_random_uuid()) $$,
  '42501', null, 'Un id que no existe da el mismo error'
);
select throws_ok(
  $$ select public.revoke_invitation(null) $$,
  '22023', null, 'Sin id es un error de programación'
);
reset role;

select tests.autenticar_como(tests.id('ana'));
select public.revoke_invitation((select (j ->> 'id')::uuid from res where k = 'c3'));
reset role;
select results_eq(
  format($f$ select revoked_at is not null, revoked_by from private.group_invitations where id = '%s' $f$, (select (j ->> 'id')::uuid from res where k = 'c3')),
  format($f$ values (true, '%s'::uuid) $f$, tests.id('ana')),
  'La dueña revoca el enlace de Beto y queda anotada'
);
create temp table antes as
select revoked_at, revoked_by from private.group_invitations
where id = (select (j ->> 'id')::uuid from res where k = 'c3');
select tests.autenticar_como(tests.id('beto'));
select public.revoke_invitation((select (j ->> 'id')::uuid from res where k = 'c3'));
reset role;
select results_eq(
  format($f$ select revoked_at, revoked_by from private.group_invitations where id = '%s' $f$, (select (j ->> 'id')::uuid from res where k = 'c3')),
  $$ select revoked_at, revoked_by from antes $$,
  'Repetirla no cambia nada (ni la fecha ni quién)'
);
select tests.autenticar_como(tests.id('beto'));
insert into res select 'c4', public.create_invitation(tests.id('viaje'));
select public.revoke_invitation((select (j ->> 'id')::uuid from res where k = 'c4'));
reset role;
select is(
  (select revoked_by from private.group_invitations where id = (select (j ->> 'id')::uuid from res where k = 'c4')),
  tests.id('beto'),
  'Quien creó el enlace lo revoca'
);
select tests.autenticar_como(tests.u('hugo'));
insert into res select 'p_revocado', public.preview_invitation(tests.tkn('c3'));
insert into res select 'a_revocado', public.accept_invitation(tests.tkn('c3'), tests.mid(6002));
reset role;
select is(tests.err('p_revocado'), 'SMINV', 'Un enlace revocado da SMINV en la vista previa');
select is(tests.err('a_revocado'), 'SMINV', 'Y al aceptar');

-- list_invitations --------------------------------------------------------------------------------------

select tests.inv('vencido3dias', tests.id('viaje'), tests.id('ana'), interval '10 days', interval '7 days');
select tests.inv('vencido40dias', tests.id('viaje'), tests.id('ana'), interval '40 days', interval '20 days');

select tests.autenticar_como(tests.id('caro'));
insert into res select 'l_caro', public.list_invitations(tests.id('viaje'));
reset role;
select is(jsonb_typeof((select j from res where k = 'l_caro')), 'array', 'La lista es un arreglo');
select is(
  (select array_agg(key order by key) from (
    select distinct jsonb_object_keys(e) as key from res, jsonb_array_elements(j) e where res.k = 'l_caro'
  ) s),
  array['created_at', 'created_by', 'expires_at', 'id', 'max_uses', 'revoked_at', 'status', 'use_count'],
  'Cada enlace trae solo id, created_by, created_at, expires_at, max_uses, use_count, revoked_at y status'
);
select is(
  (select j::text like '%' || tests.tkn('c1') || '%' from res where k = 'l_caro'),
  false,
  'Nunca el token'
);
select is(
  (select j::text like '%' || encode(sha256(convert_to(tests.tkn('c1'), 'UTF8')), 'hex') || '%' from res where k = 'l_caro'),
  false,
  'Ni su hash'
);
select is(
  (select e ->> 'status' from res, jsonb_array_elements(j) e where res.k = 'l_caro' and (e ->> 'id')::uuid = (select (j ->> 'id')::uuid from res where k = 'c1')),
  'active',
  'El enlace vigente figura como active'
);
select is(
  (select e ->> 'status' from res, jsonb_array_elements(j) e where res.k = 'l_caro' and (e ->> 'id')::uuid = (select (j ->> 'id')::uuid from res where k = 'c3')),
  'revoked',
  'El revocado, como revoked'
);
select is(
  (select e ->> 'status' from res, jsonb_array_elements(j) e where res.k = 'l_caro' and (e ->> 'id')::uuid = (select (j ->> 'id')::uuid from res where k = 'c2')),
  'exhausted',
  'El agotado, como exhausted'
);
select is(
  (select count(*)::integer from res, jsonb_array_elements(j) e
    where res.k = 'l_caro' and e ->> 'status' = 'expired'),
  2,
  'Los vencidos de la última semana aparecen como expired (el vencido hace 3 días y el de la prueba de arriba)'
);
select is(
  (select count(*)::integer from res, jsonb_array_elements(j) e
    where res.k = 'l_caro'
      and (e ->> 'id')::uuid = (select id from private.group_invitations where token_hash = sha256(convert_to(tests.tk('vencido40dias'), 'UTF8')))),
  0,
  'Y los que vencieron hace más de 7 días ya no'
);
select is(
  (select array_agg((e ->> 'created_at')::timestamptz order by ord) from res, jsonb_array_elements(j) with ordinality t (e, ord) where res.k = 'l_caro'),
  (select array_agg((e ->> 'created_at')::timestamptz order by (e ->> 'created_at')::timestamptz desc, e ->> 'id') from res, jsonb_array_elements(j) e where res.k = 'l_caro'),
  'Del más nuevo al más viejo'
);
select tests.autenticar_como(tests.u('hugo'));
select throws_ok(
  $$ select public.list_invitations(tests.id('viaje')) $$,
  '42501', null, 'Quien no tiene acceso no lista los enlaces'
);
select throws_ok(
  $$ select public.list_invitations(null) $$,
  '22023', null, 'Sin grupo, error de programación'
);
reset role;

-- Salir del grupo revoca los enlaces de quien sale -------------------------------------------------------

select tests.autenticar_como(tests.id('beto'));
insert into res select 'c5', public.create_invitation(tests.id('viaje'));
select public.leave_group(tests.id('viaje'));
reset role;
select ok(
  (select revoked_at is not null and revoked_by = tests.id('beto')
    from private.group_invitations where id = (select (j ->> 'id')::uuid from res where k = 'c5')),
  'Los enlaces de Beto quedan revocados cuando sale del grupo'
);
select ok(
  (select revoked_at is null
    from private.group_invitations where id = (select (j ->> 'id')::uuid from res where k = 'c1')),
  'Los de Ana siguen vigentes'
);
select tests.autenticar_como(tests.u('hugo'));
insert into res select 'a_c5', public.accept_invitation(tests.tkn('c5'), tests.mid(6003));
reset role;
select is(tests.err('a_c5'), 'SMINV', 'Y el enlace de quien salió ya no sirve');

-- Límites de la tabla -------------------------------------------------------------------------------------

select throws_ok(
  $$ select tests.inv('largo', tests.id('viaje'), tests.id('ana'), interval '0 seconds', interval '31 days') $$,
  '23514', null, 'Un enlace no vence a más de 30 días'
);
select throws_ok(
  $$ select tests.inv('corto', tests.id('viaje'), tests.id('ana'), interval '0 seconds', interval '30 minutes') $$,
  '23514', null, 'Ni a menos de 1 hora'
);
select throws_ok(
  $$ select tests.inv('usos51', tests.id('viaje'), tests.id('ana'), interval '0 seconds', interval '7 days', 51) $$,
  '23514', null, 'Ni admite más de 50 usos'
);
select throws_ok(
  $$ select tests.inv('pasado', tests.id('viaje'), tests.id('ana'), interval '0 seconds', interval '7 days', 2, 3) $$,
  '23514', null, 'Ni tiene más usos gastados que permitidos'
);
select throws_ok(
  $$
    insert into private.group_invitations (group_id, token_hash, created_by, expires_at, max_uses)
    select group_id, token_hash, created_by, now() + interval '1 day', 1 from private.group_invitations limit 1
  $$,
  '23505', null, 'Dos enlaces no comparten hash'
);

-- Sin privilegios para las cuentas -------------------------------------------------------------------------

select tests.autenticar_como(tests.id('ana'));
select throws_ok(
  $$ select token_hash from private.group_invitations $$,
  '42501', null, 'authenticated no lee private.group_invitations'
);
select throws_ok(
  $$ select 1 from private.rate_events $$,
  '42501', null, 'Ni private.rate_events'
);
select throws_ok(
  $$ insert into private.group_invitations (group_id, token_hash, created_by, expires_at, max_uses)
     values (tests.id('viaje'), '\x00'::bytea, tests.id('ana'), now() + interval '1 day', 1) $$,
  '42501', null, 'Ni escribe en ellas'
);
select throws_ok(
  $$ select private.claim_invitation_use(gen_random_uuid()) $$,
  '42501', null, 'Ni ejecuta private.claim_invitation_use'
);
reset role;

-- El token no queda en ninguna parte -----------------------------------------------------------------------

select is_empty(
  format(
    $f$
      select 1 from public.change_log
      where snapshot::text like '%%%1$s%%' or fields::text like '%%%1$s%%'
    $f$,
    tests.tkn('c1')
  ),
  'El historial no guarda el token'
);
select is_empty(
  format($f$ select 1 from public.group_access where to_jsonb(group_access)::text like '%%%s%%' $f$, tests.tkn('c1')),
  'group_access tampoco'
);

-- Al borrar la invitación, el acceso conserva su fila ------------------------------------------------------

delete from private.group_invitations
where id = (select (j ->> 'id')::uuid from res where k = 'c1');
select is(
  (select invitation_id from public.group_access where group_id = tests.id('viaje') and user_id = tests.id('caro')),
  null,
  'Borrar la invitación deja el acceso con invitation_id nulo (ON DELETE SET NULL)'
);

select * from finish();
rollback;
