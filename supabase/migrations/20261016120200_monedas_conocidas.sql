-- Revisión de seguridad de la Fase 4a, C1 (design/fase-4a/revision-seguridad.md).
--
-- sync_currency solo pedía tres letras mayúsculas. Un miembro podía guardar una moneda inventada
-- (por ejemplo, QQQ) en un grupo o un gasto llamando a sync_push con su sesión; los teléfonos de
-- los demás la descargaban y los saldos fallaban (la app no sabe cuántos decimales tiene).
--
-- Ahora solo acepta las monedas de ISO 4217 que conoce la app: las 155 de MINOR_UNITS en
-- src/domain/currency.ts. src/db/sync/__tests__/server-currencies.test.ts falla si las dos listas
-- dejan de coincidir; al sumar una moneda a la app, se suma aquí con otra migración.
-- create or replace conserva los privilegios de la función (006-privilegios).

create or replace function private.sync_currency(p_data jsonb, p_key text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_code text := private.sync_text(p_data, p_key, 3, 3, false, '^[A-Z]{3}$');
begin
  if not (v_code = any (array[
    'AED', 'AFN', 'ALL', 'AMD', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN', 'BAM', 'BBD', 'BDT',
    'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BRL', 'BSD', 'BTN', 'BWP', 'BYN', 'BZD', 'CAD',
    'CDF', 'CHF', 'CLP', 'CNY', 'COP', 'CRC', 'CUP', 'CVE', 'CZK', 'DJF', 'DKK', 'DOP',
    'DZD', 'EGP', 'ERN', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP', 'GEL', 'GHS', 'GIP', 'GMD',
    'GNF', 'GTQ', 'GYD', 'HKD', 'HNL', 'HTG', 'HUF', 'IDR', 'ILS', 'INR', 'IQD', 'IRR',
    'ISK', 'JMD', 'JOD', 'JPY', 'KES', 'KGS', 'KHR', 'KMF', 'KPW', 'KRW', 'KWD', 'KYD',
    'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'LYD', 'MAD', 'MDL', 'MGA', 'MKD', 'MMK',
    'MNT', 'MOP', 'MRU', 'MUR', 'MVR', 'MWK', 'MXN', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO',
    'NOK', 'NPR', 'NZD', 'OMR', 'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG', 'QAR',
    'RON', 'RSD', 'RUB', 'RWF', 'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SGD', 'SHP', 'SLE',
    'SOS', 'SRD', 'SSP', 'STN', 'SVC', 'SYP', 'SZL', 'THB', 'TJS', 'TMT', 'TND', 'TOP',
    'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'UGX', 'USD', 'UYU', 'UZS', 'VED', 'VES', 'VND',
    'VUV', 'WST', 'XAF', 'XCD', 'XCG', 'XOF', 'XPF', 'YER', 'ZAR', 'ZMW', 'ZWG'
  ])) then
    perform private.sync_fail(p_key);
  end if;
  return v_code;
end;
$$;
