// Comprueba por REST, contra el proyecto de Supabase, los privilegios de la Data API: anon sin
// acceso a ninguna tabla ni RPC, y authenticated con los suyos (lee las tablas, crea y lee su
// perfil, no ve ni crea perfiles ajenos, no borra filas, ejecuta sync_pull, sync_pull_v2 y sync_push,
// lee group_access sin escribirla, no escribe en change_log, no escribe en los grupos fuera de
// sync_push y no sale ni quita el acceso a un grupo ajeno). Detecta lo que pgTAP no ve: cambios
// hechos en el remoto fuera de las migraciones (design/fase-3/data-api-privilegios.md). Correr
// después de cada `supabase db push`.
//
// Uso: npm run check:data-api
// - URL y clave publicable: EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (.env).
// - Usuario de prueba confirmado y sin grupos: SPLITMATE_TEST_EMAIL (correo real; por omisión
//   prueba1@splitmate.test, que Supabase no acepta) y SPLITMATE_TEST_PASSWORD. Si falta la contraseña, la pide sin
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
  'change_log',
  'group_access',
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
const anonPull = await request('POST', '/rest/v1/rpc/sync_pull', { body: { p_cursors: {} } });
check('no ejecuta sync_pull', denied(anonPull), describe(anonPull));
const anonPush = await request('POST', '/rest/v1/rpc/sync_push', { body: { p_mutations: [] } });
check('no ejecuta sync_push', denied(anonPush), describe(anonPush));

const anonPullV2 = await request('POST', '/rest/v1/rpc/sync_pull_v2', { body: { p_cursors: {} } });
check('no ejecuta sync_pull_v2', denied(anonPullV2), describe(anonPullV2));
const anonLeave = await request('POST', '/rest/v1/rpc/leave_group', {
  body: { p_group_id: randomUUID() },
});
check('no ejecuta leave_group', denied(anonLeave), describe(anonLeave));
const anonRemove = await request('POST', '/rest/v1/rpc/remove_access', {
  body: { p_group_id: randomUUID(), p_user_id: randomUUID() },
});
check('no ejecuta remove_access', denied(anonRemove), describe(anonRemove));

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

  const pull = await request('POST', '/rest/v1/rpc/sync_pull', { token, body: { p_cursors: {} } });
  check(
    'ejecuta sync_pull (sin grupos)',
    pull.status === 200 && Array.isArray(pull.json?.groups) && pull.json.groups.length === 0,
    describe(pull),
  );
  const push = await request('POST', '/rest/v1/rpc/sync_push', {
    token,
    body: { p_mutations: [] },
  });
  check(
    'ejecuta sync_push con una lista vacía',
    push.status === 200 && Array.isArray(push.json) && push.json.length === 0,
    describe(push),
  );
  const pullV2 = await request('POST', '/rest/v1/rpc/sync_pull_v2', {
    token,
    body: { p_cursors: {} },
  });
  check(
    'ejecuta sync_pull_v2 (sin grupos)',
    pullV2.status === 200 &&
      Array.isArray(pullV2.json?.groups) &&
      pullV2.json.groups.length === 0 &&
      Array.isArray(pullV2.json?.lost) &&
      pullV2.json.lost.length === 0,
    describe(pullV2),
  );
  const accessRead = await request('GET', '/rest/v1/group_access?select=*', { token });
  check(
    'lee group_access (vacía: no tiene grupos)',
    accessRead.status === 200 && Array.isArray(accessRead.json) && accessRead.json.length === 0,
    describe(accessRead),
  );
  const accessInsert = await request('POST', '/rest/v1/group_access', {
    token,
    body: { group_id: randomUUID(), user_id: me, role: 'owner' },
  });
  check('no inserta en group_access', denied(accessInsert), describe(accessInsert));
  const accessUpdate = await request('PATCH', `/rest/v1/group_access?user_id=eq.${me}`, {
    token,
    body: { role: 'owner' },
  });
  check('no edita group_access', denied(accessUpdate), describe(accessUpdate));
  const accessDelete = await request('DELETE', `/rest/v1/group_access?user_id=eq.${me}`, { token });
  check('no borra de group_access', denied(accessDelete), describe(accessDelete));
  const leave = await request('POST', '/rest/v1/rpc/leave_group', {
    token,
    body: { p_group_id: randomUUID() },
  });
  check('no sale de un grupo donde no tiene acceso (forbidden)', denied(leave), describe(leave));
  const removeOther = await request('POST', '/rest/v1/rpc/remove_access', {
    token,
    body: { p_group_id: randomUUID(), p_user_id: randomUUID() },
  });
  check(
    'no quita el acceso en un grupo ajeno (forbidden)',
    denied(removeOther),
    describe(removeOther),
  );
  const logInsert = await request('POST', '/rest/v1/change_log', {
    token,
    body: {
      group_id: randomUUID(),
      entity: 'group',
      entity_id: randomUUID(),
      action: 'update',
      fields: [],
      snapshot: [],
      version: 1,
      actor: me,
    },
  });
  check('no escribe en change_log', denied(logInsert), describe(logInsert));
  // Sin la guardia de sync_push respondería 23514 (CHECK del nombre); tampoco escribiría nada.
  const direct = await request('POST', '/rest/v1/groups', {
    token,
    body: { id: randomUUID(), name: '', currency: 'USD', created_by: me },
  });
  check('no escribe en groups fuera de sync_push (guardia)', denied(direct), describe(direct));
} finally {
  await request('POST', '/auth/v1/logout?scope=local', { token });
}

console.log(failures ? `\n${failures} comprobaciones fallaron.` : '\nData API en orden.');
process.exit(failures ? 1 : 0);
