import * as SecureStore from 'expo-secure-store';

/**
 * Almacén seguro del sistema para claves de cifrado (la de la base y la de la sesión). Solo en
 * este dispositivo y disponible tras el primer desbloqueo: no viaja en copias de seguridad ni a
 * otros dispositivos.
 */
export const secureKeyStore = {
  getItemAsync: (key: string) => SecureStore.getItemAsync(key),
  setItemAsync: (key: string, value: string) =>
    SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    }),
};
