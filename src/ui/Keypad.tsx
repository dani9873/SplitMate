import { Delete } from 'lucide-react-native';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as NativeText, Pressable, View } from 'react-native';

import { cn } from './cn';
import { fontFamily, useAppTheme } from './theme';

export type KeypadDigit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
export type KeypadOperator = '+' | '-' | '*' | '/';
export type KeypadKey = KeypadDigit | KeypadOperator | '.' | 'back' | 'clear' | 'equals' | 'done';

export interface KeypadProps {
  onKey: (key: KeypadKey) => void;
  /** Separador decimal del idioma, solo para mostrarlo: la tecla siempre envía `.`. */
  decimalSeparator: string;
  /** Falso en monedas sin decimales, como JPY: la tecla no aparece. */
  allowDecimal: boolean;
  className?: string;
}

type KeyKind = 'digit' | 'operator' | 'action';

const ROWS: readonly (readonly KeypadKey[])[] = [
  ['7', '8', '9', '/'],
  ['4', '5', '6', '*'],
  ['1', '2', '3', '-'],
  ['.', '0', 'back', '+'],
];

const SYMBOLS: Partial<Record<KeypadKey, string>> = { '/': '÷', '*': '×', '-': '−', '+': '+' };

const kindOf = (key: KeypadKey): KeyKind =>
  key in SYMBOLS ? 'operator' : key === 'back' || key === 'equals' ? 'action' : 'digit';

/**
 * Teclado de la calculadora del monto. Igual en Android e iOS, con operadores que el
 * teclado numérico del sistema no tiene. Cada tecla tiene su nombre accesible; mantener
 * borrar, o su acción accesible, borra todo.
 */
export function Keypad({ onKey, decimalSeparator, allowDecimal, className }: KeypadProps) {
  const { t } = useTranslation();
  const labels: Partial<Record<KeypadKey, string>> = {
    '.': t('ui.keypad.decimal'),
    '+': t('ui.keypad.plus'),
    '-': t('ui.keypad.minus'),
    '*': t('ui.keypad.times'),
    '/': t('ui.keypad.divide'),
    back: t('ui.keypad.delete'),
    equals: t('ui.keypad.equals'),
  };

  return (
    <View
      accessibilityLabel={t('ui.keypad.label')}
      className={cn('gap-2 border-t border-line bg-surface-muted px-3 pb-2 pt-3', className)}
    >
      {ROWS.map((row, index) => (
        <View key={index} className="flex-row gap-2">
          {row.map((key) =>
            key === '.' && !allowDecimal ? (
              <View key={key} className="flex-1" />
            ) : (
              <KeypadButton
                key={key}
                value={key}
                label={labels[key] ?? key}
                glyph={key === '.' ? decimalSeparator : (SYMBOLS[key] ?? key)}
                kind={kindOf(key)}
                onKey={onKey}
                clearLabel={key === 'back' ? t('ui.keypad.clear') : undefined}
              />
            ),
          )}
        </View>
      ))}
      <View className="flex-row gap-2">
        <KeypadButton
          value="equals"
          label={labels.equals ?? '='}
          glyph="="
          kind="operator"
          onKey={onKey}
        />
        <Pressable
          testID="keypad-done"
          accessibilityRole="button"
          accessibilityLabel={t('ui.keypad.done')}
          onPress={() => onKey('done')}
          className="h-14 flex-[3] items-center justify-center rounded-lg bg-primary active:bg-primary-pressed"
        >
          <NativeText
            allowFontScaling={false}
            className="text-on-primary"
            style={{ fontFamily: fontFamily.bold, fontSize: 17 }}
          >
            {t('ui.keypad.done')}
          </NativeText>
        </Pressable>
      </View>
    </View>
  );
}

interface KeypadButtonProps {
  value: KeypadKey;
  label: string;
  glyph: string;
  kind: KeyKind;
  onKey: (key: KeypadKey) => void;
  clearLabel?: string;
}

const KeypadButton = memo(function KeypadButton({
  value,
  label,
  glyph,
  kind,
  onKey,
  clearLabel,
}: KeypadButtonProps) {
  const { colors } = useAppTheme();
  const isBack = value === 'back';
  return (
    <Pressable
      testID={`keypad-${value}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityActions={clearLabel ? [{ name: 'longpress', label: clearLabel }] : undefined}
      onAccessibilityAction={clearLabel ? () => onKey('clear') : undefined}
      onPress={() => onKey(value)}
      onLongPress={isBack ? () => onKey('clear') : undefined}
      className={cn(
        'h-14 flex-1 items-center justify-center rounded-lg',
        kind === 'operator'
          ? 'bg-accent-soft active:opacity-70'
          : 'border border-line bg-surface active:bg-surface-muted',
      )}
    >
      {isBack ? (
        <Delete size={24} color={colors.fg} strokeWidth={2} />
      ) : (
        <NativeText
          // El teclado tiene tamaño fijo para que siempre quepa en la pantalla.
          allowFontScaling={false}
          style={{
            fontFamily: kind === 'operator' ? fontFamily.bold : fontFamily.semibold,
            fontSize: 26,
            fontVariant: ['tabular-nums'],
            color: kind === 'operator' ? colors.accentStrong : colors.fg,
          }}
        >
          {glyph}
        </NativeText>
      )}
    </Pressable>
  );
});
