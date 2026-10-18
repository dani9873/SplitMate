import { act, render, screen } from '@testing-library/react-native';

import type { GroupSummary } from '@/db/repositories';
import { changeLanguage } from '@/i18n';

import { GroupCard } from '../GroupCard';

const summary = (over: Record<string, unknown> = {}): GroupSummary =>
  ({
    group: {
      id: '01990000-0000-7000-8000-000000000001',
      name: 'Viaje',
      currency: 'USD',
      emoji: null,
      color: 'teal',
      archivedAt: null,
      accessLostAt: null,
      ...over,
    },
    memberCount: 3,
    myBalance: null,
    lastActivityAt: 0,
  }) as unknown as GroupSummary;

beforeEach(async () => {
  await act(() => changeLanguage('es'));
});
afterAll(async () => {
  await act(() => changeLanguage('en'));
});

describe('GroupCard', () => {
  it('un grupo con acceso no lleva marca', async () => {
    await render(<GroupCard summary={summary()} onOpen={jest.fn()} />);
    expect(screen.getByText('3 miembros · USD')).toBeOnTheScreen();
    expect(screen.queryByText(/Sin acceso/)).toBeNull();
  });

  it('un grupo sin acceso lo dice en la tarjeta y en su descripción accesible', async () => {
    await render(<GroupCard summary={summary({ accessLostAt: 5 })} onOpen={jest.fn()} />);
    expect(screen.getByText('3 miembros · USD · Sin acceso')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /Sin acceso$/ })).toBeOnTheScreen();
  });

  it('en inglés', async () => {
    await act(() => changeLanguage('en'));
    await render(<GroupCard summary={summary({ accessLostAt: 5 })} onOpen={jest.fn()} />);
    expect(screen.getByText('3 members · USD · No access')).toBeOnTheScreen();
  });
});
