# Fase 4b — Resumen de la jornada autónoma (2026-10-18)

Rama `fase-4b-invitaciones`. **No se hizo ningún `db push`**, ninguna escritura en Supabase remoto,
ningún build, ninguna instalación en teléfonos y no se usaron contraseñas ni correos de prueba. `main`
no se tocó; no se abrió PR ni se borró ninguna rama. La fase **no** se marca como terminada en
`CLAUDE.md`.

## Estado por tarea

| # | Tarea | Estado |
|---|---|---|
| 1 | Segunda revisión de seguridad adversarial | Hecha: ver abajo |
| 2 | Prueba de concurrencia real del último uso | Pendiente |
| 3 | `log_parameter_max_length_on_error` en el remoto (solo lectura) | Pendiente |
| 4 | `guia-manana.md` | Pendiente |
| 5 | Borrador del push n.º 3 | Pendiente |
| 6 | Auditoría de las pantallas nuevas | Pendiente |

## Tarea 1 — Segunda revisión de seguridad

Informe completo en `revision-seguridad.md`, sección «Segunda revisión». Se leyó el servidor
(`acceso_membresia`, `sync_pull_v2`, `invitaciones`) y el cliente como atacante, y se respondió cada
pregunta del encargo.

- **Servidor: nada de severidad media o superior.** `20261019090000_invitaciones.sql` no cambió (así
  que el dry-run del push n.º 2 sigue siendo el mismo).
- **C12 (media), corregido con TDD:** el enlace pendiente no se borraba al cerrar sesión ni al cambiar
  de cuenta (en un teléfono compartido, la persona siguiente veía el grupo de la anterior). Ahora
  `AuthProvider` lo borra cuando termina una sesión con usuario o cambia el usuario, y al abrir la app
  se purga el vencido. Entrar desde «sin sesión» lo conserva (quien se registra con un enlace).
- **C13 (baja), corregido con TDD:** los tokens locales de enlaces que ya no sirven se borran al cargar
  la lista de invitar.
- **C14 (baja), corregido con TDD:** el aviso de «Quitar acceso» dice que habrá que crear enlaces nuevos.
- Descartados con motivo: I8 a I12, C15 a C17 (en el informe).
- No se pudo usar el grafo de código (el servidor MCP no conectó): se leyó el código real.
