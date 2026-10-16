-- sync_push de la Fase 4a (design/fase-4a/diseno.md, secciones "sync_push", "Límites",
-- "Idempotencia" e "Historial de cambios"):
-- - public.sync_push(jsonb): aplica hasta 50 envíos con concurrencia estricta por versión base, uno
--   por uno y cada uno en su propio punto de guardado; valida todo en el servidor antes de escribir;
-- - private.sync_mutations: los envíos aplicados, para que un reenvío no se aplique dos veces;
-- - public.change_log: historial de solo agregar, que escriben las RPC.
-- 008-sync-push y 009-historial verifican cada punto.
--
-- Errores propios: SMCFL (conflicto de versión), SMINV (campo inválido: el mensaje es el campo),
-- SMNFD (versión de algo que no existe), más SMCUR y SMGCC de la migración base. El sobre inválido
-- falla toda la llamada con 22023 (400) o 54000 (413).

-- ---------------------------------------------------------------------------------------------
-- Envíos aplicados
-- ---------------------------------------------------------------------------------------------

create table private.sync_mutations (
  user_id uuid not null references auth.users (id) on delete cascade,
  mutation_id uuid not null,
  entity text not null,
  entity_id uuid not null,
  version integer not null,
  applied_at timestamptz not null default now(),
  primary key (user_id, mutation_id)
);

revoke all on table private.sync_mutations from public, anon, authenticated, service_role;

-- Solo las funciones SECURITY DEFINER tocan la tabla, y solo las filas de auth.uid().
create function private.sync_find_mutation(p_mutation uuid)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  select m.version
  from private.sync_mutations m
  where m.user_id = (select auth.uid())
    and m.mutation_id = p_mutation;
$$;

create function private.sync_remember_mutation(
  p_mutation uuid,
  p_entity text,
  p_entity_id uuid,
  p_version integer
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into private.sync_mutations (user_id, mutation_id, entity, entity_id, version)
  values ((select auth.uid()), p_mutation, p_entity, p_entity_id, p_version)
  on conflict do nothing;
$$;

-- Bloquea el contador de cambios del grupo (si existe y es accesible) hasta el final de la
-- transacción: dos llamadas sobre el mismo grupo esperan en vez de cruzarse.
create function private.lock_group_changes(p_group_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select 1
  from private.group_changes c
  where c.group_id = p_group_id
    and private.can_access_group(p_group_id)
  for update;
$$;

-- ---------------------------------------------------------------------------------------------
-- Historial de cambios
-- ---------------------------------------------------------------------------------------------

create table public.change_log (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups (id) on delete cascade,
  entity text not null,
  entity_id uuid not null,
  action text not null,
  fields text[] not null,
  -- La unidad completa después del cambio: [{ "table": ..., "row": ... }], como `current`.
  snapshot jsonb not null,
  version integer not null,
  -- Sin FK, para no tener que editarlo si esa cuenta se borra.
  actor uuid not null,
  mutation_id uuid,
  changed_at timestamptz not null default now(),
  constraint change_log_entity check (
    entity in ('group', 'member', 'category', 'expense', 'transfer')
  ),
  constraint change_log_action check (action in ('create', 'update', 'delete', 'restore'))
);

create index change_log_group_idx on public.change_log (group_id, id);
create index change_log_entity_idx on public.change_log (entity_id);

alter table public.change_log enable row level security;

create policy change_log_select on public.change_log
  for select to authenticated
  using (private.can_access_group(group_id));

-- Solo lectura para authenticated; anon y service_role no tienen nada. Las RPC escriben con
-- record_change (SECURITY DEFINER).
revoke all on table public.change_log from public, anon, authenticated, service_role;
grant select on table public.change_log to authenticated;

-- Nadie edita ni borra el historial, tampoco postgres. El único DELETE que pasa es el que llega en
-- cascada al borrar un grupo: corre anidado dentro del trigger de la clave foránea.
create function private.reject_change_log_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'El historial de cambios es de solo agregar'
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger change_log_append_only
  before update or delete on public.change_log
  for each row execute function private.reject_change_log_edit();
create trigger change_log_no_truncate
  before truncate on public.change_log
  for each statement execute function private.reject_change_log_edit();

create function private.record_change(
  p_group_id uuid,
  p_entity text,
  p_entity_id uuid,
  p_action text,
  p_version integer,
  p_fields text[],
  p_snapshot jsonb,
  p_mutation uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.can_access_group(p_group_id) then
    raise exception 'Sin acceso al grupo' using errcode = 'insufficient_privilege';
  end if;
  insert into public.change_log
    (group_id, entity, entity_id, action, fields, snapshot, version, actor, mutation_id)
  values
    (p_group_id, p_entity, p_entity_id, p_action, p_fields, p_snapshot, p_version,
      (select auth.uid()), p_mutation);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Validadores: lanzan SMINV con el campo como mensaje
-- ---------------------------------------------------------------------------------------------

-- Los pagadores y las partes ponen el prefijo "payers." o "splits." con splitmate.sync_path.
create function private.sync_fail(p_key text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'SMINV',
    message = coalesce(current_setting('splitmate.sync_path', true), '') || p_key;
end;
$$;

-- `data` es un objeto con exactamente las claves de su unidad.
create function private.sync_keys(p_data jsonb, p_allowed text[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_key text;
begin
  if jsonb_typeof(p_data) is distinct from 'object' then
    perform private.sync_fail('data');
  end if;
  for v_key in select jsonb_object_keys(p_data) loop
    if not (v_key = any (p_allowed)) then
      perform private.sync_fail(v_key);
    end if;
  end loop;
  foreach v_key in array p_allowed loop
    if not (p_data ? v_key) then
      perform private.sync_fail(v_key);
    end if;
  end loop;
end;
$$;

-- Texto de p_min a p_max caracteres, sin ser solo espacios, y con el patrón si se pide.
create function private.sync_text(
  p_data jsonb,
  p_key text,
  p_min integer,
  p_max integer,
  p_nullable boolean default false,
  p_pattern text default null
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_value jsonb := p_data -> p_key;
  v_text text;
begin
  if jsonb_typeof(v_value) = 'null' and p_nullable then
    return null;
  end if;
  if jsonb_typeof(v_value) is distinct from 'string' then
    perform private.sync_fail(p_key);
  end if;
  v_text := v_value #>> '{}';
  if char_length(v_text) not between p_min and p_max
    or v_text ~ '^\s*$'
    or (p_pattern is not null and v_text !~ p_pattern)
  then
    perform private.sync_fail(p_key);
  end if;
  return v_text;
end;
$$;

-- Entero JSON (ni texto ni decimal) entre p_min y p_max.
create function private.sync_int(
  p_data jsonb,
  p_key text,
  p_min bigint,
  p_max bigint,
  p_nullable boolean default false
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_value jsonb := p_data -> p_key;
  v_number numeric;
begin
  if jsonb_typeof(v_value) = 'null' and p_nullable then
    return null;
  end if;
  if jsonb_typeof(v_value) is distinct from 'number' or (v_value #>> '{}') !~ '^-?[0-9]+$' then
    perform private.sync_fail(p_key);
  end if;
  v_number := (v_value #>> '{}')::numeric;
  if v_number < p_min or v_number > p_max then
    perform private.sync_fail(p_key);
  end if;
  return v_number::bigint;
end;
$$;

create function private.sync_uuid(p_data jsonb, p_key text, p_nullable boolean default false)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_value jsonb := p_data -> p_key;
begin
  if jsonb_typeof(v_value) = 'null' and p_nullable then
    return null;
  end if;
  if jsonb_typeof(v_value) is distinct from 'string'
    or (v_value #>> '{}') !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  then
    perform private.sync_fail(p_key);
  end if;
  return lower(v_value #>> '{}')::uuid;
end;
$$;

create function private.sync_bool(p_data jsonb, p_key text)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(p_data -> p_key) is distinct from 'boolean' then
    perform private.sync_fail(p_key);
  end if;
  return (p_data ->> p_key)::boolean;
end;
$$;

-- YYYY-MM-DD de un día que existe. Sin bloque EXCEPTION: no gasta subtransacciones.
create function private.sync_date(p_data jsonb, p_key text, p_nullable boolean default false)
returns date
language plpgsql
set search_path = ''
as $$
declare
  v_value jsonb := p_data -> p_key;
  v_text text;
  v_year integer;
  v_month integer;
  v_day integer;
begin
  if jsonb_typeof(v_value) = 'null' and p_nullable then
    return null;
  end if;
  if jsonb_typeof(v_value) is distinct from 'string' then
    perform private.sync_fail(p_key);
  end if;
  v_text := v_value #>> '{}';
  if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    perform private.sync_fail(p_key);
  end if;
  v_year := substr(v_text, 1, 4)::integer;
  v_month := substr(v_text, 6, 2)::integer;
  v_day := substr(v_text, 9, 2)::integer;
  if v_year < 1 or v_month not between 1 and 12 then
    perform private.sync_fail(p_key);
  end if;
  if v_day not between 1 and
    extract(day from (make_date(v_year, v_month, 1) + interval '1 month - 1 day'))::integer
  then
    perform private.sync_fail(p_key);
  end if;
  return make_date(v_year, v_month, v_day);
end;
$$;

create function private.sync_enum(p_data jsonb, p_key text, p_allowed text[])
returns text
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(p_data -> p_key) is distinct from 'string'
    or not ((p_data ->> p_key) = any (p_allowed))
  then
    perform private.sync_fail(p_key);
  end if;
  return p_data ->> p_key;
end;
$$;

-- Moneda de 3 letras mayúsculas.
create function private.sync_currency(p_data jsonb, p_key text)
returns text
language sql
set search_path = ''
as $$
  select private.sync_text(p_data, p_key, 3, 3, false, '^[A-Z]{3}$');
$$;

-- Tasa decimal positiva de hasta 32 caracteres.
create function private.sync_rate(p_data jsonb, p_key text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_text text := private.sync_text(p_data, p_key, 1, 32, false, '^[0-9]+(\.[0-9]+)?$');
begin
  if v_text::numeric <= 0 then
    perform private.sync_fail(p_key);
  end if;
  return v_text;
end;
$$;

-- Pagadores o partes de un gasto, validados y ordenados por id. Un gasto borrado viene sin ellos;
-- uno activo trae de 1 a 50, sin ids ni miembros repetidos.
create function private.sync_lines(p_data jsonb, p_key text, p_input boolean, p_empty boolean)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  c_max constant bigint := 99999999999999;
  v_array jsonb := p_data -> p_key;
  v_keys text[] := array['id', 'member_id', 'amount', 'group_amount'];
  v_element jsonb;
  v_line jsonb;
  v_lines jsonb[] := '{}';
begin
  if jsonb_typeof(v_array) is distinct from 'array' then
    perform private.sync_fail(p_key);
  end if;
  if jsonb_array_length(v_array) > 50
    or (p_empty and jsonb_array_length(v_array) > 0)
    or (not p_empty and jsonb_array_length(v_array) = 0)
  then
    perform private.sync_fail(p_key);
  end if;

  if p_input then
    v_keys := v_keys || 'input_value'::text;
  end if;
  perform set_config('splitmate.sync_path', p_key || '.', true);
  for v_element in select value from jsonb_array_elements(v_array) loop
    perform private.sync_keys(v_element, v_keys);
    v_line := jsonb_build_object(
      'id', private.sync_uuid(v_element, 'id'),
      'member_id', private.sync_uuid(v_element, 'member_id'),
      'amount', private.sync_int(v_element, 'amount', case when p_input then 0 else 1 end, c_max),
      'group_amount', private.sync_int(v_element, 'group_amount', 0, c_max)
    );
    if p_input then
      v_line := v_line
        || jsonb_build_object('input_value', private.sync_int(v_element, 'input_value', 0, c_max, true));
    end if;
    v_lines := v_lines || v_line;
  end loop;
  perform set_config('splitmate.sync_path', '', true);

  if (select count(distinct l ->> 'member_id') <> count(*) or count(distinct l ->> 'id') <> count(*)
      from unnest(v_lines) l)
  then
    perform private.sync_fail(p_key);
  end if;
  return coalesce((select jsonb_agg(l order by l ->> 'id') from unnest(v_lines) l), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Estado de una unidad e historial
-- ---------------------------------------------------------------------------------------------

-- La unidad como la ve quien llama (RLS): [{ "table": ..., "row": ... }]. Un gasto trae todos sus
-- pagadores y partes, también los borrados. Vacío si no existe o no se ve.
create function private.sync_entity_rows(p_entity text, p_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(r.j order by r.o, r.k), '[]'::jsonb)
  from (
    select 1 as o, g.id::text as k, jsonb_build_object('table', 'groups', 'row', to_jsonb(g)) as j
    from public.groups g where p_entity = 'group' and g.id = p_id
    union all
    select 1, m.id::text, jsonb_build_object('table', 'group_members', 'row', to_jsonb(m))
    from public.group_members m where p_entity = 'member' and m.id = p_id
    union all
    select 1, c.id::text, jsonb_build_object('table', 'categories', 'row', to_jsonb(c))
    from public.categories c where p_entity = 'category' and c.id = p_id
    union all
    select 1, e.id::text, jsonb_build_object('table', 'expenses', 'row', to_jsonb(e))
    from public.expenses e where p_entity = 'expense' and e.id = p_id
    union all
    select 2, p.id::text, jsonb_build_object('table', 'expense_payers', 'row', to_jsonb(p))
    from public.expense_payers p where p_entity = 'expense' and p.expense_id = p_id
    union all
    select 3, s.id::text, jsonb_build_object('table', 'expense_splits', 'row', to_jsonb(s))
    from public.expense_splits s where p_entity = 'expense' and s.expense_id = p_id
    union all
    select 1, t.id::text, jsonb_build_object('table', 'transfers', 'row', to_jsonb(t))
    from public.transfers t where p_entity = 'transfer' and t.id = p_id
  ) r;
$$;

-- Cierra un envío que escribió algo: una entrada en el historial (con la acción y los campos que
-- cambiaron) y el envío recordado. p_old es nulo si la unidad es nueva.
create function private.sync_finish(
  p_group_id uuid,
  p_entity text,
  p_id uuid,
  p_old jsonb,
  p_new jsonb,
  p_version integer,
  p_mutation uuid
)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_action text;
  v_fields text[];
begin
  if p_old is null then
    v_action := 'create';
    v_fields := array(select k from jsonb_object_keys(p_new) k order by k);
  else
    v_fields := array(
      select k from jsonb_object_keys(p_new) k where p_old -> k is distinct from p_new -> k order by k
    );
    v_action := case
      when (p_new ->> 'deleted')::boolean and not (p_old ->> 'deleted')::boolean then 'delete'
      when not (p_new ->> 'deleted')::boolean and (p_old ->> 'deleted')::boolean then 'restore'
      else 'update'
    end;
  end if;
  perform private.record_change(
    p_group_id, p_entity, p_id, v_action, p_version, v_fields,
    private.sync_entity_rows(p_entity, p_id), p_mutation
  );
  perform private.sync_remember_mutation(p_mutation, p_entity, p_id, p_version);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Una función por unidad: (data, base, envío) -> versión
-- ---------------------------------------------------------------------------------------------

-- Devuelve la versión que dejó el envío, o la actual si no hubo que escribir. Si la unidad ya está
-- como pide el cliente, se acepta sin escribir aunque la base sea vieja; si no, con una base que no
-- es la versión actual se lanza SMCFL y nada se escribe. SECURITY INVOKER: RLS y los privilegios
-- de columna de quien llama valen igual que por REST.

create function private.sync_apply_group(p_data jsonb, p_base integer, p_mutation uuid)
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

create function private.sync_apply_member(p_data jsonb, p_base integer, p_mutation uuid)
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

create function private.sync_apply_category(p_data jsonb, p_base integer, p_mutation uuid)
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
  v_row public.categories;
  v_deleted boolean;
  v_version integer;
begin
  perform private.sync_keys(p_data, array['id', 'group_id', 'name', 'icon', 'deleted']);
  v_id := private.sync_uuid(p_data, 'id');
  v_group := private.sync_uuid(p_data, 'group_id');
  v_new := jsonb_build_object(
    'group_id', v_group,
    'name', private.sync_text(p_data, 'name', 1, 40),
    'icon', private.sync_text(p_data, 'icon', 1, 40),
    'deleted', private.sync_bool(p_data, 'deleted')
  );
  v_deleted := (v_new ->> 'deleted')::boolean;

  select * into v_row from public.categories where id = v_id for update;
  if not found then
    if p_base is not null then
      raise exception using errcode = 'SMNFD', message = 'base';
    end if;
    insert into public.categories (id, group_id, name, icon, deleted_at)
    values (v_id, v_group, v_new ->> 'name', v_new ->> 'icon', case when v_deleted then now() end)
    returning version into v_version;
    perform private.sync_finish(v_group, 'category', v_id, null, v_new, v_version, p_mutation);
    return v_version;
  end if;

  if v_group is distinct from v_row.group_id then
    perform private.sync_fail('group_id');
  end if;
  v_old := jsonb_build_object(
    'group_id', v_row.group_id, 'name', v_row.name, 'icon', v_row.icon,
    'deleted', v_row.deleted_at is not null
  );
  if v_old = v_new then
    return v_row.version;
  end if;
  if p_base is distinct from v_row.version then
    raise exception using errcode = 'SMCFL', message = 'conflict';
  end if;

  update public.categories
  set name = v_new ->> 'name',
      icon = v_new ->> 'icon',
      deleted_at = case when v_deleted then now() end
  where id = v_id
  returning version into v_version;
  perform private.sync_finish(v_group, 'category', v_id, v_old, v_new, v_version, p_mutation);
  return v_version;
end;
$$;

create function private.sync_apply_expense(p_data jsonb, p_base integer, p_mutation uuid)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  c_max constant bigint := 99999999999999;
  v_id uuid;
  v_group uuid;
  v_amount bigint;
  v_group_amount bigint;
  v_currency text;
  v_group_currency text;
  v_deleted boolean;
  v_payers jsonb;
  v_splits jsonb;
  v_new jsonb;
  v_old jsonb;
  v_row public.expenses;
  v_version integer;
begin
  perform private.sync_keys(p_data, array[
    'id', 'group_id', 'kind', 'title', 'amount', 'currency', 'group_currency', 'group_amount',
    'exchange_rate', 'rate_date', 'split_method', 'category_id', 'occurred_on', 'notes', 'deleted',
    'payers', 'splits'
  ]);
  v_id := private.sync_uuid(p_data, 'id');
  v_group := private.sync_uuid(p_data, 'group_id');
  v_amount := private.sync_int(p_data, 'amount', 1, c_max);
  v_currency := private.sync_currency(p_data, 'currency');
  v_group_currency := private.sync_currency(p_data, 'group_currency');
  v_group_amount := private.sync_int(p_data, 'group_amount', 0, c_max);
  v_deleted := private.sync_bool(p_data, 'deleted');
  v_new := jsonb_build_object(
    'group_id', v_group,
    'kind', private.sync_enum(p_data, 'kind', array['expense', 'income']),
    'title', private.sync_text(p_data, 'title', 1, 120),
    'amount', v_amount,
    'currency', v_currency,
    'group_currency', v_group_currency,
    'group_amount', v_group_amount,
    'exchange_rate', private.sync_rate(p_data, 'exchange_rate'),
    'rate_date', private.sync_date(p_data, 'rate_date', true),
    'split_method', private.sync_enum(
      p_data, 'split_method', array['equal', 'exact', 'percentage', 'shares']
    ),
    'category_id', private.sync_uuid(p_data, 'category_id', true),
    'occurred_on', private.sync_date(p_data, 'occurred_on'),
    'notes', private.sync_text(p_data, 'notes', 1, 1000, true),
    'deleted', v_deleted
  );
  v_payers := private.sync_lines(p_data, 'payers', false, v_deleted);
  v_splits := private.sync_lines(p_data, 'splits', true, v_deleted);

  -- En la moneda del grupo no hay conversión.
  if v_currency = v_group_currency then
    if (v_new ->> 'exchange_rate')::numeric <> 1 then
      perform private.sync_fail('exchange_rate');
    end if;
    if v_group_amount <> v_amount then
      perform private.sync_fail('group_amount');
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_payers) l
      where (l ->> 'group_amount')::bigint <> (l ->> 'amount')::bigint
    ) then
      perform private.sync_fail('payers');
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_splits) l
      where (l ->> 'group_amount')::bigint <> (l ->> 'amount')::bigint
    ) then
      perform private.sync_fail('splits');
    end if;
  end if;
  -- Los pagadores y las partes suman el gasto, en la moneda original y en la del grupo.
  if not v_deleted then
    if (select sum((l ->> 'amount')::bigint) from jsonb_array_elements(v_payers) l) <> v_amount
      or (select sum((l ->> 'group_amount')::bigint) from jsonb_array_elements(v_payers) l)
        <> v_group_amount
    then
      perform private.sync_fail('payers');
    end if;
    if (select sum((l ->> 'amount')::bigint) from jsonb_array_elements(v_splits) l) <> v_amount
      or (select sum((l ->> 'group_amount')::bigint) from jsonb_array_elements(v_splits) l)
        <> v_group_amount
    then
      perform private.sync_fail('splits');
    end if;
  end if;
  v_new := v_new || jsonb_build_object('payers', v_payers, 'splits', v_splits);

  select * into v_row from public.expenses where id = v_id for update;
  if not found then
    if p_base is not null then
      raise exception using errcode = 'SMNFD', message = 'base';
    end if;
    insert into public.expenses
      (id, group_id, kind, title, amount, currency, group_currency, group_amount, exchange_rate,
        rate_date, split_method, category_id, occurred_on, notes, deleted_at)
    values (
      v_id, v_group, v_new ->> 'kind', v_new ->> 'title', v_amount, v_currency, v_group_currency,
      v_group_amount, v_new ->> 'exchange_rate', (v_new ->> 'rate_date')::date,
      v_new ->> 'split_method', (v_new ->> 'category_id')::uuid, (v_new ->> 'occurred_on')::date,
      v_new ->> 'notes', case when v_deleted then now() end
    )
    returning version into v_version;
  else
    if v_group is distinct from v_row.group_id then
      perform private.sync_fail('group_id');
    end if;
    v_old := jsonb_build_object(
      'group_id', v_row.group_id, 'kind', v_row.kind, 'title', v_row.title,
      'amount', v_row.amount, 'currency', v_row.currency, 'group_currency', v_row.group_currency,
      'group_amount', v_row.group_amount, 'exchange_rate', v_row.exchange_rate,
      'rate_date', v_row.rate_date, 'split_method', v_row.split_method,
      'category_id', v_row.category_id, 'occurred_on', v_row.occurred_on, 'notes', v_row.notes,
      'deleted', v_row.deleted_at is not null,
      'payers', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', p.id, 'member_id', p.member_id, 'amount', p.amount, 'group_amount', p.group_amount
          ) order by p.id::text
        )
        from public.expense_payers p where p.expense_id = v_id and p.deleted_at is null
      ), '[]'::jsonb),
      'splits', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', s.id, 'member_id', s.member_id, 'amount', s.amount,
            'group_amount', s.group_amount, 'input_value', s.input_value
          ) order by s.id::text
        )
        from public.expense_splits s where s.expense_id = v_id and s.deleted_at is null
      ), '[]'::jsonb)
    );
    if v_old = v_new then
      return v_row.version;
    end if;
    if p_base is distinct from v_row.version then
      raise exception using errcode = 'SMCFL', message = 'conflict';
    end if;

    -- Una parte que ya existe solo cambia deleted_at: si viene con otro contenido, es un error.
    if exists (
      select 1
      from jsonb_array_elements(v_payers) l
      join public.expense_payers p on p.id = (l ->> 'id')::uuid
      where p.expense_id <> v_id
        or p.member_id <> (l ->> 'member_id')::uuid
        or p.amount <> (l ->> 'amount')::bigint
        or p.group_amount <> (l ->> 'group_amount')::bigint
    ) then
      perform private.sync_fail('payers');
    end if;
    if exists (
      select 1
      from jsonb_array_elements(v_splits) l
      join public.expense_splits s on s.id = (l ->> 'id')::uuid
      where s.expense_id <> v_id
        or s.member_id <> (l ->> 'member_id')::uuid
        or s.amount <> (l ->> 'amount')::bigint
        or s.group_amount <> (l ->> 'group_amount')::bigint
        or s.input_value is distinct from (l ->> 'input_value')::bigint
    ) then
      perform private.sync_fail('splits');
    end if;

    -- Se toca el gasto aunque solo cambien sus partes: su versión cubre todo.
    update public.expenses
    set kind = v_new ->> 'kind',
        title = v_new ->> 'title',
        amount = v_amount,
        currency = v_currency,
        group_currency = v_group_currency,
        group_amount = v_group_amount,
        exchange_rate = v_new ->> 'exchange_rate',
        rate_date = (v_new ->> 'rate_date')::date,
        split_method = v_new ->> 'split_method',
        category_id = (v_new ->> 'category_id')::uuid,
        occurred_on = (v_new ->> 'occurred_on')::date,
        notes = v_new ->> 'notes',
        deleted_at = case when v_deleted then now() end
    where id = v_id
    returning version into v_version;
  end if;

  -- Primero se liberan los miembros de las partes que ya no vienen, después se reactivan y se
  -- crean las que vienen: el índice único (gasto, miembro) solo cuenta las activas.
  update public.expense_payers p
  set deleted_at = now()
  where p.expense_id = v_id
    and p.deleted_at is null
    and not exists (
      select 1 from jsonb_array_elements(v_payers) l where (l ->> 'id')::uuid = p.id
    );
  update public.expense_payers p
  set deleted_at = null
  from jsonb_array_elements(v_payers) l
  where p.id = (l ->> 'id')::uuid and p.deleted_at is not null;
  insert into public.expense_payers (id, group_id, expense_id, member_id, amount, group_amount)
  select (l ->> 'id')::uuid, v_group, v_id, (l ->> 'member_id')::uuid, (l ->> 'amount')::bigint,
    (l ->> 'group_amount')::bigint
  from jsonb_array_elements(v_payers) l
  where not exists (select 1 from public.expense_payers p where p.id = (l ->> 'id')::uuid);

  update public.expense_splits s
  set deleted_at = now()
  where s.expense_id = v_id
    and s.deleted_at is null
    and not exists (
      select 1 from jsonb_array_elements(v_splits) l where (l ->> 'id')::uuid = s.id
    );
  update public.expense_splits s
  set deleted_at = null
  from jsonb_array_elements(v_splits) l
  where s.id = (l ->> 'id')::uuid and s.deleted_at is not null;
  insert into public.expense_splits
    (id, group_id, expense_id, member_id, amount, group_amount, input_value)
  select (l ->> 'id')::uuid, v_group, v_id, (l ->> 'member_id')::uuid, (l ->> 'amount')::bigint,
    (l ->> 'group_amount')::bigint, (l ->> 'input_value')::bigint
  from jsonb_array_elements(v_splits) l
  where not exists (select 1 from public.expense_splits s where s.id = (l ->> 'id')::uuid);

  perform private.sync_finish(v_group, 'expense', v_id, v_old, v_new, v_version, p_mutation);
  return v_version;
end;
$$;

create function private.sync_apply_transfer(p_data jsonb, p_base integer, p_mutation uuid)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  c_max constant bigint := 99999999999999;
  v_id uuid;
  v_group uuid;
  v_from uuid;
  v_to uuid;
  v_amount bigint;
  v_currency text;
  v_group_currency text;
  v_group_amount bigint;
  v_deleted boolean;
  v_new jsonb;
  v_old jsonb;
  v_row public.transfers;
  v_version integer;
begin
  perform private.sync_keys(p_data, array[
    'id', 'group_id', 'from_member_id', 'to_member_id', 'amount', 'currency', 'group_currency',
    'group_amount', 'exchange_rate', 'rate_date', 'occurred_on', 'deleted'
  ]);
  v_id := private.sync_uuid(p_data, 'id');
  v_group := private.sync_uuid(p_data, 'group_id');
  v_from := private.sync_uuid(p_data, 'from_member_id');
  v_to := private.sync_uuid(p_data, 'to_member_id');
  v_amount := private.sync_int(p_data, 'amount', 1, c_max);
  v_currency := private.sync_currency(p_data, 'currency');
  v_group_currency := private.sync_currency(p_data, 'group_currency');
  v_group_amount := private.sync_int(p_data, 'group_amount', 0, c_max);
  v_deleted := private.sync_bool(p_data, 'deleted');
  v_new := jsonb_build_object(
    'group_id', v_group,
    'from_member_id', v_from,
    'to_member_id', v_to,
    'amount', v_amount,
    'currency', v_currency,
    'group_currency', v_group_currency,
    'group_amount', v_group_amount,
    'exchange_rate', private.sync_rate(p_data, 'exchange_rate'),
    'rate_date', private.sync_date(p_data, 'rate_date', true),
    'occurred_on', private.sync_date(p_data, 'occurred_on'),
    'deleted', v_deleted
  );
  if v_from = v_to then
    perform private.sync_fail('to_member_id');
  end if;
  if v_currency = v_group_currency then
    if (v_new ->> 'exchange_rate')::numeric <> 1 then
      perform private.sync_fail('exchange_rate');
    end if;
    if v_group_amount <> v_amount then
      perform private.sync_fail('group_amount');
    end if;
  end if;

  select * into v_row from public.transfers where id = v_id for update;
  if not found then
    if p_base is not null then
      raise exception using errcode = 'SMNFD', message = 'base';
    end if;
    insert into public.transfers
      (id, group_id, from_member_id, to_member_id, amount, currency, group_currency, group_amount,
        exchange_rate, rate_date, occurred_on, deleted_at)
    values (
      v_id, v_group, v_from, v_to, v_amount, v_currency, v_group_currency, v_group_amount,
      v_new ->> 'exchange_rate', (v_new ->> 'rate_date')::date, (v_new ->> 'occurred_on')::date,
      case when v_deleted then now() end
    )
    returning version into v_version;
    perform private.sync_finish(v_group, 'transfer', v_id, null, v_new, v_version, p_mutation);
    return v_version;
  end if;

  if v_group is distinct from v_row.group_id then
    perform private.sync_fail('group_id');
  end if;
  v_old := jsonb_build_object(
    'group_id', v_row.group_id, 'from_member_id', v_row.from_member_id,
    'to_member_id', v_row.to_member_id, 'amount', v_row.amount, 'currency', v_row.currency,
    'group_currency', v_row.group_currency, 'group_amount', v_row.group_amount,
    'exchange_rate', v_row.exchange_rate, 'rate_date', v_row.rate_date,
    'occurred_on', v_row.occurred_on, 'deleted', v_row.deleted_at is not null
  );
  if v_old = v_new then
    return v_row.version;
  end if;
  if p_base is distinct from v_row.version then
    raise exception using errcode = 'SMCFL', message = 'conflict';
  end if;

  update public.transfers
  set from_member_id = v_from,
      to_member_id = v_to,
      amount = v_amount,
      currency = v_currency,
      group_currency = v_group_currency,
      group_amount = v_group_amount,
      exchange_rate = v_new ->> 'exchange_rate',
      rate_date = (v_new ->> 'rate_date')::date,
      occurred_on = (v_new ->> 'occurred_on')::date,
      deleted_at = case when v_deleted then now() end
  where id = v_id
  returning version into v_version;
  perform private.sync_finish(v_group, 'transfer', v_id, v_old, v_new, v_version, p_mutation);
  return v_version;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- sync_push
-- ---------------------------------------------------------------------------------------------

create function public.sync_push(p_mutations jsonb)
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

  -- La guardia de escritura (stamp_sync_row) deja pasar solo lo que escribe esta función.
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

  return v_results;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------------------------

-- Nada para PUBLIC, anon ni service_role. authenticated ejecuta sync_push y, como es SECURITY
-- INVOKER, también las funciones que esta llama. Las del trigger del historial no lo necesitan.
revoke all on function
  public.sync_push(jsonb),
  private.sync_find_mutation(uuid),
  private.sync_remember_mutation(uuid, text, uuid, integer),
  private.lock_group_changes(uuid),
  private.reject_change_log_edit(),
  private.record_change(uuid, text, uuid, text, integer, text[], jsonb, uuid),
  private.sync_fail(text),
  private.sync_keys(jsonb, text[]),
  private.sync_text(jsonb, text, integer, integer, boolean, text),
  private.sync_int(jsonb, text, bigint, bigint, boolean),
  private.sync_uuid(jsonb, text, boolean),
  private.sync_bool(jsonb, text),
  private.sync_date(jsonb, text, boolean),
  private.sync_enum(jsonb, text, text[]),
  private.sync_currency(jsonb, text),
  private.sync_rate(jsonb, text),
  private.sync_lines(jsonb, text, boolean, boolean),
  private.sync_entity_rows(text, uuid),
  private.sync_finish(uuid, text, uuid, jsonb, jsonb, integer, uuid),
  private.sync_apply_group(jsonb, integer, uuid),
  private.sync_apply_member(jsonb, integer, uuid),
  private.sync_apply_category(jsonb, integer, uuid),
  private.sync_apply_expense(jsonb, integer, uuid),
  private.sync_apply_transfer(jsonb, integer, uuid)
from public, anon, authenticated, service_role;

grant execute on function
  public.sync_push(jsonb),
  private.sync_find_mutation(uuid),
  private.sync_remember_mutation(uuid, text, uuid, integer),
  private.lock_group_changes(uuid),
  private.record_change(uuid, text, uuid, text, integer, text[], jsonb, uuid),
  private.sync_fail(text),
  private.sync_keys(jsonb, text[]),
  private.sync_text(jsonb, text, integer, integer, boolean, text),
  private.sync_int(jsonb, text, bigint, bigint, boolean),
  private.sync_uuid(jsonb, text, boolean),
  private.sync_bool(jsonb, text),
  private.sync_date(jsonb, text, boolean),
  private.sync_enum(jsonb, text, text[]),
  private.sync_currency(jsonb, text),
  private.sync_rate(jsonb, text),
  private.sync_lines(jsonb, text, boolean, boolean),
  private.sync_entity_rows(text, uuid),
  private.sync_finish(uuid, text, uuid, jsonb, jsonb, integer, uuid),
  private.sync_apply_group(jsonb, integer, uuid),
  private.sync_apply_member(jsonb, integer, uuid),
  private.sync_apply_category(jsonb, integer, uuid),
  private.sync_apply_expense(jsonb, integer, uuid),
  private.sync_apply_transfer(jsonb, integer, uuid)
to authenticated;
