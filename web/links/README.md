# Página de respaldo de los enlaces de invitación

HTML estático para Cloudflare Pages (proyecto `splitmate-links`, subida directa de esta carpeta, sin
build). Sirve `https://<dominio>/i#<token>` cuando el enlace se abre en un navegador o en un teléfono
sin la app. **No es la versión web de SplitMate.** Detalle del diseño: `design/fase-4b/diseno.md`,
sección a, y los pasos de Cloudflare en la sección c.

## Antes de subirla

1. En `.well-known/assetlinks.json`, reemplaza los dos marcadores `<SHA-256 …>` por las huellas de
   firma reales de los dos keystores de EAS (development y preview firman distinto):
   `eas credentials` → Android → la huella SHA-256 de cada perfil, con el formato
   `AA:BB:CC:…` (32 pares).
2. Compra `<dominio>` y agrégalo como dominio personalizado del proyecto Pages.
3. Compila la app con `EXPO_PUBLIC_INVITE_HOST=<dominio>` (en EAS, variable de entorno del build);
   el plugin `plugins/with-invite-links.js` agrega el App Link con `autoVerify`.
4. Comprueba que `https://<dominio>/.well-known/assetlinks.json` responda con
   `Content-Type: application/json` y que `adb shell pm get-app-links com.devdani.splitmate` diga
   que el dominio está verificado.

## Qué hay aquí

| Archivo                       | Para qué                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `i/index.html`                | La página de `/i`. Lee el token del fragmento (`#`) y ofrece abrir la app o copiar. |
| `app.js`, `style.css`         | Su código y sus estilos, propios: la política de seguridad no admite nada en línea. |
| `index.html`                  | La raíz: una línea de texto.                                                        |
| `_headers`                    | CSP estricta, `Referrer-Policy: no-referrer` y el tipo de `assetlinks.json`.        |
| `.well-known/assetlinks.json` | Vincula el dominio con el paquete de la app (App Links de Android).                 |

El token va en el fragmento: el navegador no lo manda al servidor ni lo pone en el `Referer`, y esta
página no hace ninguna petición con él.
