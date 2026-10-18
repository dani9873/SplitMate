-- Acceso por membresía (Fase 4b, design/fase-4b/diseno.md, sección b): quién abre un grupo deja de
-- depender de ser su creador y pasa a una tabla, public.group_access, que se puede quitar.
-- - public.group_access: una fila por cuenta y grupo, rol owner o member, de solo bajada para la
--   app (authenticated solo lee; la escriben triggers y RPC SECURITY DEFINER);
-- - relleno de los grupos que ya existen (private.backfill_group_access, idempotente);
-- - private.can_access_group, la política de groups, group_members_insert y shares_group_with
--   leen group_access; el trigger de groups da el dueño a su creador;
-- - reglas nuevas de sync_push: borrar o restaurar el grupo solo el dueño, member_linked (no se
--   borra el miembro de una cuenta con acceso) y la propia desvinculación del "soy yo";
-- - leave_group y remove_access; borrar una cuenta con grupos compartidos le quita el acceso y
--   pasa el rol de dueño a la cuenta activa más antigua.
-- sync_pull (v1) no cambia ni devuelve group_access: la app de la 4a sigue funcionando igual.
-- 012-acceso, 001-estructura y 006-privilegios lo verifican.

-- ---------------------------------------------------------------------------------------------
-- Tabla
-- ---------------------------------------------------------------------------------------------

create table public.group_access (
  -- Del servidor: las filas las crean solo triggers y RPC.
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member',
  -- La invitación por la que entró (la FK llega con la tabla de invitaciones). Nulo para el
  -- creador y para las filas del relleno.
  invitation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Con valor quiere decir "sin acceso".
  deleted_at timestamptz,
  version integer not null default 1,
  change_seq bigint not null default 0,
  constraint group_access_role check (role in ('owner', 'member')),
  constraint group_access_version_positive check (version >= 1),
  constraint group_access_group_user_unique unique (group_id, user_id)
);

-- Un solo dueño activo por grupo.
create unique index group_access_one_owner
  on public.group_access (group_id)
  where role = 'owner' and deleted_at is null;
-- Cuántos grupos tiene una cuenta (cupo) y la lista de los suyos.
create index group_access_user_idx on public.group_access (user_id) where deleted_at is null;
create index group_access_change_seq_idx on public.group_access (group_id, change_seq);

create trigger group_access_sync_stamp
  before insert or update on public.group_access
  for each row execute function private.stamp_sync_row();

alter table public.group_access enable row level security;

create policy group_access_select on public.group_access
  for select to authenticated
  using (private.can_access_group(group_id));

-- Solo lectura para authenticated; anon y service_role no tienen nada.
revoke all on table public.group_access from public, anon, authenticated, service_role;
grant select on table public.group_access to authenticated;

-- El historial registra también los cambios de acceso.
alter table public.change_log drop constraint change_log_entity;
alter table public.change_log add constraint change_log_entity check (
  entity in ('group', 'member', 'category', 'expense', 'transfer', 'access')
);

-- ---------------------------------------------------------------------------------------------
-- Relleno de los grupos existentes
-- ---------------------------------------------------------------------------------------------

-- Idempotente: correrla otra vez no duplica filas ni devuelve el acceso a quien ya lo perdió.
-- Devuelve cuántas filas creó. Pasa por el trigger de columnas, así que sus filas reciben
-- change_seq y llegan a la app nueva como cualquier cambio.
-- 1. Dueño: el creador, también en grupos borrados (para poder restaurarlos).
-- 2. Sin creador (su cuenta se borró): dueña la cuenta vinculada activa más antigua.
-- 3. Miembro: cada cuenta vinculada a un miembro activo.
create function private.backfill_group_access()
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_total integer := 0;
  v_n integer;
begin
  insert into public.group_access (group_id, user_id, role)
  select g.id, g.created_by, 'owner'
  from public.groups g
  where g.created_by is not null
    and not exists (
      select 1 from public.group_access a
      where a.group_id = g.id and a.role = 'owner' and a.deleted_at is null
    )
  order by g.id
  on conflict do nothing;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  insert into public.group_access (group_id, user_id, role)
  select distinct on (m.group_id) m.group_id, m.user_id, 'owner'
  from public.group_members m
  where m.user_id is not null
    and m.deleted_at is null
    and not exists (
      select 1 from public.group_access a
      where a.group_id = m.group_id and a.role = 'owner' and a.deleted_at is null
    )
    and not exists (
      select 1 from public.group_access a
      where a.group_id = m.group_id and a.user_id = m.user_id
    )
  order by m.group_id, m.created_at, m.id
  on conflict do nothing;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  insert into public.group_access (group_id, user_id, role)
  select distinct on (m.group_id, m.user_id) m.group_id, m.user_id, 'member'
  from public.group_members m
  where m.user_id is not null and m.deleted_at is null
  order by m.group_id, m.user_id, m.created_at, m.id
  on conflict do nothing;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  select count(*) into v_n
  from public.groups g
  where not exists (select 1 from public.group_access a where a.group_id = g.id);
  if v_n > 0 then
    raise notice '% grupo(s) sin ninguna cuenta con acceso', v_n;
  end if;

  return v_total;
end;
$$;

revoke all on function private.backfill_group_access()
  from public, anon, authenticated, service_role;

do $$
begin
  perform private.backfill_group_access();
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Acceso en RLS
-- ---------------------------------------------------------------------------------------------

-- La cuenta de la sesión tiene acceso activo al grupo. El creador ya no entra por serlo.
create or replace function private.can_access_group(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_access a
    where a.group_id = p_group_id
      and a.user_id = (select auth.uid())
      and a.deleted_at is null
  );
$$;

-- La cuenta de la sesión es la dueña activa del grupo.
create function private.is_group_owner(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_access a
    where a.group_id = p_group_id
      and a.user_id = (select auth.uid())
      and a.role = 'owner'
      and a.deleted_at is null
  );
$$;

-- El grupo tiene alguna fila de acceso, activa o no. Solo un grupo recién creado no tiene
-- ninguna: la política de groups deja ver al creador su fila en el mismo INSERT ... RETURNING que
-- la crea (el trigger que le da el acceso corre después). Un creador expulsado tiene su fila con
-- deleted_at, así que no entra por esa vía.
create function private.group_has_access_rows(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.group_access a where a.group_id = p_group_id);
$$;

-- Los perfiles de quien comparte un grupo con acceso activo (antes, por miembro vinculado).
create or replace function private.shares_group_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_access mine
    join public.group_access theirs on theirs.group_id = mine.group_id
    where mine.user_id = (select auth.uid())
      and mine.deleted_at is null
      and theirs.user_id = p_user_id
      and theirs.deleted_at is null
  );
$$;

drop policy groups_select on public.groups;
drop policy groups_update on public.groups;
create policy groups_select on public.groups
  for select to authenticated
  using (
    private.can_access_group(id)
    or (created_by = (select auth.uid()) and not private.group_has_access_rows(id))
  );
create policy groups_update on public.groups
  for update to authenticated
  using (private.can_access_group(id))
  with check (private.can_access_group(id));

-- Solo el dueño agrega un miembro con rol owner (antes, el creador).
drop policy group_members_insert on public.group_members;
create policy group_members_insert on public.group_members
  for insert to authenticated
  with check (
    private.can_access_group(group_id)
    and (user_id is null or user_id = (select auth.uid()))
    and (role = 'member' or private.is_group_owner(group_id))
  );
drop function private.is_group_creator(uuid);

-- El creador de un grupo nuevo es su dueño.
create function private.add_group_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is not null then
    insert into public.group_access (group_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict (group_id, user_id) do nothing;
  end if;
  return null;
end;
$$;

create trigger groups_owner_access
  after insert on public.groups
  for each row execute function private.add_group_owner();

-- ---------------------------------------------------------------------------------------------
-- Quitar el acceso: salir, expulsar y borrar la cuenta
-- ---------------------------------------------------------------------------------------------

-- Quita el acceso activo de una cuenta a un grupo, con sus consecuencias: si era la dueña, el rol
-- pasa a la cuenta activa más antigua (por created_at y luego id), y su miembro queda sin cuenta
-- (sigue en los movimientos). Escribe en change_log a nombre de p_actor, directo: record_change
-- exige que quien llama tenga acceso, y aquí quien pierde el acceso es a veces el propio actor.
-- Sin nada que quitar, no hace nada. La llaman funciones SECURITY DEFINER; nadie más la ejecuta.
create function private.release_access(p_group_id uuid, p_user_id uuid, p_actor uuid)
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

-- Sale del grupo la cuenta de la sesión. SMLST si es la única con acceso (puede borrar el grupo).
-- El contador de cambios queda bloqueado primero: dos cuentas que salen a la vez no se quedan las
-- dos sin acceso.
create function public.leave_group(p_group_id uuid)
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
  perform private.lock_group_changes(p_group_id);
  if not private.can_access_group(p_group_id) then
    raise exception 'Sin acceso al grupo' using errcode = 'insufficient_privilege';
  end if;
  if (
    select count(*) from public.group_access a
    where a.group_id = p_group_id and a.deleted_at is null
  ) < 2 then
    raise exception 'Eres la única persona con acceso' using errcode = 'SMLST';
  end if;
  perform private.release_access(p_group_id, v_uid, v_uid);
end;
$$;

-- El dueño quita el acceso a otra cuenta (nunca a sí mismo: para eso está leave_group). Quitárselo
-- a quien no lo tiene no hace nada.
create function public.remove_access(p_group_id uuid, p_user_id uuid)
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
  perform private.release_access(p_group_id, p_user_id, v_uid);
end;
$$;

-- Borrar la cuenta (la cascada de auth.admin.deleteUser; el trigger corre antes de borrar el
-- perfil): los grupos sin otra cuenta con acceso se borran, con todas sus filas. En los
-- compartidos solo se quita su acceso: el rol de dueño pasa a la cuenta activa más antigua y su
-- miembro queda sin cuenta, con sus gastos. Los triggers no necesitan EXECUTE para dispararse.
create or replace function private.delete_unshared_groups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid;
begin
  delete from public.groups g
  where (
      g.created_by = old.id
      or exists (
        select 1
        from public.group_access a
        where a.group_id = g.id and a.user_id = old.id and a.deleted_at is null
      )
    )
    and not exists (
      select 1
      from public.group_access a
      where a.group_id = g.id and a.user_id <> old.id and a.deleted_at is null
    );

  for v_group in
    select a.group_id
    from public.group_access a
    where a.user_id = old.id and a.deleted_at is null
    order by a.group_id
  loop
    perform private.release_access(v_group, old.id, old.id);
  end loop;
  return old;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Reglas nuevas de sync_push
-- ---------------------------------------------------------------------------------------------

-- Borrar o restaurar un grupo es del dueño; archivarlo, de cualquiera con acceso. Un miembro con
-- cuenta y acceso no se borra: primero se le quita el acceso (SMLNK, que sync_push responde como
-- rejected / member_linked, con borrador). Desvincular el propio "soy yo" ya no depende del
-- miembro vinculado, porque el acceso vive en group_access.

create or replace function private.sync_apply_group(p_data jsonb, p_base integer, p_mutation uuid)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_id uuid;
  v_new jsonb;
  v_old jsonb;
  v_row public.groups;
  v_archived boolean;
  v_deleted boolean;
  v_version integer;
begin
  perform private.sync_keys(
    p_data, array['id', 'name', 'currency', 'emoji', 'color', 'archived', 'deleted']
  );
  v_id := private.sync_uuid(p_data, 'id');
  v_new := jsonb_build_object(
    'name', private.sync_text(p_data, 'name', 1, 80),
    'currency', private.sync_currency(p_data, 'currency'),
    'emoji', private.sync_text(p_data, 'emoji', 1, 16, true),
    'color', private.sync_enum(
      p_data, 'color', array['teal', 'coral', 'amber', 'plum', 'sky', 'olive', 'rose', 'slate']
    ),
    'archived', private.sync_bool(p_data, 'archived'),
    'deleted', private.sync_bool(p_data, 'deleted')
  );
  v_archived := (v_new ->> 'archived')::boolean;
  v_deleted := (v_new ->> 'deleted')::boolean;

  select * into v_row from public.groups where id = v_id for update;
  if not found then
    if p_base is not null then
      raise exception using errcode = 'SMNFD', message = 'base';
    end if;
    insert into public.groups (id, name, currency, emoji, color, created_by, archived_at, deleted_at)
    values (
      v_id, v_new ->> 'name', v_new ->> 'currency', v_new ->> 'emoji', v_new ->> 'color',
      (select auth.uid()),
      case when v_archived then now() end,
      case when v_deleted then now() end
    )
    returning version into v_version;
    perform private.sync_finish(v_id, 'group', v_id, null, v_new, v_version, p_mutation);
    return v_version;
  end if;

  v_old := jsonb_build_object(
    'name', v_row.name, 'currency', v_row.currency, 'emoji', v_row.emoji, 'color', v_row.color,
    'archived', v_row.archived_at is not null, 'deleted', v_row.deleted_at is not null
  );
  if v_old = v_new then
    return v_row.version;
  end if;
  -- Borrar o restaurar el grupo es del dueño.
  if v_deleted is distinct from (v_old ->> 'deleted')::boolean
    and not private.is_group_owner(v_id)
  then
    raise exception 'Solo el dueño borra o restaura el grupo' using errcode = 'insufficient_privilege';
  end if;
  if p_base is distinct from v_row.version then
    raise exception using errcode = 'SMCFL', message = 'conflict';
  end if;

  update public.groups
  set name = v_new ->> 'name',
      currency = v_new ->> 'currency',
      emoji = v_new ->> 'emoji',
      color = v_new ->> 'color',
      archived_at = case when v_archived then now() end,
      deleted_at = case when v_deleted then now() end
  where id = v_id
  returning version into v_version;
  perform private.sync_finish(v_id, 'group', v_id, v_old, v_new, v_version, p_mutation);
  return v_version;
end;
$$;

create or replace function private.sync_apply_member(p_data jsonb, p_base integer, p_mutation uuid)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_id uuid;
  v_group uuid;
  v_new jsonb;
  v_old jsonb;
  v_row public.group_members;
  v_user uuid;
  v_deleted boolean;
  v_version integer;
begin
  perform private.sync_keys(
    p_data, array['id', 'group_id', 'display_name', 'user_id', 'role', 'deleted']
  );
  v_id := private.sync_uuid(p_data, 'id');
  v_group := private.sync_uuid(p_data, 'group_id');
  v_user := private.sync_uuid(p_data, 'user_id', true);
  v_new := jsonb_build_object(
    'group_id', v_group,
    'display_name', private.sync_text(p_data, 'display_name', 1, 80),
    'user_id', v_user,
    'role', private.sync_enum(p_data, 'role', array['owner', 'member']),
    'deleted', private.sync_bool(p_data, 'deleted')
  );
  v_deleted := (v_new ->> 'deleted')::boolean;

  select * into v_row from public.group_members where id = v_id for update;
  if not found then
    if p_base is not null then
      raise exception using errcode = 'SMNFD', message = 'base';
    end if;
    insert into public.group_members (id, group_id, user_id, display_name, role, deleted_at)
    values (
      v_id, v_group, v_user, v_new ->> 'display_name', v_new ->> 'role',
      case when v_deleted then now() end
    )
    returning version into v_version;
    perform private.sync_finish(v_group, 'member', v_id, null, v_new, v_version, p_mutation);
    return v_version;
  end if;

  if v_group is distinct from v_row.group_id then
    perform private.sync_fail('group_id');
  end if;
  if v_new ->> 'role' is distinct from v_row.role then
    perform private.sync_fail('role');
  end if;
  v_old := jsonb_build_object(
    'group_id', v_row.group_id, 'display_name', v_row.display_name, 'user_id', v_row.user_id,
    'role', v_row.role, 'deleted', v_row.deleted_at is not null
  );
  if v_old = v_new then
    return v_row.version;
  end if;
  -- El miembro de una cuenta con acceso no se borra: primero se le quita el acceso. Es un rechazo
  -- (con borrador) y no un fallo porque hay una carrera real: alguien borra a Ana sin conexión
  -- mientras Ana se une con su enlace.
  if v_deleted and v_row.deleted_at is null and v_row.user_id is not null and exists (
    select 1
    from public.group_access a
    where a.group_id = v_row.group_id and a.user_id = v_row.user_id and a.deleted_at is null
  ) then
    raise exception using errcode = 'SMLNK', message = 'member_linked';
  end if;
  if p_base is distinct from v_row.version then
    raise exception using errcode = 'SMCFL', message = 'conflict';
  end if;

  update public.group_members
  set display_name = v_new ->> 'display_name',
      user_id = v_user,
      deleted_at = case when v_deleted then now() end
  where id = v_id
  returning version into v_version;
  perform private.sync_finish(v_group, 'member', v_id, v_old, v_new, v_version, p_mutation);
  return v_version;
end;
$$;

-- sync_push con el rechazo nuevo member_linked (SMLNK). Lo demás es igual a la versión anterior;
-- create or replace conserva los privilegios de la función.
create or replace function public.sync_push(p_mutations jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c_uuid constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_uid uuid := (select auth.uid());
  v_item jsonb;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
  v_mutation uuid;
  v_entity text;
  v_base integer;
  v_data jsonb;
  v_entity_id uuid;
  v_group uuid;
  v_version integer;
  v_field text;
  v_constraint text;
  -- Lo que había antes de la llamada: en la API, nunca 'on'.
  v_mark text := coalesce(current_setting('splitmate.sync_push', true), '');
begin
  if v_uid is null then
    raise exception 'Se necesita una sesión' using errcode = 'insufficient_privilege';
  end if;

  -- El sobre se valida entero antes de escribir: un error aquí es de programación.
  if jsonb_typeof(p_mutations) is distinct from 'array' then
    raise exception 'p_mutations debe ser una lista' using errcode = '22023';
  end if;
  if octet_length(p_mutations::text) > 524288 then
    raise exception 'p_mutations pasa de 512 KiB' using errcode = '54000';
  end if;
  if jsonb_array_length(p_mutations) > 50 then
    raise exception 'Hasta 50 envíos por llamada' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_mutations) loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or (select count(*) from jsonb_object_keys(v_item)) <> 4
      or not (v_item ?& array['id', 'entity', 'base', 'data'])
      or jsonb_typeof(v_item -> 'id') is distinct from 'string'
      or (v_item ->> 'id') !~ c_uuid
      or jsonb_typeof(v_item -> 'entity') is distinct from 'string'
      or not ((v_item ->> 'entity') = any (array['group', 'member', 'category', 'expense', 'transfer']))
      or not (
        jsonb_typeof(v_item -> 'base') = 'null'
        or (jsonb_typeof(v_item -> 'base') = 'number' and (v_item ->> 'base') ~ '^[1-9][0-9]{0,8}$')
      )
      or jsonb_typeof(v_item -> 'data') is distinct from 'object'
    then
      raise exception 'Envío mal formado' using errcode = '22023';
    end if;
  end loop;

  -- La guardia de escritura (stamp_sync_row) deja pasar solo lo que escribe esta función. La
  -- marca dura hasta el return: otra sentencia de la misma transacción (por ejemplo, otra mutación
  -- de una petición GraphQL) no la hereda.
  perform set_config('splitmate.sync_push', 'on', true);

  for v_item in select value from jsonb_array_elements(p_mutations) loop
    v_mutation := (v_item ->> 'id')::uuid;
    v_entity := v_item ->> 'entity';
    v_base := case when jsonb_typeof(v_item -> 'base') = 'number' then (v_item ->> 'base')::integer end;
    v_data := v_item -> 'data';
    v_entity_id := case when (v_data ->> 'id') ~ c_uuid then lower(v_data ->> 'id')::uuid end;

    -- Un punto de guardado por envío: si falla, se deshace solo ese.
    begin
      perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || v_mutation::text, 0));
      v_version := private.sync_find_mutation(v_mutation);
      if v_version is null then
        v_group := case v_entity
          when 'group' then v_entity_id
          else private.sync_uuid(v_data, 'group_id')
        end;
        perform private.lock_group_changes(v_group);
        v_version := case v_entity
          when 'group' then private.sync_apply_group(v_data, v_base, v_mutation)
          when 'member' then private.sync_apply_member(v_data, v_base, v_mutation)
          when 'category' then private.sync_apply_category(v_data, v_base, v_mutation)
          when 'expense' then private.sync_apply_expense(v_data, v_base, v_mutation)
          else private.sync_apply_transfer(v_data, v_base, v_mutation)
        end;
      end if;
      v_result := jsonb_build_object(
        'id', v_mutation, 'status', 'applied', 'version', v_version,
        'current', private.sync_entity_rows(v_entity, v_entity_id)
      );
    exception
      when sqlstate 'SMINV' then
        get stacked diagnostics v_field = message_text;
        v_result := jsonb_build_object(
          'id', v_mutation, 'status', 'failed', 'reason', 'invalid', 'field', v_field
        );
      when sqlstate 'SMNFD' then
        v_result := jsonb_build_object(
          'id', v_mutation, 'status', 'failed', 'reason', 'not_found'
        );
      when sqlstate 'SMCFL' then
        v_result := jsonb_build_object(
          'id', v_mutation, 'status', 'rejected', 'reason', 'conflict',
          'current', private.sync_entity_rows(v_entity, v_entity_id)
        );
      when sqlstate 'SMCUR' then
        v_result := jsonb_build_object(
          'id', v_mutation, 'status', 'rejected', 'reason', 'currency_locked',
          'current', private.sync_entity_rows(v_entity, v_entity_id)
        );
      when sqlstate 'SMLNK' then
        v_result := jsonb_build_object(
          'id', v_mutation, 'status', 'rejected', 'reason', 'member_linked',
          'current', private.sync_entity_rows(v_entity, v_entity_id)
        );
      when sqlstate 'SMGCC' then
        v_result := jsonb_build_object(
          'id', v_mutation, 'status', 'rejected', 'reason', 'group_currency_changed',
          'current', private.sync_entity_rows(v_entity, v_entity_id)
        );
      when unique_violation then
        -- Otro miembro del grupo ya tiene tu cuenta: "soy yo" se movió en otro lado. Un id que ya
        -- existe en otro grupo no es tuyo.
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint = 'group_members_user_unique' then
          v_result := jsonb_build_object(
            'id', v_mutation, 'status', 'rejected', 'reason', 'conflict',
            'current', private.sync_entity_rows(v_entity, v_entity_id)
          );
        elsif v_constraint like '%\_pkey' then
          v_result := jsonb_build_object(
            'id', v_mutation, 'status', 'failed', 'reason', 'forbidden'
          );
        else
          v_result := jsonb_build_object('id', v_mutation, 'status', 'failed', 'reason', 'error');
        end if;
      when insufficient_privilege then
        v_result := jsonb_build_object(
          'id', v_mutation, 'status', 'failed', 'reason', 'forbidden'
        );
      when others then
        -- Interbloqueos, serialización, cancelaciones: la llamada entera falla y el cliente la
        -- repite.
        if left(sqlstate, 2) in ('40', '53', '55', '57', '58', 'XX') then
          raise;
        end if;
        v_result := jsonb_build_object(
          'id', v_mutation, 'status', 'failed',
          'reason', case when left(sqlstate, 2) in ('22', '23') then 'invalid' else 'error' end
        );
    end;
    v_results := v_results || jsonb_build_array(v_result);
  end loop;

  perform set_config('splitmate.sync_push', v_mark, true);
  return v_results;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------------------------

-- Las políticas y sync_push (SECURITY INVOKER) llaman a estas funciones con el rol de la sesión.
-- Los triggers, el relleno y release_access no necesitan EXECUTE para nadie.
revoke all on function
  private.is_group_owner(uuid),
  private.group_has_access_rows(uuid),
  private.add_group_owner(),
  private.release_access(uuid, uuid, uuid),
  public.leave_group(uuid),
  public.remove_access(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function
  private.is_group_owner(uuid),
  private.group_has_access_rows(uuid)
to authenticated;
grant execute on function
  public.leave_group(uuid),
  public.remove_access(uuid, uuid)
to authenticated;
