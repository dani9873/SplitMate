import { create } from 'zustand';

/** Aviso que la bienvenida muestra después de cerrar sesión borrando datos o la cuenta. */
export type AccountNotice =
  'accountDeleted' | 'accountDeletedDataKept' | 'dataDeleted' | 'dataDeleteFailed';

interface AccountNoticeState {
  readonly notice: AccountNotice | null;
  show(notice: AccountNotice): void;
  clear(): void;
}

/** Estado de UI: vive en memoria y se descarta al leerlo. */
export const useAccountNotice = create<AccountNoticeState>((set) => ({
  notice: null,
  show: (notice) => set({ notice }),
  clear: () => set({ notice: null }),
}));
