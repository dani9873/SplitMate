import { act, render, screen, userEvent } from '@testing-library/react-native';
import { Text } from 'react-native';

import { changeLanguage } from '@/i18n';

import type { OpenedDatabase } from '../accounts';
import { DatabaseGate, useDatabase, useDatabaseSetup } from '../DatabaseProvider';
import { createTestDatabase } from '../test-utils';

function GroupCount() {
  const { repos } = useDatabase();
  return <Text>{`Grupos: ${repos.groups.list().length}`}</Text>;
}

function Harness({ open }: { open: () => Promise<OpenedDatabase> }) {
  const database = useDatabaseSetup(open);
  return (
    <DatabaseGate database={database}>
      <GroupCount />
    </DatabaseGate>
  );
}

async function openedTestDatabase() {
  const { db } = await createTestDatabase();
  return { db, close: jest.fn() };
}

describe('arranque de la base de datos', () => {
  beforeEach(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await act(() => changeLanguage('es'));
  });

  afterEach(async () => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    await act(() => changeLanguage('en'));
  });

  it('muestra la app cuando la base abre bien', async () => {
    const opened = await openedTestDatabase();
    await render(<Harness open={async () => opened} />);
    expect(await screen.findByText('Grupos: 0')).toBeOnTheScreen();
  });

  it('si la apertura o las migraciones fallan, muestra el error traducido y permite reintentar', async () => {
    const user = userEvent.setup();
    const opened = await openedTestDatabase();
    const open = jest
      .fn<Promise<OpenedDatabase>, []>()
      .mockRejectedValueOnce(new Error('migración rota'))
      .mockResolvedValueOnce(opened);
    await render(<Harness open={open} />);

    expect(
      await screen.findByRole('header', { name: 'No se pudieron abrir tus datos' }),
    ).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('Grupos: 0')).toBeOnTheScreen();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('cierra la base al desmontar, después de que las pantallas terminan', async () => {
    jest.useFakeTimers();
    const opened = await openedTestDatabase();
    const { unmount } = await render(<Harness open={async () => opened} />);
    expect(await screen.findByText('Grupos: 0')).toBeOnTheScreen();

    await act(async () => unmount());
    expect(opened.close).not.toHaveBeenCalled();
    await act(async () => jest.runOnlyPendingTimers());
    expect(opened.close).toHaveBeenCalledTimes(1);
  });

  it('si la base termina de abrir después de desmontar, la cierra', async () => {
    const opened = await openedTestDatabase();
    let finish: (value: OpenedDatabase) => void = () => {};
    const open = () => new Promise<OpenedDatabase>((resolve) => (finish = resolve));
    const { unmount } = await render(<Harness open={open} />);

    await act(async () => unmount());
    await act(async () => finish(opened));
    expect(opened.close).toHaveBeenCalledTimes(1);
  });
});
