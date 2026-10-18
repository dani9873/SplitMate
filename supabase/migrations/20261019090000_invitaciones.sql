-- Invitaciones por enlace (Fase 4b, design/fase-4b/diseno.md, sección a):
-- - private.group_invitations: un enlace por fila; la base guarda solo el SHA-256 del token y
--   nadie (ni authenticated ni service_role) la toca fuera de las RPC;
-- - private.rate_events: eventos para los topes por cuenta (intentos fallidos y enlaces creados);
-- - cinco RPC SECURITY DEFINER: create_invitation, preview_invitation, accept_invitation,
--   revoke_invitation y list_invitations;
-- - group_access.invitation_id apunta a la invitación por la que entró la cuenta;
-- - salir de un grupo revoca los enlaces que esa cuenta creó en él, y expulsarla revoca todos los
--   enlaces vigentes del grupo.
--
-- Seguridad (013-invitaciones verifica cada punto):
-- - El token (32 bytes aleatorios del servidor, 43 caracteres base64url) se ve una sola vez, en la
--   respuesta de create_invitation. Nunca va a la base, al historial, a los errores ni a los
--   registros: preview y accept responden { "error": ... } con estado 200 y no lanzan nada que
--   repita el argumento.
-- - Un token inexistente, mal formado, vencido, revocado, agotado o de un grupo borrado da el mismo
--   { "error": "SMINV" } en preview y en accept. Cada uno cuenta como un intento fallido, y con 10
--   en la última hora la cuenta recibe { "error": "SMRLT" } incluso con un token válido. Se
--   responde en vez de lanzar para que la transacción confirme el evento: si lanzara, PostgREST
--   la desharía y el tope no serviría de nada.
-- - El uso se reclama con un solo UPDATE condicionado (private.claim_invitation_use): nunca se lee
--   el contador para escribirlo después. Antes se bloquea el contador de cambios del grupo (el mismo
--   que usa sync_push) y luego la invitación, siempre en ese orden, para no cruzarse con
--   leave_group y remove_access.
-- - Los errores de programación (argumentos inválidos 22023, sin sesión o sin permiso 42501) sí se
--   lanzan.
-- Los errores de negocio son { "error": "SM..." }: SMINV, SMTKN (el miembro ya no está libre), SMGFL
-- (con "quota": accounts, groups o members) y SMRLT. No dejan escrito nada salvo el evento de
-- intento fallido.
--
-- Requiere pgcrypto (gen_random_bytes); en Supabase ya está en el esquema extensions.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------------------------

create table private.group_invitations (
  -- Del servidor: las filas las crea solo create_invitation.
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  token_hash bytea not null,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  max_uses integer not null,
  use_count integer not null default 0,
  revoked_at timestamptz,
  -- Sin clave foránea, como change_log.actor: no hay que editarlo si esa cuenta se borra.
  revoked_by uuid,
  constraint group_invitations_token_hash_unique unique (token_hash),
  constraint group_invitations_token_hash_length check (octet_length(token_hash) = 32),
  constraint group_invitations_lifetime check (
    expires_at between created_at + interval '1 hour' and created_at + interval '30 days'
  ),
  constraint group_invitations_max_uses check (max_uses between 1 and 50),
  constraint group_invitations_use_count check (use_count between 0 and max_uses)
);

-- La lista de enlaces de un grupo y el conteo de los activos.
create index group_invitations_group_idx on private.group_invitations (group_id, created_at desc);

create table private.rate_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now(),
  constraint rate_events_action check (action in ('inv_fail', 'inv_create'))
);

create index rate_events_user_idx on private.rate_events (user_id, action, created_at);

-- Sin políticas: solo las funciones SECURITY DEFINER (dueña postgres) las leen y escriben.
alter table private.group_invitations enable row level security;
alter table private.rate_events enable row level security;
revoke all on table private.group_invitations, private.rate_events
  from public, anon, authenticated, service_role;

-- La invitación por la que entró cada cuenta. Si la invitación se borra, el acceso se queda.
alter table public.group_access
  add constraint group_access_invitation_fk
  foreign key (invitation_id) references private.group_invitations (id) on delete set null;

-- ---------------------------------------------------------------------------------------------
-- Apoyo (solo las llaman las RPC de abajo, que corren como dueñas)
-- ---------------------------------------------------------------------------------------------

-- Reclama un uso del enlace: un solo UPDATE que comprueba el cupo y suma. Devuelve false si el
-- enlace no existe, está revocado, vencido o sin usos libres. Nunca lee el contador para escribirlo
-- después: dos reclamaciones del último cupo no pasan las dos.
create function private.claim_invitation_use(p_id uuid)
returns boolean
language plpgsql
volatile
set search_path = ''
as $$
begin
  update private.group_invitations
  set use_count = use_count + 1
  where id = p_id and revoked_at is null and expires_at > now() and use_count < max_uses;
  return found;
end;
$$;

-- La cuenta ya hizo 10 intentos fallidos en la última hora.
create function private.invitation_attempts_blocked(p_user uuid)
returns boolean
language sql
volatile
set search_path = ''
as $$
  select count(*) >= 10
  from private.rate_events e
  where e.user_id = p_user and e.action = 'inv_fail' and e.created_at > now() - interval '1 hour';
$$;

-- Anota un intento fallido y devuelve la respuesta única de "este enlace no sirve".
create function private.invitation_failure(p_user uuid)
returns jsonb
language sql
volatile
set search_path = ''
as $$
  with e as (
    insert into private.rate_events (user_id, action) values (p_user, 'inv_fail') returning 1
  )
  select jsonb_build_object('error', 'SMINV') from e;
$$;

-- ---------------------------------------------------------------------------------------------
-- create_invitation
-- ---------------------------------------------------------------------------------------------

create function public.create_invitation(
  p_group_id uuid,
  p_expires_hours integer default 168,
  p_max_uses integer default 10
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid := gen_random_uuid();
  v_token text;
  v_expires timestamptz;
begin
  if v_uid is null then
    raise exception 'Se necesita una sesión' using errcode = 'insufficient_privilege';
  end if;
  if p_group_id is null
    or p_expires_hours is null or p_expires_hours not between 1 and 720
    or p_max_uses is null or p_max_uses not between 1 and 50
  then
    raise exception 'Argumentos inválidos' using errcode = '22023';
  end if;

  -- El contador de cambios del grupo, primero: dos enlaces a la vez no pasan del tope de activos.
  perform private.lock_group_changes(p_group_id);
  if not private.can_access_group(p_group_id) or not exists (
    select 1 from public.groups g where g.id = p_group_id and g.deleted_at is null
  ) then
    raise exception 'Sin acceso al grupo' using errcode = 'insufficient_privilege';
  end if;

  delete from private.rate_events
  where user_id = v_uid and created_at < now() - interval '1 day';
  if (
    select count(*) from private.rate_events e
    where e.user_id = v_uid and e.action = 'inv_create' and e.created_at > now() - interval '1 day'
  ) >= 20 then
    return jsonb_build_object('error', 'SMRLT');
  end if;
  if (
    select count(*) from private.group_invitations i
    where i.group_id = p_group_id and i.revoked_at is null and i.expires_at > now()
      and i.use_count < i.max_uses
  ) >= 20 then
    return jsonb_build_object('error', 'SMRLT');
  end if;

  v_token := translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
  v_expires := now() + make_interval(hours => p_expires_hours);
  insert into private.group_invitations (id, group_id, token_hash, created_by, expires_at, max_uses)
  values (v_id, p_group_id, sha256(convert_to(v_token, 'UTF8')), v_uid, v_expires, p_max_uses);
  insert into private.rate_events (user_id, action) values (v_uid, 'inv_create');

  return jsonb_build_object(
    'id', v_id, 'token', v_token, 'expires_at', v_expires, 'max_uses', p_max_uses
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- preview_invitation
-- ---------------------------------------------------------------------------------------------

-- Lo mínimo para decidir: el grupo (id, nombre, emoji, color y moneda), los miembros activos sin
-- cuenta (id y nombre), cuántas cuentas tiene, cuándo vence el enlace y si quien mira ya es del
-- grupo. Ningún monto, ningún rol, ningún correo.
create function public.preview_invitation(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_inv private.group_invitations;
  v_group public.groups;
begin
  if v_uid is null then
    raise exception 'Se necesita una sesión' using errcode = 'insufficient_privilege';
  end if;

  delete from private.rate_events
  where user_id = v_uid and created_at < now() - interval '1 day';
  if private.invitation_attempts_blocked(v_uid) then
    return jsonb_build_object('error', 'SMRLT');
  end if;

  if p_token is null or char_length(p_token) <> 43 or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return private.invitation_failure(v_uid);
  end if;
  select i.* into v_inv
  from private.group_invitations i
  join public.groups g on g.id = i.group_id and g.deleted_at is null
  where i.token_hash = sha256(convert_to(p_token, 'UTF8'))
    and i.revoked_at is null and i.expires_at > now() and i.use_count < i.max_uses;
  if not found then
    return private.invitation_failure(v_uid);
  end if;

  select * into v_group from public.groups g where g.id = v_inv.group_id;
  return jsonb_build_object(
    'group', jsonb_build_object(
      'id', v_group.id, 'name', v_group.name, 'emoji', v_group.emoji, 'color', v_group.color,
      'currency', v_group.currency
    ),
    'members', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', m.id, 'display_name', m.display_name) order by m.created_at, m.id
      )
      from public.group_members m
      where m.group_id = v_group.id and m.user_id is null and m.deleted_at is null
    ), '[]'::jsonb),
    'accounts', (
      select count(*) from public.group_access a
      where a.group_id = v_group.id and a.deleted_at is null
    ),
    'expires_at', v_inv.expires_at,
    'already_member', private.can_access_group(v_group.id)
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- accept_invitation
-- ---------------------------------------------------------------------------------------------

-- Da acceso como member y vincula a la cuenta con un miembro: uno que ya existe y no tiene cuenta
-- (p_member_id) o uno nuevo ({ id, display_name }, con un id UUID v7 del cliente). Exactamente uno
-- de los dos. Todo en una transacción:
-- 1. argumentos (22023), tope de intentos (SMRLT), token (SMINV);
-- 2. bloqueo del contador del grupo y después de la invitación;
-- 3. si la cuenta ya tiene acceso, devuelve { group_id } sin gastar un uso ni tocar nada;
-- 4. cupos (SMGFL) y miembro libre (SMTKN);
-- 5. reclama el uso con un solo UPDATE y escribe el acceso, el miembro y el historial.
-- Las revisiones del paso 4 van antes de reclamar el uso: una respuesta de error confirma la
-- transacción, así que no puede dejar un uso gastado.
create function public.accept_invitation(
  p_token text,
  p_member_id uuid default null,
  p_new_member jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_group_id uuid;
  v_inv private.group_invitations;
  v_access public.group_access;
  v_member public.group_members;
  v_new_id uuid;
  v_new_name text;
  v_restore boolean := false;
begin
  if v_uid is null then
    raise exception 'Se necesita una sesión' using errcode = 'insufficient_privilege';
  end if;

  -- Los argumentos no dependen del token: validarlos primero no revela nada de él.
  if (p_member_id is null) = (p_new_member is null) then
    raise exception 'Elige un miembro o crea uno nuevo, no ambos' using errcode = '22023';
  end if;
  if p_new_member is not null then
    begin
      perform private.sync_keys(p_new_member, array['id', 'display_name']);
      v_new_id := private.sync_uuid(p_new_member, 'id');
      v_new_name := private.sync_text(p_new_member, 'display_name', 1, 80);
    exception
      when sqlstate 'SMINV' then
        raise exception 'p_new_member no es válido' using errcode = '22023';
    end;
  end if;

  delete from private.rate_events
  where user_id = v_uid and created_at < now() - interval '1 day';
  if private.invitation_attempts_blocked(v_uid) then
    return jsonb_build_object('error', 'SMRLT');
  end if;

  if p_token is null or char_length(p_token) <> 43 or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return private.invitation_failure(v_uid);
  end if;

  -- Primero el grupo (sin bloquear la invitación) y luego el bloqueo del contador del grupo, y
  -- recién después la invitación: leave_group y remove_access bloquean en ese mismo orden.
  select i.group_id into v_group_id
  from private.group_invitations i
  where i.token_hash = sha256(convert_to(p_token, 'UTF8'));
  if not found then
    return private.invitation_failure(v_uid);
  end if;
  perform 1 from private.group_changes c where c.group_id = v_group_id for update;

  select i.* into v_inv
  from private.group_invitations i
  join public.groups g on g.id = i.group_id and g.deleted_at is null
  where i.token_hash = sha256(convert_to(p_token, 'UTF8'))
    and i.revoked_at is null and i.expires_at > now() and i.use_count < i.max_uses
  for update of i;
  if not found then
    return private.invitation_failure(v_uid);
  end if;

  -- Un reintento no hace nada nuevo.
  if private.can_access_group(v_group_id) then
    return jsonb_build_object('group_id', v_group_id);
  end if;

  begin
    perform private.sync_check_quota('groups', null);
  exception
    when sqlstate 'SMQTA' then
      return jsonb_build_object('error', 'SMGFL', 'quota', 'groups');
  end;
  if (
    select count(*) from public.group_access a
    where a.group_id = v_group_id and a.deleted_at is null
  ) >= 50 then
    return jsonb_build_object('error', 'SMGFL', 'quota', 'accounts');
  end if;

  if p_member_id is not null then
    -- Que no exista, sea de otro grupo, esté borrado o ya tenga cuenta es lo mismo para quien
    -- llama: el miembro ya no está libre y la app vuelve a cargar la vista previa.
    select * into v_member
    from public.group_members m
    where m.id = p_member_id and m.group_id = v_group_id
      and m.user_id is null and m.deleted_at is null
    for update;
    if not found then
      return jsonb_build_object('error', 'SMTKN');
    end if;
  else
    begin
      perform private.sync_check_quota('members', v_group_id);
    exception
      when sqlstate 'SMQTA' then
        return jsonb_build_object('error', 'SMGFL', 'quota', 'members');
    end;
  end if;

  if not private.claim_invitation_use(v_inv.id) then
    return private.invitation_failure(v_uid);
  end if;

  -- El acceso: se reactiva la fila de quien ya estuvo, o se crea.
  select * into v_access
  from public.group_access a
  where a.group_id = v_group_id and a.user_id = v_uid
  for update;
  if found then
    v_restore := true;
    update public.group_access
    set deleted_at = null, role = 'member', invitation_id = v_inv.id
    where id = v_access.id
    returning * into v_access;
  else
    insert into public.group_access (group_id, user_id, role, invitation_id)
    values (v_group_id, v_uid, 'member', v_inv.id)
    returning * into v_access;
  end if;
  insert into public.change_log
    (group_id, entity, entity_id, action, fields, snapshot, version, actor)
  values (
    v_group_id, 'access', v_access.id,
    case when v_restore then 'restore' else 'create' end,
    case when v_restore then array['deleted', 'invitation_id'] else array['invitation_id', 'role'] end,
    jsonb_build_array(jsonb_build_object('table', 'group_access', 'row', to_jsonb(v_access))),
    v_access.version, v_uid
  );

  -- El miembro: se vincula el elegido o se crea el nuevo.
  if p_member_id is not null then
    update public.group_members set user_id = v_uid where id = v_member.id
    returning * into v_member;
    insert into public.change_log
      (group_id, entity, entity_id, action, fields, snapshot, version, actor)
    values (
      v_group_id, 'member', v_member.id, 'update', array['user_id'],
      jsonb_build_array(jsonb_build_object('table', 'group_members', 'row', to_jsonb(v_member))),
      v_member.version, v_uid
    );
  else
    insert into public.group_members (id, group_id, user_id, display_name, role)
    values (v_new_id, v_group_id, v_uid, v_new_name, 'member')
    on conflict (id) do nothing
    returning * into v_member;
    if not found then
      -- El id ya es de otra fila: se deshace todo, incluido el uso.
      raise exception 'El id del miembro ya está en uso' using errcode = '22023';
    end if;
    insert into public.change_log
      (group_id, entity, entity_id, action, fields, snapshot, version, actor)
    values (
      v_group_id, 'member', v_member.id, 'create',
      array['deleted', 'display_name', 'group_id', 'role', 'user_id'],
      jsonb_build_array(jsonb_build_object('table', 'group_members', 'row', to_jsonb(v_member))),
      v_member.version, v_uid
    );
  end if;

  return jsonb_build_object('group_id', v_group_id);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- revoke_invitation y list_invitations
-- ---------------------------------------------------------------------------------------------

-- Quien creó el enlace o el dueño del grupo, siempre con acceso activo. Repetirla no cambia nada.
-- Un id que no existe y uno sin permiso dan el mismo error. No toca el historial: la revocación
-- no es una entidad de change_log.
create function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_group uuid;
  v_creator uuid;
begin
  if v_uid is null then
    raise exception 'Se necesita una sesión' using errcode = 'insufficient_privilege';
  end if;
  if p_invitation_id is null then
    raise exception 'p_invitation_id es obligatorio' using errcode = '22023';
  end if;

  select i.group_id, i.created_by into v_group, v_creator
  from private.group_invitations i
  where i.id = p_invitation_id;
  if not found
    or not private.can_access_group(v_group)
    or not (v_creator = v_uid or private.is_group_owner(v_group))
  then
    raise exception 'Sin permiso para revocar este enlace' using errcode = 'insufficient_privilege';
  end if;

  -- El mismo orden que accept_invitation: el contador del grupo y después la invitación.
  perform 1 from private.group_changes c where c.group_id = v_group for update;
  update private.group_invitations
  set revoked_at = now(), revoked_by = v_uid
  where id = p_invitation_id and revoked_at is null;
end;
$$;

-- Los enlaces activos del grupo y los vencidos o revocados en los últimos 7 días, del más nuevo al
-- más viejo (hasta 100). status: revoked, expired, exhausted o active, en ese orden de prioridad.
-- Nunca el token ni su hash.
create function public.list_invitations(p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Se necesita una sesión' using errcode = 'insufficient_privilege';
  end if;
  if p_group_id is null then
    raise exception 'p_group_id es obligatorio' using errcode = '22023';
  end if;
  if not private.can_access_group(p_group_id) then
    raise exception 'Sin acceso al grupo' using errcode = 'insufficient_privilege';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', x.id, 'created_by', x.created_by, 'created_at', x.created_at,
        'expires_at', x.expires_at, 'max_uses', x.max_uses, 'use_count', x.use_count,
        'revoked_at', x.revoked_at, 'status', x.status
      )
      order by x.created_at desc, x.id
    )
    from (
      select i.id, i.created_by, i.created_at, i.expires_at, i.max_uses, i.use_count, i.revoked_at,
        case
          when i.revoked_at is not null then 'revoked'
          when i.expires_at <= now() then 'expired'
          when i.use_count >= i.max_uses then 'exhausted'
          else 'active'
        end as status
      from private.group_invitations i
      where i.group_id = p_group_id
        and least(i.expires_at, coalesce(i.revoked_at, 'infinity'::timestamptz))
          > now() - interval '7 days'
      order by i.created_at desc, i.id
      limit 100
    ) x
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Salir o ser expulsado revoca los enlaces de esa cuenta en el grupo
-- ---------------------------------------------------------------------------------------------

-- Igual a la versión anterior, más la revocación de los enlaces que la cuenta creó en el grupo: sin
-- ella, quien sale o es expulsado podría seguir trayendo gente (o volver) con sus propios enlaces.
-- create or replace conserva los privilegios de la función.
create or replace function private.release_access(p_group_id uuid, p_user_id uuid, p_actor uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_access public.group_access;
  v_heir public.group_access;
  v_member public.group_members;
  v_was_owner boolean;
begin
  select * into v_access
  from public.group_access a
  where a.group_id = p_group_id and a.user_id = p_user_id and a.deleted_at is null
  for update;
  if not found then
    return;
  end if;
  v_was_owner := v_access.role = 'owner';

  update public.group_access
  set deleted_at = now(), role = 'member'
  where id = v_access.id
  returning * into v_access;
  insert into public.change_log
    (group_id, entity, entity_id, action, fields, snapshot, version, actor)
  values (
    p_group_id, 'access', v_access.id, 'delete', array['deleted', 'role'],
    jsonb_build_array(jsonb_build_object('table', 'group_access', 'row', to_jsonb(v_access))),
    v_access.version, p_actor
  );

  update private.group_invitations
  set revoked_at = now(), revoked_by = p_actor
  where group_id = p_group_id and created_by = p_user_id and revoked_at is null;

  if v_was_owner then
    select * into v_heir
    from public.group_access a
    where a.group_id = p_group_id and a.deleted_at is null
    order by a.created_at, a.id
    limit 1
    for update;
    if found then
      update public.group_access set role = 'owner' where id = v_heir.id returning * into v_heir;
      insert into public.change_log
        (group_id, entity, entity_id, action, fields, snapshot, version, actor)
      values (
        p_group_id, 'access', v_heir.id, 'update', array['role'],
        jsonb_build_array(jsonb_build_object('table', 'group_access', 'row', to_jsonb(v_heir))),
        v_heir.version, p_actor
      );
    end if;
  end if;

  for v_member in
    update public.group_members
    set user_id = null
    where group_id = p_group_id and user_id = p_user_id and deleted_at is null
    returning *
  loop
    insert into public.change_log
      (group_id, entity, entity_id, action, fields, snapshot, version, actor)
    values (
      p_group_id, 'member', v_member.id, 'update', array['user_id'],
      jsonb_build_array(jsonb_build_object('table', 'group_members', 'row', to_jsonb(v_member))),
      v_member.version, p_actor
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Expulsar revoca todos los enlaces vigentes del grupo
-- ---------------------------------------------------------------------------------------------

-- Igual a la versión anterior, más la revocación de todos los enlaces vigentes del grupo: quien fue
-- expulsado pudo ver cualquier enlace compartido en el grupo y, sin esto, volvería a entrar con él.
-- El dueño crea enlaces nuevos para quien sí quiere. (leave_group solo revoca los de quien sale, en
-- private.release_access.) create or replace conserva los privilegios de la función.
create or replace function public.remove_access(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Se necesita una sesión' using errcode = 'insufficient_privilege';
  end if;
  if p_user_id is null then
    raise exception 'p_user_id es obligatorio' using errcode = '22023';
  end if;
  perform private.lock_group_changes(p_group_id);
  if not private.is_group_owner(p_group_id) or p_user_id = v_uid then
    raise exception 'Solo el dueño quita el acceso a otra cuenta' using errcode = 'insufficient_privilege';
  end if;
  if exists (
    select 1 from public.group_access a
    where a.group_id = p_group_id and a.user_id = p_user_id and a.deleted_at is null
  ) then
    update private.group_invitations
    set revoked_at = now(), revoked_by = v_uid
    where group_id = p_group_id and revoked_at is null;
  end if;
  perform private.release_access(p_group_id, p_user_id, v_uid);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------------------------

-- Las funciones de apoyo no las ejecuta nadie más que las RPC (que corren como dueñas). Las cinco
-- RPC, solo authenticated: anon no las ejecuta, ni service_role.
revoke all on function
  private.claim_invitation_use(uuid),
  private.invitation_attempts_blocked(uuid),
  private.invitation_failure(uuid),
  public.create_invitation(uuid, integer, integer),
  public.preview_invitation(text),
  public.accept_invitation(text, uuid, jsonb),
  public.revoke_invitation(uuid),
  public.list_invitations(uuid)
from public, anon, authenticated, service_role;
grant execute on function
  public.create_invitation(uuid, integer, integer),
  public.preview_invitation(text),
  public.accept_invitation(text, uuid, jsonb),
  public.revoke_invitation(uuid),
  public.list_invitations(uuid)
to authenticated;
