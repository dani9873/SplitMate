import type { Repositories } from '@/db/repositories';

export interface SampleLabels {
  readonly groupName: string;
  readonly you: string;
  readonly hotel: string;
  readonly dinner: string;
  readonly taxi: string;
  readonly refund: string;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Crea un grupo que ejercita todo el motor: un pagador y división por igual, dos pagadores
 * con división por partes, un gasto en euros convertido, un ingreso y una transferencia.
 */
export function createSampleGroup(repos: Repositories, labels: SampleLabels): string {
  const user = repos.users.create({ displayName: labels.you });
  const group = repos.groups.create({
    name: labels.groupName,
    currency: 'USD',
    createdBy: user.id,
    members: [
      { displayName: labels.you, userId: user.id },
      { displayName: 'Beto' },
      { displayName: 'Carla' },
      { displayName: 'Dani' },
    ],
  });
  const [me, beto, carla, dani] = repos.members.listByGroup(group.id).map((m) => m.id) as [
    string,
    string,
    string,
    string,
  ];
  const everyone = [me, beto, carla, dani];
  const date = today();

  repos.expenses.add({
    groupId: group.id,
    title: labels.hotel,
    amount: 36_000,
    currency: 'USD',
    payers: [{ memberId: me, amount: 36_000 }],
    split: { method: 'equal', participants: everyone },
    occurredOn: date,
  });
  repos.expenses.add({
    groupId: group.id,
    title: labels.dinner,
    amount: 9_550,
    currency: 'USD',
    payers: [
      { memberId: beto, amount: 6_000 },
      { memberId: carla, amount: 3_550 },
    ],
    split: {
      method: 'shares',
      shares: [
        { memberId: me, shares: 1 },
        { memberId: beto, shares: 2 },
        { memberId: carla, shares: 1 },
        { memberId: dani, shares: 1 },
      ],
    },
    occurredOn: date,
  });
  repos.expenses.add({
    groupId: group.id,
    title: labels.taxi,
    amount: 4_200,
    currency: 'EUR',
    exchangeRate: '1.0853',
    rateDate: date,
    payers: [{ memberId: dani, amount: 4_200 }],
    split: { method: 'equal', participants: [me, dani] },
    occurredOn: date,
  });
  repos.expenses.add({
    groupId: group.id,
    kind: 'income',
    title: labels.refund,
    amount: 3_000,
    currency: 'USD',
    payers: [{ memberId: me, amount: 3_000 }],
    split: { method: 'equal', participants: everyone },
    occurredOn: date,
  });
  repos.transfers.add({
    groupId: group.id,
    fromMemberId: dani,
    toMemberId: me,
    amount: 5_000,
    currency: 'USD',
    occurredOn: date,
  });
  return group.id;
}

/** Gasto aleatorio entre 1 y 200 USD, de un pagador, dividido por igual. */
export function addRandomExpense(
  repos: Repositories,
  groupId: string,
  title: string,
  random: () => number = Math.random,
): void {
  const members = repos.members.listByGroup(groupId).map((m) => m.id);
  const pick = () => members[Math.floor(random() * members.length)] as string;
  const participants = members.filter(() => random() < 0.6);
  const amount = 100 + Math.floor(random() * 19_900);
  repos.expenses.add({
    groupId,
    title,
    amount,
    currency: 'USD',
    payers: [{ memberId: pick(), amount }],
    split: { method: 'equal', participants: participants.length > 0 ? participants : [pick()] },
    occurredOn: today(),
  });
}

/** Borra con borrado lógico todos los grupos. Solo para la pantalla de desarrollo. */
export function resetSampleData(repos: Repositories): void {
  for (const group of repos.groups.list()) {
    repos.groups.remove(group.id, group.version);
  }
}
