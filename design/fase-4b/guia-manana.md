# Guía para la mañana: de la rama a la prueba con dos teléfonos

Pensada para hacerlo **sin haberlo hecho antes**, en Windows con PowerShell. Cada paso dice qué escribir y
qué deberías ver. Si lo que ves es otra cosa, **detente** y copia el mensaje: no sigas.

**Cómo leer las marcas:**

- ✅ **verificado**: el comando o la pantalla se comprobó en la documentación oficial o ejecutándolo hoy.
- ⚠️ **no verificado**: viene de memoria o de inferencia; trátalo con cuidado.

**Antes de empezar, en este orden (no te saltes el paso 0):**

0. Aprobar y aplicar el `db push` n.º 2 (ver «Lo que te toca en la noche» en `resumen-dia.md`). Sin él, el
   servidor todavía no tiene las invitaciones y la prueba del paso F no puede funcionar.

Abre PowerShell en la carpeta del proyecto:

```powershell
cd "C:\Users\danie\OneDrive\Documentos\Proyectos\SplitMate"
git status
```

Debe decir `On branch fase-4b-invitaciones` y `nothing to commit, working tree clean`.

---

## A. Publicar la página de respaldo y obtener el dominio

La carpeta `web/links/` es una página estática (HTML, CSS y un JS). Se publica gratis en **Cloudflare Pages**
con «subida directa»: sin conectar GitHub y sin compilar nada.

> **No necesitas comprar un dominio para empezar.** Cloudflare te da uno gratis con la forma
> `<nombre>.pages.dev` (✅ documentado: «Production deploys to `<PROJECT_NAME>.pages.dev`»). Sirve para los
> enlaces de invitación y para los App Links de Android. El plugin de la app acepta ese nombre
> (`splitmate-links.pages.dev` cumple su validación de dominio ✅ probado con la misma expresión regular).
> **Para Brevo (sección D) sí hará falta un dominio propio**, porque hay que poner registros en su DNS; eso
> se puede dejar para después.
>
> Contra: el nombre `.pages.dev` queda en los enlaces que compartes y, si cambias de dominio más tarde, los
> enlaces viejos y la app compilada dejan de coincidir (habría que hacer otro build). Para pruebas con dos
> teléfonos no importa.

1. Crea una cuenta gratuita en <https://dash.cloudflare.com/sign-up>. **Verás:** el panel de Cloudflare.
2. Inicia sesión desde la terminal (se abrirá el navegador):

   ```powershell
   npx wrangler login
   ```

   **Verás:** una página que pide «Allow Wrangler…»; pulsa **Allow**. En la terminal:
   `Successfully logged in.` ✅ (`wrangler login` está en la documentación de Cloudflare).

3. Crea el proyecto (una sola vez):

   ```powershell
   npx wrangler pages project create splitmate-links --production-branch main
   ```

   **Verás:** `Successfully created the 'splitmate-links' project` y una dirección
   `https://splitmate-links.pages.dev`. ⚠️ La documentación muestra el comando sin argumentos (te hace las
   preguntas); si con los argumentos da error, ejecútalo como `npx wrangler pages project create` y contesta:
   nombre `splitmate-links`, rama de producción `main`.

4. **Antes de subir**, completa las huellas (sección B), porque el archivo
   `web/links/.well-known/assetlinks.json` hoy tiene dos marcadores `<SHA-256 …>`. **Puedes subir primero
   sin huellas** para ver que la página responde, pero los App Links no se verificarán hasta que las pongas
   y vuelvas a subir.
5. Sube la carpeta:

   ```powershell
   npx wrangler pages deploy web/links --project-name splitmate-links
   ```

   **Verás:** `Uploading… (N/N)` y `Deployment complete! Take a peek over at https://xxxxxxxx.splitmate-links.pages.dev`.
   El dominio que importa es el del proyecto: **`splitmate-links.pages.dev`** (si el nombre estaba ocupado,
   Cloudflare le agrega letras al azar: usa el que te muestre ✅ documentado). **Anota este nombre: es tu
   `<dominio>`.** No lleva `https://` ni barra al final.
6. Comprueba la página y el archivo de huellas (cambia `<dominio>`):

   ```powershell
   curl.exe -sI https://<dominio>/.well-known/assetlinks.json
   curl.exe -s  https://<dominio>/.well-known/assetlinks.json
   ```

   **Verás** en la primera: `HTTP/1.1 200`, y `content-type: application/json` (lo pone el archivo `_headers`).
   En la segunda, el JSON con `com.dani9873.splitmate`.
   En el navegador, abre `https://<dominio>/i#` + 43 letras cualesquiera: debe salir «Te invitaron a SplitMate»
   con los botones **Abrir en SplitMate** y **Copiar enlace**. Con `https://<dominio>/i` a secas debe salir «Este
   enlace no es válido».

> Cada vez que cambies algo en `web/links/` (por ejemplo, las huellas), repite el paso 5.

---

## B. Las huellas SHA-256 de las firmas (development y preview)

Android solo abre la app directamente desde un enlace `https://` si el archivo `assetlinks.json` del dominio
lista la huella de la **firma** del APK instalado. Los dos perfiles de EAS firman distinto.

> ⚠️ **Posible problema con `development`.** En `eas.json` el perfil `development` tiene
> `"withoutCredentials": true` y compila con `assembleDebug`. Según la documentación (✅) eso significa que EAS
> **no administra una firma** para ese perfil, así que `eas credentials` probablemente **no mostrará ninguna
> huella para development**. El APK se firmará con la clave de depuración del proyecto Android (⚠️ no
> verificado cuál es ni si es siempre la misma). Por eso el método más seguro es **leer la huella del APK ya
> compilado** (paso 3). Si no te cuadra, la salida más simple es hacer la prueba de App Links **solo con el
> build `preview`** y dejar `development` con el esquema propio `splitmate://`.

1. Instala (una vez) la CLI de EAS, o usa `npx`:

   ```powershell
   npx eas-cli --version
   npx eas-cli login
   ```

   **Verás:** un número de versión (hoy la CLI instalada con `npx` es 16.17.4 ✅) y un mensaje de sesión iniciada con tu cuenta de Expo (⚠️ el texto exacto no verificado).

2. **Huella de preview** (después de haber compilado `preview`, sección E):

   ```powershell
   npx eas-cli credentials -p android
   ```

   Elige **preview** → **Keystore** (los nombres exactos de los menús ⚠️ no verificados). **Verás** una tabla con
   `SHA256 Fingerprint` y 32 pares de letras y números separados por `:` (por ejemplo `AA:BB:…`). ✅ El comando
   y la huella «SHA256 Fingerprint» están en la documentación de Expo para App Links.

3. **Huella leída del APK** (sirve para development y para preview, y es la que se debe creer):
   1. En <https://expo.dev> abre el build, y descarga el `.apk` a una carpeta, por ejemplo
      `C:\Users\danie\Descargas\splitmate-dev.apk`.
   2. Ejecuta (viene con Java, que ya necesitas para Maestro; si falla, `java -version` te dice si lo tienes):

      ```powershell
      keytool -printcert -jarfile "C:\Users\danie\Descargas\splitmate-dev.apk"
      ```

      **Verás** un bloque «Certificate fingerprints:» con una línea `SHA256: AA:BB:…`. ⚠️ `keytool -printcert -jarfile`
      es de la documentación de Java, no de Expo; se usa tal cual en el mundo Android.
   3. Copia la línea SHA256 **sin la palabra `SHA256:`**.

4. Pega las huellas en `web/links/.well-known/assetlinks.json`, reemplazando los dos marcadores. Debe quedar
   así (con tus valores, entre comillas, separados por coma):

   ```json
   "sha256_cert_fingerprints": [
     "AA:BB:...:FF",
     "11:22:...:99"
   ]
   ```

   Si solo tienes una, quita la línea del marcador sobrante (la prueba `web-links` acepta el marcador o una
   huella real; no acepta un valor con otra forma). Comprueba y vuelve a subir:

   ```powershell
   npm test -- --watchAll=false web-links
   npx wrangler pages deploy web/links --project-name splitmate-links
   ```

   **Verás** la prueba en verde y `Deployment complete!`.

---

## C. Decirle a EAS cuál es el dominio

El dominio entra al build por una variable pública de EAS. **No** va al `.env` para los builds de EAS (el
`.env` no se sube; ver `.easignore`). Se define para los dos entornos: `development` y `preview`.

1. Mira qué comando acepta tu versión de la CLI:

   ```powershell
   npx eas-cli env:set --help
   ```

   - Si imprime ayuda, usa `env:set`. ✅ La documentación actual de Expo muestra `eas env:set`.
   - Si dice `Command env:set not found`, usa `env:create` (así es en la 16.17.4 que tengo aquí ✅ comprobado
     con `--help`). Los argumentos son los mismos.

2. Crea la variable (repite una vez por entorno):

   ```powershell
   npx eas-cli env:set --name EXPO_PUBLIC_INVITE_HOST --value <dominio> --environment development --visibility plaintext
   npx eas-cli env:set --name EXPO_PUBLIC_INVITE_HOST --value <dominio> --environment preview --visibility plaintext
   ```

   (Con `env:create` en vez de `env:set`, o con `--environment development --environment preview` en una sola
   llamada ✅ la ayuda de `env:create` admite varios `--environment`.) **Verás:** `Successfully created…` o
   similar. `plaintext` es lo correcto: el valor es público.
3. Comprueba:

   ```powershell
   npx eas-cli env:list --environment development
   ```

   **Verás** `EXPO_PUBLIC_INVITE_HOST` con tu dominio (⚠️ `env:list` no lo probé hoy). Si ya existía de antes
   (`already exists`), añade `--force` para sobrescribir ✅ (flag de `env:create`).

> El `.env` local (`EXPO_PUBLIC_INVITE_HOST=`) solo afecta a Metro en tu PC. Puedes dejarlo vacío.

---

## D. Brevo y el SMTP de Supabase

Es lo que hace que lleguen correos a otras personas (el correo integrado de Supabase solo envía a miembros
de tu organización y muy pocos por hora). Sin esto, la cuenta B de la prueba (con un correo real) no puede
registrarse. **Requiere un dominio propio** (los registros DNS de Brevo no se pueden poner en `pages.dev`).
Pasos del diseño (`diseno.md`, sección c); los menús de Brevo y de Supabase ⚠️ **no verificados** (están en
sus paneles, que cambian):

1. **Dominio.** Cómpralo (el diseño propone Cloudflare Registrar, que cobra el precio de costo). Con un
   dominio propio también puedes servir los enlaces desde él (Pages → proyecto → **Custom domains** →
   **Set up a domain** ✅ documentado) y entonces tu `<dominio>` de las secciones A a C cambia: tendrás que
   repetir C y compilar de nuevo.
2. **Brevo, cuenta y dominio.** Crea la cuenta (plan gratuito, 300 correos por día). *Senders, Domains & Dedicated
   IPs → Domains → Add a domain*. Copia en el DNS de Cloudflare los registros que muestra: el TXT de
   verificación de Brevo, DKIM y DMARC (`v=DMARC1; p=none; rua=mailto:<tu correo>`). Pulsa *Authenticate* hasta que
   los tres queden en verde.
3. **Remitente.** *Senders* → agrega `no-reply@<dominio>` con el nombre «SplitMate».
4. **Clave SMTP.** *SMTP & API → SMTP*: genera una clave llamada `supabase`. Anota servidor
   `smtp-relay.brevo.com`, puerto `587` y el usuario (`…@smtp-brevo.com`). **La clave se ve una sola vez:
   guárdala en tu gestor de contraseñas. Nunca en el repo, en `.env` ni en EAS.**
5. **Seguimiento de clics.** Si Brevo lo tiene activo para correos transaccionales, apágalo (reescribe los
   enlaces y rompe los de confirmación).
6. **Supabase** → *Authentication → Emails → SMTP Settings*. Activa *Enable custom SMTP*, remitente
   `no-reply@<dominio>`, nombre `SplitMate`, host `smtp-relay.brevo.com`, puerto `587`, usuario y clave del
   paso 4, intervalo mínimo 60 s. **Guarda.** Verás un aviso verde de guardado.
7. **Supabase** → *Authentication → Rate Limits*: sube *Rate limit for sending emails* de 2 a 30 por hora.
8. **Plantillas.** Pega las de `supabase/templates` (`confirmation.html` y `recovery.html`) en *Authentication →
   Emails → Templates* (asuntos y pasos en `design/fase-3/ajustes-panel.md`, sección 5).
9. **Prueba.** Pide «Olvidé mi contraseña» desde la app con tu correo. En Gmail abre **⋮ → Mostrar original**:
   SPF, DKIM y DMARC deben decir `PASS`.
10. **Avísame** (en la sesión): yo cambio `EMAIL_HAS_CODE` a `true` en `src/features/auth/auth-service.ts`
    y va en el build del cierre.

---

## E. Compilar el cliente de desarrollo de Android

Usa lo ya documentado en el repo (`CLAUDE.md`, «Build nativo local desde OneDrive»): los builds se hacen con
EAS porque Gradle falla local por las rutas largas de OneDrive. El cambio de esta rama es **nativo** (el
`intent-filter` del App Link), así que **hace falta un build nuevo**; reabrir Metro no basta.

1. Comprueba que no vas a compilar a ciegas:

   ```powershell
   git status
   npm test -- --watchAll=false
   ```

   Debe estar limpio y en verde.
2. Compila (tarda unos 10–20 minutos en la nube; no cierres la terminal si quieres ver el avance, o ábrelo
   luego en <https://expo.dev>):

   ```powershell
   npx eas-cli build --profile development --platform android
   ```

   **Verás** preguntas (si te pide iniciar sesión, hazlo), «Build queued…» y, al terminar, un enlace y un QR
   para descargar el `.apk`. El plugin imprime un aviso si la variable falta:
   `[with-invite-links] EXPO_PUBLIC_INVITE_HOST no está definido…` — **si lo ves en el registro del build, la
   variable de la sección C no llegó**: no sigas.
3. Para la prueba del App Link también necesitas `preview` (sirve para ver la huella de EAS y no depende de
   Metro):

   ```powershell
   npx eas-cli build --profile preview --platform android
   ```

   ⚠️ El perfil `preview` apunta a las variables del entorno `preview` (sección C). Esta app necesita las
   variables `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` también en `preview`; si nunca
   compilaste `preview`, es posible que falten (`npx eas-cli env:list --environment preview`). Si faltan, la app
   abre con la pantalla «Falta la configuración».
4. Instala el `.apk` en **los dos teléfonos** (abre el enlace del build en cada teléfono y descarga; Android
   pedirá permitir instalar apps de esa fuente la primera vez). Si prefieres cable:

   ```powershell
   adb devices
   adb -s <ID_DEL_TELEFONO> install -r C:\Users\danie\Descargas\splitmate-dev.apk
   ```

   **Verás** `Success`. (`adb devices` debe listar el teléfono como `device`, no como `unauthorized`.)
5. El cliente de desarrollo necesita Metro corriendo en tu PC:

   ```powershell
   npx expo start --dev-client
   ```

   Abre la app en el teléfono y elige tu PC en la lista, o escanea el QR. Los dos teléfonos y la PC en la
   misma red wifi.
6. **Comprueba la verificación del dominio** (Android 12 o más nuevo para el comando manual ✅ documentado). Con el
   teléfono conectado por cable y la app instalada:

   ```powershell
   adb shell pm verify-app-links --re-verify com.dani9873.splitmate
   ```

   Espera unos minutos y:

   ```powershell
   adb shell pm get-app-links com.dani9873.splitmate
   ```

   **Verás** `<dominio>: verified`. Cualquier otra cosa (`none`, `legacy_failure`, un número de 1024 o más)
   significa que no se verificó: normalmente la huella no coincide con el APK instalado (sección B) o el dominio
   no responde. Mientras no esté `verified`, el enlace se abre en el navegador, y desde la página el botón
   **Abrir en SplitMate** (esquema propio) sigue funcionando. Para reintentar desde cero:
   `adb shell pm set-app-links --package com.dani9873.splitmate 0 all` y otra vez `--re-verify`.

---

## F. Prueba con dos cuentas y dos teléfonos

**Prerrequisitos:** push n.º 2 aplicado y `npm run check:data-api` en verde; builds instalados; Metro corriendo;
SMTP funcionando (D). **Teléfono 1 (S24) = cuenta A, dueña.** **Teléfono 2 (Poco) = cuenta B, con un correo real.**
Si algo no coincide con «Esperado», anota la hora, el teléfono y lo que viste, y sigue con el caso siguiente
(la mayoría son independientes).

Preparación: con A, crea el grupo «Prueba» con dos personas sin cuenta (por ejemplo «Carla» y «Luis») y un gasto.

| # | Caso | Pasos | Esperado |
|---|---|---|---|
| 1 | Crear el enlace | En A: abre el grupo → **Invitar** → deja **7 días** → **Crear enlace y compartir** → compártelo por WhatsApp a ti mismo | Sale la hoja de compartir con el texto «Únete a «Prueba» en SplitMate: …». En la lista aparece un enlace **Vigente**, «0 de 10 usos», «Creado por ti» |
| 2 | Vista previa | En B (sin la app abierta): toca el enlace en WhatsApp | Si el dominio está `verified`: se abre SplitMate directo en «Unirte a «Prueba»» con «USD · 1 persona con cuenta» y la pregunta «¿Quién eres?» con «Carla», «Luis» y «Soy alguien nuevo». Si no: se abre el navegador con la página «Te invitaron a SplitMate»; pulsa **Abrir en SplitMate** y llega a lo mismo |
| 3 | Aceptar | En B: elige «Carla» → **Unirme** | «Descargando el grupo…» y se abre «Prueba» con el gasto de A. En **Miembros**, «Carla» dice «Tú» y «Con cuenta». En A, tras sincronizar (jálalo hacia abajo o abre la hoja de sincronización), Carla tiene «Con cuenta» y el enlace dice «1 de 10 usos» |
| 4 | Gastos de los dos | B agrega un gasto, A agrega otro | Cada uno aparece en el otro teléfono tras sincronizar; los saldos coinciden en los dos |
| 5 | Aceptar dos veces | En B: vuelve a tocar el mismo enlace | Muestra «Ya eres parte de este grupo.» con **Abrir grupo**; en A el uso sigue en «1 de 10» (no sube) |
| 6 | Miembro ya elegido | En un tercer caso (o con una cuenta C si la tienes): abre el enlace y elige «Carla» | Aviso «Alguien ya eligió a Carla. Elige de nuevo.» y la lista sin Carla |
| 7 | Enlace vencido | La app solo ofrece 1, 7 o 30 días, así que no se puede probar hoy a mano: es opcional, crea uno de 1 día y vuelve a abrirlo pasado mañana (⚠️ no verificado en teléfono; el servidor lo cubre con pgTAP) | «Este enlace no es válido. Pídele a quien te invitó uno nuevo.» y la lista lo marca **Vencido**. El servidor no distingue «vencido» de «inexistente» a propósito |
| 8 | Enlace revocado | En A: **Revocar** el enlace del caso 1 → confirma. Con una cuenta/teléfono que no haya entrado, abre ese enlace | «Este enlace no es válido…»; en la lista de A el enlace queda **Revocado**. B (que ya entró) sigue en el grupo |
| 9 | Enlace agotado | En A crea un enlace con la duración por omisión y úsalo con 10 cuentas distintas (⚠️ difícil de hacer a mano). Alternativa: confía en la prueba de concurrencia del CI | Con el uso 11: «Este enlace no es válido…»; la lista lo marca **Agotado** |
| 10 | Expulsar y reintentar | En A: **Miembros** → «Quitar el acceso de Carla» → confirma (el aviso dice que los enlaces vigentes dejan de servir y que crees enlaces nuevos). Luego en A crea un enlace nuevo y envíaselo a B | En B, tras sincronizar: aviso «Ya no tienes acceso a este grupo…» y el grupo en **solo lectura** (no deja agregar gastos). Con el enlace **viejo**, B recibe «Este enlace no es válido». Con el **nuevo**, B puede unirse otra vez y el grupo vuelve a ser editable |
| 11 | Salir del grupo | En B: grupo → ajustes → **Salir del grupo** → **Salir** | B deja de ver el grupo; en A, el miembro de B queda **sin cuenta** pero sus gastos se conservan |
| 12 | Solo lectura con cambios pendientes | Con B desconectado (modo avión), crea un gasto en B; en A quita el acceso a B; reconecta B | El gasto de B no se pierde: aparece como borrador por revisar o en el conteo aparte de la hoja de sincronización, y el grupo queda en solo lectura. **Quitar de este teléfono** avisa cuántos cambios sin subir se pierden |
| 13 | Sin conexión | En A, modo avión → **Invitar** | «Hace falta conexión a internet para esto…» al crear; la lista dice «Sin conexión: solo se ven los enlaces que creaste en este teléfono». En B, modo avión → tocar un enlace: «Hace falta conexión…» con **Reintentar**, y al volver la red funciona |
| 14 | Sesión | En B (sin entrar a la cuenta) toca un enlace; regístrate o entra | Después de entrar, te lleva a «Unirte a…». Si cierras sesión **antes** de unirte y entras con otra cuenta, **no** debe aparecer esa invitación (corrección de hoy) |
| 15 | Página de respaldo | En el navegador de una PC (sin la app) abre `https://<dominio>/i#<token>` | La página «Te invitaron a SplitMate» con los dos botones; sin errores. El token no aparece en la barra de direcciones del servidor (`Referer`) |

Al terminar, avisa cuáles casos fallaron y con qué pantalla; con eso se corrige y se hacen las dos pruebas
manuales de la Fase 3 (registro con confirmación por correo y recuperar contraseña) que quedaron pendientes.
