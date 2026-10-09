import AsyncStorage from '@react-native-async-storage/async-storage';
import { waitFor } from '@testing-library/react-native';
import { colorScheme } from 'nativewind';

import { i18n } from '@/i18n';

import { PREFERENCES_STORAGE_KEY, usePreferences } from '../preferences-store';

async function readStored() {
  const raw = await AsyncStorage.getItem(PREFERENCES_STORAGE_KEY);
  return raw ? JSON.parse(raw).state : null;
}

async function saveRaw(state: unknown) {
  await AsyncStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({ state, version: 1 }));
}

describe('usePreferences', () => {
  beforeEach(async () => {
    jest.spyOn(colorScheme, 'set').mockImplementation(() => {});
    usePreferences.setState({ language: 'system', theme: 'system', hydrated: false });
    // setState también escribe en el almacenamiento: se limpia después.
    await AsyncStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sin nada guardado sigue al sistema y queda lista', async () => {
    await usePreferences.persist.rehydrate();

    expect(usePreferences.getState()).toMatchObject({
      language: 'system',
      theme: 'system',
      hydrated: true,
    });
  });

  it('restaura y aplica el idioma y el tema guardados', async () => {
    await saveRaw({ language: 'es', theme: 'dark' });

    await usePreferences.persist.rehydrate();

    expect(usePreferences.getState()).toMatchObject({
      language: 'es',
      theme: 'dark',
      hydrated: true,
    });
    await waitFor(() => expect(i18n.language).toBe('es'));
    expect(colorScheme.set).toHaveBeenCalledWith('dark');
  });

  it('descarta valores guardados inválidos', async () => {
    await saveRaw({ language: 'klingon', theme: 'morado' });

    await usePreferences.persist.rehydrate();

    expect(usePreferences.getState()).toMatchObject({ language: 'system', theme: 'system' });
  });

  it('queda lista aunque falle la lectura, para no bloquear el splash', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disco no disponible'));

    await usePreferences.persist.rehydrate();

    expect(usePreferences.getState()).toMatchObject({
      language: 'system',
      theme: 'system',
      hydrated: true,
    });
  });

  it('cambia el idioma al instante y lo guarda', async () => {
    await usePreferences.persist.rehydrate();

    usePreferences.getState().setLanguage('en');
    await waitFor(() => expect(i18n.language).toBe('en'));
    usePreferences.getState().setLanguage('es');

    await waitFor(() => expect(i18n.language).toBe('es'));
    expect(await readStored()).toEqual({ language: 'es', theme: 'system' });
  });

  it('cambia el tema al instante y lo guarda', async () => {
    await usePreferences.persist.rehydrate();

    usePreferences.getState().setTheme('dark');

    expect(colorScheme.set).toHaveBeenLastCalledWith('dark');
    expect(await readStored()).toEqual({ language: 'system', theme: 'dark' });
  });
});
