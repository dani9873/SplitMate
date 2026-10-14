-- Base de la sincronización de la Fase 4a (design/fase-4a/diseno.md):
-- - columnas que pone el servidor: created_at, updated_at, version, deleted_at, archived_at y la
--   posición de cada cambio en la secuencia de su grupo (change_seq);
-- - guardia: authenticated escribe en las tablas de grupo solo dentro de sync_push;
-- - reglas: la moneda de un grupo con movimientos no cambia, cada movimiento guarda la moneda de
--   grupo con la que se calculó (group_currency) y "soy yo" solo usa la cuenta propia;
-- - acceso del creador del grupo en RLS (en la Fase 4b pasará a depender de la membresía);
-- - privilegios: authenticated ya no edita las columnas del servidor, edita user_id y
--   group_currency, y de los pagadores y las partes solo edita deleted_at; service_role queda sin
--   privilegios en public, igual que el remoto.
-- 001-estructura, 006-privilegios y 007-sync-columnas verifican cada punto.

-- ---------------------------------------------------------------------------------------------
-- Columnas nuevas
-- ---------------------------------------------------------------------------------------------

-- Posición del último cambio de la fila en la secuencia de su grupo: la descarga pide las filas
-- con change_seq mayor que el cursor del grupo. Las categorías predefinidas quedan en 0.
alter table public.groups add column change_seq bigint not null default 0;
alter table public.group_members add column change_seq bigint not null default 0;
alter table public.categories add column change_seq bigint not null default 0;
alter table public.expenses add column change_seq bigint not null default 0;
alter table public.expense_payers add column change_seq bigint not null default 0;
alter table public.expense_splits add column change_seq bigint not null default 0;
alter table public.transfers add column change_seq bigint not null default 0;

-- Las filas que ya existían entran en la secuencia con el número 1, así una descarga desde 0 las
-- trae. El 2026-10-14 el remoto no tenía grupos.
update public.groups set change_seq = 1;
update public.group_members set change_seq = 1;
update public.categories set change_seq = 1 where group_id is not null;
update public.expenses set change_seq = 1;
update public.expense_payers set change_seq = 1;
update public.expense_splits set change_seq = 1;
update public.transfers set change_seq = 1;

create index group_members_change_seq_idx on public.group_members (group_id, change_seq);
create index categories_change_seq_idx
  on public.categories (group_id, change_seq)
  where group_id is not null;
create index expenses_change_seq_idx on public.expenses (group_id, change_seq);
create index expense_payers_change_seq_idx on public.expense_payers (group_id, change_seq);
create index expense_splits_change_seq_idx on public.expense_splits (group_id, change_seq);
create index transfers_change_seq_idx on public.transfers (group_id, change_seq);

-- Moneda del grupo en la que está group_amount: la que tenía el grupo cuando la app hizo el
-- cálculo. Sin ella, un gasto calculado sin conexión podría subir después de un cambio de moneda
-- y quedar con montos en la moneda equivocada.
alter table public.expenses add column group_currency text;
alter table public.transfers add column group_currency text;
update public.expenses e set group_currency = g.currency from public.groups g where g.id = e.group_id;
update public.transfers t set group_currency = g.currency from public.groups g where g.id = t.group_id;
alter table public.expenses
  alter column group_currency set not null,
  add constraint expenses_group_currency_format check (group_currency ~ '^[A-Z]{3}$');
alter table public.transfers
  alter column group_currency set not null,
  add constraint transfers_group_currency_format check (group_currency ~ '^[A-Z]{3}$');

-- ---------------------------------------------------------------------------------------------
-- Secuencia de cambios por grupo
-- ---------------------------------------------------------------------------------------------

-- Un contador por grupo. La FK es diferida: el trigger de groups crea el contador antes de que
-- exista la fila del grupo.
create table private.group_changes (
  group_id uuid primary key
    references public.groups (id) on delete cascade deferrable initially deferred,
  last_seq bigint not null,
  constraint group_changes_last_seq_non_negative check (last_seq >= 0)
);

revoke all on table private.group_changes from public, anon, authenticated, service_role;

insert into private.group_changes (group_id, last_seq) select id, 1 from public.groups;

-- Siguiente número de la secuencia del grupo. El contador queda bloqueado hasta el commit: dos
-- transacciones del mismo grupo no se intercalan, así que quien lee nunca ve un número sin ver
-- también todos los anteriores.
create function private.next_change_seq(p_group_id uuid)
returns bigint
language sql
volatile
security definer
set search_path = ''
as $$
  insert into private.group_changes as c (group_id, last_seq)
  values (p_group_id, 1)
  on conflict (group_id) do update set last_seq = c.last_seq + 1
  returning c.last_seq;
$$;

-- ---------------------------------------------------------------------------------------------
-- Columnas que pone el servidor y guardia de escritura
-- ---------------------------------------------------------------------------------------------

-- Corre con los permisos de quien escribe, para ver su rol. sync_push marca su transacción con
-- splitmate.sync_push = on; un cliente no puede poner esa marca (PostgREST no expone set_config).
-- postgres, las migraciones y las cascadas de borrar una cuenta pasan sin marca.
create function private.stamp_sync_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
    and coalesce(current_setting('splitmate.sync_push', true), '') <> 'on'
  then
    raise exception 'Las escrituras pasan por sync_push'
      using errcode = 'insufficient_privilege';
  end if;

  -- La hora es la del servidor, nunca la del teléfono.
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.version := 1;
    if new.deleted_at is not null then
      new.deleted_at := now();
    end if;
  else
    new.created_at := old.created_at;
    new.version := old.version + 1;
    -- Borrar es "sí o no" para el cliente: el instante se conserva mientras siga borrada.
    if new.deleted_at is not null then
      new.deleted_at := coalesce(old.deleted_at, now());
    end if;
  end if;

  if tg_table_name = 'groups' then
    if new.archived_at is not null then
      if tg_op = 'INSERT' then
        new.archived_at := now();
      else
        new.archived_at := coalesce(old.archived_at, now());
      end if;
    end if;
    new.change_seq := private.next_change_seq(new.id);
  elsif new.group_id is null then
    -- Categorías predefinidas: comunes a todos los grupos, fuera de toda secuencia.
    new.change_seq := 0;
  else
    new.change_seq := private.next_change_seq(new.group_id);
  end if;

  return new;
end;
$$;

create trigger groups_sync_stamp
  before insert or update on public.groups
  for each row execute function private.stamp_sync_row();
create trigger group_members_sync_stamp
  before insert or update on public.group_members
  for each row execute function private.stamp_sync_row();
create trigger categories_sync_stamp
  before insert or update on public.categories
  for each row execute function private.stamp_sync_row();
create trigger expenses_sync_stamp
  before insert or update on public.expenses
  for each row execute function private.stamp_sync_row();
create trigger expense_payers_sync_stamp
  before insert or update on public.expense_payers
  for each row execute function private.stamp_sync_row();
create trigger expense_splits_sync_stamp
  before insert or update on public.expense_splits
  for each row execute function private.stamp_sync_row();
create trigger transfers_sync_stamp
  before insert or update on public.transfers
  for each row execute function private.stamp_sync_row();

-- ---------------------------------------------------------------------------------------------
-- Reglas
-- ---------------------------------------------------------------------------------------------

-- La moneda de un grupo no cambia mientras tenga movimientos activos: sus montos convertidos están
-- en la moneda anterior. Quien edita el grupo ve todos sus movimientos.
create function private.check_group_currency()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.currency is distinct from old.currency and (
    exists (select 1 from public.expenses e where e.group_id = new.id and e.deleted_at is null)
    or exists (select 1 from public.transfers t where t.group_id = new.id and t.deleted_at is null)
  ) then
    raise exception 'La moneda del grupo no cambia mientras tenga movimientos'
      using errcode = 'SMCUR';
  end if;
  return new;
end;
$$;

create trigger groups_currency_lock
  before update of currency on public.groups
  for each row execute function private.check_group_currency();

-- Un movimiento activo está calculado en la moneda actual de su grupo. Con los permisos de quien
-- escribe: un grupo que no ve no se revisa (RLS rechaza la fila después), así nadie averigua la
-- moneda de un grupo ajeno.
create function private.check_movement_currency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_currency text;
begin
  if new.deleted_at is null then
    select g.currency into v_currency from public.groups g where g.id = new.group_id;
    if found and new.group_currency is distinct from v_currency then
      raise exception 'El movimiento está calculado en otra moneda de grupo'
        using errcode = 'SMGCC';
    end if;
  end if;
  return new;
end;
$$;

create trigger expenses_group_currency
  before insert or update on public.expenses
  for each row execute function private.check_movement_currency();
create trigger transfers_group_currency
  before insert or update on public.transfers
  for each row execute function private.check_movement_currency();

-- "Soy yo": una cuenta solo vincula o desvincula la suya. Las demás escrituras (postgres, las
-- cascadas de borrar una cuenta) no pasan por esta regla.
create function private.check_member_link()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.user_id is not null and new.user_id is distinct from v_uid then
      raise exception 'Solo se vincula la cuenta propia'
        using errcode = 'insufficient_privilege';
    end if;
  elsif new.user_id is distinct from old.user_id
    and (
      (old.user_id is not null and old.user_id is distinct from v_uid)
      or (new.user_id is not null and new.user_id is distinct from v_uid)
    )
  then
    raise exception 'Solo se vincula o desvincula la cuenta propia'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger group_members_link
  before insert or update of user_id on public.group_members
  for each row execute function private.check_member_link();

-- ---------------------------------------------------------------------------------------------
-- Acceso: el creador del grupo o un miembro vinculado activo
-- ---------------------------------------------------------------------------------------------

create function private.is_group_creator(p_group_id uuid)
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
  );
$$;

-- Desde la Fase 2 un grupo puede no tener "yo": su creador igual lo abre. En la Fase 4b, con
-- invitaciones y expulsiones, el acceso debe depender solo de la membresía (pendiente en
-- CLAUDE.md).
create function private.can_access_group(p_group_id uuid)
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
  or exists (
    select 1
    from public.group_members m
    where m.group_id = p_group_id
      and m.user_id = (select auth.uid())
      and m.deleted_at is null
  );
$$;

-- groups compara su propio created_by: en un INSERT ... ON CONFLICT o con RETURNING la fila nueva
-- todavía no es visible para una consulta, así que buscar el grupo no serviría.
drop policy groups_select on public.groups;
drop policy groups_update on public.groups;
create policy groups_select on public.groups
  for select to authenticated
  using (created_by = (select auth.uid()) or private.is_group_member(id));
create policy groups_update on public.groups
  for update to authenticated
  using (created_by = (select auth.uid()) or private.is_group_member(id))
  with check (created_by = (select auth.uid()) or private.is_group_member(id));

-- Miembros: quien tiene acceso agrega miembros sin cuenta o con la suya, y solo el creador agrega
-- un dueño. Ya no hace falta que el creador entre primero como miembro.
drop policy group_members_select on public.group_members;
drop policy group_members_insert on public.group_members;
drop policy group_members_update on public.group_members;
create policy group_members_select on public.group_members
  for select to authenticated
  using (private.can_access_group(group_id));
create policy group_members_insert on public.group_members
  for insert to authenticated
  with check (
    private.can_access_group(group_id)
    and (user_id is null or user_id = (select auth.uid()))
    and (role = 'member' or private.is_group_creator(group_id))
  );
create policy group_members_update on public.group_members
  for update to authenticated
  using (private.can_access_group(group_id))
  with check (private.can_access_group(group_id));

drop function private.can_bootstrap_group(uuid);

drop policy categories_select on public.categories;
drop policy categories_insert on public.categories;
drop policy categories_update on public.categories;
create policy categories_select on public.categories
  for select to authenticated
  using (group_id is null or private.can_access_group(group_id));
create policy categories_insert on public.categories
  for insert to authenticated
  with check (group_id is not null and private.can_access_group(group_id));
create policy categories_update on public.categories
  for update to authenticated
  using (group_id is not null and private.can_access_group(group_id))
  with check (group_id is not null and private.can_access_group(group_id));

drop policy expenses_select on public.expenses;
drop policy expenses_insert on public.expenses;
drop policy expenses_update on public.expenses;
create policy expenses_select on public.expenses
  for select to authenticated
  using (private.can_access_group(group_id));
create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (private.can_access_group(group_id));
create policy expenses_update on public.expenses
  for update to authenticated
  using (private.can_access_group(group_id))
  with check (private.can_access_group(group_id));

drop policy expense_payers_select on public.expense_payers;
drop policy expense_payers_insert on public.expense_payers;
drop policy expense_payers_update on public.expense_payers;
create policy expense_payers_select on public.expense_payers
  for select to authenticated
  using (private.can_access_group(group_id));
create policy expense_payers_insert on public.expense_payers
  for insert to authenticated
  with check (private.can_access_group(group_id));
create policy expense_payers_update on public.expense_payers
  for update to authenticated
  using (private.can_access_group(group_id))
  with check (private.can_access_group(group_id));

drop policy expense_splits_select on public.expense_splits;
drop policy expense_splits_insert on public.expense_splits;
drop policy expense_splits_update on public.expense_splits;
create policy expense_splits_select on public.expense_splits
  for select to authenticated
  using (private.can_access_group(group_id));
create policy expense_splits_insert on public.expense_splits
  for insert to authenticated
  with check (private.can_access_group(group_id));
create policy expense_splits_update on public.expense_splits
  for update to authenticated
  using (private.can_access_group(group_id))
  with check (private.can_access_group(group_id));

drop policy transfers_select on public.transfers;
drop policy transfers_insert on public.transfers;
drop policy transfers_update on public.transfers;
create policy transfers_select on public.transfers
  for select to authenticated
  using (private.can_access_group(group_id));
create policy transfers_insert on public.transfers
  for insert to authenticated
  with check (private.can_access_group(group_id));
create policy transfers_update on public.transfers
  for update to authenticated
  using (private.can_access_group(group_id))
  with check (private.can_access_group(group_id));

-- ---------------------------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------------------------

-- Funciones: authenticated ejecuta las que llaman las políticas y el trigger de columnas. Las de
-- los triggers no necesitan EXECUTE para dispararse.
revoke all on function
  private.next_change_seq(uuid),
  private.is_group_creator(uuid),
  private.can_access_group(uuid),
  private.stamp_sync_row(),
  private.check_group_currency(),
  private.check_movement_currency(),
  private.check_member_link()
from public, anon, authenticated, service_role;
grant execute on function
  private.next_change_seq(uuid),
  private.is_group_creator(uuid),
  private.can_access_group(uuid)
to authenticated;

-- Las columnas que pone el servidor ya no se editan desde la API (profiles no sincroniza y queda
-- como estaba).
revoke update (updated_at, version) on
  public.groups,
  public.group_members,
  public.categories,
  public.expenses,
  public.expense_payers,
  public.expense_splits,
  public.transfers
from authenticated;

-- Los pagadores y las partes no se editan: una edición del gasto crea filas nuevas. Solo se
-- borran o se restauran.
revoke update (expense_id, member_id, amount, group_amount)
  on public.expense_payers from authenticated;
revoke update (expense_id, member_id, amount, group_amount, input_value)
  on public.expense_splits from authenticated;

-- "Soy yo" (con su regla) y la moneda de grupo de cada movimiento.
grant update (user_id) on public.group_members to authenticated;
grant update (group_currency) on public.expenses, public.transfers to authenticated;

-- service_role: ningún privilegio en las tablas de public, igual que el remoto desde el cambio
-- del panel (design/fase-3/data-api-privilegios.md). delete-account solo usa auth.admin y las
-- cascadas no dependen de privilegios. Tampoco recibe nada de lo que se cree después.
-- (EXECUTE para PUBLIC en funciones nuevas no se puede quitar por esquema: cada migración lo
-- revoca función por función.)
revoke all on all tables in schema public from service_role;
alter default privileges in schema public revoke all on tables from service_role;
alter default privileges in schema public revoke all on sequences from service_role;
alter default privileges in schema public revoke all on functions from service_role;
