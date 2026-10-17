import * as Network from 'expo-network';

import type { NetworkMonitor } from './engine';

/**
 * Hay internet si el sistema reporta conexión y no marca internet como inalcanzable. En iOS
 * `isInternetReachable` es igual a `isConnected`; en Android puede faltar un instante.
 */
export function isOnline(state: Pick<Network.NetworkState, 'isConnected' | 'isInternetReachable'>) {
  return state.isConnected === true && state.isInternetReachable !== false;
}

export function createNetworkMonitor(): NetworkMonitor {
  return {
    current: async () => isOnline(await Network.getNetworkStateAsync()),
    subscribe(listener) {
      const subscription = Network.addNetworkStateListener((state) => listener(isOnline(state)));
      return () => subscription.remove();
    },
  };
}
