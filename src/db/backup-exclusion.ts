import { requireOptionalNativeModule } from 'expo';

/** Módulo nativo local `modules/splitmate-backup`, solo para iOS. */
export interface BackupExclusionModule {
  excludeFromBackup(path: string): boolean;
}

const nativeModule = requireOptionalNativeModule<BackupExclusionModule>('SplitmateBackup');

/**
 * Excluye la base local del respaldo de iOS (iCloud y copias del equipo).
 *
 * La clave de SQLCipher vive en el llavero con acceso solo en este dispositivo y no viaja
 * con el respaldo: una base restaurada sería ilegible. Se marca la carpeta de la base, así
 * quedan excluidos también el WAL y el SHM que SQLite crea a su lado.
 *
 * En Android no hace falta: `android.allowBackup` está en `false` y el plugin
 * `plugins/with-backup-rules.js` excluye la carpeta en las reglas de respaldo. En Expo Go
 * el módulo no existe y la función no hace nada.
 */
export function excludeDatabaseFromBackup(
  databasePath: string,
  module: BackupExclusionModule | null = nativeModule,
): boolean {
  if (!module) {
    return false;
  }
  const directory = databasePath.slice(0, databasePath.lastIndexOf('/'));
  return module.excludeFromBackup(directory);
}
