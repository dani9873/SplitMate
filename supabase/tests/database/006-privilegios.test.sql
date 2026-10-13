-- Contrato de privilegios de la Data API: la matriz exacta de lo que authenticated puede hacer en
-- public y private, y nada para anon. Falla si una migración quita un privilegio esperado o da uno
-- de más; una tabla, columna o función nueva obliga a actualizar esta lista. Complementa
-- 001-estructura. Corre sobre la base que arman las migraciones: un cambio hecho desde el panel en
-- el proyecto remoto solo lo detecta `npm run check:data-api` (design/fase-3/data-api-privilegios.md).
begin;
select plan(5);

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
  $$,
  'authenticated: SELECT e INSERT en cada tabla de public, y ningún otro privilegio de tabla'
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
        ('groups', array[
          'name', 'currency', 'emoji', 'color', 'archived_at', 'updated_at', 'deleted_at', 'version'
        ]),
        ('group_members', array['display_name', 'updated_at', 'deleted_at', 'version']),
        ('categories', array['name', 'icon', 'updated_at', 'deleted_at', 'version']),
        ('expenses', array[
          'kind', 'title', 'amount', 'currency', 'group_amount', 'exchange_rate', 'rate_date',
          'split_method', 'category_id', 'occurred_on', 'notes', 'updated_at', 'deleted_at',
          'version'
        ]),
        ('expense_payers', array[
          'expense_id', 'member_id', 'amount', 'group_amount', 'updated_at', 'deleted_at', 'version'
        ]),
        ('expense_splits', array[
          'expense_id', 'member_id', 'amount', 'group_amount', 'input_value', 'updated_at',
          'deleted_at', 'version'
        ]),
        ('transfers', array[
          'from_member_id', 'to_member_id', 'amount', 'currency', 'group_amount', 'exchange_rate',
          'rate_date', 'occurred_on', 'updated_at', 'deleted_at', 'version'
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
    'private.can_bootstrap_group(uuid)',
    'private.is_group_member(uuid)',
    'private.shares_group_with(uuid)'
  ],
  'authenticated: EXECUTE solo en las tres funciones de apoyo de RLS'
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
