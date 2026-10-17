/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

import { DatabaseSetupError } from '../errors';
import { assertMigrationsHaveSql, hasSql, type BundledMigrations } from '../migration-guard';
import migrations from '../migrations/migrations';

const bundle = (sql: string): BundledMigrations => ({
  journal: { entries: [{ idx: 0, tag: '0000_prueba' }] },
  migrations: { m0000: sql },
});

const setupError = (run: () => void): DatabaseSetupError => {
  try {
    run();
  } catch (error) {
    if (error instanceof DatabaseSetupError) {
      return error;
    }
    throw error;
  }
  throw new Error('No lanzó DatabaseSetupError');
};

describe('migraciones que empaqueta la app (migrations.js)', () => {
  it('son idénticas a cada archivo .sql', () => {
    // El 2026-10-13 el teléfono corrió una 0003 que ya no existía en el repo: Metro servía
    // migrations.js de su caché con la plantilla vacía de drizzle-kit incrustada.
    const dir = path.join(__dirname, '..', 'migrations');
    for (const entry of migrations.journal.entries) {
      const key = `m${String(entry.idx).padStart(4, '0')}`;
      expect(migrations.migrations[key as keyof typeof migrations.migrations]).toBe(
        fs.readFileSync(path.join(dir, `${entry.tag}.sql`), 'utf8'),
      );
    }
  });

  it('tienen SQL en cada trozo', () => {
    expect(() => assertMigrationsHaveSql(migrations)).not.toThrow();
  });

  it('incluyen la 0004 de sincronización, con SQL propio y no la plantilla vacía', () => {
    expect(migrations.journal.entries.map((entry) => entry.tag)).toContain('0004_sincronizacion');
    const sql = (migrations.migrations as Record<string, string>).m0004 as string;
    expect(sql).toContain('synced_version');
    expect(sql).not.toContain('Custom SQL migration file');
    expect(sql.split('--> statement-breakpoint').length).toBeGreaterThan(10);
  });
});

describe('assertMigrationsHaveSql', () => {
  it('rechaza la plantilla de drizzle-kit generate --custom, la que cerraba la app', () => {
    const error = setupError(() =>
      assertMigrationsHaveSql(bundle('-- Custom SQL migration file, put your code below! --')),
    );
    expect(error.code).toBe('MIGRATION_INVALID');
    expect(error.message).toContain('0000_prueba');
  });

  it('rechaza un trozo vacío después del último separador', () => {
    const error = setupError(() =>
      assertMigrationsHaveSql(bundle('CREATE TABLE a (id integer);--> statement-breakpoint\n')),
    );
    expect(error.code).toBe('MIGRATION_INVALID');
    expect(error.message).toContain('trozo 2');
  });

  it('rechaza una migración del journal que no está en el paquete', () => {
    const error = setupError(() =>
      assertMigrationsHaveSql({
        journal: { entries: [{ idx: 1, tag: '0001_falta' }] },
        migrations: { m0000: 'SELECT 1;' },
      }),
    );
    expect(error.code).toBe('MIGRATION_INVALID');
    expect(error.message).toContain('0001_falta');
  });

  it('acepta comentarios antes del SQL, como la 0003', () => {
    expect(() =>
      assertMigrationsHaveSql(
        bundle(
          '-- Explicación\n/* bloque */\nUPDATE `x` SET `y` = 1;\n--> statement-breakpoint\nSELECT 1;',
        ),
      ),
    ).not.toThrow();
  });
});

describe('hasSql', () => {
  it.each([
    ['', false],
    ['  \n\t ', false],
    [';;', false],
    ['-- solo un comentario', false],
    ['/* bloque */\n-- y línea', false],
    ['-- comentario\nSELECT 1;', true],
    ["INSERT INTO t VALUES ('--');", true],
  ])('%j → %s', (text, expected) => {
    expect(hasSql(text)).toBe(expected);
  });
});
