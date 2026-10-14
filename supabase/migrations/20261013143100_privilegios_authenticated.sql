-- Vuelve a dar a authenticated los privilegios de 20261011123739_seguridad.sql.
--
-- En el proyecto remoto las dos migraciones figuran aplicadas, pero el 2026-10-13 un usuario
-- autenticado recibía 403 42501 (permission denied) por REST en las 8 tablas: sus privilegios no
-- estaban, y sin ellos la app no puede crear su perfil. La causa no está confirmada. Desde 2026
-- Supabase solo expone a la Data API las tablas de public con un GRANT explícito, y este archivo
-- repite los de la migración de seguridad.
--
-- Solo toca a authenticated: anon sigue sin ningún privilegio y RLS no cambia. GRANT no falla si
-- el privilegio ya existe: en una base donde estaban (local, CI) no cambia nada.
-- 001-estructura.test.sql verifica el resultado.

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

-- Las políticas llaman a estas funciones con el rol de la sesión.
grant usage on schema private to authenticated;
grant execute on function
  private.is_group_member(uuid),
  private.can_bootstrap_group(uuid),
  private.shares_group_with(uuid)
to authenticated;
