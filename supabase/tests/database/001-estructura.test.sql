-- Estructura de seguridad: RLS en todo, privilegios mínimos por rol, columnas que pone el servidor
-- y funciones de apoyo cerradas. Si una migración futura agrega una tabla o una función, estas
-- pruebas la revisan.
begin;
select plan(20);

-- Tablas -----------------------------------------------------------------------------------

select tables_are(
  'public',
  array[
    'profiles', 'groups', 'group_members', 'categories',
    'expenses', 'expense_payers', 'expense_splits', 'transfers', 'change_log'
  ],
  'public tiene solo las tablas revisadas por estas pruebas'
);

select is_empty(
  $$
    select c.relname
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  $$,
  'Toda tabla de public tiene RLS activado'
);

select is_empty(
  $$
    select c.relname
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('v', 'm', 'f')
  $$,
  'public no tiene vistas ni tablas foráneas, que podrían saltarse RLS'
);

-- anon ---------------------------------------------------------------------------------------

select is_empty(
  $$
    select c.relname
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p', 'S')
      and (
        has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        or has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
      )
  $$,
  'anon no tiene privilegios sobre tablas ni columnas de public'
);

select ok(
  not has_schema_privilege('anon', 'private', 'USAGE'),
  'anon no puede usar el esquema private'
);

select is_empty(
  $$
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  $$,
  'anon no ejecuta funciones de public ni de private'
);

-- authenticated y service_role ---------------------------------------------------------------

select is_empty(
  $$
    select c.relname, r.rolname
    from pg_class c
    cross join (values ('anon'), ('authenticated'), ('service_role')) as r (rolname)
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and has_table_privilege(r.rolname, c.oid, 'DELETE, TRUNCATE')
  $$,
  'Ningún rol de la API tiene DELETE ni TRUNCATE: borrar es marcar deleted_at'
);

select is_empty(
  $$
    select c.relname
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      -- change_log es de solo lectura: 009-historial revisa sus privilegios.
      and c.relname <> 'change_log'
      and not (
        has_table_privilege('authenticated', c.oid, 'SELECT')
        and has_table_privilege('authenticated', c.oid, 'INSERT')
      )
  $$,
  'authenticated lee e inserta en todas las tablas (RLS decide qué filas)'
);

select is_empty(
  $$
    select c.relname
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and has_table_privilege('authenticated', c.oid, 'UPDATE, REFERENCES, TRIGGER')
  $$,
  'authenticated no tiene UPDATE de tabla completa, REFERENCES ni TRIGGER'
);

select is_empty(
  $$
    select a.attrelid::regclass, a.attname
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and a.attnum > 0
      and not a.attisdropped
      and a.attname in ('id', 'group_id', 'created_by', 'role', 'key', 'created_at', 'change_seq')
      and has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
  $$,
  'authenticated no edita id, group_id, created_by, role, key, created_at ni change_seq'
);

select is_empty(
  $$
    select c.relname
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and c.relname <> 'change_log'
      -- Con CASE: el orden del WHERE no está fijo y la función falla en tablas sin deleted_at.
      and case when c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
        then not has_column_privilege('authenticated', c.oid, 'deleted_at', 'UPDATE')
      end
  $$,
  'authenticated borra (marca deleted_at) en todas las tablas'
);

select is_empty(
  $$
    select c.relname, a.attname
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and c.relname <> 'profiles'
      and a.attname in ('updated_at', 'version')
      and has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
  $$,
  'En las tablas de grupo, updated_at y version los pone el servidor: authenticated no los edita'
);

select set_eq(
  $$
    select t.tgrelid::regclass::text
    from pg_trigger t
    where t.tgfoid = 'private.stamp_sync_row()'::regprocedure
      and not t.tgisinternal
  $$,
  $$
    values ('groups'), ('group_members'), ('categories'), ('expenses'), ('expense_payers'),
      ('expense_splits'), ('transfers')
  $$,
  'Las siete tablas de grupo tienen el trigger de las columnas del servidor y la guardia'
);

-- Funciones --------------------------------------------------------------------------------

select is_empty(
  $$
    select p.oid::regprocedure
    from pg_proc p
    where (p.prosecdef or p.pronamespace = 'private'::regnamespace)
      and p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and not coalesce(p.proconfig, '{}') @> array['search_path=""']
  $$,
  'Toda función de private y toda SECURITY DEFINER fija search_path vacío'
);

select is(
  (
    select array_agg(p.proname::text order by p.proname)
    from pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and p.prosecdef
      and p.provolatile = 's'
  ),
  array['can_access_group', 'is_group_creator', 'is_group_member', 'shares_group_with'],
  'Las funciones de apoyo de RLS son SECURITY DEFINER y STABLE'
);

select ok(
  has_schema_privilege('authenticated', 'private', 'USAGE')
    and not has_schema_privilege('authenticated', 'private', 'CREATE'),
  'authenticated usa el esquema private, pero no crea objetos en él'
);

select is_empty(
  $$
    select f.signature
    from (
      values
        ('private.is_group_member(uuid)'),
        ('private.can_access_group(uuid)'),
        ('private.is_group_creator(uuid)'),
        ('private.shares_group_with(uuid)'),
        ('private.next_change_seq(uuid)')
    ) as f (signature)
    where not has_function_privilege('authenticated', f.signature, 'EXECUTE')
  $$,
  'authenticated ejecuta las funciones que usan las políticas y el trigger de columnas'
);

select is_empty(
  $$
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and p.prorettype = 'trigger'::regtype
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  $$,
  'Las funciones de los triggers no se pueden llamar: solo las usan los triggers'
);

select is_empty(
  $$
    select c.relname, r.rolname
    from pg_class c
    cross join (values ('anon'), ('authenticated'), ('service_role')) as r (rolname)
    where c.relnamespace = 'private'::regnamespace
      and c.relkind in ('r', 'p')
      and has_table_privilege(r.rolname, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  $$,
  'Las tablas de private no tienen privilegios para los roles de la API'
);

select is_empty(
  $$
    select c.relname
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
  $$,
  'Toda tabla de public tiene políticas'
);

select * from finish();
rollback;
