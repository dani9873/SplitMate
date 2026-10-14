// Comprueba por REST, contra el proyecto de Supabase, los privilegios de la Data API: anon sin
// acceso a ninguna tabla, y authenticated con los suyos (lee las tablas, crea y lee su perfil, no
// ve ni crea perfiles ajenos y no borra filas). Detecta lo que pgTAP no ve: cambios hechos en el
// remoto fuera de las migraciones (design/fase-3/data-api-privilegios.md). Correr después de cada
// `supabase db push`.
//
// Uso: npm run check:data-api
// - URL y clave publicable: EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (.env).
// - Usuario de prueba confirmado y sin grupos: SPLITMATE_TEST_EMAIL (por omisión
//   prueba1@splitmate.test) y SPLITMATE_TEST_PASSWORD. Si falta la contraseña, la pide sin
//   mostrarla. Ni la contraseña ni el token se imprimen ni se guardan.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';

const TABLES = [
  'profiles',
  'groups',
  'group_members',
  'categories',
  'expenses',
  'expense_payers',
  'expense_splits',
  'transfers',
];

if (existsSync('.env')) process.loadEnvFile('.env');
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const email = process.env.SPLITMATE_TEST_EMAIL || 'prueba1@splitmate.test';
if (!url || !key) {
  console.error('Faltan EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (.env).');
  process.exit(1);
}

/** Lee una línea sin mostrarla en la terminal. */
function askHidden(label) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const done = (fn, arg) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stdout.write('\n');
      fn(arg);
    };
    function onData(chunk) {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return done(resolve, value);
        if (char === '\u0003') return done(reject, new Error('Cancelado.'));
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    }
    stdin.on('data', onData);
  });
}

async function request(method, path, { token, body, prefer } = {}) {
  const headers = { apikey: key };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(`${url}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Cuerpo vacío o no JSON: basta el estado.
  }
  return { status: response.status, json };
}

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : ` → ${detail}`}`);
};
const describe = (r) => [r.status, r.json?.code, r.json?.message].filter(Boolean).join(' ');
// PostgREST responde 401 a anon y 403 a authenticated cuando falta un privilegio o lo frena RLS.
const denied = (r) => (r.status === 401 || r.status === 403) && r.json?.code === '42501';

let password = process.env.SPLITMATE_TEST_PASSWORD;
if (!password) {
  if (!process.stdin.isTTY) {
    console.error('Falta SPLITMATE_TEST_PASSWORD y no hay terminal para pedirla.');
    process.exit(1);
  }
  password = await askHidden(`Contraseña de ${email}: `);
}

console.log('anon (solo la clave publicable)');
for (const table of TABLES) {
  const r = await request('GET', `/rest/v1/${table}?select=*&limit=1`);
  check(`no lee ${table}`, denied(r), describe(r));
}
const anonInsert = await request('POST', '/rest/v1/profiles', {
  body: { id: randomUUID(), display_name: 'Anon' },
});
check('no inserta en profiles', denied(anonInsert), describe(anonInsert));

console.log(`authenticated (${email})`);
const login = await request('POST', '/auth/v1/token?grant_type=password', {
  body: { email, password },
});
password = undefined;
const token = login.json?.access_token;
const me = login.json?.user?.id;
if (login.status !== 200 || !token || !me) {
  check('inicia sesión', false, `${login.status} ${login.json?.error_code ?? ''}`.trim());
  process.exit(1);
}

try {
  for (const table of TABLES) {
    const r = await request('GET', `/rest/v1/${table}?select=*&limit=1`, { token });
    check(`lee ${table}`, r.status === 200, describe(r));
  }
  const upsert = await request('POST', '/rest/v1/profiles?on_conflict=id', {
    token,
    body: { id: me, display_name: 'Usuario de prueba' },
    prefer: 'resolution=ignore-duplicates,return=minimal',
  });
  check('crea su perfil (upsert de la app)', upsert.status === 201, describe(upsert));
  const visible = await request('GET', '/rest/v1/profiles?select=id', { token });
  const ids = Array.isArray(visible.json) ? visible.json.map((row) => row.id) : [];
  check('lee su perfil', visible.status === 200 && ids.includes(me), describe(visible));
  check(
    'no ve perfiles ajenos (sin grupos en común)',
    visible.status === 200 && ids.every((id) => id === me),
    `ve ${ids.filter((id) => id !== me).length} perfiles ajenos`,
  );
  const foreign = await request('POST', '/rest/v1/profiles', {
    token,
    body: { id: randomUUID(), display_name: 'Ajeno' },
  });
  check('no crea un perfil ajeno', denied(foreign), describe(foreign));
  const changeId = await request('PATCH', `/rest/v1/profiles?id=eq.${me}`, {
    token,
    body: { id: randomUUID() },
  });
  check('no cambia el id de su perfil', denied(changeId), describe(changeId));
  const remove = await request('DELETE', `/rest/v1/profiles?id=eq.${me}`, { token });
  check('no borra filas', denied(remove), describe(remove));
} finally {
  await request('POST', '/auth/v1/logout?scope=local', { token });
}

console.log(failures ? `\n${failures} comprobaciones fallaron.` : '\nData API en orden.');
process.exit(failures ? 1 : 0);
