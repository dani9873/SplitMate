import type { TFunction } from 'i18next';

import type { Money } from '@/domain';

export type BalanceDirection = 'owed' | 'owes' | 'settled';

export function balanceDirection(amount: Money): BalanceDirection {
  return amount.amount > 0 ? 'owed' : amount.amount < 0 ? 'owes' : 'settled';
}

/** Valor absoluto, para escribir "debe 12,00" en lugar de "debe -12,00". */
export function absolute(amount: Money): Money {
  return { amount: Math.abs(amount.amount), currency: amount.currency };
}

/**
 * Frase del saldo, desde "tú" o desde otro miembro. El sentido siempre está en las palabras,
 * no solo en el color: "Te deben 30,00 US$", "Beto debe 12,00 US$", "al día".
 */
export function balanceSentence(
  amount: Money,
  perspective: 'you' | 'member',
  formatMoney: (value: Money) => string,
  t: TFunction,
): string {
  const direction = balanceDirection(amount);
  const formatted = formatMoney(absolute(amount));
  if (perspective === 'you') {
    return direction === 'owed'
      ? t('balance.youAreOwed', { amount: formatted })
      : direction === 'owes'
        ? t('balance.youOwe', { amount: formatted })
        : t('balance.youAreSettled');
  }
  return direction === 'owed'
    ? t('balance.isOwed', { amount: formatted })
    : direction === 'owes'
      ? t('balance.owes', { amount: formatted })
      : t('balance.settled');
}
