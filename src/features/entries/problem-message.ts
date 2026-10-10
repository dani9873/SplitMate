import type { TFunction } from 'i18next';

import { currencyCode, MAX_AMOUNT_INTEGER_DIGITS, minorUnits, money, type Money } from '@/domain';

import type { EntryProblem } from './entry-form';

/** Monto máximo que admite la calculadora en una moneda, para el mensaje. */
export function maxAmount(currency: string): Money {
  const decimals = minorUnits(currencyCode(currency));
  return money((10 ** MAX_AMOUNT_INTEGER_DIGITS - 1) * 10 ** decimals, currency);
}

/** Mensaje traducido de un problema del formulario. */
export function problemMessage(
  problem: EntryProblem,
  currency: string,
  t: TFunction,
  formatMoney: (value: Money) => string,
  decimalSeparator: string,
): string {
  switch (problem.field) {
    case 'expression':
      if (problem.code === 'TOO_MANY_DECIMALS') {
        return t('entries.problems.TOO_MANY_DECIMALS', {
          count: minorUnits(currencyCode(currency)),
        });
      }
      if (problem.code === 'TOO_LARGE') {
        return t('entries.problems.TOO_LARGE', { max: formatMoney(maxAmount(currency)) });
      }
      return t(`entries.problems.${problem.code}`);
    case 'title':
      return problem.code === 'required' ? t('entries.title.required') : t('entries.title.tooLong');
    case 'rate':
      return problem.code === 'rateRequired'
        ? t('entries.currency.rateRequired')
        : t('entries.currency.rateInvalid');
    case 'transfer':
      return problem.code === 'sameMember'
        ? t('entries.transfer.sameMember')
        : t('entries.transfer.pickFrom');
    case 'payers':
      switch (problem.code) {
        case 'remaining':
          return t('entries.payer.remaining', { amount: formatMoney(problem.amount) });
        case 'excess':
          return t('entries.payer.excess', { amount: formatMoney(problem.amount) });
        case 'missingPayer':
          return t('entries.payer.pick.expense');
        case 'invalidAmount':
          return t('entries.problems.MALFORMED');
      }
      break;
    case 'split':
      switch (problem.code) {
        case 'remaining':
          return t('entries.split.remaining', { amount: formatMoney(problem.amount) });
        case 'excess':
          return t('entries.split.excess', { amount: formatMoney(problem.amount) });
        case 'percentRemaining':
        case 'percentExcess': {
          const value = (problem.basisPoints / 100).toString().replace('.', decimalSeparator);
          return problem.code === 'percentRemaining'
            ? t('entries.split.percentRemaining', { value })
            : t('entries.split.percentExcess', { value });
        }
        case 'noParticipants':
          return t('entries.split.noParticipants');
        case 'noShares':
          return t('entries.split.noShares');
        case 'percentInvalid':
          return t('entries.split.percentInvalid');
        case 'invalidAmount':
          return t('entries.problems.MALFORMED');
      }
  }
  return t('errors.unknown');
}
