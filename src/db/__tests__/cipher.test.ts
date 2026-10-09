import { readCipherVersion } from '../cipher';
import { createTestDatabase } from '../test-utils';

it('devuelve null cuando la base no está cifrada con SQLCipher', async () => {
  const { db } = await createTestDatabase();
  expect(readCipherVersion(db)).toBeNull();
});
