-- Esquema de SplitMate en Postgres. Refleja la base local (src/db/schema.ts): mismos ids UUID v7
-- generados en el cliente, borrado lógico con deleted_at y bloqueo optimista con version.
-- Los montos son enteros en unidades menores. La seguridad (RLS, privilegios y funciones de
-- apoyo) está en la migración siguiente.
--
-- Diferencias con la base local:
-- - profiles: perfil de cada cuenta de Auth. La base local lo llama users. No guarda el correo:
--   queda en auth.users y otros miembros no lo ven.
-- - Los instantes son timestamptz (en local, milisegundos Unix) y los días de calendario, date.
-- - expense_payers y expense_splits llevan group_id: con él, las claves foráneas compuestas
--   exigen que el gasto y los miembros sean del mismo grupo, y RLS filtra sin subconsultas.
-- - Los montos tienen un tope de 99 999 999 999 999 unidades menores.

-- Funciones internas (triggers y RLS). La Data API solo expone public y graphql_public.
create schema if not exists private;

-- ---------------------------------------------------------------------------------------------
-- Perfiles
-- ---------------------------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  constraint profiles_display_name_length check (char_length(display_name) between 1 and 80),
  constraint profiles_version_positive check (version >= 1)
);

comment on table public.profiles is
  'Perfil de cada cuenta. El correo queda en auth.users y no se expone a otros miembros.';

-- ---------------------------------------------------------------------------------------------
-- Grupos y miembros
-- ---------------------------------------------------------------------------------------------

create table public.groups (
  id uuid primary key,
  name text not null,
  currency text not null,
  -- Pasa a nulo si se borra la cuenta del creador: el grupo sigue para los demás.
  created_by uuid references public.profiles (id) on delete set null,
  emoji text,
  color text not null default 'teal',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  constraint groups_name_length check (char_length(name) between 1 and 80),
  constraint groups_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint groups_emoji_length check (emoji is null or char_length(emoji) between 1 and 16),
  constraint groups_color check (
    color in ('teal', 'coral', 'amber', 'plum', 'sky', 'olive', 'rose', 'slate')
  ),
  constraint groups_version_positive check (version >= 1)
);

create index groups_active_updated_idx on public.groups (updated_at) where deleted_at is null;
create index groups_created_by_idx on public.groups (created_by);

create table public.group_members (
  id uuid primary key,
  group_id uuid not null references public.groups (id) on delete cascade,
  -- Nulo: miembro sin cuenta, solo con su nombre. Pasa a nulo si se borra la cuenta.
  user_id uuid references public.profiles (id) on delete set null,
  display_name text not null,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  constraint group_members_display_name_length check (char_length(display_name) between 1 and 80),
  constraint group_members_role check (role in ('owner', 'member')),
  constraint group_members_version_positive check (version >= 1),
  -- Destino de las claves foráneas compuestas: un miembro y su grupo.
  constraint group_members_id_group_unique unique (id, group_id)
);

create index group_members_group_idx on public.group_members (group_id) where deleted_at is null;
-- Una cuenta es a lo sumo un miembro activo de cada grupo: hay un solo "yo". También sirve a
-- private.is_group_member.
create unique index group_members_user_unique
  on public.group_members (group_id, user_id)
  where user_id is not null and deleted_at is null;
create index group_members_user_idx
  on public.group_members (user_id)
  where user_id is not null and deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Categorías
-- ---------------------------------------------------------------------------------------------

create table public.categories (
  id uuid primary key,
  -- Nulo en las predefinidas, que son comunes a todos los grupos.
  group_id uuid references public.groups (id) on delete cascade,
  -- Clave de traducción de las predefinidas, por ejemplo food.
  key text,
  -- Nombre libre de las personalizadas.
  name text,
  -- Nombre de un ícono de Lucide.
  icon text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  constraint categories_key_or_name check ((key is null) <> (name is null)),
  constraint categories_custom_has_group check ((key is null) = (group_id is not null)),
  constraint categories_key_format check (key is null or key ~ '^[a-z][a-z_]{0,31}$'),
  constraint categories_name_length check (name is null or char_length(name) between 1 and 40),
  constraint categories_icon_length check (char_length(icon) between 1 and 40),
  constraint categories_version_positive check (version >= 1)
);

create unique index categories_key_unique on public.categories (key) where key is not null;
create index categories_group_idx on public.categories (group_id) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Gastos e ingresos
-- ---------------------------------------------------------------------------------------------

create table public.expenses (
  id uuid primary key,
  group_id uuid not null references public.groups (id) on delete cascade,
  kind text not null,
  title text not null,
  -- Monto original en unidades menores de currency.
  amount bigint not null,
  currency text not null,
  -- Monto convertido a la moneda del grupo, en sus unidades menores.
  group_amount bigint not null,
  -- Tasa decimal usada en la conversión; 1 si la moneda es la del grupo.
  exchange_rate text not null default '1',
  rate_date date,
  split_method text not null,
  category_id uuid references public.categories (id),
  -- Día del gasto, sin zona horaria.
  occurred_on date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  constraint expenses_kind check (kind in ('expense', 'income')),
  constraint expenses_split_method check (split_method in ('equal', 'exact', 'percentage', 'shares')),
  constraint expenses_title_length check (char_length(title) between 1 and 120),
  constraint expenses_amount_range check (amount between 1 and 99999999999999),
  constraint expenses_group_amount_range check (group_amount between 0 and 99999999999999),
  constraint expenses_currency_format check (currency ~ '^[A-Z]{3}$'),
  -- CASE fija el orden: Postgres no garantiza evaluar un AND de izquierda a derecha, y el cast
  -- a numeric de un texto mal formado fallaría con otro error en lugar de violar el CHECK.
  constraint expenses_rate_format check (
    case
      when char_length(exchange_rate) <= 32 and exchange_rate ~ '^[0-9]+(\.[0-9]+)?$'
        then exchange_rate::numeric > 0
      else false
    end
  ),
  constraint expenses_notes_length check (notes is null or char_length(notes) <= 1000),
  constraint expenses_version_positive check (version >= 1),
  constraint expenses_id_group_unique unique (id, group_id)
);

create index expenses_group_date_idx on public.expenses (group_id, occurred_on) where deleted_at is null;
create index expenses_category_idx on public.expenses (category_id);

-- La categoría de un gasto es predefinida o del mismo grupo.
create function private.check_expense_category() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.category_id is not null and not exists (
    select 1
    from public.categories c
    where c.id = new.category_id
      and (c.group_id is null or c.group_id = new.group_id)
  ) then
    raise exception 'La categoría no es predefinida ni del grupo del gasto'
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

create trigger expenses_category_in_group
  before insert or update of category_id, group_id on public.expenses
  for each row execute function private.check_expense_category();

create table public.expense_payers (
  id uuid primary key,
  group_id uuid not null,
  expense_id uuid not null,
  member_id uuid not null,
  -- Lo pagado en la moneda original del gasto.
  amount bigint not null,
  -- Lo pagado en la moneda del grupo.
  group_amount bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  constraint expense_payers_amount_range check (amount between 1 and 99999999999999),
  constraint expense_payers_group_amount_range check (group_amount between 0 and 99999999999999),
  constraint expense_payers_version_positive check (version >= 1),
  constraint expense_payers_expense_fk foreign key (expense_id, group_id)
    references public.expenses (id, group_id) on delete cascade,
  constraint expense_payers_member_fk foreign key (member_id, group_id)
    references public.group_members (id, group_id) on delete cascade
);

create unique index expense_payers_member_unique
  on public.expense_payers (expense_id, member_id)
  where deleted_at is null;
create index expense_payers_expense_idx on public.expense_payers (expense_id);
create index expense_payers_member_idx on public.expense_payers (member_id);
create index expense_payers_group_idx on public.expense_payers (group_id) where deleted_at is null;

create table public.expense_splits (
  id uuid primary key,
  group_id uuid not null,
  expense_id uuid not null,
  member_id uuid not null,
  -- Parte en la moneda original del gasto.
  amount bigint not null,
  -- Parte en la moneda del grupo.
  group_amount bigint not null,
  -- Valor ingresado según el método: puntos básicos, partes o monto exacto. Nulo si es por igual.
  input_value bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  constraint expense_splits_amount_range check (amount between 0 and 99999999999999),
  constraint expense_splits_group_amount_range check (group_amount between 0 and 99999999999999),
  constraint expense_splits_input_value_range check (
    input_value is null or input_value between 0 and 99999999999999
  ),
  constraint expense_splits_version_positive check (version >= 1),
  constraint expense_splits_expense_fk foreign key (expense_id, group_id)
    references public.expenses (id, group_id) on delete cascade,
  constraint expense_splits_member_fk foreign key (member_id, group_id)
    references public.group_members (id, group_id) on delete cascade
);

create unique index expense_splits_member_unique
  on public.expense_splits (expense_id, member_id)
  where deleted_at is null;
create index expense_splits_expense_idx on public.expense_splits (expense_id);
create index expense_splits_member_idx on public.expense_splits (member_id);
create index expense_splits_group_idx on public.expense_splits (group_id) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Transferencias
-- ---------------------------------------------------------------------------------------------

create table public.transfers (
  id uuid primary key,
  group_id uuid not null references public.groups (id) on delete cascade,
  from_member_id uuid not null,
  to_member_id uuid not null,
  amount bigint not null,
  currency text not null,
  group_amount bigint not null,
  exchange_rate text not null default '1',
  rate_date date,
  occurred_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  constraint transfers_distinct_members check (from_member_id <> to_member_id),
  constraint transfers_amount_range check (amount between 1 and 99999999999999),
  constraint transfers_group_amount_range check (group_amount between 0 and 99999999999999),
  constraint transfers_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint transfers_rate_format check (
    case
      when char_length(exchange_rate) <= 32 and exchange_rate ~ '^[0-9]+(\.[0-9]+)?$'
        then exchange_rate::numeric > 0
      else false
    end
  ),
  constraint transfers_version_positive check (version >= 1),
  constraint transfers_from_member_fk foreign key (from_member_id, group_id)
    references public.group_members (id, group_id) on delete cascade,
  constraint transfers_to_member_fk foreign key (to_member_id, group_id)
    references public.group_members (id, group_id) on delete cascade
);

create index transfers_group_date_idx on public.transfers (group_id, occurred_on) where deleted_at is null;
create index transfers_from_member_idx on public.transfers (from_member_id);
create index transfers_to_member_idx on public.transfers (to_member_id);

-- ---------------------------------------------------------------------------------------------
-- Categorías predefinidas: los mismos ids fijos que la migración local 0001.
-- ---------------------------------------------------------------------------------------------

insert into public.categories (id, key, icon, created_at, updated_at) values
  ('0199c82c-c000-7000-8000-000000000001', 'food', 'utensils', to_timestamp(1760000000), to_timestamp(1760000000)),
  ('0199c82c-c000-7000-8000-000000000002', 'groceries', 'shopping-cart', to_timestamp(1760000000), to_timestamp(1760000000)),
  ('0199c82c-c000-7000-8000-000000000003', 'transport', 'car', to_timestamp(1760000000), to_timestamp(1760000000)),
  ('0199c82c-c000-7000-8000-000000000004', 'lodging', 'bed', to_timestamp(1760000000), to_timestamp(1760000000)),
  ('0199c82c-c000-7000-8000-000000000005', 'entertainment', 'party-popper', to_timestamp(1760000000), to_timestamp(1760000000)),
  ('0199c82c-c000-7000-8000-000000000006', 'shopping', 'shopping-bag', to_timestamp(1760000000), to_timestamp(1760000000)),
  ('0199c82c-c000-7000-8000-000000000007', 'utilities', 'plug', to_timestamp(1760000000), to_timestamp(1760000000)),
  ('0199c82c-c000-7000-8000-000000000008', 'health', 'heart-pulse', to_timestamp(1760000000), to_timestamp(1760000000)),
  ('0199c82c-c000-7000-8000-000000000009', 'other', 'tag', to_timestamp(1760000000), to_timestamp(1760000000));
