/** Fuentes de tiempo y aleatoriedad, inyectables para probar el generador. */
export interface IdGeneratorDeps {
  now(): number;
  randomBytes(length: number): Uint8Array;
}

const COUNTER_MAX = 0xfff;
const COUNTER_SEED_MASK = 0x7ff;

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * Crea un generador de UUID v7 (RFC 9562): 48 bits de milisegundos Unix, versión, un
 * contador de 12 bits y 62 bits aleatorios.
 *
 * Los ids de un mismo generador son estrictamente crecientes: dentro del mismo milisegundo
 * avanza el contador, y si el reloj retrocede se sigue usando el último milisegundo visto.
 * Así el orden de los ids coincide con el orden de creación, que el dominio usa para
 * desempatar repartos.
 */
export function createIdGenerator({ now, randomBytes }: IdGeneratorDeps): () => string {
  let lastMs = -1;
  let counter = 0;

  return () => {
    let ms = Math.max(Math.floor(now()), lastMs);
    if (ms === lastMs) {
      counter += 1;
      if (counter > COUNTER_MAX) {
        ms += 1;
        counter = seedCounter(randomBytes);
      }
    } else {
      counter = seedCounter(randomBytes);
    }
    lastMs = ms;

    const bytes = new Uint8Array(16);
    let time = ms;
    for (let i = 5; i >= 0; i--) {
      bytes[i] = time % 256;
      time = Math.floor(time / 256);
    }
    bytes[6] = 0x70 | (counter >> 8);
    bytes[7] = counter & 0xff;
    bytes.set(randomBytes(8), 8);
    bytes[8] = 0x80 | (bytes[8]! & 0x3f);

    const text = hex(bytes);
    return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
  };
}

/** Semilla del contador con el bit alto en cero, para dejar margen dentro del milisegundo. */
function seedCounter(randomBytes: IdGeneratorDeps['randomBytes']): number {
  const [high = 0, low = 0] = randomBytes(2);
  return ((high << 8) | low) & COUNTER_SEED_MASK;
}

/** Milisegundos Unix codificados en un UUID v7. */
export function uuidV7Timestamp(id: string): number {
  return parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}
