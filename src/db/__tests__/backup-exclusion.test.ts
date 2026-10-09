import { excludeDatabaseFromBackup } from '../backup-exclusion';

describe('exclusión de la base del respaldo', () => {
  it('marca la carpeta de la base, que también contiene el WAL y el SHM', () => {
    const excluded: string[] = [];
    const module = { excludeFromBackup: (path: string) => excluded.push(path) > 0 };

    const applied = excludeDatabaseFromBackup(
      '/var/mobile/App/Documents/SQLite/splitmate.db',
      module,
    );

    expect(applied).toBe(true);
    expect(excluded).toEqual(['/var/mobile/App/Documents/SQLite']);
  });

  it('no hace nada sin el módulo nativo: Android usa reglas de respaldo y Expo Go no lo incluye', () => {
    expect(excludeDatabaseFromBackup('/data/files/SQLite/splitmate.db', null)).toBe(false);
  });
});
