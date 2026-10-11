import { act, render, screen, userEvent } from '@testing-library/react-native';
import { registerCSS, setupAllComponents } from 'react-native-css-interop/test';

import { changeLanguage } from '@/i18n';

import { Calendar } from '../Calendar';

// En Jest, NativeWind no procesa las clases. Aquí se activa su runtime y se registra la regla
// active: del sistema de diseño, para que los componentes se comporten como en el teléfono.
beforeEach(async () => {
  setupAllComponents();
  registerCSS('.active\\:bg-surface-muted:active { background-color: #e5e5e5 }');
  await act(() => changeLanguage('es'));
});

afterAll(async () => {
  await act(() => changeLanguage('en'));
});

it('cada día del calendario es un solo elemento táctil, también los anteriores a hoy', async () => {
  // NativeWind convierte en Pressable un View con clases active:. Dentro del botón del día,
  // ese Pressable sin onPress se quedaba con el toque y el día casi nunca se elegía.
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

  const day = screen.getByRole('button', { name: 'lunes, 5 de octubre de 2026' });
  const nestedTargets = day.queryAll(
    (node) => typeof node.props.onStartShouldSetResponder === 'function',
  );
  expect(nestedTargets).toHaveLength(0);
  await user.press(day);
  expect(onChange).toHaveBeenCalledWith('2026-10-05');
});
