// Proceso hijo del servidor de prueba (src/test/supabase-pglite.ts). PGlite carga su WASM con
// `import()` dinámico, que Jest no permite sin --experimental-vm-modules, así que corre aquí, en
// Node puro, y Jest le habla por mensajes (IPC con serialización avanzada: admite BigInt).
//
// Protocolo: el padre manda { id, op, ...datos } y recibe { id, ok: true, result } o
// { id, ok: false, error: { message, code } }. Las operaciones son init, query, createUser, rpc y
// close. El mapeo de errores de Postgres a errores de transporte lo hace el padre.
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');

const SUPABASE_DIR = path.join(__dirname, '..', '..', 'supabase');
// Las RPC que el servidor de prueba deja llamar, con el tipo SQL de cada argumento.
const RPC_SIGNATURES = {
  sync_push: { p_mutations: 'jsonb' },
  sync_pull: { p_cursors: 'jsonb', p_max_rows: 'integer' },
  sync_pull_v2: { p_cursors: 'jsonb', p_max_rows: 'integer' },
  create_invitation: { p_group_id: 'uuid', p_expires_hours: 'integer', p_max_uses: 'integer' },
  preview_invitation: { p_token: 'text' },
  accept_invitation: { p_token: 'text', p_member_id: 'uuid', p_new_member: 'jsonb' },
  revoke_invitation: { p_invitation_id: 'uuid' },
  list_invitations: { p_group_id: 'uuid' },
  leave_group: { p_group_id: 'uuid' },
  remove_access: { p_group_id: 'uuid', p_user_id: 'uuid' },
};

/** @type {import('@electric-sql/pglite').PGlite} */
let db;
let nextUser = 1;

async function init() {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(readFileSync(path.join(SUPABASE_DIR, 'pglite', 'plataforma.sql'), 'utf8'));
  const migrations = path.join(SUPABASE_DIR, 'migrations');
  for (const file of readdirSync(migrations)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    try {
      await db.exec(readFileSync(path.join(migrations, file), 'utf8'));
    } catch (error) {
      throw new Error(`La migración ${file} falló en PGlite: ${error.message}`);
    }
  }
}

async function createUser(name) {
  const n = nextUser++;
  const id = `01980000-0000-7000-8000-${String(n).padStart(12, '0')}`;
  await db.query(
    `insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
     values ($1, 'authenticated', 'authenticated', $2,
       '{"provider": "email", "providers": ["email"]}'::jsonb, $3::jsonb)`,
    [id, `${String(name).toLowerCase()}-${n}@example.com`, JSON.stringify({ display_name: name })],
  );
  await db.query(`insert into public.profiles (id, display_name) values ($1, $2)`, [id, name]);
  return id;
}

/** Una llamada a la RPC dentro de una transacción, como la API con el JWT de la cuenta. */
async function rpc({ userId, name, args }) {
  const signature = Object.hasOwn(RPC_SIGNATURES, name) ? RPC_SIGNATURES[name] : undefined;
  if (!signature) {
    throw new Error(`RPC no permitida en el servidor de prueba: ${String(name)}`);
  }
  const entries = Object.entries(args);
  if (entries.some(([key]) => !Object.hasOwn(signature, key))) {
    throw new Error('Argumento de RPC no permitido en el servidor de prueba');
  }
  const placeholders = entries.map(([key], index) => `${key} => $${index + 1}::${signature[key]}`);
  const params = entries.map(([key, value]) => {
    if (value === null || value === undefined) {
      return null;
    }
    return signature[key] === 'jsonb' ? JSON.stringify(value) : value;
  });
  // La transacción se deshace sola si algo falla; `set local` no deja el rol cambiado.
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated' }),
    ]);
    await tx.exec('set local role authenticated');
    const result = await tx.query(
      `select public.${name}(${placeholders.join(', ')}) as result`,
      params,
    );
    return result.rows[0]?.result;
  });
}

async function handle(message) {
  switch (message.op) {
    case 'init':
      return init();
    case 'query':
      return (await db.query(message.sql, message.params ?? [])).rows;
    case 'createUser':
      return createUser(message.name);
    case 'rpc':
      return rpc(message);
    case 'close':
      await db.close();
      return null;
    default:
      throw new Error(`Operación desconocida: ${String(message.op)}`);
  }
}

process.on('message', async (message) => {
  try {
    const result = await handle(message);
    process.send({ id: message.id, ok: true, result });
    if (message.op === 'close') {
      process.exit(0);
    }
  } catch (error) {
    process.send({
      id: message.id,
      ok: false,
      error: { message: String(error?.message ?? error), code: error?.code },
    });
  }
});

// Si Jest se cae o se corta, el canal se cierra y este proceso no se queda huérfano.
process.on('disconnect', () => process.exit(0));
