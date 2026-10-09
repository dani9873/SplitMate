import { money, settle, type Balance } from '@/domain';

export interface SettlementTiming {
  readonly members: number;
  /** Mediana de las ejecuciones, en milisegundos. */
  readonly ms: number;
}

/** Saldos que suman cero con un generador fijo, para que la medición sea repetible. */
function sampleBalances(members: number): Balance[] {
  let seed = 42;
  const next = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed;
  };
  const amounts = Array.from({ length: members - 1 }, () => (next() % 200_000) - 100_000);
  amounts.push(-amounts.reduce((sum, value) => sum + value, 0));
  return amounts.map((amount, index) => ({
    memberId: `m${String(index).padStart(2, '0')}`,
    amount: money(amount, 'USD'),
  }));
}

/** Mide la liquidación exacta, forzando la DP, para cada tamaño de grupo. */
export function measureSettlement(sizes: readonly number[], runs = 3): SettlementTiming[] {
  return sizes.map((members) => {
    const balances = sampleBalances(members);
    const times: number[] = [];
    for (let run = 0; run < runs; run++) {
      const start = performance.now();
      settle(balances, { exactLimit: members });
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    return { members, ms: Math.round(times[Math.floor(times.length / 2)] ?? 0) };
  });
}
