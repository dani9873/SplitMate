-- Seguridad de SplitMate en Postgres: RLS en todas las tablas, privilegios mínimos por rol y por
-- columna, y las funciones de apoyo de las políticas en el esquema private.
--
-- Modelo:
-- - anon no tiene ningún privilegio: la app exige sesión.
-- - authenticated lee e inserta, y edita solo las columnas editables. Nadie borra filas: borrar
--   es marcar deleted_at, como en la base local.
-- - Una cuenta ve y escribe solo en los grupos donde es miembro activo. Los perfiles se ven entre
--   quienes comparten un grupo.
-- - service_role conserva lectura y escritura, sin DELETE ni TRUNCATE. Borrar una cuenta limpia
--   sus filas con las FKs, que no dependen de estos privilegios.
-- Las pruebas pgTAP de supabase/tests/database verifican cada punto.

-- ---------------------------------------------------------------------------------------------
-- Privilegios por omisión: una tabla, función o secuencia nueva de public no queda expuesta sin
-- un GRANT explícito en su migración.
-- ---------------------------------------------------------------------------------------------

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
alter default privileges in schema public revoke delete, truncate on tables from service_role;

-- ---------------------------------------------------------------------------------------------
-- Privilegios de las tablas. La migración de esquema las creó con los privilegios por omisión de
-- Supabase (todo para anon, authenticated y service_role): se quitan y se dan los mínimos.
-- ---------------------------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke delete, truncate on all tables in schema public from service_role;

grant select, insert on
  public.profiles,
  public.groups,
  public.group_members,
  public.categories,
  public.expenses,
  public.expense_payers,
  public.expense_splits,
  public.transfers
to authenticated;

-- UPDATE solo en columnas editables. Nunca: id, group_id, created_by, user_id, role, key ni
-- created_at. Vincular un miembro a una cuenta ("soy yo", invitaciones) será una función RPC.
grant update (display_name, updated_at, deleted_at, version)
  on public.profiles to authenticated;
grant update (name, currency, emoji, color, archived_at, updated_at, deleted_at, version)
  on public.groups to authenticated;
grant update (display_name, updated_at, deleted_at, version)
  on public.group_members to authenticated;
grant update (name, icon, updated_at, deleted_at, version)
  on public.categories to authenticated;
grant update (
  kind, title, amount, currency, group_amount, exchange_rate, rate_date, split_method,
  category_id, occurred_on, notes, updated_at, deleted_at, version
) on public.expenses to authenticated;
grant update (expense_id, member_id, amount, group_amount, updated_at, deleted_at, version)
  on public.expense_payers to authenticated;
grant update (
  expense_id, member_id, amount, group_amount, input_value, updated_at, deleted_at, version
) on public.expense_splits to authenticated;
grant update (
  from_member_id, to_member_id, amount, currency, group_amount, exchange_rate, rate_date,
  occurred_on, updated_at, deleted_at, version
) on public.transfers to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Funciones de apoyo. SECURITY DEFINER para que las políticas no se consulten a sí mismas (el
-- dueño de las tablas no pasa por RLS); search_path vacío y nombres calificados para que nadie
-- las desvíe con objetos propios. private no está en la Data API.
-- ---------------------------------------------------------------------------------------------

-- Hay un miembro activo del grupo con la cuenta de la sesión.
create function private.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members m
    where m.group_id = p_group_id
      and m.user_id = (select auth.uid())
      and m.deleted_at is null
  );
$$;

-- La cuenta de la sesión creó el grupo y el grupo todavía no tiene miembros activos: puede
-- agregarse como su primer miembro.
create function private.can_bootstrap_group(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.groups g
    where g.id = p_group_id
      and g.created_by = (select auth.uid())
  )
  and not exists (
    select 1
    from public.group_members m
    where m.group_id = p_group_id
      and m.deleted_at is null
  );
$$;

-- La cuenta de la sesión y p_user_id son miembros activos de algún mismo grupo.
create function private.shares_group_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = (select auth.uid())
      and mine.deleted_at is null
      and theirs.user_id = p_user_id
      and theirs.deleted_at is null
  );
$$;

-- Toda función de private se cierra: authenticated ejecuta solo las que usan las políticas. La
-- del trigger de categoría no necesita EXECUTE: Postgres no lo exige al disparar un trigger.
revoke all on schema private from public;
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_group_member(uuid),
  private.can_bootstrap_group(uuid),
  private.shares_group_with(uuid)
to authenticated;

-- ---------------------------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.categories enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_payers enable row level security;
alter table public.expense_splits enable row level security;
alter table public.transfers enable row level security;

-- Perfiles: el propio, o el de quien comparte un grupo activo. Solo se crea y edita el propio.
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_group_with(id));
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Grupos: los ven y editan sus miembros. Cualquiera crea un grupo a su nombre.
create policy groups_select on public.groups
  for select to authenticated
  using (private.is_group_member(id));
create policy groups_insert on public.groups
  for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy groups_update on public.groups
  for update to authenticated
  using (private.is_group_member(id))
  with check (private.is_group_member(id));

-- Miembros: un miembro agrega miembros sin cuenta. El creador de un grupo vacío se agrega como
-- su primer miembro; así nace la membresía que habilita lo demás.
create policy group_members_select on public.group_members
  for select to authenticated
  using (private.is_group_member(group_id));
create policy group_members_insert on public.group_members
  for insert to authenticated
  with check (
    (private.is_group_member(group_id) and user_id is null and role = 'member')
    or (private.can_bootstrap_group(group_id) and user_id = (select auth.uid()))
  );
create policy group_members_update on public.group_members
  for update to authenticated
  using (private.is_group_member(group_id))
  with check (private.is_group_member(group_id));

-- Categorías: las predefinidas las ven todos y no las edita nadie; las personalizadas son del
-- grupo.
create policy categories_select on public.categories
  for select to authenticated
  using (group_id is null or private.is_group_member(group_id));
create policy categories_insert on public.categories
  for insert to authenticated
  with check (group_id is not null and private.is_group_member(group_id));
create policy categories_update on public.categories
  for update to authenticated
  using (group_id is not null and private.is_group_member(group_id))
  with check (group_id is not null and private.is_group_member(group_id));

-- Gastos, pagadores, partes y transferencias: los miembros del grupo. Las FKs compuestas ya
-- exigen que el gasto y los miembros sean de ese mismo grupo.
create policy expenses_select on public.expenses
  for select to authenticated
  using (private.is_group_member(group_id));
create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (private.is_group_member(group_id));
create policy expenses_update on public.expenses
  for update to authenticated
  using (private.is_group_member(group_id))
  with check (private.is_group_member(group_id));

create policy expense_payers_select on public.expense_payers
  for select to authenticated
  using (private.is_group_member(group_id));
create policy expense_payers_insert on public.expense_payers
  for insert to authenticated
  with check (private.is_group_member(group_id));
create policy expense_payers_update on public.expense_payers
  for update to authenticated
  using (private.is_group_member(group_id))
  with check (private.is_group_member(group_id));

create policy expense_splits_select on public.expense_splits
  for select to authenticated
  using (private.is_group_member(group_id));
create policy expense_splits_insert on public.expense_splits
  for insert to authenticated
  with check (private.is_group_member(group_id));
create policy expense_splits_update on public.expense_splits
  for update to authenticated
  using (private.is_group_member(group_id))
  with check (private.is_group_member(group_id));

create policy transfers_select on public.transfers
  for select to authenticated
  using (private.is_group_member(group_id));
create policy transfers_insert on public.transfers
  for insert to authenticated
  with check (private.is_group_member(group_id));
create policy transfers_update on public.transfers
  for update to authenticated
  using (private.is_group_member(group_id))
  with check (private.is_group_member(group_id));
