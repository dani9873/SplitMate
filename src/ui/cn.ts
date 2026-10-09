type ClassValue = string | false | null | undefined;

/**
 * Une clases de Tailwind descartando las vacías.
 * No resuelve conflictos: usa `className` en los componentes para márgenes y layout,
 * y las props de variante para el estilo.
 */
export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(' ');
}
