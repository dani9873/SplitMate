# Fase 4a — Progreso

> Se actualiza con el commit de cada paso. Si una sesión se corta, se retoma desde
> "Siguiente paso". Tareas en `plan.md`; decisiones en `diseno.md`. El usuario pide detenerse cada
> 2 pasos.

**Siguiente paso:** paso 1, parches de Expo y perfil preview de EAS.

## Pasos

- [x] Diseño y plan aprobados el 2026-10-14, con siete ajustes ya incorporados: borradores en vez
      de borrar datos, concurrencia optimista estricta, historial `change_log`, cerrar sesión con
      "Sincronizar primero", descarga incremental, límites validados en el servidor y el pendiente
      del acceso del creador para la 4b (también en CLAUDE.md).
- [ ] 1. Parches de Expo y perfil preview de EAS.
- [ ] 2. Servidor: migración base (columnas del servidor, cambios por grupo, guardia, reglas, RLS y
      privilegios) con pgTAP en PGlite y en CI.
- [ ] 3. Servidor: `sync_push` con concurrencia estricta, límites e historial.
- [ ] 4. Servidor: `sync_pull` incremental, borrar la cuenta borra sus grupos no compartidos y
      `check:data-api` ampliado.
- [ ] Punto de control: permiso para `supabase db push` y `check:data-api` contra el remoto.
- [ ] 5. Base local: columnas y tablas de sincronización (migración 0004).
- [ ] 6. Banco de pruebas con PGlite y cliente remoto.
- [ ] 7. Motor, parte 1 (TDD): envío y borradores de conflicto.
- [ ] 8. Motor, parte 2 (TDD): descarga y conflictos entre dos dispositivos.
- [ ] 9. Motor, parte 3 (TDD): cuándo sincronizar y estado.
- [ ] 10. Pantallas: indicador, avisos, sesión y reinicio de la base.
- [ ] 11. Pantallas: borradores por revisar.
- [ ] 12. Cierre: verificaciones, revisión de seguridad, CLAUDE.md, PR, builds y prueba en el
      teléfono.

## Notas para retomar

- Rama `fase-4a-sincronizacion`, creada desde `main` en `5217e74` (merge del PR #4).
- expo-doctor marcó 6 parches el 2026-10-14 (lista en el paso 1 de `plan.md`).
- PGlite: 0.5.8 (del 2026-08-26, el mismo de la Fase 3). La 0.5.9 salió el 2026-10-12 y no se usa
  todavía. `@electric-sql/pglite` trae build CommonJS (`require`), así que puede cargarse en Jest.
- `expo-network` 57.0.2 es la versión del SDK 57 (del 2026-09-11).
- El remoto tiene 2 perfiles y 0 grupos: los rellenos de las migraciones no tocan datos reales.
- El formulario de movimientos ya tiene `valuesFromExpense` y `valuesFromTransfer`: el paso 11 los
  usa para abrir un borrador.
- La app acepta montos hasta `Number.MAX_SAFE_INTEGER` y el servidor hasta 99 999 999 999 999: el
  paso 5 alinea la app con el servidor.
