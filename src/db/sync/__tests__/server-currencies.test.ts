import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { KNOWN_CURRENCIES } from '@/domain';

const MIGRATIONS = join(__dirname, '../../../../supabase/migrations');

/** Los códigos que acepta private.sync_currency en la última migración que la define. */
function serverCurrencies(): string[] {
  const files = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const last = files
    .map((file) => readFileSync(join(MIGRATIONS, file), 'utf8'))
    .filter((sql) => sql.includes('function private.sync_currency('))
    .at(-1);
  const body = last?.slice(last.indexOf('function private.sync_currency('));
  const list = body?.match(/array\[([\s\S]*?)\]/)?.[1] ?? '';
  return [...list.matchAll(/'([A-Z]{3})'/g)].map((match) => match[1] as string).sort();
}

describe('monedas del servidor', () => {
  it('sync_push acepta exactamente las monedas que conoce la app', () => {
    expect(serverCurrencies()).toEqual([...KNOWN_CURRENCIES]);
  });
});
