import { i18n } from '@/i18n';
import { money } from '@/domain';
import { formatMoney } from '@/lib/format';

import { balanceSentence } from '../balance-status';

const t = i18n.getFixedT('es');
const fmt = (value: Parameters<typeof formatMoney>[0]) =>
  formatMoney(value, 'es-419').replace(/\s/g, ' ');

describe('frase del saldo', () => {
  it('desde ti', () => {
    expect(balanceSentence(money(3000, 'USD'), 'you', fmt, t)).toBe('Te deben $30.00');
    expect(balanceSentence(money(-1250, 'USD'), 'you', fmt, t)).toBe('Debes $12.50');
    expect(balanceSentence(money(0, 'USD'), 'you', fmt, t)).toBe('Estás al día');
  });

  it('desde otro miembro, siempre con palabras y sin signo negativo', () => {
    expect(balanceSentence(money(3000, 'COP'), 'member', fmt, t)).toBe('le deben COP 30.00');
    expect(balanceSentence(money(-3000, 'COP'), 'member', fmt, t)).toBe('debe COP 30.00');
    expect(balanceSentence(money(0, 'COP'), 'member', fmt, t)).toBe('al día');
  });
});
