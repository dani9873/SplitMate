-- Retiro de sync_pull (v1) — push n.º 3 de la Fase 4b (design/fase-4b/diseno.md, «Retiro de sync_pull»).
--
-- BORRADOR: este archivo NO está en supabase/migrations/. Se mueve ahí solo cuando los teléfonos de
-- prueba ya tengan el build nuevo de la 4b (ver README.md de esta carpeta). La app de la 4a llama a
-- sync_pull: en cuanto se aplique, esa app deja de poder descargar.
--
-- sync_pull_v2 (sync_pull con group_access, páginas dentro de un grupo, tope duro de filas y `lost`)
-- ya es la única descarga que usa la app nueva. Quitar la v1 cierra S3 (la descarga sin tope por grupo
-- que la v1 admitía) para todo el mundo.

do $$
begin
  -- No se retira la vieja si falta la nueva: la app se quedaría sin descarga.
  if to_regprocedure('public.sync_pull_v2(jsonb, integer)') is null then
    raise exception 'sync_pull_v2 no existe: no se retira sync_pull';
  end if;
end;
$$;

-- Sin IF EXISTS a propósito: si la v1 ya no está, algo se aplicó fuera de las migraciones y conviene
-- enterarse antes de que se haga un push más. Los privilegios se van con la función.
drop function public.sync_pull(jsonb, integer);
