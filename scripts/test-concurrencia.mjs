// Prueba de concurrencia real de las invitaciones (Fase 4b): dos conexiones a Postgres, cada una con
// su transacción, llaman a la vez a las RPC y se comprueba que el servidor se comporta como si
// hubieran ido una detrás de otra. pgTAP y PGlite tienen una sola conexión, así que no pueden ver
// esto; el CI la corre contra el Postgres que levanta `supabase db start`.
//
// Escenarios (cada uno en grupos y cuentas nuevos, repetidos CONCURRENCY_ROUNDS veces):
// 1. Última plaza: un enlace de 1 uso y dos cuentas lo aceptan a la vez → exactamente una entra y la
//    otra recibe { "error": "SMINV" }; use_count = 1.
// 2. Plaza para dos: un enlace de 2 usos y dos cuentas → entran las dos; use_count = 2.
// 3. La misma cuenta dos veces a la vez, con miembros nuevos distintos → las dos reciben el grupo,
//    pero se gasta un solo uso y queda un solo acceso y un solo miembro vinculado.
// 4. Revocar contra aceptar: el dueño revoca mientras una cuenta acepta → cualquier orden vale, pero el
//    resultado es coherente (entró y use_count = 1, o no entró y use_count = 0).
//
// Solo corre contra una base local y desechable: crea cuentas y grupos de prueba y no los borra. Se
// niega a conectarse a otro servidor. Nunca imprime un token.
//
// Uso: npm run test:concurrencia
//   DATABASE_URL            por omisión, el Postgres de `supabase db start`
//                           (postgresql://postgres:postgres@127.0.0.1:54322/postgres)
//   CONCURRENCY_ROUNDS      repeticiones de cada escenario (por omisión, 25)
import { randomUUID } from 'node:crypto';

import pg from 'pg';

const DEFAULT_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const url = process.env.DATABASE_URL ?? DEFAULT_URL;
const rounds = Number(process.env.CONCURRENCY_ROUNDS ?? 25);

const host = new URL(url).hostname;
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
  console.error(`Solo corre contra una base local (127.0.0.1 o localhost), no contra «${host}».`);
  process.exit(2);
}
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 500) {
  console.error('CONCURRENCY_ROUNDS debe ser un entero de 1 a 500.');
  process.exit(2);
}

/** Un UUID con la forma de un v7 (el servidor solo pide la forma de un UUID). */
const v7ish = () =>
  `0199${randomUUID().slice(4, 14)}7${randomUUID().slice(15, 19)}8${randomUUID().slice(20)}`;

const failures = [];
const fail = (scenario, round, message) => {
  failures.push(`${scenario} (ronda ${round}): ${message}`);
};

const admin = new pg.Client({ connectionString: url });
await admin.connect();

async function createUser(name) {
  const id = randomUUID();
  await admin.query(
    `insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
     values ($1, 'authenticated', 'authenticated', $2,
       '{"provider": "email", "providers": ["email"]}'::jsonb, jsonb_build_object('display_name', $3::text))`,
    [id, `conc-${id}@example.com`, name],
  );
  await admin.query('insert into public.profiles (id, display_name) values ($1, $2)', [id, name]);
  return id;
}

/** Una conexión con su transacción abierta, ya autenticada como esa cuenta. */
async function session(userId) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('begin');
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated' }),
  ]);
  await client.query('set local role authenticated');
  return client;
}

/** Corre cada acción en su propia conexión, todas a la vez, y confirma cada transacción. */
async function inParallel(actions) {
  const sessions = await Promise.all(actions.map((action) => session(action.user)));
  const results = await Promise.all(
    actions.map(async (action, index) => {
      const client = sessions[index];
      try {
        const result = await action.run(client);
        await client.query('commit');
        return { ok: true, value: result };
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        // Solo el código y la clase del error: el mensaje podría repetir un argumento.
        return { ok: false, code: error.code ?? 'sin-código' };
      }
    }),
  );
  await Promise.all(sessions.map((client) => client.end()));
  return results;
}

/** Un grupo nuevo con su dueño y un enlace con `maxUses` usos, creado con la RPC real. */
async function newGroupWithInvite(maxUses) {
  const owner = await createUser('Dueña');
  const groupId = randomUUID();
  await admin.query(
    `insert into public.groups (id, name, currency, created_by) values ($1, 'Carrera', 'USD', $2)`,
    [groupId, owner],
  );
  const [created] = await inParallel([
    {
      user: owner,
      run: async (client) =>
        (await client.query('select public.create_invitation($1, 24, $2) as r', [groupId, maxUses]))
          .rows[0].r,
    },
  ]);
  if (!created.ok) {
    throw new Error(`No se pudo crear el enlace (${created.code})`);
  }
  return { owner, groupId, token: created.value.token, invitationId: created.value.id };
}

const accept = (token) => async (client) =>
  (
    await client.query('select public.accept_invitation($1, null, $2::jsonb) as r', [
      token,
      JSON.stringify({ id: v7ish(), display_name: 'Cuenta' }),
    ])
  ).rows[0].r;

async function state(groupId, invitationId) {
  const uses = await admin.query('select use_count from private.group_invitations where id = $1', [
    invitationId,
  ]);
  const access = await admin.query(
    `select count(*)::int as n from public.group_access
     where group_id = $1 and role = 'member' and deleted_at is null`,
    [groupId],
  );
  const linked = await admin.query(
    `select count(*)::int as n from public.group_members
     where group_id = $1 and user_id is not null and role = 'member' and deleted_at is null`,
    [groupId],
  );
  return { uses: uses.rows[0].use_count, access: access.rows[0].n, linked: linked.rows[0].n };
}

const outcome = (result) =>
  !result.ok
    ? `error ${result.code}`
    : (result.value.error ?? (result.value.group_id ? 'entró' : '?'));

for (let round = 1; round <= rounds; round += 1) {
  // 1. Última plaza
  {
    const { groupId, token, invitationId } = await newGroupWithInvite(1);
    const [a, b] = [await createUser('A'), await createUser('B')];
    const results = await inParallel([
      { user: a, run: accept(token) },
      { user: b, run: accept(token) },
    ]);
    const seen = results.map(outcome).sort();
    const now = await state(groupId, invitationId);
    if (seen.join('|') !== ['SMINV', 'entró'].sort().join('|')) {
      fail(
        'Última plaza',
        round,
        `resultados ${seen.join(' y ')} (se esperaba una entrada y un SMINV)`,
      );
    }
    if (now.uses !== 1 || now.access !== 1 || now.linked !== 1) {
      fail(
        'Última plaza',
        round,
        `use_count=${now.uses}, accesos=${now.access}, vinculados=${now.linked}`,
      );
    }
  }

  // 2. Plaza para dos
  {
    const { groupId, token, invitationId } = await newGroupWithInvite(2);
    const [a, b] = [await createUser('A'), await createUser('B')];
    const results = await inParallel([
      { user: a, run: accept(token) },
      { user: b, run: accept(token) },
    ]);
    const now = await state(groupId, invitationId);
    if (!results.every((r) => outcome(r) === 'entró') || now.uses !== 2 || now.access !== 2) {
      fail(
        'Plaza para dos',
        round,
        `resultados ${results.map(outcome).join(' y ')}, use_count=${now.uses}, accesos=${now.access}`,
      );
    }
  }

  // 3. La misma cuenta dos veces a la vez
  {
    const { groupId, token, invitationId } = await newGroupWithInvite(5);
    const a = await createUser('A');
    const results = await inParallel([
      { user: a, run: accept(token) },
      { user: a, run: accept(token) },
    ]);
    const now = await state(groupId, invitationId);
    if (
      !results.every((r) => outcome(r) === 'entró') ||
      now.uses !== 1 ||
      now.access !== 1 ||
      now.linked !== 1
    ) {
      fail(
        'Misma cuenta dos veces',
        round,
        `resultados ${results.map(outcome).join(' y ')}, use_count=${now.uses}, accesos=${now.access}, vinculados=${now.linked}`,
      );
    }
  }

  // 4. Revocar contra aceptar
  {
    const { owner, groupId, token, invitationId } = await newGroupWithInvite(3);
    const a = await createUser('A');
    const results = await inParallel([
      { user: a, run: accept(token) },
      {
        user: owner,
        run: async (client) =>
          (await client.query('select public.revoke_invitation($1)', [invitationId])).rowCount,
      },
    ]);
    const now = await state(groupId, invitationId);
    const entered = outcome(results[0]) === 'entró';
    const coherent = entered
      ? now.uses === 1 && now.access === 1
      : outcome(results[0]) === 'SMINV' && now.uses === 0 && now.access === 0;
    if (!results[1].ok || !coherent) {
      fail(
        'Revocar contra aceptar',
        round,
        `aceptar=${outcome(results[0])}, revocar=${results[1].ok ? 'ok' : results[1].code}, use_count=${now.uses}, accesos=${now.access}`,
      );
    }
  }
}

await admin.end();

if (failures.length > 0) {
  console.error(`✘ ${failures.length} fallo(s) de concurrencia:`);
  for (const line of failures) {
    console.error(`  - ${line}`);
  }
  process.exit(1);
}
console.log(`✔ Concurrencia de invitaciones: 4 escenarios × ${rounds} rondas, sin diferencias`);
