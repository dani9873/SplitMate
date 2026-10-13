# Fase 3 — Ajustes del panel de Supabase

Lista para dejar el proyecto remoto igual que `supabase/config.toml`, que solo aplica en local
y en CI. Los nombres de los menús pueden variar un poco según la versión del panel.

> **Cambio después de aplicarla (2026-10-12, revisión de seguridad):** el código del correo vence
> en 30 minutos, no en una hora. Aplicado por el usuario el mismo día:
>
> 1. En la sección 2, Email OTP expiration en **1800** segundos.
> 2. En la sección 5, las dos plantillas pegadas otra vez: ahora dicen "vencen en 30 minutos".
>
> **Corrección (2026-10-13):** el punto 2 no se pudo aplicar. El panel exige SMTP propio para
> editar las plantillas, así que el proyecto usa las predeterminadas: solo el enlace, en inglés y
> sin código. La sección 5 queda para cuando haya SMTP.

## 1. Authentication → URL Configuration

| Ajuste        | Valor                                                                   |
| ------------- | ----------------------------------------------------------------------- |
| Site URL      | `splitmate://auth/callback`                                             |
| Redirect URLs | solo `splitmate://auth/callback` (borra `localhost` u otras si las hay) |

Supabase compara la redirección con esta lista, query incluida. La app no agrega parámetros.

## 2. Authentication → Sign In / Providers

**Email**

| Ajuste                  | Valor                               |
| ----------------------- | ----------------------------------- |
| Enable Email provider   | activado                            |
| Confirm email           | activado                            |
| Secure password change  | activado                            |
| Secure email change     | activado (viene así)                |
| Minimum password length | 8                                   |
| Password requirements   | ninguno (sin reglas de composición) |
| Email OTP length        | 6                                   |
| Email OTP expiration    | 1800 segundos                       |

**Generales**

| Ajuste                      | Valor                                             |
| --------------------------- | ------------------------------------------------- |
| Allow new users to sign up  | activado                                          |
| Allow anonymous sign-ins    | desactivado                                       |
| Allow manual linking        | desactivado                                       |
| Teléfono, Apple y los demás | desactivados                                      |
| Google                      | desactivado (la app solo usa correo y contraseña) |

## 3. Authentication → Sessions (o JWT Keys)

| Ajuste                                       | Valor         |
| -------------------------------------------- | ------------- |
| Access token expiry (JWT expiry)             | 3600 segundos |
| Detect and revoke compromised refresh tokens | activado      |
| Refresh token reuse interval                 | 10 segundos   |
| Time-box / inactivity timeout                | sin límite    |

## 4. Authentication → Rate Limits

| Ajuste                                | Valor                                                |
| ------------------------------------- | ---------------------------------------------------- |
| Emails sent per hour                  | el del correo integrado (no se sube sin SMTP propio) |
| Sign-ups and sign-ins (por IP, 5 min) | 30                                                   |
| Token verifications (por IP, 5 min)   | 30                                                   |
| Token refreshes (por IP, 5 min)       | 150                                                  |
| Minimum interval between emails       | 60 segundos (la app espera lo mismo para reenviar)   |

## 5. Authentication → Emails → Templates

> **Requiere SMTP propio (pendiente en CLAUDE.md).** Sin él, el panel no deja editarlas y quedan
> las predeterminadas, que traen solo el enlace (`{{ .ConfirmationURL }}`). La app ya funciona así:
> no muestra el campo del código mientras `EMAIL_HAS_CODE` sea `false`. Al pegarlas, pasarlo a
> `true` y hacer un build nuevo.

| Plantilla      | Asunto                                                      | Cuerpo                                 |
| -------------- | ----------------------------------------------------------- | -------------------------------------- |
| Confirm signup | `Confirma tu correo · Confirm your email \| SplitMate`      | `supabase/templates/confirmation.html` |
| Reset password | `Recupera tu contraseña · Reset your password \| SplitMate` | `supabase/templates/recovery.html`     |

Pegar el archivo completo en el editor de cada plantilla. El texto sale en inglés si la cuenta
se registró con la app en inglés (`user_metadata.locale`); si no, en español.

## 6. Project Settings → API Keys y Data API

- En `.env` van la URL del proyecto y la clave **publicable** (`sb_publishable_…`). La clave
  secreta (`sb_secret_…` o `service_role`) nunca va en la app ni en el repo.
- Data API → Exposed schemas: solo `public` y `graphql_public` (vienen así). El esquema
  `private` no debe aparecer.

## 7. Base de datos

Las migraciones de `supabase/migrations` se aplican con `supabase db push` (punto de control de
la tarea 3). Sin ellas, la app entra pero no puede crear su perfil (tarea 9). Aplicadas el
2026-10-12.

## Pendiente con SMTP propio

El correo integrado de Supabase solo envía a miembros de la organización y pocos por hora.
Antes de invitar a otras personas: SMTP propio, subir "Emails sent per hour" y, opcional,
activar el aviso "Password changed" (pendiente en CLAUDE.md).
