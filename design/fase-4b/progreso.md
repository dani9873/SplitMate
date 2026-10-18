# Fase 4b — Progreso

- [x] 0. Diseño y plan (`diseno.md`, `plan.md`): escritos y aprobados con ajustes (2026-10-17)
- [x] 1. Acceso por membresía (servidor): migración `20261018090000_acceso_membresia.sql`, pruebas `012-acceso` (81)
- [ ] 2. `sync_pull_v2`
- [ ] 3. Cupos en `sync_push`
- [ ] 4. 🔒 `db push` n.º 1
- [ ] 5. Invitaciones (servidor)
- [ ] 6. 🔒 `db push` n.º 2
- [ ] 7. Base local 0005
- [ ] 8. Motor con `sync_pull_v2`
- [ ] 9. Permisos y acceso perdido en pantallas
- [ ] 10. Enlaces de entrada y página de respaldo
- [ ] 11. Invitar y unirse
- [ ] 12. Doble toque a 300 ms
- [ ] 13. Verificación, revisión de seguridad y builds
- [ ] 14. 🔒 `db push` n.º 3: retiro de `sync_pull` v1
- [ ] 15. Documentación y PR

**Siguiente paso:** paso 2, `sync_pull_v2` (pgTAP `014-sync-pull-v2` primero).

**Notas del paso 1:**

- Nombre: ya existía `012-revision-seguridad`; la prueba nueva se llama `012-acceso` como en el plan (ambas corren con `-- 012`).
- Ajustes a pruebas existentes: `000-setup` (Beto, miembro de viaje, tiene acceso en `crear_mundo`), `001`, `006` (tabla y funciones nuevas; sin `is_group_creator`), `002` y `005` (un ex miembro es quien perdió su `group_access`), `009` y `011` (el historial suma 3 entradas de la salida de Ana al borrar su cuenta). `007`, `008`, `010` y `012-revision-seguridad` pasan sin tocarse: la descarga vieja no cambió.
- Decisiones: `leave_group` y `remove_access` escriben `change_log` directo (record_change exige acceso de quien llama); la cascada de borrar la cuenta borra la fila de acceso ya marcada (el cliente de la 4b debe tolerar una fila de acceso que desaparece); `shares_group_with` ahora usa `group_access`; sin creador, el dueño del relleno es la cuenta vinculada más antigua.
- Jest completo (1126), `tsc` y `lint` en verde.
