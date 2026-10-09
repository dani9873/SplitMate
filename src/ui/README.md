# Sistema de diseño

Identidad visual de SplitMate: **amigable pero confiable**. La app maneja dinero entre
amigos, así que debe transmitir calma y precisión sin sentirse fría ni bancaria.

## Decisiones

| Elemento   | Elección                                                    | Por qué                                                                                                                                                        |
| ---------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primario   | Verde azulado profundo `#0E6B5E`, claro `#4CC3AE` en oscuro | Transmite calma y confianza, y continúa el cian del logo original con más sobriedad.                                                                           |
| Acento     | Coral `#E8603C`                                             | Aporta calidez. Se usa con moderación: ilustraciones, marca y momentos amables.                                                                                |
| Fondo      | Papel cálido `#F7F4EE` y tinta `#0B1413` en oscuro          | Las tarjetas blancas se separan del fondo sin sombras. En oscuro, un negro con matiz verde evita el gris plano.                                                |
| Saldos     | `positive` verde y `negative` rojo                          | Lo que te deben y lo que debes. Nunca solo con color: siempre con signo o texto, por accesibilidad para daltonismo.                                            |
| Tipografía | Manrope, pesos 400 a 800                                    | Geométrica y amable, muy legible en tamaños pequeños, con cifras tabulares (`tnum`) verificadas para alinear montos en columnas. Una sola familia, menos peso. |
| Espaciado  | Escala de 4 px de Tailwind                                  | Ritmo consistente sin inventar una escala propia.                                                                                                              |
| Radios     | 12 en campos, 16 en botones, 20 en tarjetas                 | Generosos para sentirse amables, sin llegar a lo infantil.                                                                                                     |
| Elevación  | Bordes finos y tonos, sin sombras                           | Funciona igual en claro y oscuro, y se ve limpio en Android e iOS.                                                                                             |

Todos los pares de texto y fondo cumplen WCAG AA en ambos modos: 4,5:1 para texto y 3:1
para bordes de controles. Se verificó con un script al definir la paleta.

## Cómo se usa

- Los colores son **semánticos** y cambian solos con el tema: `bg-surface`, `text-fg`,
  `text-fg-muted`, `border-line`, `bg-primary`, `text-positive`... No uses `dark:`.
- Los tokens viven en `theme/colors.json`. Tailwind los expone como variables CSS y
  `ThemeProvider` cambia sus valores según el tema efectivo.
- Para valores en JavaScript, como íconos o navegación, usa `useAppTheme().colors`.
- Con fuentes propias cada peso es una familia: usa `font-sans`, `font-sans-semibold`,
  `font-sans-bold`... nunca `font-bold`, que en Android puede caer en la fuente del sistema.
- La escala tipográfica está en `<Text variant>`: `display`, `title`, `heading`,
  `subheading`, `body`, `bodyStrong`, `label` y `caption`. Para montos usa `tabular`.
- `className` en los componentes es para márgenes y layout. El estilo lo dan las variantes.

## Componentes base

`Button`, `Text`, `Input`, `Card`, `Screen` y `EmptyState`. Todos son accesibles:
roles, estados (`disabled`, `busy`), etiquetas asociadas y errores anunciados.
