# Fase 3 — Plan de implementación: cuentas y nube con Supabase

> **Ejecución:** en la misma sesión, tarea por tarea, con TDD en el almacenamiento de la sesión,
> las bases por cuenta, el manejador de la Edge Function y las pruebas pgTAP. Antes de cerrar,
> la skill verification-before-completion. Los pasos usan casillas `- [ ]`.

**Objetivo:** login obligatorio con correo y Google, y la base de Postgres con RLS lista para
sincronizar en la Fase 4. Diseño en `design/fase-3/diseno.md`.

**Arquitectura:**

- `src/lib/supabase/` crea el cliente con el almacenamiento cifrado.
- `src/features/auth/` tiene el proveedor de sesión, el servicio de auth inyectable y las
  pantallas.
- `src/db/accounts.ts` abre la base de cada cuenta.
- Las pantallas de las Fases 1 y 2 pasan al grupo de rutas `(app)`, cuyo layout abre esa base.
- `supabase/` tiene la configuración, las migraciones, las pruebas pgTAP y la Edge Function.

**Stack nuevo:**

- `@supabase/supabase-js` 2.117 (solo JS);
- el módulo local `splitmate-google-auth` (Kotlin, Credential Manager), el único con código
  nativo;
- Supabase CLI 2.120.0 con `npx` y en CI.

## Restricciones globales

- Toda la comunicación, los planes, los PR y los commits van en español.
- La clave secreta de Supabase nunca entra al repo ni a la app. Solo valores `EXPO_PUBLIC_*`
  públicos.
- Antes de `supabase db push` y de desplegar la Edge Function, pedir permiso al usuario.
- Tokens y sesión solo cifrados con clave en secure-store; nunca en AsyncStorage ni en logs.
- Toda entrada del usuario y todo dato de la red se valida con zod.
- Mensajes de auth que no revelan si un correo existe.
- Cero textos fijos en JSX, i18n es/en, áreas táctiles de 44 px y contraste AA.
- `app/`, `src/features/` y `src/ui/` no importan SQL, Drizzle ni el esquema.
- Commits pequeños con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Mapa de archivos

| Archivo                                                                                                    | Responsabilidad                                         |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `supabase/config.toml`                                                                                     | Postgres local, Auth, plantillas y la Edge Function     |
| `supabase/migrations/*_esquema.sql`                                                                        | Tablas, CHECK, FKs, índices y categorías predefinidas   |
| `supabase/migrations/*_seguridad.sql`                                                                      | Esquema `private`, funciones, RLS y privilegios         |
| `supabase/tests/database/*.test.sql`                                                                       | pgTAP                                                   |
| `supabase/templates/*.html`                                                                                | Correos de verificación y recuperación (es/en)          |
| `supabase/functions/delete-account/handler.ts`                                                             | Lógica de borrar cuenta, sin Deno, probada con Jest     |
| `supabase/functions/delete-account/index.ts`                                                               | Entrada Deno: crea los clientes y llama al manejador    |
| `src/lib/supabase/env.ts`                                                                                  | Variables públicas validadas con zod                    |
| `src/lib/supabase/session-storage.ts`                                                                      | Adaptador cifrado para supabase-js                      |
| `src/lib/supabase/session-cipher.ts`                                                                       | AES-256-GCM con expo-crypto                             |
| `src/lib/supabase/client.ts`                                                                               | Cliente de Supabase                                     |
| `src/db/accounts.ts`                                                                                       | Registro, abrir, adoptar y borrar la base de una cuenta |
| `src/features/auth/auth-service.ts`                                                                        | Interfaz y versión con supabase-js                      |
| `src/features/auth/auth-errors.ts`                                                                         | Errores de Supabase → claves de i18n                    |
| `src/features/auth/AuthProvider.tsx`                                                                       | Estado de la sesión                                     |
| `src/features/auth/google.ts`                                                                              | Nonce y llamada al módulo nativo                        |
| `src/features/auth/screens/*`                                                                              | Bienvenida, registro, entrar, código, recuperar         |
| `src/features/account/*`                                                                                   | Sección Cuenta: cerrar sesión y borrar cuenta           |
| `modules/splitmate-google-auth/`                                                                           | Módulo Expo de Android con Credential Manager           |
| `app/(auth)/*`, `app/(app)/*`, `app/auth/callback.tsx`, `app/reset-password.tsx`, `app/+native-intent.tsx` | Rutas                                                   |

## Tareas

### 1. Supabase local y esquema

**Archivos:** `supabase/config.toml`, `supabase/migrations/*_esquema.sql`, `.gitignore`.

- [ ] `npx supabase@2.120.0 init`. Ignorar `supabase/.temp` y `supabase/.branches`.
- [ ] Migración de esquema con las tablas, CHECK, FKs compuestas, el trigger de categoría,
      los índices y las categorías predefinidas del diseño.
- [ ] Commit.

### 2. Seguridad y pruebas pgTAP

**Archivos:** `supabase/migrations/*_seguridad.sql`, `supabase/tests/database/*.test.sql`.

- [ ] Pruebas primero:
  - `000-setup`;
  - estructura: RLS en todo, `anon` sin privilegios, sin `DELETE` ni `TRUNCATE`,
    `search_path` fijo;
  - ajeno contra miembro por tabla;
  - suplantación;
  - integridad entre grupos;
  - perfiles.
- [ ] Migración de seguridad: el esquema `private` con sus funciones, las políticas y los
      privilegios por columna y por omisión.
- [ ] Commit.

### 3. Job de CI

**Archivos:** `.github/workflows/ci.yml`.

- [ ] Job "Base de datos y RLS": checkout, `supabase/setup-cli` 2.120.0, `supabase db start`,
      `supabase test db`.
- [ ] Push e iterar hasta verde (en la PC no hay Docker).
- [ ] Commit.

**Punto de control:** con las pruebas en verde, pedir permiso para `supabase db push` al
proyecto remoto. El usuario escribe la contraseña de la base.

### 4. Almacenamiento cifrado de la sesión

**Archivos:** `src/lib/supabase/{session-storage,session-cipher}.ts` y sus pruebas.

**Produce:**

```ts
interface SessionCipher { encrypt(plain: string, aad: string): Promise<string>; decrypt(blob: string, aad: string): Promise<string> }
interface KeyValueStore { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void>; removeItem(k: string): Promise<void> }
createEncryptedStorage({ cipher, store }): { getItem, setItem, removeItem }   // adaptador de supabase-js
createSessionCipher({ keyStore, randomBytes }): SessionCipher                   // expo-crypto
```

- [ ] Pruebas con `node:crypto`:
  - ida y vuelta;
  - un valor alterado o con otro AAD se descarta y se borra;
  - sin clave → `null`;
  - más de 2048 bytes;
  - la clave se crea una sola vez.
- [ ] Implementación y commit.

### 5. Cliente, servicio y proveedor de auth

**Archivos:** `src/lib/supabase/{env,client}.ts`, `src/features/auth/{auth-service,auth-errors,AuthProvider}.ts(x)`.

**Produce:**

```ts
interface AuthService {
  restore(): Promise<AuthSession | null>; // desde el almacenamiento, sin red
  signUp(input): Promise<void>;
  signIn(email, password): Promise<AuthSession>;
  verifyCode(email, code, flow): Promise<AuthSession>;
  resend(email, flow): Promise<void>;
  exchangeCode(code): Promise<AuthSession>;
  requestPasswordReset(email): Promise<void>;
  updatePassword(password): Promise<void>;
  signInWithGoogle(): Promise<AuthSession | null>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
  onSignedOut(listener): () => void; // rechazo definitivo de la sesión
}
type AuthSession = {
  userId: string;
  email: string;
  providers: string[];
  displayName: string | null;
};
```

- [ ] Pruebas:
  - variables inválidas o ausentes;
  - traducción de errores con un `fetch` falso que responde como Supabase (credenciales,
    correo sin confirmar, límite de intentos, contraseña débil, sin red);
  - el registro guarda `locale` y `display_name`;
  - `restore` sin red devuelve la sesión guardada.
- [ ] `AuthProvider` con `restoring | signedOut | signedIn`, renovación según `AppState`.
- [ ] Commit.

### 6. Base por cuenta

**Archivos:** `src/db/accounts.ts`, `src/db/client.ts`, `src/db/DatabaseProvider.tsx` y pruebas.

**Produce:**

```ts
openAccountDatabase(account: { userId, email, displayName }): Promise<AppDatabase>
deleteAccountData(userId): Promise<void>   // journal DELETE, cerrar, borrar archivo, clave y registro
```

- [ ] Pruebas con sql.js y almacenes falsos:
  - adopción con cambio de id y referencias;
  - repetirla no duplica;
  - otra cuenta empieza vacía;
  - una base con otro dueño no se abre;
  - borrar elimina archivo, clave y registro;
  - el usuario local siempre tiene el id de la cuenta.
- [ ] Implementación y commit.

### 7. Rutas protegidas y enlaces

**Archivos:** `app/_layout.tsx`, `app/(app)/_layout.tsx`, mover `app/(tabs)` y
`app/groups` a `app/(app)/`, `app/+native-intent.tsx`, `src/features/navigation/deep-links.ts`.

- [ ] Pruebas de enlaces: largo, rutas desconocidas y parámetros de `auth/callback`.
- [ ] `Stack.Protected` con `(auth)` y `(app)`. El layout de `(app)` abre la base de la
      cuenta con `DatabaseGate`.
- [ ] Ajustar el flujo de la Fase 2 para que corra con una sesión falsa.
- [ ] Commit.

### 8. Pantallas de auth y plantillas

**Archivos:** `app/(auth)/*`, `app/auth/callback.tsx`, `app/reset-password.tsx`,
`src/features/auth/screens/*`, `src/i18n/locales/{es,en}.json`, `supabase/templates/*`,
`supabase/config.toml`.

- [ ] Pruebas con RNTL y un servicio falso:
  - validación y mensajes genéricos;
  - registro → revisa tu correo → código;
  - entrar;
  - recuperar → código o enlace → nueva contraseña;
  - reenviar con espera.
- [ ] Pantallas con el sistema de diseño, i18n y accesibilidad.
- [ ] Plantillas es/en y `[auth]` en `config.toml`.
- [ ] Commit.

**Punto de control:** entregar la lista exacta de ajustes del panel de Supabase:

- confirmación de correo obligatoria;
- límites de intentos;
- duración de sesión y rotación de refresh tokens;
- URLs de redirección (solo `splitmate://`);
- largo mínimo de contraseña;
- proveedores (solo correo y Google);
- las plantillas.

### 9. Perfil remoto

**Archivos:** `src/features/auth/profile-sync.ts` y prueba.

- [ ] Prueba: tras el login asegura `profiles` (insertar si falta) con el nombre del registro
      o de Google; sin red, queda pendiente y se reintenta en el siguiente arranque.
- [ ] Commit.

### 10. Google (Android)

**Archivos:** `modules/splitmate-google-auth/*`, `src/features/auth/google.ts`, botón en
bienvenida y entrar.

- [ ] Prueba del nonce y de la cancelación con un módulo falso.
- [ ] Módulo Kotlin con `GetSignInWithGoogleOption` y nonce; errores `CANCELED`,
      `NO_ACCOUNT` y `FAILED`.
- [ ] Botón con la marca de Google, solo en Android.
- [ ] Commit.

**Punto de control:** paso a paso de Google Cloud Console y Supabase (cliente web, cliente
Android con paquete y SHA-1 sacada del APK de EAS, proveedor Google en Supabase) y
`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` en `.env`.

### 11. Cuenta: cerrar sesión y borrar cuenta

**Archivos:** `src/features/account/*`, sección Cuenta en Ajustes,
`supabase/functions/delete-account/*`, `[functions.delete-account]` en `config.toml`.

- [ ] Pruebas del manejador (Jest, entorno node):
  - 405;
  - 401 sin token, con token inválido o con `sub` distinto;
  - 403 `reauthentication_required` con una sesión de más de 5 minutos;
  - 200 y borrado con una sesión reciente;
  - 500 sin detalles.
- [ ] Pruebas de pantallas:
  - las dos opciones de cerrar sesión (la segunda advierte y borra los datos);
  - borrar cuenta pide el correo exacto y luego la contraseña, o Google si la cuenta es de
    Google;
  - tras borrar, vuelve a la bienvenida.
- [ ] Implementación y commit.

**Punto de control:** pedir permiso para desplegar la Edge Function.

### 12. Cierre

- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test -- --watchAll=false`,
      `npm run test:coverage`, `npm run check:bundle` y `npx expo-doctor`.
- [ ] Revisión de seguridad completa con la skill security-code-review.
- [ ] Prueba en el emulador: registro con código, entrar, cerrar sesión con y sin borrar,
      adopción de los datos de las Fases 1 y 2 y enlaces.
- [ ] CLAUDE.md: Estado y pendientes.
- [ ] Push, PR y CI en verde.
- [ ] Development build en EAS (módulo de Google) y enlace al usuario.
