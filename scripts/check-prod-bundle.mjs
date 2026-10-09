// Verifica que los datos de ejemplo, solo de desarrollo, queden fuera del bundle de producción.
// Uso: npm run check:bundle          → exporta producción y exige que NO esté la marca.
//      npm run check:bundle -- --dev → exporta desarrollo y exige que SÍ esté (control).
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MARKER = 'splitmate-sample-data-v1';
// Clave que la app siempre incluye: si no aparece, la búsqueda no está funcionando.
const SANITY = 'splitmate.preferences';
const dev = process.argv.includes('--dev');

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );

const outDir = mkdtempSync(join(tmpdir(), 'splitmate-bundle-'));
try {
  execFileSync(
    'npx',
    ['expo', 'export', '--platform', 'android', '--output-dir', outDir, ...(dev ? ['--dev'] : [])],
    { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, CI: '1' } },
  );
  const bundles = walk(outDir).filter((file) => /\.(hbc|js)$/.test(file));
  const content = Buffer.concat(bundles.map((file) => readFileSync(file)));
  const hasMarker = content.includes(MARKER);
  if (!content.includes(SANITY)) {
    console.error(`No se encontró "${SANITY}" en el bundle: la verificación no es fiable.`);
    process.exitCode = 1;
  } else if (dev && !hasMarker) {
    console.error('El bundle de desarrollo debería incluir los datos de ejemplo.');
    process.exitCode = 1;
  } else if (!dev && hasMarker) {
    console.error('Los datos de ejemplo están en el bundle de producción.');
    process.exitCode = 1;
  } else {
    console.log(
      dev
        ? 'Control: el bundle de desarrollo incluye los datos de ejemplo.'
        : 'OK: los datos de ejemplo no están en el bundle de producción.',
    );
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
