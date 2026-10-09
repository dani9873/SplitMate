import { act, render, screen, userEvent } from '@testing-library/react-native';
import { Text } from 'react-native';

import { changeLanguage } from '@/i18n';

import { DatabaseGate, useDatabase, useDatabaseSetup } from '../DatabaseProvider';
import type { AppDatabase } from '../repositories';
import { createTestDatabase } from '../test-utils';

function GroupCount() {
  const { repos } = useDatabase();
  return <Text>{`Grupos: ${repos.groups.list().length}`}</Text>;
}

function Harness({ open }: { open: () => Promise<AppDatabase> }) {
  const database = useDatabaseSetup(open);
  return (
    <DatabaseGate database={database}>
      <GroupCount />
    </DatabaseGate>
  );
}

describe('arranque de la base de datos', () => {
  beforeEach(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await act(() => changeLanguage('es'));
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await act(() => changeLanguage('en'));
  });

  it('muestra la app cuando la base abre bien', async () => {
    const { db } = await createTestDatabase();
    await render(<Harness open={async () => db} />);
    expect(await screen.findByText('Grupos: 0')).toBeOnTheScreen();
  });

  it('si la apertura o las migraciones fallan, muestra el error traducido y permite reintentar', async () => {
    const user = userEvent.setup();
    const { db } = await createTestDatabase();
    const open = jest
      .fn<Promise<AppDatabase>, []>()
      .mockRejectedValueOnce(new Error('migración rota'))
      .mockResolvedValueOnce(db);
    await render(<Harness open={open} />);

    expect(
      await screen.findByRole('header', { name: 'No se pudieron abrir tus datos' }),
    ).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('Grupos: 0')).toBeOnTheScreen();
    expect(open).toHaveBeenCalledTimes(2);
  });
});
