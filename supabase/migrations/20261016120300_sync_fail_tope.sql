-- Revisión de seguridad de la Fase 4a, S4 (design/fase-4a/revision-seguridad.md).
--
-- El campo de un envío inválido (`field` en la respuesta de sync_push) repetía la clave tal como
-- la mandó el cliente, sin tope: una clave desconocida de cientos de KiB volvía entera. Ahora se
-- recorta a 64 caracteres, más que el campo conocido más largo con su prefijo
-- ("payers." o "splits.").
-- create or replace conserva los privilegios de la función (006-privilegios).

create or replace function private.sync_fail(p_key text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'SMINV',
    message = left(coalesce(current_setting('splitmate.sync_path', true), '') || p_key, 64);
end;
$$;
