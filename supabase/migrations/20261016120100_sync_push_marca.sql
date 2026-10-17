-- Revisión de seguridad de la Fase 4a, S2 (design/fase-4a/revision-seguridad.md).
--
-- sync_push ponía la marca splitmate.sync_push = on, que deja pasar la guardia de escritura
-- (private.stamp_sync_row), y no la quitaba: seguía puesta hasta el final de la transacción. Por
-- PostgREST no se aprovecha (una petición es una sola llamada), pero una petición GraphQL con
-- varias mutaciones corre en una sola transacción: syncPush seguido de un insert directo pasaba
-- la guardia y saltaba la validación y la concurrencia de sync_push.
--
-- Ahora sync_push deja la marca como estaba antes de llamarla. Si la llamada falla, la transacción
-- entera se deshace. create or replace conserva los privilegios de la función (006-privilegios).

create or replace function public.sync_push(p_mutations jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c_uuid constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_uid uuid := (select auth.uid());
  v_item jsonb;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
  v_mutation uuid;
  v_entity text;
  v_base integer;
  v_data jsonb;
  v_entity_id uuid;
  v_group uuid;
  v_version integer;
  v_field text;
  v_constraint text;
  -- Lo que había antes de la llamada: en la API, nunca 'on'.
  v_mark text := coalesce(current_setting('splitmate.sync_push', true), '');
begin
  if v_uid is null then
    raise exception 'Se necesita una sesión' using errcode = 'insufficient_privilege';
  end if;

  -- El sobre se valida entero antes de escribir: un error aquí es de programación.
  if jsonb_typeof(p_mutations) is distinct from 'array' then
    raise exception 'p_mutations debe ser una lista' using errcode = '22023';
  end if;
  if octet_length(p_mutations::text) > 524288 then
    raise exception 'p_mutations pasa de 512 KiB' using errcode = '54000';
  end if;
  if jsonb_array_length(p_mutations) > 50 then
    raise exception 'Hasta 50 envíos por llamada' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_mutations) loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or (select count(*) from jsonb_object_keys(v_item)) <> 4
      or not (v_item ?& array['id', 'entity', 'base', 'data'])
      or jsonb_typeof(v_item -> 'id') is distinct from 'string'
      or (v_item ->> 'id') !~ c_uuid
      or jsonb_typeof(v_item -> 'entity') is distinct from 'string'
      or not ((v_item ->> 'entity') = any (array['group', 'member', 'category', 'expense', 'transfer']))
      or not (
        jsonb_typeof(v_item -> 'base') = 'null'
        or (jsonb_typeof(v_item -> 'base') = 'number' and (v_item ->> 'base') ~ '^[1-9][0-9]{0,8}$')
      )
      or jsonb_typeof(v_item -> 'data') is distinct from 'object'
    then
      raise exception 'Envío mal formado' using errcode = '22023';
    end if;
  end loop;

  -- La guardia de escritura (stamp_sync_row) deja pasar solo lo que escribe esta función. La
  -- marca dura hasta el return: otra sentencia de la misma transacción (por ejemplo, otra mutación
  -- de una petición GraphQL) no la hereda.
  perform set_config('splitmate.sync_push', 'on', true);

  for v_item in select value from jsonb_array_elements(p_mutations) loop
    v_mutation := (v_item ->> 'id')::uuid;
    v_entity := v_item ->> 'entity';
    v_base := case when jsonb_typeof(v_item -> 'base') = 'number' then (v_item ->> 'base')::integer end;
    v_data := v_item -> 'data';
    v_entity_id := case when (v_data ->> 'id') ~ c_uuid then lower(v_data ->> 'id')::uuid end;

    -- Un punto de guardado por envío: si falla, se deshace solo ese.
    begin
      perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || v_mutation::text, 0));
      v_version := private.sync_find_mutation(v_mutation);
      if v_version is null then
        v_group := case v_entity
          when 'group' then v_entity_id
          else private.sync_uuid(v_data, 'group_id')
        end;
        perform private.lock_group_changes(v_group);
        v_version := case v_entity
          when 'group' then private.sync_apply_group(v_data, v_base, v_mutation)
          when 'member' then private.sync_apply_member(v_data, v_base, v_mutation)
          when 'category' then private.sync_apply_category(v_data, v_base, v_mutation)
          when 'expense' then private.sync_apply_expense(v_data, v_base, v_mutation)
          else private.sync_apply_transfer(v_data, v_base, v_mutation)
        end;
      end if;
      v_result := jsonb_build_object(
        'id', v_mutation, 'status', 'applied', 'version', v_version,
        'current', private.sync_entity_rows(v_entity, v_entity_id)
      );
    exception
      when sqlstate 'SMINV' then
        get stacked diagnostics v_field = message_text;
        v_result := jsonb_build_object(
          'id', v_mutation, 'status', 'failed', 'reason', 'invalid', 'field', v_field
        );
      when sqlstate 'SMNFD' then
        v_result := jsonb_build_object(
          'id', v_mutation, 'status', 'failed', 'reason', 'not_found'
        );
      when sqlstate 'SMCFL' then
        v_result := jsonb_build_object(
          'id', v_mutation, 'status', 'rejected', 'reason', 'conflict',
          'current', private.sync_entity_rows(v_entity, v_entity_id)
        );
      when sqlstate 'SMCUR' then
        v_result := jsonb_build_object(
          'id', v_mutation, 'status', 'rejected', 'reason', 'currency_locked',
          'current', private.sync_entity_rows(v_entity, v_entity_id)
        );
      when sqlstate 'SMGCC' then
        v_result := jsonb_build_object(
          'id', v_mutation, 'status', 'rejected', 'reason', 'group_currency_changed',
          'current', private.sync_entity_rows(v_entity, v_entity_id)
        );
      when unique_violation then
        -- Otro miembro del grupo ya tiene tu cuenta: "soy yo" se movió en otro lado. Un id que ya
        -- existe en otro grupo no es tuyo.
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint = 'group_members_user_unique' then
          v_result := jsonb_build_object(
            'id', v_mutation, 'status', 'rejected', 'reason', 'conflict',
            'current', private.sync_entity_rows(v_entity, v_entity_id)
          );
        elsif v_constraint like '%\_pkey' then
          v_result := jsonb_build_object(
            'id', v_mutation, 'status', 'failed', 'reason', 'forbidden'
          );
        else
          v_result := jsonb_build_object('id', v_mutation, 'status', 'failed', 'reason', 'error');
        end if;
      when insufficient_privilege then
        v_result := jsonb_build_object(
          'id', v_mutation, 'status', 'failed', 'reason', 'forbidden'
        );
      when others then
        -- Interbloqueos, serialización, cancelaciones: la llamada entera falla y el cliente la
        -- repite.
        if left(sqlstate, 2) in ('40', '53', '55', '57', '58', 'XX') then
          raise;
        end if;
        v_result := jsonb_build_object(
          'id', v_mutation, 'status', 'failed',
          'reason', case when left(sqlstate, 2) in ('22', '23') then 'invalid' else 'error' end
        );
    end;
    v_results := v_results || jsonb_build_array(v_result);
  end loop;

  perform set_config('splitmate.sync_push', v_mark, true);
  return v_results;
end;
$$;
