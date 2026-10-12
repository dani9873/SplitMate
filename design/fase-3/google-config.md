# Fase 3 — Configurar "Continuar con Google" (Android)

El botón usa Credential Manager con el módulo `modules/splitmate-google-auth` y entrega el ID
token a Supabase con un nonce. Hacen falta dos clientes OAuth en Google Cloud y el proveedor
Google en Supabase. Los nombres de los menús pueden variar un poco.

## 1. Google Cloud Console

Proyecto de Google Cloud de SplitMate → **Google Auth Platform** (antes "OAuth consent screen").

1. **Branding:** nombre `SplitMate`, correo de soporte y logo (opcional).
2. **Audience:** mientras la app esté en "Testing", solo entran los **usuarios de prueba**:
   agrega tu cuenta de Gmail (y las de quien vaya a probar).
3. **Data access:** los permisos `openid`, `email` y `profile` (los básicos; no hace falta
   pedir otros).
4. **Clients → Create client → Web application**
   - Nombre: `SplitMate Supabase`.
   - Sin orígenes ni URIs de redirección: la app no usa el flujo web.
   - Copia el **Client ID** (termina en `.apps.googleusercontent.com`).
5. **Clients → Create client → Android**
   - Nombre: `SplitMate Android development`.
   - Package name: `com.dani9873.splitmate`.
   - SHA-1: la del certificado del build instalado. El perfil `development` de EAS firma con la
     clave de depuración pública de la plantilla. Para leerla del APK:

     ```
     keytool -printcert -jarfile splitmate-development.apk
     ```

     (keytool viene con el JDK 17 que ya tienes). Este cliente no se usa en el código: Google lo
     usa para reconocer la app instalada.

## 2. `.env` en la raíz del proyecto

```
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<Client ID del cliente web>
```

Es un valor público. El "Client secret" de Google no va en la app.

## 3. Supabase → Authentication → Sign In / Providers → Google

| Ajuste                     | Valor                                                   |
| -------------------------- | ------------------------------------------------------- |
| Enable Sign in with Google | activado                                                |
| Client IDs                 | el Client ID del cliente **web**                        |
| Client Secret (for OAuth)  | vacío: SplitMate no usa el flujo web de OAuth           |
| Skip nonce checks          | **desactivado**: Supabase compara el nonce del ID token |

## 4. Build nuevo

El módulo de Google es código nativo: hace falta un development build nuevo de EAS (tarea 12).
El build que tienes instalado no lo trae, y sin el módulo el botón no aparece.

## Para builds de prueba o de tienda

Pendiente en CLAUDE.md: usar el keystore privado de EAS, registrar su SHA-1 en otro cliente
Android y retirar el de depuración.
