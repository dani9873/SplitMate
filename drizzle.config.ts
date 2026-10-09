import { defineConfig } from 'drizzle-kit';

// Genera las migraciones SQL versionadas y el archivo migrations.js que importa la app.
export default defineConfig({
  dialect: 'sqlite',
  driver: 'expo',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
});
