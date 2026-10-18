-- sync_pull_v2 de la Fase 4b (design/fase-4b/diseno.md, sección e): la descarga de sync_pull con
-- group_access, un tope duro de filas por llamada, páginas dentro de un grupo grande y `lost`.
-- sync_pull (v1) no cambia: la app de la 4a la sigue usando hasta que los dos teléfonos tengan la de
-- la 4b (entonces una migración la retira). 014-sync-pull-v2 verifica cada punto.
--
-- Cursores (p_cursors, un objeto { "<grupo>": cursor }):
-- - un entero: el change_seq confirmado de ese grupo (como en la 4a);
-- - un objeto { "seq": s, "hw": h, "after": { "t": t, "id": uuid } }: la descarga de un grupo grande
--   en curso. `seq` es el cursor confirmado, `hw` (high water) el change_seq más alto del grupo
--   cuando empezó la descarga, y `after` la última fila de la página anterior. t es la tabla en el
--   orden padre -> hijo: 1 groups, 2 group_access, 3 group_members, 4 categories, 5 expenses,
--   6 expense_payers, 7 expense_splits, 8 transfers.
--
-- Respuesta: { groups: [{ id, cursor, partial, next, rows }], has_more, lost }.
-- - Los grupos cuyos cambios caben en p_max_rows se juntan enteros en una página, como en la 4a.
-- - Un grupo que no cabe (o que ya está en curso) sale solo, con a lo sumo p_max_rows filas, ordenadas
--   por (t, id) desde `after` y con change_seq entre seq y hw. Si quedan más, `partial` es true,
--   `cursor` es nulo y `next` es el cursor para pedir la página siguiente; en la última, `cursor`
--   es hw. Una fila que cambia mientras se descarga queda con change_seq mayor que hw: no entra en
--   estas páginas y llega en la ronda siguiente, que pide desde hw.
-- - `lost`: los grupos del cursor que la cuenta ya no ve (expulsión, salida, borrado definitivo o
--   un id que no existe).
--
-- STABLE: todas sus consultas ven la misma foto de la base, así que nunca devuelve un hijo sin el
-- padre que se escribió antes. El contador de cada grupo queda bloqueado hasta el commit de quien
-- escribe (private.next_change_seq): un cursor nunca salta un cambio que todavía no se ve.

create function public.sync_pull_v2(p_cursors jsonb, p_max_rows integer default 1000)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  c_uuid constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  c_max constant numeric := 9007199254740991;
  v_key text;
  v_value jsonb;
  v_after jsonb;
  v_bad boolean;
  v_ids uuid[];
  v_since bigint[];
  v_has_more boolean;
  v_paged boolean;
  v_gid uuid;
  v_sin bigint;
  v_hw bigint;
  v_after_t integer;
  v_after_id uuid;
  v_rows jsonb;
  v_partial boolean;
  v_last_t integer;
  v_last_id uuid;
  v_groups jsonb := '[]'::jsonb;
  v_lost jsonb;
begin
  -- El sobre se valida entero: un error aquí es de programación (400).
  if p_max_rows is null or p_max_rows not between 100 and 2000 then
    raise exception 'p_max_rows va de 100 a 2000' using errcode = '22023';
  end if;
  if jsonb_typeof(p_cursors) is distinct from 'object' then
    raise exception 'p_cursors debe ser un objeto' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(p_cursors)) > 1000 then
    raise exception 'Hasta 1000 cursores' using errcode = '22023';
  end if;
  if (select count(distinct lower(k)) <> count(*) from jsonb_object_keys(p_cursors) k) then
    raise exception 'Cursores repetidos' using errcode = '22023';
  end if;
  for v_key, v_value in select key, value from jsonb_each(p_cursors) loop
    v_bad := false;
    if v_key !~ c_uuid then
      v_bad := true;
    elsif jsonb_typeof(v_value) = 'number' then
      v_bad := (v_value #>> '{}') !~ '^[0-9]{1,16}$';
      if not v_bad then
        v_bad := (v_value #>> '{}')::numeric > c_max;
      end if;
    elsif jsonb_typeof(v_value) = 'object' then
      v_bad := (select count(*) from jsonb_object_keys(v_value)) <> 3
        or not (v_value ?& array['seq', 'hw', 'after']);
      if not v_bad then
        v_bad := jsonb_typeof(v_value -> 'seq') is distinct from 'number'
          or jsonb_typeof(v_value -> 'hw') is distinct from 'number'
          or jsonb_typeof(v_value -> 'after') is distinct from 'object';
      end if;
      if not v_bad then
        v_bad := (v_value ->> 'seq') !~ '^[0-9]{1,16}$' or (v_value ->> 'hw') !~ '^[0-9]{1,16}$';
      end if;
      if not v_bad then
        v_bad := (v_value ->> 'hw')::numeric > c_max
          or (v_value ->> 'seq')::numeric > (v_value ->> 'hw')::numeric;
      end if;
      if not v_bad then
        v_after := v_value -> 'after';
        v_bad := (select count(*) from jsonb_object_keys(v_after)) <> 2
          or not (v_after ?& array['t', 'id'])
          or jsonb_typeof(v_after -> 't') is distinct from 'number'
          or jsonb_typeof(v_after -> 'id') is distinct from 'string';
      end if;
      if not v_bad then
        v_bad := (v_after ->> 't') !~ '^[1-8]$' or (v_after ->> 'id') !~ c_uuid;
      end if;
    else
      v_bad := true;
    end if;
    if v_bad then
      raise exception 'Cursor mal formado' using errcode = '22023';
    end if;
  end loop;

  -- Cuántas filas cambiaron en cada grupo visible por RLS y qué grupos entran en esta llamada: por
  -- id, mientras quepan en p_max_rows. El primero entra siempre. Un grupo en curso pesa p_max_rows:
  -- sale solo, igual que uno que por sí solo no cabe. Un cursor de un grupo que no se ve se ignora
  -- aquí y se informa en `lost`.
  with cursors as (
    select
      lower(c.key)::uuid as group_id,
      case
        when jsonb_typeof(c.value) = 'number' then (c.value #>> '{}')::bigint
        else (c.value ->> 'seq')::bigint
      end as since,
      case when jsonb_typeof(c.value) = 'object' then (c.value ->> 'hw')::bigint end as hw
    from jsonb_each(p_cursors) c
  ),
  visible as (
    select g.id, coalesce(c.since, 0) as since, c.hw
    from public.groups g
    left join cursors c on c.group_id = g.id
  ),
  counted as (
    select
      v.id,
      v.since,
      v.hw,
      (select count(*) from public.groups t where t.id = v.id and t.change_seq > v.since)
      + (select count(*) from public.group_access t where t.group_id = v.id and t.change_seq > v.since)
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
      n,
      hw,
      row_number() over (order by id) = 1
        or sum(case when hw is not null then p_max_rows else n end) over (order by id) <= p_max_rows
        as fits
    from counted
    where n > 0 or hw is not null
  )
  select
    array_agg(id order by id) filter (where fits),
    array_agg(since order by id) filter (where fits),
    coalesce(bool_or(not fits), false),
    coalesce(bool_or(fits and (hw is not null or n > p_max_rows)), false)
  into v_ids, v_since, v_has_more, v_paged
  from ordered;

  if v_paged then
    -- Un grupo grande, por páginas: es el único de la llamada.
    v_gid := v_ids[1];
    v_sin := v_since[1];
    select (c.value ->> 'hw')::bigint, (c.value #>> '{after,t}')::integer, (c.value #>> '{after,id}')::uuid
    into v_hw, v_after_t, v_after_id
    from jsonb_each(p_cursors) c
    where lower(c.key)::uuid = v_gid and jsonb_typeof(c.value) = 'object';

    if v_hw is null then
      -- Primera página: hw es el change_seq más alto del grupo ahora. Todo lo que cambie después
      -- queda por encima y llega en la ronda siguiente.
      v_hw := greatest(
        (select max(t.change_seq) from public.groups t where t.id = v_gid),
        (select max(t.change_seq) from public.group_access t where t.group_id = v_gid),
        (select max(t.change_seq) from public.group_members t where t.group_id = v_gid),
        (select max(t.change_seq) from public.categories t where t.group_id = v_gid),
        (select max(t.change_seq) from public.expenses t where t.group_id = v_gid),
        (select max(t.change_seq) from public.expense_payers t where t.group_id = v_gid),
        (select max(t.change_seq) from public.expense_splits t where t.group_id = v_gid),
        (select max(t.change_seq) from public.transfers t where t.group_id = v_gid)
      );
    end if;

    -- Primero solo las claves (t, id), que son baratas; el JSON se arma solo para la página.
    with keys as (
      select 1 as t, x.id from public.groups x
      where x.id = v_gid and x.change_seq > v_sin and x.change_seq <= v_hw
      union all
      select 2, x.id from public.group_access x
      where x.group_id = v_gid and x.change_seq > v_sin and x.change_seq <= v_hw
      union all
      select 3, x.id from public.group_members x
      where x.group_id = v_gid and x.change_seq > v_sin and x.change_seq <= v_hw
      union all
      select 4, x.id from public.categories x
      where x.group_id = v_gid and x.change_seq > v_sin and x.change_seq <= v_hw
      union all
      select 5, x.id from public.expenses x
      where x.group_id = v_gid and x.change_seq > v_sin and x.change_seq <= v_hw
      union all
      select 6, x.id from public.expense_payers x
      where x.group_id = v_gid and x.change_seq > v_sin and x.change_seq <= v_hw
      union all
      select 7, x.id from public.expense_splits x
      where x.group_id = v_gid and x.change_seq > v_sin and x.change_seq <= v_hw
      union all
      select 8, x.id from public.transfers x
      where x.group_id = v_gid and x.change_seq > v_sin and x.change_seq <= v_hw
    ),
    picked as (
      select k.t, k.id
      from keys k
      where v_after_t is null or (k.t, k.id) > (v_after_t, v_after_id)
      order by k.t, k.id
      limit p_max_rows + 1
    ),
    numbered as (
      select p.t, p.id, row_number() over (order by p.t, p.id) as rn from picked p
    ),
    taken as (
      select n.t, n.id, n.rn from numbered n where n.rn <= p_max_rows
    ),
    fetched as (
      select k.t, k.id, jsonb_build_object('table', 'groups', 'row', to_jsonb(r)) as j
      from taken k join public.groups r on k.t = 1 and r.id = k.id
      union all
      select k.t, k.id, jsonb_build_object('table', 'group_access', 'row', to_jsonb(r))
      from taken k join public.group_access r on k.t = 2 and r.id = k.id
      union all
      select k.t, k.id, jsonb_build_object('table', 'group_members', 'row', to_jsonb(r))
      from taken k join public.group_members r on k.t = 3 and r.id = k.id
      union all
      select k.t, k.id, jsonb_build_object('table', 'categories', 'row', to_jsonb(r))
      from taken k join public.categories r on k.t = 4 and r.id = k.id
      union all
      select k.t, k.id, jsonb_build_object('table', 'expenses', 'row', to_jsonb(r))
      from taken k join public.expenses r on k.t = 5 and r.id = k.id
      union all
      select k.t, k.id, jsonb_build_object('table', 'expense_payers', 'row', to_jsonb(r))
      from taken k join public.expense_payers r on k.t = 6 and r.id = k.id
      union all
      select k.t, k.id, jsonb_build_object('table', 'expense_splits', 'row', to_jsonb(r))
      from taken k join public.expense_splits r on k.t = 7 and r.id = k.id
      union all
      select k.t, k.id, jsonb_build_object('table', 'transfers', 'row', to_jsonb(r))
      from taken k join public.transfers r on k.t = 8 and r.id = k.id
    )
    select
      coalesce((select jsonb_agg(f.j order by f.t, f.id) from fetched f), '[]'::jsonb),
      (select count(*) from numbered) > p_max_rows,
      (select k.t from taken k order by k.rn desc limit 1),
      (select k.id from taken k order by k.rn desc limit 1)
    into v_rows, v_partial, v_last_t, v_last_id;

    v_groups := jsonb_build_array(jsonb_build_object(
      'id', v_gid,
      'cursor', case when v_partial then null else v_hw end,
      'partial', v_partial,
      'next', case
        when v_partial then jsonb_build_object(
          'seq', v_sin, 'hw', v_hw, 'after', jsonb_build_object('t', v_last_t, 'id', v_last_id)
        )
      end,
      'rows', v_rows
    ));
    v_has_more := v_has_more or v_partial;
  else
    -- Grupos que caben enteros: las filas de cada uno por tabla (los padres antes que los hijos) y
    -- por change_seq. El cursor de cada grupo es su change_seq más alto.
    with page as (
      select p.id, p.since from unnest(v_ids, v_since) as p (id, since)
    ),
    changed as (
      select p.id as group_id, 1 as o, t.change_seq as seq,
        jsonb_build_object('table', 'groups', 'row', to_jsonb(t)) as j
      from page p join public.groups t on t.id = p.id and t.change_seq > p.since
      union all
      select p.id, 2, t.change_seq, jsonb_build_object('table', 'group_access', 'row', to_jsonb(t))
      from page p join public.group_access t on t.group_id = p.id and t.change_seq > p.since
      union all
      select p.id, 3, t.change_seq, jsonb_build_object('table', 'group_members', 'row', to_jsonb(t))
      from page p join public.group_members t on t.group_id = p.id and t.change_seq > p.since
      union all
      select p.id, 4, t.change_seq, jsonb_build_object('table', 'categories', 'row', to_jsonb(t))
      from page p join public.categories t on t.group_id = p.id and t.change_seq > p.since
      union all
      select p.id, 5, t.change_seq, jsonb_build_object('table', 'expenses', 'row', to_jsonb(t))
      from page p join public.expenses t on t.group_id = p.id and t.change_seq > p.since
      union all
      select p.id, 6, t.change_seq, jsonb_build_object('table', 'expense_payers', 'row', to_jsonb(t))
      from page p join public.expense_payers t on t.group_id = p.id and t.change_seq > p.since
      union all
      select p.id, 7, t.change_seq, jsonb_build_object('table', 'expense_splits', 'row', to_jsonb(t))
      from page p join public.expense_splits t on t.group_id = p.id and t.change_seq > p.since
      union all
      select p.id, 8, t.change_seq, jsonb_build_object('table', 'transfers', 'row', to_jsonb(t))
      from page p join public.transfers t on t.group_id = p.id and t.change_seq > p.since
    ),
    grouped as (
      select group_id, max(seq) as cursor, jsonb_agg(j order by o, seq) as rows
      from changed
      group by group_id
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', group_id, 'cursor', cursor, 'partial', false, 'next', null, 'rows', rows
        )
        order by group_id
      ),
      '[]'::jsonb
    )
    into v_groups
    from grouped;
  end if;

  select coalesce(jsonb_agg(c.group_id order by c.group_id), '[]'::jsonb)
  into v_lost
  from (select lower(k)::uuid as group_id from jsonb_object_keys(p_cursors) k) c
  where not exists (select 1 from public.groups g where g.id = c.group_id);

  return jsonb_build_object('groups', v_groups, 'has_more', v_has_more, 'lost', v_lost);
end;
$$;

revoke all on function public.sync_pull_v2(jsonb, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.sync_pull_v2(jsonb, integer) to authenticated;
