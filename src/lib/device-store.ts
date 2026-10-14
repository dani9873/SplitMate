import { SQLiteStorage } from 'expo-sqlite/kv-store';

/**
 * kv-store del dispositivo (expo-sqlite): la sesión cifrada (`auth.*`) y el registro de bases
 * por cuenta. Vive en la carpeta de SQLite, que está fuera del respaldo (reglas de Android y
 * marca de iOS).
 */
export const deviceStore = new SQLiteStorage('splitmate-device.db');
