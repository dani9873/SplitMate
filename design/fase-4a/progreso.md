# Fase 4a — Progreso

> Se actualiza con el commit de cada paso. Si una sesión se corta, se retoma desde
> "Siguiente paso". Tareas en `plan.md`; decisiones en `diseno.md`. El usuario pide detenerse cada
> 2 pasos.

**Siguiente paso:** esperar la aprobación del diseño y el plan (propuestos el 2026-10-14). Después,
paso 1.

## Pasos

- [ ] Diseño y plan aprobados.
- [ ] 1. Parches de Expo y perfil preview de EAS.
- [ ] 2. Servidor: migración base (columnas del servidor, cambios por grupo, guardia, reglas, RLS y
      privilegios) con pgTAP en PGlite y en CI.
- [ ] 3. Servidor: `sync_push` y `sync_pull` con pgTAP.
- [ ] 4. Servidor: borrar la cuenta borra sus grupos no compartidos, y `check:data-api` ampliado.
- [ ] Punto de control: permiso para `supabase db push` y `check:data-api` contra el remoto.
- [ ] 5. Base local: columnas y tablas de sincronización (migración 0004).
- [ ] 6. Banco de pruebas con PGlite y cliente remoto.
- [ ] 7. Motor, parte 1 (TDD): envío.
- [ ] 8. Motor, parte 2 (TDD): descarga y conflictos.
- [ ] 9. Motor, parte 3 (TDD): cuándo sincronizar y estado.
- [ ] 10. Pantallas: indicador, avisos, sesión y reinicio de la base.
- [ ] 11. Cierre: verificaciones, revisión de seguridad, CLAUDE.md, PR, builds y prueba en el
      teléfono.

## Notas para retomar

- Rama `fase-4a-sincronizacion`, creada desde `main` en `5217e74` (merge del PR #4).
- expo-doctor marcó 6 parches el 2026-10-14 (lista en el paso 1 de `plan.md`).
- PGlite: 0.5.8 (del 2026-08-26, el mismo de la Fase 3). La 0.5.9 salió el 2026-10-12 y no se usa
  todavía. `@electric-sql/pglite` trae build CommonJS (`require`), así que puede cargarse en Jest.
- `expo-network` 57.0.2 es la versión del SDK 57 (del 2026-09-11).
- El remoto tiene 2 perfiles y 0 grupos: los rellenos de las migraciones no tocan datos reales.
