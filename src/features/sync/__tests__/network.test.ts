import * as ExpoNetwork from 'expo-network';

import { createNetworkMonitor, isOnline } from '../network';

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(),
  addNetworkStateListener: jest.fn(),
}));

const mocked = ExpoNetwork as jest.Mocked<typeof ExpoNetwork>;

describe('isOnline', () => {
  it('requiere conexión y que internet no esté marcado como inalcanzable', () => {
    expect(isOnline({ isConnected: true, isInternetReachable: true })).toBe(true);
    expect(isOnline({ isConnected: true })).toBe(true);
    expect(isOnline({ isConnected: true, isInternetReachable: false })).toBe(false);
    expect(isOnline({ isConnected: false, isInternetReachable: true })).toBe(false);
    expect(isOnline({})).toBe(false);
  });
});

describe('createNetworkMonitor', () => {
  afterEach(() => jest.clearAllMocks());

  it('current lee el estado del sistema', async () => {
    mocked.getNetworkStateAsync.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    await expect(createNetworkMonitor().current()).resolves.toBe(true);
    mocked.getNetworkStateAsync.mockResolvedValue({ isConnected: false });
    await expect(createNetworkMonitor().current()).resolves.toBe(false);
  });

  it('subscribe avisa de cada cambio y se cancela con la función devuelta', () => {
    const remove = jest.fn();
    let emit: (state: ExpoNetwork.NetworkStateEvent) => void = () => undefined;
    mocked.addNetworkStateListener.mockImplementation((listener) => {
      emit = listener as typeof emit;
      return { remove } as unknown as ReturnType<typeof ExpoNetwork.addNetworkStateListener>;
    });
    const listener = jest.fn();
    const unsubscribe = createNetworkMonitor().subscribe(listener);

    emit({ isConnected: true, isInternetReachable: true } as ExpoNetwork.NetworkStateEvent);
    emit({ isConnected: false } as ExpoNetwork.NetworkStateEvent);
    expect(listener.mock.calls).toEqual([[true], [false]]);

    unsubscribe();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
