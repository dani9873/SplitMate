# Fase 1 — Diseño: motor de cálculo y base de datos local

Aprobado el 2026-10-09, con los ajustes de la revisión incorporados.

## Objetivo

El núcleo correcto y probado de SplitMate: dinero, división, saldos y liquidación como
funciones puras, y una base de datos local cifrada, lista para sincronizar, con
repositorios tipados. Casi sin UI: solo una pantalla de desarrollo excluida del bundle de
producción.

## Dominio (`src/domain/`)

Funciones puras, sin React ni I/O, desarrolladas con TDD. Los errores son `DomainError`
con un `code` estable, para traducirlos en la UI más adelante.

### Monedas y Money

- Tabla estática ISO 4217 con los decimales de cada moneda: USD 2, JPY 0, KWD 3, etc.
- `Money = { amount, currency }`: `amount` es un entero seguro de JavaScript en unidades
  menores. Se eligió `number` sobre `bigint` porque SQLite y JSON lo manejan sin
  conversiones. Los productos intermedios que podrían desbordarse se calculan con `bigint`.
- Operaciones `add`, `subtract`, `negate`, `sum`, `compare`, `equals` e `isZero`. Fallan con
  `CURRENCY_MISMATCH` si se mezclan monedas y con `AMOUNT_OUT_OF_RANGE` si el resultado deja
  de ser un entero seguro.
- `parseMoney('12.34', 'USD')` lee texto decimal sin pasar por `float` y rechaza más
  decimales de los que admite la moneda.

### Reparto por mayor residuo

Base de toda división y conversión. Para repartir un total entre pesos:

1. Cada parte recibe la parte entera de `total × peso / suma de pesos`.
2. Las unidades sobrantes se entregan de una en una, por fracción descartada de mayor a
   menor.
3. Los empates se resuelven por `memberId` ascendente. Como los ids son UUID v7, ese orden
   coincide con el de creación y es el mismo en cualquier dispositivo.

La suma de las partes es siempre igual al total. Ejemplos:

| Caso                        | Cuotas exactas  | Resultado          |
| --------------------------- | --------------- | ------------------ |
| 10,00 USD entre 3 por igual | 333,33 cada una | 3,34 · 3,33 · 3,33 |
| 0,01 USD entre 3 por igual  | 0,33 cada una   | 0,01 · 0,00 · 0,00 |
| 10,01 USD por partes 1 y 2  | 333,67 y 667,33 | 3,34 · 6,67        |
| 1000 JPY entre 3 por igual  | 333,33 cada una | 334 · 333 · 333    |

### División de gastos

`splitAmount(total, input)` con cuatro métodos: igual, montos exactos que deben sumar el
total, porcentajes en puntos básicos que deben sumar 10 000, y partes enteras positivas.
Rechaza participantes vacíos o repetidos, valores negativos o no enteros y totales no
positivos.

### Pagadores

Un gasto tiene uno o más pagadores con su monto. La suma debe ser igual al total, sin
pagadores repetidos ni montos no positivos. La UI de fases futuras empezará con un pagador,
pero el dominio y el esquema ya admiten varios.

### Conversión de monedas

- La tasa es texto decimal positivo, por ejemplo `"0.9214"`, y se guarda con su fecha.
- `convert(money, to, rate)` calcula en `bigint` y redondea al par más cercano, es decir,
  redondeo bancario, ajustando la escala entre los decimales de ambas monedas.
- `convertParts(parts, convertedTotal)` reparte el total convertido entre las partes
  originales con el mayor residuo, usando los montos originales como pesos. Así las partes
  convertidas suman exactamente el total convertido. Se aplica a pagadores y a partes.

### Saldos

`computeBalances(currency, entries, members)` calcula, para cada miembro, lo pagado menos
lo consumido, en la moneda del grupo.

- Gasto: cada pagador suma lo que pagó y cada participante resta su parte.
- Ingreso: dinero que un miembro recibe para el grupo. Quien lo recibe resta y cada
  beneficiario suma su parte.
- Transferencia: quien paga suma y quien recibe resta.

Invariante: los saldos siempre suman cero.

### Liquidación

`settle(balances)` devuelve la lista mínima de transferencias.

- Minimizar transferencias equivale a partir el grupo en la mayor cantidad de subgrupos que
  suman cero: con `k` subgrupos hacen falta `n − k` transferencias. El problema es
  NP-difícil.
- Hasta un límite de miembros con saldo distinto de cero se resuelve exacto con
  programación dinámica sobre subconjuntos, en tiempo O(2ⁿ · n) y memoria O(2ⁿ). Dentro de
  cada subgrupo, un emparejamiento voraz liquida con `k − 1` transferencias.
- Por encima del límite, el voraz sobre el grupo completo garantiza como máximo `n − 1`.
- Límite inicial: 20. Se mide en el emulador y se baja si una ejecución con 20 miembros
  pasa de unos 200 ms, con la justificación documentada.
- Determinismo: la entrada se ordena por `memberId`, los empates del voraz se rompen por
  monto y luego por `memberId`, y la salida se ordena por pagador y receptor. Los mismos
  saldos producen las mismas transferencias, en el mismo orden, en cualquier dispositivo.

### Pruebas

Casos normales y bordes: un centavo entre tres, montos enormes, un solo miembro y monedas
sin decimales. Propiedades con fast-check: las partes suman el total, las partes
convertidas suman el total convertido, los saldos suman cero, la liquidación salda todo,
es mínima frente a fuerza bruta en grupos pequeños y es determinista ante entradas
desordenadas. Cobertura exigida en `src/domain/`: 100 % en líneas, funciones y sentencias,
y al menos 95 % en ramas.

## Base de datos local (`src/db/`)

### Cifrado

- expo-sqlite con SQLCipher activado en su plugin.
- En el primer arranque se generan 32 bytes aleatorios con expo-crypto y se guardan en
  expo-secure-store, accesibles solo en este dispositivo tras el primer desbloqueo. La
  clave se pasa como clave cruda, `PRAGMA key = "x'…'"`, sin derivación lenta.
- Al abrir se comprueba `PRAGMA cipher_version`. Un build sin SQLCipher es un error. La
  única excepción es Expo Go, que no incluye SQLCipher: ahí la base queda sin cifrar y se
  registra una advertencia, solo para desarrollo.
- La base y su WAL quedan fuera de los respaldos, porque la clave no viaja con ellos y una
  copia restaurada sería ilegible. En Android, `android.allowBackup` en `false` más reglas
  de respaldo que excluyen la carpeta `SQLite/` y la clave, por si algún día se activa el
  respaldo. En iOS, un módulo local marca la carpeta de la base con `isExcludedFromBackup`;
  así, tras restaurar el dispositivo, la app empieza con una base nueva en lugar de una
  ilegible.

**Si la clave se pierde**, por desinstalar la app, borrar sus datos o restaurarla en otro
dispositivo, la base cifrada no se puede abrir y sus datos locales son irrecuperables. La
app muestra la pantalla de error de base de datos. Hasta que exista la sincronización con
Supabase no hay copia remota. Esa fase agregará la opción de reiniciar la base local y
volver a descargar los datos.

### Esquema

Tablas: `users`, `groups`, `group_members`, `categories`, `expenses`, `expense_payers`,
`expense_splits` y `transfers`.

- Columnas de sincronización en todas: `id` UUID v7 generado en el cliente, `created_at` y
  `updated_at` en milisegundos UTC, `deleted_at` para borrado lógico y `version` para
  bloqueo optimista.
- Integridad en la base: NOT NULL por defecto, CHECK de moneda con tres letras mayúsculas,
  montos positivos, tipos y métodos permitidos, y transferencias entre miembros distintos.
  Claves foráneas con `ON DELETE RESTRICT` y `PRAGMA foreign_keys = ON`. Índices parciales
  `WHERE deleted_at IS NULL` y unicidad de miembro por gasto en pagadores y partes.
- Los gastos guardan el monto original, su moneda, el monto en la moneda del grupo, la tasa
  como texto y su fecha. Pagadores y partes guardan ambos montos ya convertidos, para que
  los saldos se lean sin recalcular conversiones.
- Las fechas de gasto son `YYYY-MM-DD`. Las marcas de tiempo son enteros en milisegundos.
- Las categorías predefinidas son filas con ids fijos y clave de traducción, sembradas en
  una migración. Las personalizadas tienen nombre libre y grupo.

### Migraciones

drizzle-kit genera SQL versionado en `src/db/migrations`. La app aplica las migraciones
antes de ocultar el splash. Si fallan, o si la base no se puede abrir, muestra una pantalla
de error traducida con la opción de reintentar.

### Repositorios

Reciben la conexión de Drizzle, un reloj y un generador de ids. Validan la entrada con
zod, usan el dominio para dividir, convertir y liquidar, y escriben cada gasto con sus
pagadores y partes en una transacción. Las actualizaciones exigen la `version` esperada y
fallan con un error de concurrencia si cambió. Ningún componente escribe SQL.

Las pruebas corren contra SQLite real con sql.js y aplican las mismas migraciones.

## Pantalla de desarrollo

Ruta `/dev`, accesible desde Ajustes solo en desarrollo. Crea un grupo de ejemplo con
varios pagadores, división por partes, un gasto en otra moneda, un ingreso y una
transferencia. Agrega gastos aleatorios, muestra saldos y transferencias sugeridas con
consultas reactivas, mide la liquidación con 20 miembros y permite reiniciar.

Queda **fuera del bundle de producción**. La ruta carga la pantalla solo dentro de
`if (__DEV__)`, que Metro elimina al compilar para producción, y sus textos viven en un
espacio de traducción propio dentro del módulo. Un script exporta el bundle de producción
y falla si encuentra una marca de la pantalla. Ese script corre en CI.

## Fuera de alcance

Formularios de gastos, sincronización con Supabase, autenticación y obtención automática
de tasas de cambio.
