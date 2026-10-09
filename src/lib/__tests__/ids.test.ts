import { createIdGenerator, uuidV7Timestamp } from '../ids';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Bytes "aleatorios" predecibles para las pruebas. */
const fixedRandom = (byte: number) => (length: number) => new Uint8Array(length).fill(byte);

describe('UUID v7', () => {
  it('tiene el formato y la versión de RFC 9562', () => {
    const newId = createIdGenerator({
      now: () => 1_760_000_000_000,
      randomBytes: fixedRandom(0xab),
    });
    expect(newId()).toMatch(UUID_V7);
  });

  it('codifica la marca de tiempo en los primeros 48 bits', () => {
    const newId = createIdGenerator({ now: () => 1_760_000_000_000, randomBytes: fixedRandom(0) });
    expect(uuidV7Timestamp(newId())).toBe(1_760_000_000_000);
  });

  it('ordena por tiempo de creación', () => {
    let time = 1_760_000_000_000;
    const newId = createIdGenerator({ now: () => time, randomBytes: fixedRandom(0xff) });
    const first = newId();
    time += 1;
    const second = newId();
    expect(first < second).toBe(true);
  });

  it('es monótono dentro del mismo milisegundo', () => {
    let calls = 0;
    const newId = createIdGenerator({
      now: () => 1_760_000_000_000,
      randomBytes: (length) => new Uint8Array(length).fill(calls++ % 2 ? 0x00 : 0xff),
    });
    const ids = Array.from({ length: 50 }, () => newId());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no retrocede si el reloj del dispositivo va hacia atrás', () => {
    let time = 1_760_000_000_000;
    const newId = createIdGenerator({ now: () => time, randomBytes: fixedRandom(0x10) });
    const first = newId();
    time -= 5_000;
    expect(newId() > first).toBe(true);
  });
});
