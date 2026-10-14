/**
 * Web Crypto mínimo para el PKCE de auth-js. auth-js genera el verificador con
 * `crypto.getRandomValues` y el desafío S256 con `crypto.subtle.digest('SHA-256')`. Hermes no
 * trae ninguno y Expo no los instala: sin ellos, auth-js usaría `Math.random` y el método plain.
 *
 * Solo se completa lo que falta, y solo con SHA-256. No hay `importKey` ni `verify`: con claves
 * de firma asimétricas, `auth.getClaims()` los necesitaría, así que la app no lo usa.
 */

/** Lo que el polyfill usa: el generador aleatorio y el SHA-256 nativos (expo-crypto en la app). */
export interface WebCryptoSource {
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;
  sha256(data: Uint8Array): Promise<ArrayBuffer>;
}

type PartialCrypto = { -readonly [K in keyof Crypto]?: Crypto[K] };

export function installAuthWebCrypto(target: { crypto?: Crypto }, source: WebCryptoSource): void {
  const crypto: PartialCrypto = target.crypto ?? {};
  crypto.getRandomValues ??= ((array) =>
    source.getRandomValues(array)) as Crypto['getRandomValues'];
  crypto.subtle ??= {
    async digest(algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> {
      const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
      if (name.toUpperCase() !== 'SHA-256') {
        throw new Error(`Algoritmo de resumen no disponible: ${name}`);
      }
      return source.sha256(toBytes(data));
    },
  } as SubtleCrypto;
  target.crypto ??= crypto as Crypto;
}

function toBytes(data: BufferSource): Uint8Array {
  return ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
}
