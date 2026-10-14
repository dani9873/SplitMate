// Corre en la PC, sin Docker, lo mismo que el job "Base de datos y RLS" del CI: aplica
// supabase/migrations sobre PGlite (Postgres en WASM, con lo mínimo de la plataforma de Supabase de
// supabase/tests/pglite/plataforma.sql) y ejecuta las pruebas pgTAP de supabase/tests/database.
// El CI (supabase test db, Postgres 17) sigue siendo la fuente de verdad: PGlite es Postgres 18.
//
// Uso: npm run test:db:local [-- 007 008]  (sin argumentos corre todos; 000-setup corre siempre)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { pgtap } from '@electric-sql/pglite-pgtap';

const MIGRATIONS = 'supabase/migrations';
const TESTS = 'supabase/tests/database';
const PLATFORM = 'supabase/tests/pglite/plataforma.sql';

const only = process.argv.slice(2);
const sqlFiles = (dir, suffix) =>
  readdirSync(dir)
    .filter((file) => file.endsWith(suffix))
    .sort();

const db = await PGlite.create({ extensions: { pgtap } });
await db.exec(readFileSync(PLATFORM, 'utf8'));
for (const file of sqlFiles(MIGRATIONS, '.sql')) {
  try {
    await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  } catch (error) {
    console.error(`✘ La migración ${file} falló: ${error.message}`);
    process.exit(1);
  }
}
// Como pg_prove en Supabase: las funciones de pgTAP se llaman sin esquema.
await db.exec('set search_path to "$user", public, extensions');

/** Líneas TAP que devolvió cada consulta del archivo: "ok 1 - ...", "not ok 2 - ...", "# ...". */
function tapLines(results) {
  return results
    .flatMap((result) => result.rows.flatMap((row) => Object.values(row)))
    .filter((value) => typeof value === 'string')
    .flatMap((value) => value.split('\n'));
}

let passed = 0;
let failedFiles = 0;
for (const file of sqlFiles(TESTS, '.test.sql')) {
  if (only.length > 0 && !file.startsWith('000') && !only.some((name) => file.includes(name))) {
    continue;
  }
  let lines;
  try {
    lines = tapLines(await db.exec(readFileSync(join(TESTS, file), 'utf8')));
  } catch (error) {
    failedFiles += 1;
    console.log(`✘ ${file}: ${error.message}`);
    await db.exec('rollback; reset role');
    await db.exec('discard temp');
    continue;
  }
  // pgTAP guarda su estado en tablas temporales: sin esto, el archivo siguiente "planea dos veces".
  await db.exec('discard temp');

  const plan = lines.find((line) => /^1\.\.\d+$/.test(line));
  const ok = lines.filter((line) => /^ok \d+/.test(line)).length;
  const notOk = lines.filter((line) => /^not ok \d+/.test(line));
  const planned = plan ? Number(plan.slice(3)) : null;
  const problems = lines.filter((line) => line.startsWith('#'));
  passed += ok;
  if (notOk.length > 0 || planned !== ok) {
    failedFiles += 1;
    console.log(`✘ ${file}: ${ok} de ${planned ?? '?'}`);
    for (const line of [...notOk, ...problems]) {
      console.log(`    ${line}`);
    }
  } else {
    console.log(`✔ ${file}: ${ok}`);
  }
}

await db.close();
console.log(
  failedFiles > 0
    ? `\n${failedFiles} archivos con fallas; ${passed} pruebas en verde.`
    : `\n${passed} pruebas en verde.`,
);
process.exit(failedFiles > 0 ? 1 : 0);
