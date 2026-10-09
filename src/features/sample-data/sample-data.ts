import type { TFunction } from 'i18next';

import type { Repositories } from '@/db/repositories';
import { addDays, today, type CalendarDate } from '@/lib/calendar-date';

/** Marca única: `npm run check:bundle` falla si aparece en el bundle de producción. */
export const SAMPLE_DATA_MARKER = 'splitmate-sample-data-v1';

type SampleT = TFunction<'sampleData'>;

/**
 * Crea tres grupos realistas en el idioma activo, para probar la app y tomar capturas:
 * un viaje en USD con gastos en COP convertidos, varios pagadores, un ingreso y una
 * transferencia; un apartamento en COP con porcentajes y montos exactos; y un cumpleaños
 * en EUR ya archivado. El usuario local es el primer miembro de cada grupo.
 */
export function createSampleData(
  repos: Repositories,
  t: SampleT,
  on: CalendarDate = today(),
): string[] {
  const category = (key: string) => repos.categories.list().find((c) => c.key === key)?.id;
  const day = (offset: number) => addDays(on, -offset);

  return repos.changes.batch(() => {
    const me = repos.profile.ensure('Ana');
    const trip = repos.groups.create({
      name: t('trip.name'),
      currency: 'USD',
      emoji: '🏖️',
      color: 'coral',
      createdBy: me.id,
      members: [
        { displayName: me.displayName, userId: me.id },
        { displayName: 'Beto' },
        { displayName: 'Carla' },
        { displayName: 'Dani' },
      ],
    });
    const [ana, beto, carla, dani] = repos.members.listByGroup(trip.id).map((m) => m.id) as [
      string,
      string,
      string,
      string,
    ];
    const everyone = [ana, beto, carla, dani];
    repos.expenses.add({
      groupId: trip.id,
      title: t('trip.hotel'),
      amount: 48_000,
      currency: 'USD',
      payers: [{ memberId: ana, amount: 48_000 }],
      split: { method: 'equal', participants: everyone },
      categoryId: category('lodging'),
      occurredOn: day(4),
    });
    repos.expenses.add({
      groupId: trip.id,
      title: t('trip.dinner'),
      amount: 13_550,
      currency: 'USD',
      payers: [
        { memberId: beto, amount: 8_000 },
        { memberId: carla, amount: 5_550 },
      ],
      split: {
        method: 'shares',
        shares: [
          { memberId: ana, shares: 1 },
          { memberId: beto, shares: 2 },
          { memberId: carla, shares: 1 },
          { memberId: dani, shares: 1 },
        ],
      },
      categoryId: category('food'),
      occurredOn: day(3),
    });
    repos.expenses.add({
      groupId: trip.id,
      title: t('trip.boat'),
      amount: 720_000_00,
      currency: 'COP',
      exchangeRate: '0.00025',
      rateDate: day(2),
      payers: [{ memberId: dani, amount: 720_000_00 }],
      split: { method: 'equal', participants: everyone },
      categoryId: category('entertainment'),
      occurredOn: day(2),
    });
    repos.expenses.add({
      groupId: trip.id,
      kind: 'income',
      title: t('trip.refund'),
      amount: 6_000,
      currency: 'USD',
      payers: [{ memberId: ana, amount: 6_000 }],
      split: { method: 'equal', participants: everyone },
      categoryId: category('lodging'),
      occurredOn: day(1),
    });
    repos.expenses.add({
      groupId: trip.id,
      title: t('trip.taxi'),
      amount: 2_400,
      currency: 'USD',
      payers: [{ memberId: carla, amount: 2_400 }],
      split: {
        method: 'exact',
        amounts: [
          { memberId: ana, amount: 600 },
          { memberId: beto, amount: 600 },
          { memberId: carla, amount: 1_200 },
        ],
      },
      categoryId: category('transport'),
      occurredOn: day(0),
    });
    repos.transfers.add({
      groupId: trip.id,
      fromMemberId: beto,
      toMemberId: ana,
      amount: 5_000,
      currency: 'USD',
      occurredOn: day(0),
    });

    const home = repos.groups.create({
      name: t('home.name'),
      currency: 'COP',
      emoji: '🏠',
      color: 'teal',
      createdBy: me.id,
      members: [
        { displayName: me.displayName, userId: me.id },
        { displayName: 'Lucía' },
        { displayName: 'Mateo' },
      ],
    });
    const [ana2, lucia, mateo] = repos.members.listByGroup(home.id).map((m) => m.id) as [
      string,
      string,
      string,
    ];
    repos.expenses.add({
      groupId: home.id,
      title: t('home.rent'),
      amount: 2_400_000_00,
      currency: 'COP',
      payers: [{ memberId: ana2, amount: 2_400_000_00 }],
      split: {
        method: 'percentage',
        percentages: [
          { memberId: ana2, basisPoints: 4_000 },
          { memberId: lucia, basisPoints: 3_000 },
          { memberId: mateo, basisPoints: 3_000 },
        ],
      },
      categoryId: category('lodging'),
      occurredOn: day(6),
    });
    repos.expenses.add({
      groupId: home.id,
      title: t('home.groceries'),
      amount: 385_400_00,
      currency: 'COP',
      payers: [{ memberId: lucia, amount: 385_400_00 }],
      split: { method: 'equal', participants: [ana2, lucia, mateo] },
      categoryId: category('groceries'),
      occurredOn: day(2),
    });
    repos.expenses.add({
      groupId: home.id,
      title: t('home.utilities'),
      amount: 210_000_00,
      currency: 'COP',
      payers: [{ memberId: mateo, amount: 210_000_00 }],
      split: { method: 'equal', participants: [ana2, lucia, mateo] },
      categoryId: category('utilities'),
      occurredOn: day(1),
    });

    const party = repos.groups.create({
      name: t('party.name'),
      currency: 'EUR',
      emoji: '🎂',
      color: 'plum',
      createdBy: me.id,
      members: [
        { displayName: me.displayName, userId: me.id },
        { displayName: 'Sofi' },
        { displayName: 'Tomás' },
      ],
    });
    const [ana3, , tomas] = repos.members.listByGroup(party.id).map((m) => m.id) as [
      string,
      string,
      string,
    ];
    repos.expenses.add({
      groupId: party.id,
      title: t('party.cake'),
      amount: 4_500,
      currency: 'EUR',
      payers: [{ memberId: tomas, amount: 4_500 }],
      split: { method: 'equal', participants: [ana3, tomas] },
      categoryId: category('food'),
      occurredOn: day(30),
    });
    repos.expenses.add({
      groupId: party.id,
      title: t('party.gift'),
      amount: 6_000,
      currency: 'EUR',
      payers: [{ memberId: ana3, amount: 6_000 }],
      split: { method: 'equal', participants: [ana3, tomas] },
      categoryId: category('shopping'),
      occurredOn: day(31),
    });
    repos.transfers.add({
      groupId: party.id,
      fromMemberId: tomas,
      toMemberId: ana3,
      amount: 750,
      currency: 'EUR',
      occurredOn: day(29),
    });
    repos.groups.archive(party.id, 1);

    return [trip.id, home.id, party.id];
  });
}
