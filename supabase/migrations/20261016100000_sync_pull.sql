-- sync_pull de la Fase 4a (design/fase-4a/diseno.md, secciones "sync_pull" y "Límites"): descarga
-- incremental por grupo. Por cada grupo visible por RLS (los de la cuenta, borrados incluidos)
-- devuelve las filas con change_seq mayor que su cursor, en páginas que nunca parten un grupo.
-- 010-sync-pull verifica cada punto.

-- STABLE: todas sus consultas ven la misma foto de la base, así que nunca devuelve un hijo sin el
-- padre que se escribió antes. El contador de cada grupo queda bloqueado hasta el commit de quien
-- escribe (private.next_change_seq): un cursor nunca salta un cambio que todavía no se ve.
create function public.sync_pull(p_cursors jsonb, p_max_rows integer default 2000)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  c_uuid constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_key text;
  v_value jsonb;
  v_page uuid[];
  v_since bigint[];
  v_has_more boolean;
  v_groups jsonb;
begin
  -- El sobre se valida entero: un error aquí es de programación (400).
  if p_max_rows is null or p_max_rows not between 100 and 5000 then
    raise exception 'p_max_rows va de 100 a 5000' using errcode = '22023';
  end if;
  if jsonb_typeof(p_cursors) is distinct from 'object' then
    raise exception 'p_cursors debe ser un objeto' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(p_cursors)) > 1000 then
    raise exception 'Hasta 1000 cursores' using errcode = '22023';
  end if;
  for v_key, v_value in select key, value from jsonb_each(p_cursors) loop
    if v_key !~ c_uuid
      or jsonb_typeof(v_value) is distinct from 'number'
      or (v_value #>> '{}') !~ '^[0-9]+$'
      or (v_value #>> '{}')::numeric > 9007199254740991
    then
      raise exception 'Cursor mal formado' using errcode = '22023';
    end if;
  end loop;

  -- Cuántas filas cambiaron en cada grupo visible y qué grupos entran en esta página: por id,
  -- mientras quepan en p_max_rows. El primero entra siempre, aunque solo pase del límite.
  -- Un cursor de un grupo que no se ve se ignora.
  with cursors as (
    select lower(c.key)::uuid as group_id, min((c.value #>> '{}')::bigint) as since
    from jsonb_each(p_cursors) c
    group by 1
  ),
  visible as (
    select g.id, coalesce(c.since, 0) as since
    from public.groups g
    left join cursors c on c.group_id = g.id
  ),
  counted as (
    select
      v.id,
      v.since,
      (select count(*) from public.groups t where t.id = v.id and t.change_seq > v.since)
      + (select count(*) from public.group_members t where t.group_id = v.id and t.change_seq > v.since)
      + (select count(*) from public.categories t where t.group_id = v.id and t.change_seq > v.since)
      + (select count(*) from public.expenses t where t.group_id = v.id and t.change_seq > v.since)
      + (select count(*) from public.expense_payers t where t.group_id = v.id and t.change_seq > v.since)
      + (select count(*) from public.expense_splits t where t.group_id = v.id and t.change_seq > v.since)
      + (select count(*) from public.transfers t where t.group_id = v.id and t.change_seq > v.since)
        as n
    from visible v
  ),
  ordered as (
    select
      id,
      since,
      row_number() over (order by id) = 1 or sum(n) over (order by id) <= p_max_rows as fits
    from counted
    where n > 0
  )
  select
    array_agg(id order by id) filter (where fits),
    array_agg(since order by id) filter (where fits),
    coalesce(bool_or(not fits), false)
  into v_page, v_since, v_has_more
  from ordered;

  -- Las filas de la página, por tabla (los padres antes que los hijos) y por change_seq. El cursor
  -- de cada grupo es su change_seq más alto.
  with page as (
    select p.id, p.since from unnest(v_page, v_since) as p (id, since)
  ),
  changed as (
    select p.id as group_id, 1 as o, t.change_seq as seq,
      jsonb_build_object('table', 'groups', 'row', to_jsonb(t)) as j
    from page p join public.groups t on t.id = p.id and t.change_seq > p.since
    union all
    select p.id, 2, t.change_seq, jsonb_build_object('table', 'group_members', 'row', to_jsonb(t))
    from page p join public.group_members t on t.group_id = p.id and t.change_seq > p.since
    union all
    select p.id, 3, t.change_seq, jsonb_build_object('table', 'categories', 'row', to_jsonb(t))
    from page p join public.categories t on t.group_id = p.id and t.change_seq > p.since
    union all
    select p.id, 4, t.change_seq, jsonb_build_object('table', 'expenses', 'row', to_jsonb(t))
    from page p join public.expenses t on t.group_id = p.id and t.change_seq > p.since
    union all
    select p.id, 5, t.change_seq, jsonb_build_object('table', 'expense_payers', 'row', to_jsonb(t))
    from page p join public.expense_payers t on t.group_id = p.id and t.change_seq > p.since
    union all
    select p.id, 6, t.change_seq, jsonb_build_object('table', 'expense_splits', 'row', to_jsonb(t))
    from page p join public.expense_splits t on t.group_id = p.id and t.change_seq > p.since
    union all
    select p.id, 7, t.change_seq, jsonb_build_object('table', 'transfers', 'row', to_jsonb(t))
    from page p join public.transfers t on t.group_id = p.id and t.change_seq > p.since
  ),
  grouped as (
    select group_id, max(seq) as cursor, jsonb_agg(j order by o, seq) as rows
    from changed
    group by group_id
  )
  select coalesce(
    jsonb_agg(jsonb_build_object('id', group_id, 'cursor', cursor, 'rows', rows) order by group_id),
    '[]'::jsonb
  )
  into v_groups
  from grouped;

  return jsonb_build_object('groups', v_groups, 'has_more', v_has_more);
end;
$$;

revoke all on function public.sync_pull(jsonb, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.sync_pull(jsonb, integer) to authenticated;
