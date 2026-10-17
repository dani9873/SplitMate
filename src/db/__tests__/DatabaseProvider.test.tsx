import { act, render, screen, userEvent } from '@testing-library/react-native';
import { Text } from 'react-native';

import { changeLanguage } from '@/i18n';
import { waitForPressCooldown } from '@/test/press-cooldown';

import type { OpenedDatabase } from '../accounts';
import { DatabaseGate, useDatabase, useDatabaseSetup } from '../DatabaseProvider';
import { createTestDatabase } from '../test-utils';

function GroupCount() {
  const { repos } = useDatabase();
  return <Text>{`Grupos: ${repos.groups.list().length}`}</Text>;
}

function Harness({
  open,
  onReset,
}: {
  open: () => Promise<OpenedDatabase>;
  onReset?: () => Promise<void>;
}) {
  const database = useDatabaseSetup(open);
  return (
    <DatabaseGate database={database} onReset={onReset}>
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

  describe('reiniciar los datos de este teléfono', () => {
    async function renderBroken(
      onReset?: () => Promise<void>,
      header = 'No se pudieron abrir tus datos',
    ) {
      const opened = await openedTestDatabase();
      const open = jest
        .fn<Promise<OpenedDatabase>, []>()
        .mockRejectedValueOnce(new Error('clave perdida'))
        .mockResolvedValue(opened);
      await render(<Harness open={open} onReset={onReset} />);
      await screen.findByRole('header', { name: header });
      return open;
    }

    it('sin una acción para reiniciar, la pantalla de error no la ofrece', async () => {
      await renderBroken();
      expect(
        screen.queryByRole('button', { name: 'Reiniciar los datos de este teléfono' }),
      ).toBeNull();
    });

    it('pide dos confirmaciones, borra y vuelve a abrir una base nueva', async () => {
      const user = userEvent.setup();
      const onReset = jest.fn(async () => {});
      const open = await renderBroken(onReset);

      await user.press(
        screen.getByRole('button', { name: 'Reiniciar los datos de este teléfono' }),
      );
      expect(
        await screen.findByRole('header', { name: '¿Reiniciar los datos de este teléfono?' }),
      ).toBeOnTheScreen();
      expect(
        screen.getByText(/no se haya subido antes a la nube no se puede recuperar/),
      ).toBeOnTheScreen();
      expect(onReset).not.toHaveBeenCalled();

      await user.press(screen.getByRole('button', { name: 'Continuar' }));
      expect(
        await screen.findByRole('header', { name: '¿Seguro? No se puede deshacer' }),
      ).toBeOnTheScreen();
      expect(screen.getByText(/Lo que no se había subido no se puede recuperar/)).toBeOnTheScreen();
      expect(onReset).not.toHaveBeenCalled();

      await waitForPressCooldown();
      await user.press(screen.getByRole('button', { name: 'Borrar y reiniciar' }));
      expect(await screen.findByText('Grupos: 0')).toBeOnTheScreen();
      expect(onReset).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['la primera', 0],
      ['la segunda', 1],
    ])('cancelar en %s confirmación vuelve al error sin borrar nada', async (_name, steps) => {
      const user = userEvent.setup();
      const onReset = jest.fn(async () => {});
      const open = await renderBroken(onReset);

      await user.press(
        screen.getByRole('button', { name: 'Reiniciar los datos de este teléfono' }),
      );
      if (steps === 1) {
        await user.press(await screen.findByRole('button', { name: 'Continuar' }));
      }
      await waitForPressCooldown();
      await user.press(await screen.findByRole('button', { name: 'Cancelar' }));

      expect(
        await screen.findByRole('header', { name: 'No se pudieron abrir tus datos' }),
      ).toBeOnTheScreen();
      expect(onReset).not.toHaveBeenCalled();
      expect(open).toHaveBeenCalledTimes(1);
    });

    it('si no se pueden borrar, lo dice y deja reintentar', async () => {
      const user = userEvent.setup();
      const onReset = jest.fn().mockRejectedValue(new Error('archivo en uso'));
      const open = await renderBroken(onReset);

      await user.press(
        screen.getByRole('button', { name: 'Reiniciar los datos de este teléfono' }),
      );
      await user.press(await screen.findByRole('button', { name: 'Continuar' }));
      await waitForPressCooldown();
      await user.press(await screen.findByRole('button', { name: 'Borrar y reiniciar' }));

      expect(
        await screen.findByText(
          /No se pudieron borrar los datos de este teléfono\. Inténtalo de nuevo\./,
        ),
      ).toBeOnTheScreen();
      expect(open).toHaveBeenCalledTimes(1);
      await waitForPressCooldown();
      await user.press(screen.getByRole('button', { name: 'Reintentar' }));
      expect(await screen.findByText('Grupos: 0')).toBeOnTheScreen();
    });

    it('habla en inglés', async () => {
      await act(() => changeLanguage('en'));
      await renderBroken(async () => {}, "Couldn't open your data");
      expect(
        screen.getByRole('button', { name: 'Reset the data on this phone' }),
      ).toBeOnTheScreen();
    });
  });
});
