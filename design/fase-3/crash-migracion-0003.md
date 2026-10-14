# La app se cerraba al entrar con sesión (2026-10-13)

## Síntoma

En el teléfono del usuario (Galaxy S24 Ultra, Android 16), con el development build `1f07df1f`:
al tocar el enlace del correo de registro, y también al entrar con correo y contraseña, Android
mostraba "Ocurrió un problema con SplitMate" y la app se cerraba. La sesión y el perfil sí
llegaban a Supabase. Con la sesión guardada, la app se cerraba en cada arranque.

## Evidencia

**logcat (buffer de crashes): 21 cierres, todos iguales**, también 4 de antes de instalar el build
nuevo (con el build anterior y el mismo JS de Metro):

```
F libc  : Fatal signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0 in tid … (mqt_v_js)
F DEBUG : Cause: null pointer dereference      x0 0000000000000000
F DEBUG :   #00 libexpo-sqlite.so (exsqlite3_clear_bindings+32)
F DEBUG :   #01 libexpo-sqlite.so (expo::NativeStatementBinding::sqlite3_clear_bindings())
F DEBUG :   #11 expo.modules.sqlite.SQLiteModule.run   ← llamada síncrona desde Hermes
```

En expo-sqlite 57.0.4, `run()` comprueba que la base esté abierta y el statement sin finalizar, y
llama a `sqlite3_reset` y `sqlite3_clear_bindings`. SQLite deja el statement en NULL, con
`SQLITE_OK`, cuando el texto preparado no tiene SQL (vacío o solo comentarios). `reset(NULL)` no
hace nada; `clear_bindings(NULL)` lee la dirección 0.

**Reproducción con `adb`, sin correos:**

- `am start -d 'splitmate://auth/callback?code=prueba'` con la app cerrada: abre el launcher del
  development build; al cargar, la app muestra "Este enlace ya no sirve" y no se cierra.
- Desde ahí, "Volver" entra a `(app)`, que abre la base de la cuenta: SIGSEGV inmediato, con la
  misma firma. La captura muestra el indicador de `DatabaseLoading`.

**Instrumentación temporal** (no versionada; cada `prepare`, `execute` y `close` de expo-sqlite en
una base aparte, con escritura síncrona). Lo último antes del cierre:

```
28  execSync         account-<id>.db  "PRAGMA key = <oculto>"
31  finalizeSync     account-<id>.db  "PRAGMA cipher_version;"        (SQLCipher presente)
34  finalizeSync     account-<id>.db  "SELECT count(*) FROM sqlite_master;"   (clave correcta)
…   migraciones 0000 a 0002, todos los trozos con SQL
112 PREPARE-SIN-SQL  account-<id>.db  "-- Custom SQL migration file, put your code below! --"
113 executeSync      (el mismo statement)        → SIGSEGV 6 ms después
```

La base cifrada no era el problema: clave, SQLCipher y las primeras migraciones funcionan en el
arranque en frío con la sesión del enlace.

## Causa

El texto ejecutado no es la migración 0003 del repo, que tiene comentarios y un `UPDATE`: es la
plantilla de `drizzle-kit generate --custom`. En la caché de Metro (`%TEMP%\metro-cache`) había una
entrada del 2026-10-11 06:25:43 con `migrations.js` así:

```text
/* babel-plugin-inline-import './0003_gastos_sin_categoria_en_otros.sql' */
var m0003 = "-- Custom SQL migration file, put your code below! --";
```

El commit con el `UPDATE` real (`02bec92`) es de las 06:27:49. `babel-plugin-inline-import`
incrustaba cada `.sql` dentro de `migrations.js`, pero Metro cachea `migrations.js` por su propio
contenido y sus opciones de transformación: no sabía que dependía del `.sql`, así que esa entrada
siguió siendo válida para las opciones que usa la app. Las pruebas de Jest no lo veían porque
migran leyendo los `.sql` del disco (`drizzle-orm/sql-js/migrator`), no `migrations.js`.

Por eso pasaba solo con sesión: la base de la cuenta es nueva, corre todas las migraciones al
abrirse, y el crash dentro de la transacción de migración la dejaba sin migrar para el siguiente
intento. Los builds de EAS que empaquetan el JS (preview, producción) parten de una caché vacía y
no tenían el problema; el development build toma el JS del Metro de la PC.

## Corrección

1. **Cada `.sql` es un módulo propio** (`scripts/sql-module.js`): Metro lo transforma con
   `scripts/metro-sql-transformer.js` (el transformador de Expo con los `.sql` como
   `module.exports = "<texto>"`) y Jest con `scripts/jest-sql-transformer.js`. Cada archivo se
   cachea por su contenido y Metro lo recarga al cambiar (comprobado: una edición del `.sql`
   aparece en el bundle en unos 2 s, sin reiniciar). Fuera `babel-plugin-inline-import`. La clave
   de caché nueva descarta las entradas viejas.
2. **Defensa:** `assertMigrationsHaveSql` (`src/db/migration-guard.ts`) revisa cada trozo antes de
   migrar. Uno sin SQL lanza `DatabaseSetupError('MIGRATION_INVALID')`: la app muestra la
   pantalla de error de la base, con reintento, en lugar de cerrarse, y no registra la migración.

## Pruebas

- `src/db/__tests__/migration-guard.test.ts`: la plantilla exacta que corrió el teléfono se
  rechaza con `MIGRATION_INVALID`; también un trozo vacío tras el último separador y una migración
  ausente. Lo que exporta `migrations.js` (el módulo de la app) es idéntico a cada `.sql` y todos
  sus trozos tienen SQL.
- `scripts/__tests__/sql-module.test.js`: el módulo exporta el texto exacto (comillas, barras,
  acentos, U+2028/U+2029) y el transformador de Metro solo cambia los `.sql`.

## Verificación en el teléfono

Con el código corregido, servido por un Metro en el puerto 8083 por USB:

- Arranque con la sesión guardada: abre "Grupos" (antes se cerraba siempre).
- `splitmate://auth/callback?code=prueba` con la app cerrada, abierta y en segundo plano: en los
  tres, "Este enlace ya no sirve — Ya tienes la sesión abierta en este teléfono", y "Volver" entra
  a Grupos. Ningún cierre en logcat.

No hace falta un build nuevo: el binario está bien y el JS lo sirve Metro. Sí hay que reiniciar
Metro con `npx expo start --dev-client --clear`: el que estaba abierto cargó la configuración de
Babel anterior.
