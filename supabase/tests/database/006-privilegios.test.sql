-- Contrato de privilegios de la Data API: la matriz exacta de lo que authenticated puede hacer en
-- public y private, y nada para anon ni para service_role en las tablas. Falla si una migración
-- quita un privilegio esperado o da uno de más; una tabla, columna o función nueva obliga a
-- actualizar esta lista. Complementa
-- 001-estructura. Corre sobre la base que arman las migraciones: un cambio hecho desde el panel en
-- el proyecto remoto solo lo detecta `npm run check:data-api` (design/fase-3/data-api-privilegios.md).
begin;
select plan(6);

-- authenticated ------------------------------------------------------------------------------

select set_eq(
  $$
    select c.relname::text, p.privilegio
    from pg_class c
    cross join unnest(array[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
    ]) as p (privilegio)
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and has_table_privilege('authenticated', c.oid, p.privilegio)
  $$,
  $$
    select t.tabla, p.privilegio
    from unnest(array[
      'profiles', 'groups', 'group_members', 'categories',
      'expenses', 'expense_payers', 'expense_splits', 'transfers'
    ]) as t (tabla)
    cross join unnest(array['SELECT', 'INSERT']) as p (privilegio)
    union all
    select 'change_log', 'SELECT'
  $$,
  'authenticated: SELECT e INSERT en cada tabla de public (change_log solo SELECT), y ningún otro privilegio de tabla'
);

select set_eq(
  $$
    select c.relname::text, a.attname::text, p.privilegio
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    cross join unnest(array['UPDATE', 'REFERENCES']) as p (privilegio)
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and a.attnum > 0
      and not a.attisdropped
      and has_column_privilege('authenticated', a.attrelid, a.attnum, p.privilegio)
  $$,
  $$
    select e.tabla, unnest(e.columnas), 'UPDATE'
    from (
      values
        ('profiles', array['display_name', 'updated_at', 'deleted_at', 'version']),
        ('groups', array['name', 'currency', 'emoji', 'color', 'archived_at', 'deleted_at']),
        ('group_members', array['display_name', 'user_id', 'deleted_at']),
        ('categories', array['name', 'icon', 'deleted_at']),
        ('expenses', array[
          'kind', 'title', 'amount', 'currency', 'group_currency', 'group_amount', 'exchange_rate',
          'rate_date', 'split_method', 'category_id', 'occurred_on', 'notes', 'deleted_at'
        ]),
        ('expense_payers', array['deleted_at']),
        ('expense_splits', array['deleted_at']),
        ('transfers', array[
          'from_member_id', 'to_member_id', 'amount', 'currency', 'group_currency', 'group_amount',
          'exchange_rate', 'rate_date', 'occurred_on', 'deleted_at'
        ])
    ) as e (tabla, columnas)
  $$,
  'authenticated: UPDATE exactamente en las columnas editables, y ningún REFERENCES de columna'
);

select set_eq(
  $$
    select p.oid::regprocedure::text
    from pg_proc p
    where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  $$,
  array[
    'private.can_access_group(uuid)',
    'private.is_group_creator(uuid)',
    'private.is_group_member(uuid)',
    'private.next_change_seq(uuid)',
    'private.shares_group_with(uuid)',
    -- sync_push es SECURITY INVOKER: authenticated ejecuta también todo lo que ella llama.
    'sync_push(jsonb)',
    'sync_pull(jsonb,integer)',
    'private.sync_find_mutation(uuid)',
    'private.sync_remember_mutation(uuid,text,uuid,integer)',
    'private.lock_group_changes(uuid)',
    'private.record_change(uuid,text,uuid,text,integer,text[],jsonb,uuid)',
    'private.sync_fail(text)',
    'private.sync_keys(jsonb,text[])',
    'private.sync_text(jsonb,text,integer,integer,boolean,text)',
    'private.sync_int(jsonb,text,bigint,bigint,boolean)',
    'private.sync_uuid(jsonb,text,boolean)',
    'private.sync_bool(jsonb,text)',
    'private.sync_date(jsonb,text,boolean)',
    'private.sync_enum(jsonb,text,text[])',
    'private.sync_currency(jsonb,text)',
    'private.sync_rate(jsonb,text)',
    'private.sync_lines(jsonb,text,boolean,boolean)',
    'private.sync_entity_rows(text,uuid)',
    'private.sync_finish(uuid,text,uuid,jsonb,jsonb,integer,uuid)',
    'private.sync_apply_group(jsonb,integer,uuid)',
    'private.sync_apply_member(jsonb,integer,uuid)',
    'private.sync_apply_category(jsonb,integer,uuid)',
    'private.sync_apply_expense(jsonb,integer,uuid)',
    'private.sync_apply_transfer(jsonb,integer,uuid)'
  ],
  'authenticated: EXECUTE solo en las funciones de las políticas, del trigger de columnas, de sync_push y de sync_pull'
);

select is_empty(
  $$
    select 'secuencia ' || c.relname
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      -- Con CASE: el orden del WHERE no está fijo y esta función falla si no es una secuencia.
      and case when c.relkind = 'S'
        then has_sequence_privilege('authenticated', c.oid, 'USAGE, SELECT, UPDATE')
      end
    union all
    select 'CREATE en public'
    where has_schema_privilege('authenticated', 'public', 'CREATE')
  $$,
  'authenticated: no usa secuencias de public ni crea objetos en public'
);

-- service_role ---------------------------------------------------------------------------------

select is_empty(
  $$
    select 'tabla ' || c.relname || ': ' || p.privilegio
    from pg_class c
    cross join unnest(array[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
    ]) as p (privilegio)
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and has_table_privilege('service_role', c.oid, p.privilegio)
    union all
    select 'columna ' || c.relname || '.' || a.attname
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and a.attnum > 0
      and not a.attisdropped
      and has_column_privilege('service_role', a.attrelid, a.attnum, 'SELECT, INSERT, UPDATE, REFERENCES')
  $$,
  'service_role: ningún privilegio sobre las tablas de public, igual que el remoto'
);

-- anon ---------------------------------------------------------------------------------------

select is_empty(
  $$
    select 'tabla ' || c.relname || ': ' || p.privilegio
    from pg_class c
    cross join unnest(array[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
    ]) as p (privilegio)
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and has_table_privilege('anon', c.oid, p.privilegio)
    union all
    select 'columna ' || c.relname || '.' || a.attname
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and a.attnum > 0
      and not a.attisdropped
      and has_column_privilege('anon', a.attrelid, a.attnum, 'SELECT, INSERT, UPDATE, REFERENCES')
    union all
    select 'secuencia ' || c.relname
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and case when c.relkind = 'S'
        then has_sequence_privilege('anon', c.oid, 'USAGE, SELECT, UPDATE')
      end
    union all
    select 'función ' || p.oid::regprocedure
    from pg_proc p
    where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and has_function_privilege('anon', p.oid, 'EXECUTE')
    union all
    select 'esquema ' || s.esquema
    from unnest(array['public', 'private']) as s (esquema)
    where has_schema_privilege('anon', s.esquema, 'CREATE')
       or (s.esquema = 'private' and has_schema_privilege('anon', s.esquema, 'USAGE'))
  $$,
  'anon: ningún privilegio sobre tablas, columnas, secuencias ni funciones de public y private'
);

select * from finish();
rollback;
