import type { QuotaKind, RejectReason, SyncEntity } from './wire';

/** Reloj y generador de ids, inyectables para que las pruebas sean deterministas. */
export interface SyncDeps {
  now(): number;
  newId(): string;
}

export interface BatchLimits {
  /** Máximo de envíos por lote. */
  readonly count: number;
  /** Máximo de bytes (UTF-8) del lote; un lote siempre lleva al menos un envío. */
  readonly bytes: number;
}

/** Un cambio del usuario que el servidor rechazó y quedó como borrador por revisar. */
export interface SyncNotice {
  readonly draftId: string;
  readonly groupId: string;
  readonly entity: SyncEntity;
  readonly reason: RejectReason;
  /** El cupo alcanzado; solo con `reason: 'quota'`. */
  readonly quota?: QuotaKind;
  /** Nombre del grupo o miembro, o título del movimiento, para nombrarlo en el aviso. */
  readonly label: string;
  readonly serverDeleted: boolean;
  readonly wasNew: boolean;
  readonly wasDeletion: boolean;
}

export interface SyncCounts {
  /** Unidades con cambios por subir, sin contar las apartadas. */
  readonly pending: number;
  /** Envíos que el servidor rechazó por inválidos o prohibidos y esperan al usuario. */
  readonly failed: number;
  /** Borradores por revisar. */
  readonly conflicts: number;
  /**
   * Unidades con cambios por subir en grupos a los que la cuenta ya no tiene acceso: no se envían
   * y se cuentan aparte de `pending`.
   */
  readonly lost: number;
}

/** Qué pasó al aplicar la descarga de un grupo. Cuenta unidades (grupo, miembro, gasto...). */
export interface ApplyOutcome {
  /** Unidades que cambiaron en la base local. */
  readonly applied: number;
  /** Unidades con cambios locales pendientes: se conservaron y se saltaron. */
  readonly skipped: number;
  /**
   * Algo no se pudo aplicar (fila inválida, padre que falta, restricción): el cursor del grupo no
   * avanzó y se reintenta en el próximo ciclo.
   */
  readonly held: boolean;
}

/** Qué pasó al aplicar una respuesta de `sync_pull_v2`. */
export interface PullOutcome {
  /** Unidades que cambiaron en la base local. */
  readonly applied: number;
  /** Unidades con cambios locales pendientes: se conservaron y se saltaron. */
  readonly skipped: number;
  /**
   * Grupos que no se pudieron aplicar (el cursor no avanzó). `cursor` es hasta donde llegó la
   * descarga de ese grupo, para no pedirlo otra vez dentro del mismo ciclo; nulo si no hay un
   * cursor seguro (la descarga por páginas se descartó).
   */
  readonly held: readonly { readonly id: string; readonly cursor: number | null }[];
  /** Grupos del teléfono a los que la cuenta ya no tiene acceso (quedaron de solo lectura). */
  readonly lost: readonly string[];
  /** Falta una ronda: hay un grupo grande con la última página guardada a la espera de la ronda extra. */
  readonly more: boolean;
}
