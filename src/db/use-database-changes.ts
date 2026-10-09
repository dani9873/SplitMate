import { addDatabaseChangeListener } from 'expo-sqlite';
import { useEffect, useState } from 'react';

/**
 * Número que cambia con cada escritura en la base, para que las pantallas vuelvan a leer.
 * Requiere abrir la base con `enableChangeListener`.
 */
export function useDatabaseChanges(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const subscription = addDatabaseChangeListener(() => setVersion((value) => value + 1));
    return () => subscription.remove();
  }, []);
  return version;
}
