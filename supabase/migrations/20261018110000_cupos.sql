-- Cupos de sync_push (Fase 4b, design/fase-4b/diseno.md, sección e, "S3"): al crear algo,
-- sync_push lo rechaza con rejected / quota si el grupo o la cuenta ya llegó al tope, y la unidad
-- queda como borrador en la app. Los cupos solo miran al crear: editar, borrar o reenviar lo ya
-- aplicado no se frena. Cuentan los borrados (borrar no libera cupo), salvo los grupos, que cuentan
-- el acceso activo de la cuenta (salir de un grupo libera cupo).
--
--   groups      200 grupos con acceso activo por cuenta
--   members     200 miembros por grupo, borrados incluidos
--   categories  100 categorías personalizadas por grupo, borradas incluidas
--   movements   20 000 gastos más transferencias por grupo, borrados incluidos
--
-- Los conteos usan los índices (group_id, change_seq) y son los de quien llama (RLS): un grupo
-- ajeno cuenta 0 y la creación falla después como forbidden, sin revelar su tamaño. La respuesta
-- lleva `quota` con el cupo alcanzado. 015-cupos verifica cada tope (el último que cabe se aplica y
-- el siguiente se rechaza). La aceptación de una invitación revisa el cupo de grupos y el de cuentas
-- por grupo en su propia función (paso de invitaciones).

create function private.sync_check_quota(p_kind text, p_group uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_count bigint;
  v_limit integer;
begin
  if p_kind = 'groups' then
    v_limit := 200;
    select count(*) into v_count
    from public.group_access a
    where a.user_id = (select auth.uid()) and a.deleted_at is null;
  elsif p_kind = 'members' then
    v_limit := 200;
    select count(*) into v_count from public.group_members m where m.group_id = p_group;
  elsif p_kind = 'categories' then
    v_limit := 100;
    select count(*) into v_count from public.categories c where c.group_id = p_group;
  elsif p_kind = 'movements' then
    v_limit := 20000;
    select
      (select count(*) from public.expenses e where e.group_id = p_group)
      + (select count(*) from public.transfers t where t.group_id = p_group)
    into v_count;
  else
    raise exception 'Cupo desconocido' using errcode = '22023';
  end if;
  if v_count >= v_limit then
    raise exception using errcode = 'SMQTA', message = p_kind;
  end if;
end;
$$;

revoke all on function private.sync_check_quota(text, uuid)
  from public, anon, authenticated, service_role;
-- SECURITY INVOKER: las funciones de sync_push la llaman con el rol de la sesión.
grant execute on function private.sync_check_quota(text, uuid) to authenticated;

-- Las funciones por unidad con la revisión del cupo al crear (lo demás es igual a la versión
-- anterior; create or replace conserva sus privilegios) y sync_push con el rechazo nuevo.

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
    perform private.sync_check_quota('groups', null);
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
    perform private.sync_check_quota('members', v_group);
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

create or replace function private.sync_apply_category(p_data jsonb, p_base integer, p_mutation uuid)
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
    perform private.sync_check_quota('categories', v_group);
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

create or replace function private.sync_apply_expense(p_data jsonb, p_base integer, p_mutation uuid)
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
    perform private.sync_check_quota('movements', v_group);
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

  -- Una parte que ya existe solo cambia deleted_at: si es de otro gasto o viene con otro contenido,
  -- es un error. Corre también con un gasto nuevo (revisión de seguridad, S1).
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
  where p.id = (l ->> 'id')::uuid and p.expense_id = v_id and p.deleted_at is not null;
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
  where s.id = (l ->> 'id')::uuid and s.expense_id = v_id and s.deleted_at is not null;
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

create or replace function private.sync_apply_transfer(p_data jsonb, p_base integer, p_mutation uuid)
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
    perform private.sync_check_quota('movements', v_group);
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

-- sync_push con el rechazo quota. Lo demás es igual a la versión anterior.
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
      when sqlstate 'SMQTA' then
        -- Se alcanzó un cupo (private.sync_check_quota): el mensaje dice cuál.
        get stacked diagnostics v_field = message_text;
        v_result := jsonb_build_object(
          'id', v_mutation, 'status', 'rejected', 'reason', 'quota', 'quota', v_field,
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
