-- Borrar la cuenta borra en la nube los grupos que nadie más puede abrir (Fase 4a,
-- design/fase-4a/diseno.md, sección "Borrar la cuenta"). Sin esto quedarían huérfanos sus gastos.
-- Lo que pasa con los grupos compartidos sigue en la Fase 4b. 011-borrar-cuenta lo verifica.

-- Corre antes de que se borre el perfil (en la cascada de auth.admin.deleteUser): los grupos creados
-- por la cuenta o con su miembro activo, que ninguna otra cuenta puede abrir, ni como miembro
-- vinculado activo ni como creador (private.can_access_group). Sus filas, su historial y su
-- contador de cambios caen en cascada; el trigger de change_log deja pasar ese DELETE porque corre
-- anidado. En los grupos que quedan, la cascada del perfil deja sin cuenta al miembro y sin creador
-- al grupo, como antes.
create function private.delete_unshared_groups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.groups g
  where (
      g.created_by = old.id
      or exists (
        select 1
        from public.group_members m
        where m.group_id = g.id
          and m.user_id = old.id
          and m.deleted_at is null
      )
    )
    and (g.created_by is null or g.created_by = old.id)
    and not exists (
      select 1
      from public.group_members m
      where m.group_id = g.id
        and m.user_id is not null
        and m.user_id <> old.id
        and m.deleted_at is null
    );
  return old;
end;
$$;

create trigger profiles_delete_unshared_groups
  before delete on public.profiles
  for each row execute function private.delete_unshared_groups();

-- Los triggers no necesitan EXECUTE para dispararse.
revoke all on function private.delete_unshared_groups()
  from public, anon, authenticated, service_role;
