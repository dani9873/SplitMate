# Fase 3 — Progreso

> Se actualiza con el commit de cada paso. Si una sesión se corta, se retoma desde
> "Siguiente paso". Tareas en `plan.md`; decisiones en `diseno.md`.

**Siguiente paso:** tarea 4, almacenamiento cifrado de la sesión (pruebas escritas, falta la
implementación). Pendiente del usuario: permiso y contraseña para `supabase db push`.

## Pasos

- [x] Diseño y plan aprobados con los cuatro ajustes de la revisión (`a950b86`).
- [x] 1. Supabase local y esquema (`1e5ac04`).
- [x] 2. Seguridad y pruebas pgTAP: 123 pruebas en verde en PGlite; 12 mutaciones de la
      migración detectadas.
- [x] 3. Job de CI "Base de datos y RLS": verde al primer intento en el run 38182028758
      (`Files=6, Tests=123, Result: PASS`).
- [ ] Punto de control: permiso para `supabase db push` al proyecto remoto (pedido; las
      tareas 4 a 7 no dependen de él).
- [ ] 4. Almacenamiento cifrado de la sesión.
- [ ] 5. Cliente, servicio y proveedor de auth.
- [ ] 6. Base por cuenta.
- [ ] 7. Rutas protegidas y enlaces.
- [ ] 8. Pantallas de auth y plantillas.
- [ ] Punto de control: lista de ajustes de Auth para el panel de Supabase.
- [ ] 9. Perfil remoto.
- [ ] 10. Google (Android).
- [ ] Punto de control: Google Cloud Console, proveedor Google en Supabase y
      `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`.
- [ ] 11. Cuenta: cerrar sesión y borrar cuenta.
- [ ] Punto de control: permiso para desplegar la Edge Function `delete-account`.
- [ ] 12. Cierre: verificaciones, revisión de seguridad, emulador, CLAUDE.md, PR y build.

## Notas para retomar

- En la PC no hay Docker. Para validar migraciones y pgTAP sin esperar al CI se usa PGlite
  (Postgres en WASM) en una carpeta temporal fuera de OneDrive:
  `npm i @electric-sql/pglite@0.5.8 @electric-sql/pglite-pgtap@0.0.9`, más un script que crea
  los roles `anon`, `authenticated` y `service_role`, el esquema `auth` con `auth.uid()`, los
  privilegios por omisión de Supabase en `public` y pgTAP en `extensions`; después aplica
  `supabase/migrations` y corre `supabase/tests/database` en orden. El CI es la fuente de
  verdad: PGlite usa Postgres 18 y Supabase, 17.
- Comprobado en PGlite: un trigger se dispara aunque el rol no tenga `EXECUTE` sobre su
  función, así que la función del trigger de categoría no necesita ese permiso.
