# Fase 1 — Plan de implementación: motor de cálculo y base de datos local

> **Ejecución:** en la misma sesión, tarea por tarea, con TDD en `src/domain/` y la skill
> verification-before-completion antes de cerrar. Los pasos usan casillas `- [ ]`.

**Objetivo:** dominio puro y probado de dinero, división, saldos y liquidación, más una
base local cifrada con repositorios tipados y una pantalla de desarrollo fuera del bundle
de producción.

**Arquitectura:** `src/domain` no importa nada de React, Expo ni la base. `src/db` usa
Drizzle sobre una conexión síncrona: expo-sqlite con SQLCipher en la app y sql.js en las
pruebas, con las mismas migraciones. Los repositorios validan con zod y delegan los
cálculos al dominio.

**Stack:** TypeScript 6 estricto, Jest con jest-expo, fast-check 4, Drizzle ORM 0.45 y
drizzle-kit 0.31, expo-sqlite 57 con SQLCipher, expo-crypto, expo-secure-store y sql.js.

## Restricciones globales

- Montos en enteros de unidades menores. Nunca `float` para dinero.
- Toda división reparte el residuo por mayor residuo con desempate por `memberId`. La suma
  de las partes es igual al total.
- `src/domain/`: sin React ni I/O. Cobertura de 100 % en líneas, funciones y sentencias, y
  95 % o más en ramas.
- Ids UUID v7 generados en el cliente. Columnas `created_at`, `updated_at`, `deleted_at` y
  `version` en todas las tablas.
- Cero textos fijos en JSX. Los textos de la pantalla de desarrollo viven en su propio
  espacio de traducción.
- Commits pequeños en español con la línea `Co-Authored-By` acordada.
- Antes de cerrar: `npx tsc --noEmit`, `npm run lint` y `npm test -- --watchAll=false` con
  su salida visible.
- Lanzar un development build en EAS solo con expo-sqlite con SQLCipher y expo-crypto ya
  incluidos. El usuario lo aprobó.

## Mapa de archivos

| Archivo                         | Responsabilidad                                              |
| ------------------------------- | ------------------------------------------------------------ |
| `src/domain/errors.ts`          | `DomainError` y sus códigos                                  |
| `src/domain/currency.ts`        | Tabla ISO 4217 y validación de códigos                       |
| `src/domain/money.ts`           | Tipo `Money`, operaciones y lectura de texto decimal         |
| `src/domain/allocate.ts`        | Reparto por mayor residuo con `bigint`                       |
| `src/domain/split.ts`           | División de gastos y validación de pagadores                 |
| `src/domain/convert.ts`         | Tasas, conversión con redondeo bancario y partes convertidas |
| `src/domain/balances.ts`        | Saldos por miembro                                           |
| `src/domain/settlement.ts`      | Liquidación exacta y voraz                                   |
| `src/domain/index.ts`           | API pública del dominio                                      |
| `src/domain/README.md`          | Reglas de redondeo, algoritmos y complejidad                 |
| `src/lib/ids.ts`                | UUID v7                                                      |
| `src/db/schema.ts`              | Esquema Drizzle                                              |
| `src/db/migrations/`            | SQL generado y siembra de categorías                         |
| `src/db/encryption-key.ts`      | Clave de cifrado en el almacén seguro                        |
| `src/db/client.ts`              | Apertura cifrada, pragmas y migración en la app              |
| `src/db/DatabaseProvider.tsx`   | Arranque, contexto y pantalla de error con reintento         |
| `src/db/repositories/*.ts`      | Grupos, gastos, transferencias y saldos                      |
| `src/db/testing.ts`             | Base sql.js migrada para pruebas                             |
| `src/features/dev/*`            | Pantalla de desarrollo y sus textos                          |
| `app/dev.tsx`                   | Ruta que solo carga la pantalla en desarrollo                |
| `scripts/check-prod-bundle.mjs` | Verifica que la pantalla no esté en producción               |

## Tarea 1: errores, monedas y Money

**Archivos:** crear `src/domain/errors.ts`, `currency.ts`, `money.ts` y sus pruebas en
`src/domain/__tests__/`.

**Produce:**

```ts
type DomainErrorCode =
  | 'UNKNOWN_CURRENCY'
  | 'CURRENCY_MISMATCH'
  | 'INVALID_AMOUNT'
  | 'AMOUNT_OUT_OF_RANGE'
  | 'INVALID_SPLIT'
  | 'INVALID_PAYERS'
  | 'INVALID_RATE'
  | 'UNBALANCED';
class DomainError extends Error {
  readonly code: DomainErrorCode;
}

type CurrencyCode = string & { readonly __brand: 'CurrencyCode' };
function currencyCode(code: string): CurrencyCode; // lanza UNKNOWN_CURRENCY
function minorUnits(code: CurrencyCode): number;
function isKnownCurrency(code: string): code is CurrencyCode;

interface Money {
  readonly amount: number;
  readonly currency: CurrencyCode;
}
function money(amount: number, currency: string): Money; // entero seguro
function zero(currency: string): Money;
function add(a: Money, b: Money): Money;
function subtract(a: Money, b: Money): Money;
function negate(a: Money): Money;
function sum(currency: string, items: readonly Money[]): Money;
function compare(a: Money, b: Money): -1 | 0 | 1;
function equals(a: Money, b: Money): boolean;
function isZero(a: Money): boolean;
function parseMoney(input: string, currency: string): Money;
function toDecimalString(m: Money): string;
```

- [ ] **Paso 1: pruebas en rojo**

```ts
it('respeta los decimales de cada moneda', () => {
  expect(minorUnits(currencyCode('USD'))).toBe(2);
  expect(minorUnits(currencyCode('JPY'))).toBe(0);
  expect(minorUnits(currencyCode('KWD'))).toBe(3);
});
it('rechaza mezclar monedas', () => {
  expect(() => add(money(1, 'USD'), money(1, 'EUR'))).toThrow(
    expect.objectContaining({ code: 'CURRENCY_MISMATCH' }),
  );
});
it('lee texto decimal sin float', () => {
  expect(parseMoney('12.34', 'USD')).toEqual(money(1234, 'USD'));
  expect(parseMoney('1000', 'JPY')).toEqual(money(1000, 'JPY'));
  expect(() => parseMoney('1.234', 'USD')).toThrow(
    expect.objectContaining({ code: 'INVALID_AMOUNT' }),
  );
});
it('detecta desbordes', () => {
  expect(() => add(money(Number.MAX_SAFE_INTEGER, 'USD'), money(1, 'USD'))).toThrow(
    expect.objectContaining({ code: 'AMOUNT_OUT_OF_RANGE' }),
  );
});
```

- [ ] **Paso 2:** `npx jest src/domain` falla porque los módulos no existen.
- [ ] **Paso 3:** implementar. La tabla ISO 4217 es un objeto literal congelado con los
      códigos vigentes y sus decimales. `parseMoney` valida con `^-?\d+(\.\d+)?$`, completa
      decimales con ceros y convierte con `BigInt`.
- [ ] **Paso 4:** pruebas en verde, más propiedades: `add` y `subtract` son inversas y
      `toDecimalString` seguido de `parseMoney` devuelve el mismo `Money`.
- [ ] **Paso 5:** commit `feat(domain): monedas ISO 4217 y Money en unidades menores`.

## Tarea 2: reparto, división y pagadores

**Archivos:** crear `src/domain/allocate.ts`, `split.ts` y pruebas.

**Consume:** `Money`, `DomainError`. **Produce:**

```ts
type MemberId = string;
interface MemberAmount {
  readonly memberId: MemberId;
  readonly amount: number;
}

function allocate(
  total: number,
  weights: readonly { memberId: MemberId; weight: bigint }[],
): MemberAmount[];

type SplitInput =
  | { method: 'equal'; participants: readonly MemberId[] }
  | { method: 'exact'; amounts: readonly MemberAmount[] }
  | { method: 'percentage'; percentages: readonly { memberId: MemberId; basisPoints: number }[] }
  | { method: 'shares'; shares: readonly { memberId: MemberId; shares: number }[] };

function splitAmount(total: Money, input: SplitInput): MemberAmount[];
function validatePayers(total: Money, payers: readonly MemberAmount[]): MemberAmount[];
```

`allocate` devuelve las partes en el orden de entrada. El desempate usa `memberId`
ascendente, sin depender del orden recibido.

- [ ] **Paso 1: pruebas en rojo** con los cuatro ejemplos del diseño, más:

```ts
it('las partes siempre suman el total', () => {
  fc.assert(
    fc.property(arbTotal, arbParticipants, (total, ids) => {
      const parts = splitAmount(money(total, 'USD'), { method: 'equal', participants: ids });
      return parts.reduce((s, p) => s + p.amount, 0) === total;
    }),
  );
});
it('el resultado no depende del orden de los participantes', () => {
  /* barajar y comparar por memberId */
});
it('rechaza porcentajes que no suman 10 000', () => {
  /* INVALID_SPLIT */
});
it('rechaza pagadores que no suman el total o repetidos', () => {
  /* INVALID_PAYERS */
});
```

- [ ] **Paso 2:** comprobar el rojo.
- [ ] **Paso 3:** implementar `allocate` con `bigint`: cociente, residuo, sobrante
      repartido por residuo descendente y `memberId` ascendente. Los cuatro métodos se reducen
      a pesos: igual con peso 1, porcentaje con puntos básicos, partes con su número, y exacto
      validando la suma sin repartir.
- [ ] **Paso 4:** verde, incluido un monto enorme cerca de `MAX_SAFE_INTEGER`.
- [ ] **Paso 5:** commit `feat(domain): división de gastos con reparto por mayor residuo`.

## Tarea 3: conversión de monedas

**Archivos:** crear `src/domain/convert.ts` y pruebas.

**Produce:**

```ts
function parseRate(rate: string): { numerator: bigint; denominator: bigint }; // INVALID_RATE
function convert(amount: Money, to: string, rate: string): Money; // redondeo bancario
function convertParts(parts: readonly MemberAmount[], convertedTotal: Money): MemberAmount[];
```

- [ ] **Paso 1: pruebas en rojo:** 10,00 USD a 0.9214 da 9,21 EUR; 1000 JPY a USD con tasa
      0.0067 da 6,70 USD; empates exactos van al par; tasas `0`, negativas o no numéricas se
      rechazan. Propiedad: `convertParts` suma exactamente el total convertido.
- [ ] **Paso 2:** comprobar el rojo.
- [ ] **Paso 3:** implementar: `valor = amount × num × 10^dDestino / (den × 10^dOrigen)` en
      `bigint`, redondeo al par; `convertParts` llama a `allocate` con los montos originales
      como pesos.
- [ ] **Paso 4:** verde.
- [ ] **Paso 5:** commit `feat(domain): conversión de monedas con partes que suman el total`.

## Tarea 4: saldos

**Archivos:** crear `src/domain/balances.ts` y pruebas.

**Produce:**

```ts
type LedgerEntry =
  | { kind: 'expense'; payers: readonly MemberAmount[]; shares: readonly MemberAmount[] }
  | { kind: 'income'; receivers: readonly MemberAmount[]; shares: readonly MemberAmount[] }
  | { kind: 'transfer'; from: MemberId; to: MemberId; amount: number };
interface Balance {
  readonly memberId: MemberId;
  readonly amount: Money;
}
function computeBalances(
  currency: string,
  entries: readonly LedgerEntry[],
  members?: readonly MemberId[],
): Balance[];
```

Salida ordenada por `memberId`, con saldo cero para los miembros sin movimientos.

- [ ] **Paso 1: pruebas en rojo:** gasto con un pagador, gasto con dos pagadores, ingreso,
      transferencia que salda una deuda. Propiedad: con pagadores y partes aleatorios, los
      saldos suman cero.
- [ ] **Paso 2 a 4:** rojo, implementación con acumulación en `bigint`, verde.
- [ ] **Paso 5:** commit `feat(domain): saldos por miembro con varios pagadores`.

## Tarea 5: liquidación

**Archivos:** crear `src/domain/settlement.ts` y pruebas.

**Produce:**

```ts
interface Transfer {
  readonly from: MemberId;
  readonly to: MemberId;
  readonly amount: Money;
}
const EXACT_SETTLEMENT_LIMIT: number; // 20 inicial
function settle(balances: readonly Balance[], options?: { exactLimit?: number }): Transfer[];
```

- [ ] **Paso 1: pruebas en rojo:**
  - saldos que no suman cero lanzan `UNBALANCED`;
  - un solo miembro o todos en cero devuelven `[]`;
  - propiedad: aplicar las transferencias deja todos los saldos en cero;
  - propiedad: con 2 a 7 miembros, la cantidad es igual al mínimo por fuerza bruta;
  - propiedad: el resultado es idéntico al barajar la entrada;
  - por encima del límite se usan como máximo `n − 1` transferencias.
- [ ] **Paso 2:** comprobar el rojo.
- [ ] **Paso 3:** implementar la DP sobre subconjuntos con `Float64Array` para sumas e
      `Int8Array` para la mejor cantidad de subgrupos y la elección. Reconstruir la cadena,
      partir en subgrupos de suma cero y aplicar el voraz en cada uno. Ordenar la salida.
- [ ] **Paso 4:** verde, y medir en Node el tiempo con 20 miembros como referencia.
- [ ] **Paso 5:** commit `feat(domain): liquidación mínima y determinista de deudas`.

## Tarea 6: cobertura y documentación del dominio

**Archivos:** modificar `package.json` y `.github/workflows/ci.yml`. Crear
`src/domain/README.md` y `src/domain/index.ts`.

- [ ] Configurar `collectCoverageFrom` para `src/domain/**/*.ts` y `coverageThreshold` con
      100 / 100 / 100 / 95 para `./src/domain/`. Agregar `test:coverage` y usarlo en CI.
- [ ] README con el reparto del redondeo, los ejemplos, la conversión, los saldos y la
      liquidación con su complejidad.
- [ ] Commit `test(domain): cobertura exigida y documentación del motor de cálculo`.

## Tarea 7: esquema, migraciones e ids

**Archivos:** crear `drizzle.config.ts`, `src/db/schema.ts`, `src/db/migrations/*`,
`src/lib/ids.ts`, `src/db/testing.ts`. Modificar `babel.config.js`, `metro.config.js` y
`app.json`.

**Produce:** las tablas del diseño como exportaciones de `schema.ts`; `newId(): string`
con UUID v7; `createTestDatabase(): SQLJsDatabase<typeof schema>` ya migrada;
`type AppDatabase = BaseSQLiteDatabase<'sync', unknown, typeof schema>`.

- [ ] Pruebas en rojo: formato y versión de UUID v7 y orden por tiempo; la base de prueba
      migra y contiene las categorías; un CHECK rechaza una moneda inválida; una clave foránea
      rechaza un miembro de un grupo inexistente.
- [ ] Generar la migración con `npx drizzle-kit generate` y una migración personalizada
      con la siembra de categorías.
- [ ] `babel-plugin-inline-import` para `.sql`, `sql` en `sourceExts`, plugin de
      expo-sqlite con `useSQLCipher` y `android.allowBackup: false`.
- [ ] Commit `feat(db): esquema listo para sincronizar, migraciones e ids UUID v7`.

## Tarea 8: repositorios

**Archivos:** crear `src/db/repositories/{groups,expenses,transfers,balances,index,errors}.ts`
y pruebas.

**Produce:**

```ts
function createRepositories(
  db: AppDatabase,
  deps: { now(): number; newId(): string },
): {
  groups: {
    create(input): Group;
    list(): Group[];
    get(id): Group | undefined;
    rename(id, version, name): Group;
    remove(id, version): void;
  };
  members: { listByGroup(groupId): Member[] };
  expenses: {
    add(input): Expense;
    listByGroup(groupId): ExpenseWithParts[];
    remove(id, version): void;
  };
  transfers: { add(input): TransferRow; listByGroup(groupId): TransferRow[] };
  balances: { forGroup(groupId): { balances: Balance[]; settlement: Transfer[] } };
};
```

- [ ] Pruebas en rojo contra sql.js: crear grupo con miembros; gasto en la moneda del grupo
      con dos pagadores y partes; gasto en otra moneda con tasa; ingreso; transferencia;
      saldos y liquidación; entrada inválida rechazada por zod; versión vieja rechazada; borrado
      lógico excluido de listados y saldos; todo o nada si falla una inserción.
- [ ] Implementar con transacciones de Drizzle y esquemas zod.
- [ ] Commit `feat(db): repositorios tipados con validación y cálculo del dominio`.

## Tarea 9: cifrado, arranque y pantalla de error

**Archivos:** crear `src/db/encryption-key.ts`, `client.ts`, `DatabaseProvider.tsx` y
pruebas. Modificar `app/_layout.tsx` y las traducciones.

- [ ] Pruebas en rojo: la clave se crea una vez, tiene 64 caracteres hexadecimales y se
      reutiliza; si la apertura falla se muestra el error traducido con un botón de reintentar;
      reintentar vuelve a abrir y muestra la app.
- [ ] Implementar la apertura: clave cruda, verificación de `cipher_version` salvo en Expo
      Go, `foreign_keys`, WAL y migraciones. Integrar en el layout raíz antes de ocultar el
      splash.
- [ ] Commit `feat(db): base cifrada con SQLCipher y pantalla de error con reintento`.

## Tarea 10: pantalla de desarrollo fuera de producción

**Archivos:** crear `src/features/dev/*`, `app/dev.tsx`, `scripts/check-prod-bundle.mjs`.
Modificar Ajustes y CI.

- [ ] Prueba en rojo de la pantalla: crear el grupo de ejemplo muestra saldos y
      transferencias sugeridas.
- [ ] Implementar la pantalla, el acceso desde Ajustes solo con `__DEV__` y la medición
      de la liquidación con 20 miembros.
- [ ] Script que exporta el bundle de producción de Android y falla si contiene la marca
      de la pantalla. Comprobarlo también con un export de desarrollo, que sí debe contenerla.
- [ ] Commit `feat(dev): pantalla de desarrollo excluida del bundle de producción`.

## Tarea 11: build, verificación en dispositivo y cierre

- [ ] Lanzar el development build en EAS, instalarlo en el emulador y comprobar:
  - el archivo `.db` no empieza con `SQLite format 3`;
  - la pantalla de desarrollo funciona;
  - el tiempo de la liquidación con 20 miembros. Si pasa de unos 200 ms, bajar el límite,
    justificarlo y volver a medir.
- [ ] Revisión de seguridad con la skill security-code-review.
- [ ] Verificación completa con su salida, actualización de CLAUDE.md, push y PR.

## Checklist de cierre en dispositivo

- [ ] El archivo de la base en el dispositivo no es legible como SQLite plano.
- [ ] La app arranca con la base cifrada y conserva los datos al reabrirse.
- [ ] La pantalla de desarrollo crea el grupo y muestra saldos y transferencias.
- [ ] La liquidación con 20 miembros queda por debajo del límite de tiempo.
