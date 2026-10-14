import { createHash } from 'node:crypto';

import { installAuthWebCrypto, type WebCryptoSource } from '../web-crypto';

const source: WebCryptoSource = {
  getRandomValues: jest.fn(<T extends ArrayBufferView | null>(array: T) => {
    if (array) {
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(7);
    }
    return array;
  }),
  sha256: jest.fn(async (data: Uint8Array) => {
    const digest = createHash('sha256').update(data).digest();
    return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength);
  }),
};

describe('Web Crypto para PKCE', () => {
  it('instala getRandomValues y subtle.digest con SHA-256 cuando faltan', async () => {
    const target: { crypto?: Crypto } = {};
    installAuthWebCrypto(target, source);

    const bytes = target.crypto!.getRandomValues(new Uint32Array(4));
    expect(Array.from(new Uint8Array(bytes.buffer))).toEqual(new Array(16).fill(7));

    const hash = await target.crypto!.subtle.digest('SHA-256', new TextEncoder().encode('abc'));
    expect(Buffer.from(hash).toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('acepta el algoritmo como objeto, como permite Web Crypto', async () => {
    const target: { crypto?: Crypto } = {};
    installAuthWebCrypto(target, source);
    await expect(
      target.crypto!.subtle.digest({ name: 'SHA-256' }, new Uint8Array([1])),
    ).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it('rechaza otros algoritmos en lugar de devolver un hash equivocado', async () => {
    const target: { crypto?: Crypto } = {};
    installAuthWebCrypto(target, source);
    await expect(target.crypto!.subtle.digest('SHA-1', new Uint8Array([1]))).rejects.toThrow(
      'SHA-1',
    );
  });

  it('no reemplaza un crypto que ya existe', () => {
    const existing = { getRandomValues: jest.fn(), subtle: { digest: jest.fn() } };
    const target = { crypto: existing as unknown as Crypto };
    installAuthWebCrypto(target, source);
    expect(target.crypto).toBe(existing);
    expect(target.crypto.getRandomValues).toBe(existing.getRandomValues);
    expect(target.crypto.subtle).toBe(existing.subtle);
  });

  it('completa lo que falta de un crypto parcial', () => {
    const existing = { getRandomValues: jest.fn() };
    const target = { crypto: existing as unknown as Crypto };
    installAuthWebCrypto(target, source);
    expect(target.crypto.getRandomValues).toBe(existing.getRandomValues);
    expect(typeof target.crypto.subtle.digest).toBe('function');
  });
});
