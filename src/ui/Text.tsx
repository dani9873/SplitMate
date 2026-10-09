import { Text as NativeText, type TextProps as NativeTextProps } from 'react-native';

import { cn } from './cn';

export type TextVariant =
  'display' | 'title' | 'heading' | 'subheading' | 'body' | 'bodyStrong' | 'label' | 'caption';

export type TextTone =
  | 'default'
  | 'muted'
  | 'subtle'
  | 'primary'
  | 'positive'
  | 'negative'
  | 'warning'
  | 'onPrimary'
  | 'onDanger';

const variantClasses: Record<TextVariant, string> = {
  display: 'font-sans-extrabold text-display',
  title: 'font-sans-bold text-title',
  heading: 'font-sans-bold text-heading',
  subheading: 'font-sans-semibold text-subheading',
  body: 'font-sans text-body',
  bodyStrong: 'font-sans-semibold text-body',
  label: 'font-sans-semibold text-label',
  caption: 'font-sans-medium text-caption',
};

const toneClasses: Record<TextTone, string> = {
  default: 'text-fg',
  muted: 'text-fg-muted',
  subtle: 'text-fg-subtle',
  primary: 'text-primary',
  positive: 'text-positive',
  negative: 'text-negative',
  warning: 'text-warning',
  onPrimary: 'text-on-primary',
  onDanger: 'text-on-danger',
};

const headingVariants: readonly TextVariant[] = ['display', 'title', 'heading'];

export interface TextProps extends NativeTextProps {
  variant?: TextVariant;
  tone?: TextTone;
  /** Cifras de ancho fijo para que los montos se alineen en columnas. */
  tabular?: boolean;
  className?: string;
}

/** Texto con la escala tipográfica y los colores del sistema de diseño. */
export function Text({
  variant = 'body',
  tone = 'default',
  tabular = false,
  className,
  style,
  accessibilityRole,
  ...props
}: TextProps) {
  const isHeading = headingVariants.includes(variant);
  return (
    <NativeText
      accessibilityRole={accessibilityRole ?? (isHeading ? 'header' : undefined)}
      // Los títulos ya son grandes: se limita cuánto crecen con la letra del sistema.
      maxFontSizeMultiplier={variant === 'display' || variant === 'title' ? 1.4 : undefined}
      className={cn(variantClasses[variant], toneClasses[tone], className)}
      style={[tabular && { fontVariant: ['tabular-nums'] }, style]}
      {...props}
    />
  );
}
