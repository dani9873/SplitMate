import type { RejectReason, SyncEntity } from './wire';

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
}
