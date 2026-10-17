import { act, renderHook } from '@testing-library/react-native';

import { useGuardedRouter } from '../use-guarded-router';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  navigate: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => mockRouter,
}));

describe('useGuardedRouter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('un doble push al mismo destino abre una sola pantalla', async () => {
    const { result } = await renderHook(() => useGuardedRouter());

    await act(async () => {
      result.current.push('/groups/1');
      result.current.push('/groups/1');
    });

    expect(mockRouter.push).toHaveBeenCalledTimes(1);
  });

  it('destinos distintos, o el mismo después del enfriamiento, sí pasan', async () => {
    const { result } = await renderHook(() => useGuardedRouter());

    await act(async () => {
      result.current.push('/groups/1');
      result.current.push('/groups/2');
    });
    expect(mockRouter.push).toHaveBeenCalledTimes(2);

    await act(async () => {
      jest.advanceTimersByTime(700);
      result.current.push('/groups/2');
    });
    expect(mockRouter.push).toHaveBeenCalledTimes(3);
  });

  it('replace seguido de push no se confunden', async () => {
    const { result } = await renderHook(() => useGuardedRouter());

    await act(async () => {
      result.current.replace('/groups/1');
      result.current.push('/groups/1');
    });

    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
  });

  it('un doble back no cierra dos pantallas', async () => {
    const { result } = await renderHook(() => useGuardedRouter());

    await act(async () => {
      result.current.back();
      result.current.back();
    });

    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  it('distingue destinos con objeto (pathname y params)', async () => {
    const { result } = await renderHook(() => useGuardedRouter());

    await act(async () => {
      result.current.push({ pathname: '/groups/[groupId]', params: { groupId: 'a' } });
      result.current.push({ pathname: '/groups/[groupId]', params: { groupId: 'b' } });
      result.current.push({ pathname: '/groups/[groupId]', params: { groupId: 'b' } });
    });

    expect(mockRouter.push).toHaveBeenCalledTimes(2);
  });

  it('conserva el resto del router (canGoBack)', async () => {
    const { result } = await renderHook(() => useGuardedRouter());
    expect(result.current.canGoBack()).toBe(true);
  });
});
