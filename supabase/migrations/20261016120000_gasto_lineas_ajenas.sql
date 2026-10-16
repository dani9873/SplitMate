-- Revisión de seguridad de la Fase 4a, S1 (design/fase-4a/revision-seguridad.md).
--
-- Un gasto nuevo podía traer el id de un pagador o una parte de otro gasto del mismo usuario: la
-- comprobación de líneas existentes solo corría al editar, y la restauración (deleted_at = null)
-- filtraba solo por id. Así se reactivaba la línea de otro gasto sin subir su versión ni dejar
-- historial, y el gasto nuevo quedaba sin esa línea (sus partes ya no sumaban el monto).
--
-- Ahora la comprobación corre siempre, después de crear o editar el gasto (un error deshace el
-- envío entero con su punto de guardado), y la restauración solo toca las líneas del mismo gasto.
-- create or replace conserva los privilegios de la función (006-privilegios).

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
