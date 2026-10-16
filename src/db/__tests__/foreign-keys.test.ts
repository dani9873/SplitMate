import { openDatabaseFile } from '../client';

const mockExec = jest.fn();

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    databasePath: '/data/SQLite/test.db',
    execSync: (sql: string) => mockExec(sql),
    getFirstSync: () => ({ cipher_version: '4' }),
    closeSync: jest.fn(),
  }),
  deleteDatabaseSync: jest.fn(),
}));
jest.mock('drizzle-orm/expo-sqlite', () => ({ drizzle: () => ({}) }));
jest.mock('drizzle-orm/expo-sqlite/migrator', () => ({ migrate: async () => undefined }));
jest.mock('../migration-guard', () => ({ assertMigrationsHaveSql: () => undefined }));

describe('conexión real de la app', () => {
  it('activa foreign_keys: la descarga (pull.ts) depende de que una fila sin padre falle', async () => {
    mockExec.mockClear();
    await openDatabaseFile('test.db', 'a'.repeat(64));

    const pragmas = mockExec.mock.calls.map(([sql]) => String(sql)).join(' ');
    expect(pragmas).toMatch(/PRAGMA foreign_keys = ON/);
  });
});
