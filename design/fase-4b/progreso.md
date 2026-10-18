# Fase 4b — Progreso

- [x] 0. Diseño y plan (`diseno.md`, `plan.md`): escritos y aprobados con ajustes (2026-10-17)
- [x] 1. Acceso por membresía (servidor): migración `20261018090000_acceso_membresia.sql`, pruebas `012-acceso` (81)
- [x] 2. `sync_pull_v2`: migración `20261018100000_sync_pull_v2.sql`, pruebas `014-sync-pull-v2` (68)
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

**Siguiente paso:** paso 3, cupos en `sync_push` (pgTAP `015-cupos` primero).

**Notas del paso 2:**

- Respuesta de `sync_pull_v2`: `{ groups: [{ id, cursor, partial, next, rows }], has_more, lost }`. `cursor` es nulo en una página parcial; `next` es el cursor objeto `{ seq, hw, after: { t, id } }` (t: 1 groups, 2 group_access, 3 group_members, 4 categories, 5 expenses, 6 expense_payers, 7 expense_splits, 8 transfers).
- Un grupo en curso o que no cabe sale solo; el cliente debe mandar siempre los cursores de todos los grupos que tiene (si omite alguno, esa llamada lo descarga desde 0 y le quita el turno al grupo grande).
- Cursores repetidos con otra capitalización dan 22023. `010` ganó una prueba (v1 no devuelve `group_access`); `006` suma la RPC.

**Notas del paso 1:**

- Nombre: ya existía `012-revision-seguridad`; la prueba nueva se llama `012-acceso` como en el plan (ambas corren con `-- 012`).
- Ajustes a pruebas existentes: `000-setup` (Beto, miembro de viaje, tiene acceso en `crear_mundo`), `001`, `006` (tabla y funciones nuevas; sin `is_group_creator`), `002` y `005` (un ex miembro es quien perdió su `group_access`), `009` y `011` (el historial suma 3 entradas de la salida de Ana al borrar su cuenta). `007`, `008`, `010` y `012-revision-seguridad` pasan sin tocarse: la descarga vieja no cambió.
- Decisiones: `leave_group` y `remove_access` escriben `change_log` directo (record_change exige acceso de quien llama); la cascada de borrar la cuenta borra la fila de acceso ya marcada (el cliente de la 4b debe tolerar una fila de acceso que desaparece); `shares_group_with` ahora usa `group_access`; sin creador, el dueño del relleno es la cuenta vinculada más antigua.
- Jest completo (1126), `tsc` y `lint` en verde.
