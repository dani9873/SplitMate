# Dominio

Lógica pura de SplitMate: dinero, división de gastos, conversión de monedas, saldos y
liquidación de deudas. Sin React, sin I/O y sin dependencias de la plataforma. Se
desarrolla con TDD y CI exige 100 % de cobertura en líneas, funciones y sentencias, y al
menos 95 % en ramas.

Los errores son `DomainError` con un `code` estable, como `CURRENCY_MISMATCH` o
`INVALID_SPLIT`, para traducirlos en la UI sin depender del mensaje.

## Dinero

- `Money` es `{ amount, currency }`. `amount` es un entero seguro de JavaScript en unidades
  menores: 1234 USD son 12,34 dólares y 1234 JPY son 1234 yenes.
- `currency.ts` contiene las 155 monedas vigentes de ISO 4217 con sus decimales, generadas
  desde la lista oficial de SIX publicada el 2026-09-17.
- Las operaciones fallan si se mezclan monedas o si el resultado deja de ser un entero
  seguro. Los productos intermedios se calculan con `bigint`.
- `parseMoney('12.34', 'USD')` y `toDecimalString` convierten desde y hacia texto decimal
  sin pasar nunca por `float`.

## Reparto del redondeo

Toda división, y toda conversión de partes, pasa por `allocate`, que usa el método del
mayor residuo:

1. Cada miembro recibe la parte entera de `total × peso / suma de pesos`.
2. Las unidades que sobran se entregan de una en una, empezando por quien perdió la mayor
   fracción al truncar.
3. Si dos fracciones son iguales, gana el `memberId` menor en orden binario. Los ids son
   UUID v7, así que ese orden coincide con el de creación y es el mismo en cualquier
   dispositivo, sin importar el orden en que lleguen los datos.

La suma de las partes es siempre exactamente el total. Ejemplo, 10,01 USD por partes 1 y 2:

```
total en unidades menores    1001
cuota exacta de a            1001 × 1 / 3 = 333,67  → parte entera 333, fracción 0,67
cuota exacta de b            1001 × 2 / 3 = 667,33  → parte entera 667, fracción 0,33
sobrante                     1001 − 333 − 667 = 1   → va a a, que tiene la mayor fracción
resultado                    a 3,34 · b 6,67
```

Otros casos:

| Caso                        | Resultado          |
| --------------------------- | ------------------ |
| 10,00 USD entre 3 por igual | 3,34 · 3,33 · 3,33 |
| 0,01 USD entre 3 por igual  | 0,01 · 0,00 · 0,00 |
| 1000 JPY entre 3 por igual  | 334 · 333 · 333    |

En el primero, el centavo sobrante va a quien tenga el `memberId` menor, porque las tres
fracciones empatan.

## División de gastos

`splitAmount(total, input)` admite cuatro métodos. Todos se reducen a pesos para `allocate`:

| Método       | Entrada                                 | Pesos                   |
| ------------ | --------------------------------------- | ----------------------- |
| `equal`      | participantes                           | 1 para cada uno         |
| `shares`     | partes enteras positivas                | las partes              |
| `percentage` | puntos básicos, 1 % = 100, suman 10 000 | los puntos básicos      |
| `exact`      | montos que suman el total               | sin reparto: se validan |

`validatePayers` exige uno o más pagadores, sin repetir, con montos positivos que sumen el
total.

## Conversión de monedas

- La tasa es texto decimal positivo, por ejemplo `"0.9214"`, leído como fracción exacta.
- `convert` calcula `monto × tasa × 10^decimales destino / 10^decimales origen` en `bigint` y
  redondea al entero más cercano. Los empates exactos van al par, es decir, redondeo
  bancario, para no sesgar los totales hacia arriba.
- `convertParts` no convierte cada parte por separado, porque los redondeos podrían no sumar
  el total. Reparte el total ya convertido con `allocate`, usando las partes originales
  como pesos, así que las partes convertidas suman exactamente el total convertido.

## Saldos

`computeBalances` calcula para cada miembro lo pagado menos lo consumido, en la moneda del
grupo:

- **Gasto:** cada pagador suma lo que adelantó y cada participante resta su parte.
- **Ingreso:** quien recibe el dinero resta, porque guarda dinero del grupo, y cada
  beneficiario suma su parte.
- **Transferencia:** quien paga suma y quien recibe resta.

Los saldos siempre suman cero. Un saldo positivo significa que el grupo le debe al miembro.

## Liquidación

`settle` propone la lista mínima de transferencias que deja todos los saldos en cero.

**Idea.** Si los `n` miembros con saldo se pueden partir en `k` subgrupos disjuntos que
suman cero, bastan `n − k` transferencias: cada subgrupo de tamaño `m` se liquida con
`m − 1`. Minimizar transferencias equivale a maximizar `k`, un problema NP-difícil.

**Algoritmo exacto.** Programación dinámica sobre subconjuntos de los miembros con saldo:

```
best[vacío] = 0
best[S] = max sobre i ∈ S de best[S \ {i}]  +  (1 si la suma de S es 0, si no 0)
```

`best[todos]` es el máximo de subgrupos. Para obtenerlos, se recorre la cadena óptima
quitando un miembro a la vez y se corta cada vez que la suma vuelve a cero. Cada subgrupo se
liquida con el voraz de abajo.

- Tiempo: O(2ⁿ · n). Memoria: O(2ⁿ), con tablas tipadas.
- Se aplica hasta `EXACT_SETTLEMENT_LIMIT` miembros con saldo distinto de cero.

**Voraz.** Empareja al mayor deudor con el mayor acreedor, transfiere el menor de los dos
montos y repite. Usa como máximo `n − 1` transferencias. Se usa dentro de cada subgrupo y,
como respaldo, sobre el grupo completo cuando se supera el límite o cuando las sumas
dejarían de ser exactas en punto flotante.

**Determinismo.** La entrada se ordena por `memberId`, los empates del voraz se rompen por
monto y luego por `memberId`, y la salida se ordena por pagador y receptor. Los mismos
saldos producen las mismas transferencias, en el mismo orden, en cualquier dispositivo.

**Límite.** El valor de `EXACT_SETTLEMENT_LIMIT` sale de medir la DP en un emulador
Android con Hermes; la medición y su justificación están en el comentario de la constante.
