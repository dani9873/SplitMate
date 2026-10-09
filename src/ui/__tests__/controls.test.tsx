import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';

import { changeLanguage } from '@/i18n';

import { Calendar } from '../Calendar';
import { Checkbox } from '../Checkbox';
import { Chip } from '../Chip';
import { Keypad } from '../Keypad';
import { SegmentedControl } from '../SegmentedControl';
import { ErrorState, LoadingState } from '../States';
import { Stepper } from '../Stepper';
import { Toast } from '../Toast';

beforeEach(async () => {
  await act(() => changeLanguage('es'));
});

afterAll(async () => {
  await act(() => changeLanguage('en'));
});

describe('Keypad', () => {
  it('envía cada tecla con su nombre accesible', async () => {
    const user = userEvent.setup();
    const onKey = jest.fn();
    await render(<Keypad onKey={onKey} decimalSeparator="," allowDecimal />);

    for (const name of [
      '7',
      'más',
      'por',
      'dividido entre',
      'menos',
      'coma decimal',
      'borrar',
      'igual',
      'Listo',
    ]) {
      await user.press(screen.getByRole('button', { name }));
    }
    expect(onKey.mock.calls.map(([key]) => key)).toEqual([
      '7',
      '+',
      '*',
      '/',
      '-',
      '.',
      'back',
      'equals',
      'done',
    ]);
    expect(screen.getByText(',')).toBeOnTheScreen();
  });

  it('mantener borrar, o su acción accesible, borra todo', async () => {
    const onKey = jest.fn();
    await render(<Keypad onKey={onKey} decimalSeparator="." allowDecimal />);
    const back = screen.getByRole('button', { name: 'borrar' });
    await fireEvent(back, 'longPress');
    await fireEvent(back, 'accessibilityAction', { nativeEvent: { actionName: 'longpress' } });
    expect(onKey.mock.calls).toEqual([['clear'], ['clear']]);
  });

  it('no ofrece la tecla decimal en monedas sin decimales', async () => {
    await render(<Keypad onKey={jest.fn()} decimalSeparator="." allowDecimal={false} />);
    expect(screen.queryByRole('button', { name: 'coma decimal' })).toBeNull();
  });
});

describe('SegmentedControl', () => {
  it('se anuncia como pestañas y marca la elegida', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    await render(
      <SegmentedControl
        label="Tipo"
        value="expense"
        onChange={onChange}
        segments={[
          { value: 'expense', label: 'Gasto' },
          { value: 'income', label: 'Ingreso' },
        ]}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Gasto' })).toBeSelected();
    expect(screen.getByRole('tab', { name: 'Ingreso' })).not.toBeSelected();
    await user.press(screen.getByRole('tab', { name: 'Ingreso' }));
    expect(onChange).toHaveBeenCalledWith('income');
  });
});

describe('Calendar', () => {
  it('lee cada día con la fecha completa, marca hoy y cambia de mes', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    await render(
      <Calendar
        value="2026-10-09"
        today="2026-10-12"
        onChange={onChange}
        locale="es"
        weekStartsOn={1}
      />,
    );
    expect(screen.getByRole('header', { name: 'octubre de 2026' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'viernes, 9 de octubre de 2026' })).toBeSelected();
    await user.press(screen.getByRole('button', { name: 'lunes, 12 de octubre de 2026, hoy' }));
    expect(onChange).toHaveBeenCalledWith('2026-10-12');

    await user.press(screen.getByRole('button', { name: 'Mes siguiente' }));
    expect(screen.getByRole('header', { name: 'noviembre de 2026' })).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Mes anterior' }));
    await user.press(screen.getByRole('button', { name: 'Mes anterior' }));
    expect(screen.getByRole('header', { name: 'septiembre de 2026' })).toBeOnTheScreen();
  });

  it('cruza el año al cambiar de mes', async () => {
    const user = userEvent.setup();
    await render(
      <Calendar
        value="2026-12-20"
        today="2026-12-20"
        onChange={jest.fn()}
        locale="en-US"
        weekStartsOn={0}
      />,
    );
    await user.press(screen.getByRole('button', { name: 'Mes siguiente' }));
    expect(screen.getByRole('header', { name: 'January 2027' })).toBeOnTheScreen();
  });
});

describe('Stepper', () => {
  it('suma y resta dentro de sus límites, también como control ajustable', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    await render(<Stepper value={1} onChange={onChange} label="partes de Beto" min={1} max={3} />);
    expect(screen.getByRole('button', { name: 'Restar a partes de Beto' })).toBeDisabled();
    await user.press(screen.getByRole('button', { name: 'Sumar a partes de Beto' }));
    expect(onChange).toHaveBeenLastCalledWith(2);
    await fireEvent(
      screen.getByRole('adjustable', { name: 'partes de Beto' }),
      'accessibilityAction',
      {
        nativeEvent: { actionName: 'increment' },
      },
    );
    expect(onChange).toHaveBeenLastCalledWith(2);
  });
});

describe('Checkbox y Chip', () => {
  it('la casilla alterna su estado', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    await render(<Checkbox checked={false} onChange={onChange} label="Beto" />);
    const box = screen.getByRole('checkbox', { name: 'Beto' });
    expect(box).not.toBeChecked();
    await user.press(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('el chip elegido se anuncia como seleccionado', async () => {
    await render(<Chip label="Comida" selected onPress={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Comida' })).toBeSelected();
  });
});

describe('Toast y estados', () => {
  it('el aviso ofrece su acción y cerrar', async () => {
    const user = userEvent.setup();
    const onAction = jest.fn();
    const onDismiss = jest.fn();
    await render(
      <Toast
        message="Gasto borrado"
        actionLabel="Deshacer"
        onAction={onAction}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Gasto borrado');
    await user.press(screen.getByRole('button', { name: 'Deshacer' }));
    await user.press(screen.getByRole('button', { name: 'Cerrar aviso' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('la carga se anuncia y el error permite reintentar', async () => {
    const user = userEvent.setup();
    const onRetry = jest.fn();
    await render(<LoadingState />);
    expect(screen.getByRole('progressbar', { name: 'Cargando' })).toBeOnTheScreen();
    await render(<ErrorState onRetry={onRetry} />);
    await user.press(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
