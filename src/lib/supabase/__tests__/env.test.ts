import { SupabaseConfigError, parseSupabaseEnv } from '../env';

const URL = 'https://abcdefghijklmnopqrst.supabase.co';
const KEY = 'sb_publishable_AbC123-_xyzXYZ0987654321';

function configError(raw: Parameters<typeof parseSupabaseEnv>[0]): SupabaseConfigError {
  try {
    parseSupabaseEnv(raw);
  } catch (error) {
    if (error instanceof SupabaseConfigError) {
      return error;
    }
    throw error;
  }
  throw new Error('Se esperaba un error de configuración');
}

describe('variables públicas de Supabase', () => {
  it('acepta la URL https del proyecto y la clave publicable', () => {
    expect(parseSupabaseEnv({ url: URL, publishableKey: KEY })).toEqual({
      url: URL,
      publishableKey: KEY,
    });
  });

  it('acepta la URL con una barra final y la normaliza', () => {
    expect(parseSupabaseEnv({ url: `${URL}/`, publishableKey: KEY }).url).toBe(URL);
  });

  it('señala las variables ausentes por su nombre', () => {
    expect(configError({}).variables).toEqual([
      'EXPO_PUBLIC_SUPABASE_URL',
      'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    ]);
    expect(configError({ url: '', publishableKey: KEY }).variables).toEqual([
      'EXPO_PUBLIC_SUPABASE_URL',
    ]);
  });

  it.each([
    ['http', 'http://abcdefghijklmnopqrst.supabase.co'],
    ['otro dominio', 'https://supabase.co.example.com'],
    ['con ruta', `${URL}/rest/v1`],
    ['con consulta', `${URL}?x=1`],
    ['con credenciales', 'https://user:pass@abcdefghijklmnopqrst.supabase.co'],
    ['sin URL', 'no es una url'],
  ])('rechaza una URL %s', (_, url) => {
    expect(configError({ url, publishableKey: KEY }).variables).toEqual([
      'EXPO_PUBLIC_SUPABASE_URL',
    ]);
  });

  it.each([
    ['secreta', 'sb_secret_AbC123xyzXYZ0987654321'],
    ['legacy (JWT anon)', 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.firma'],
    ['con espacios', 'sb_publishable_ abc def'],
    ['vacía después del prefijo', 'sb_publishable_'],
  ])('rechaza una clave %s', (_, publishableKey) => {
    expect(configError({ url: URL, publishableKey }).variables).toEqual([
      'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    ]);
  });

  it('nunca incluye los valores en el mensaje de error', () => {
    const error = configError({
      url: 'http://filtrado.example.com',
      publishableKey: 'sb_secret_x',
    });
    expect(error.message).not.toContain('filtrado');
    expect(error.message).not.toContain('sb_secret_x');
  });
});
