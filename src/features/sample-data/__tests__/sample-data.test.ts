import { createTestRepositories } from '@/db/test-utils';
import { i18n } from '@/i18n';

import en from '../locales/en.json';
import es from '../locales/es.json';
import { createSampleData } from '../sample-data';
import '../i18n';

type Tree = { [key: string]: string | Tree };
const keys = (tree: Tree, prefix = ''): string[] =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : keys(value, `${prefix}${key}.`),
  );

describe('datos de ejemplo', () => {
  it('tienen las mismas claves en español e inglés', () => {
    expect(keys(es).sort()).toEqual(keys(en).sort());
  });

  it('crean tres grupos coherentes en el idioma activo, con avisos agrupados', async () => {
    const ctx = await createTestRepositories();
    const listener = jest.fn();
    ctx.bus.subscribe(listener);
    const t = i18n.getFixedT('es', 'sampleData');

    const [trip, home, party] = createSampleData(ctx.repos, t, '2026-10-09');

    expect(listener).toHaveBeenCalledTimes(1);
    const summaries = ctx.repos.groups.listSummaries();
    expect(summaries.map((s) => [s.group.name, s.group.archivedAt === null])).toEqual([
      ['Apartamento', true],
      ['Viaje a Cartagena', true],
      ['Cumpleaños de Sofi', false],
    ]);
    for (const id of [trip, home, party] as string[]) {
      const { balances } = ctx.repos.balances.forGroup(id);
      expect(balances.reduce((sum, b) => sum + b.amount.amount, 0)).toBe(0);
    }
    expect(ctx.repos.balances.forGroup(party as string).settlement).toEqual([]);
    expect(ctx.repos.activity.list({ groupId: trip as string })).toHaveLength(6);
    const boat = ctx.repos.activity
      .list({ groupId: trip as string })
      .find((item) => item.kind === 'expense' && item.title === 'Tour en lancha a las islas');
    expect(boat).toMatchObject({
      amount: { amount: 72_000_000, currency: 'COP' },
      groupAmount: { amount: 18_000, currency: 'USD' },
    });
  });
});
