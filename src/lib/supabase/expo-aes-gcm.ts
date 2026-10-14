import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';

import type { AesGcm } from './session-cipher';

/**
 * AES-256-GCM nativo de expo-crypto: CryptoKit en iOS y javax.crypto en Android. Genera un IV
 * aleatorio de 12 bytes por escritura y una etiqueta de 16; `combined()` los junta como
 * IV ‖ cifrado ‖ etiqueta, el mismo formato que leen las pruebas con node:crypto.
 */
export const expoAesGcm: AesGcm = {
  async encrypt(key, plain, aad) {
    const sealed = await aesEncryptAsync(plain, await AESEncryptionKey.import(key), {
      additionalData: aad,
    });
    return sealed.combined();
  },

  async decrypt(key, sealed, aad) {
    return aesDecryptAsync(AESSealedData.fromCombined(sealed), await AESEncryptionKey.import(key), {
      additionalData: aad,
    });
  },
};
