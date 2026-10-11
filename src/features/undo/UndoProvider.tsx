import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { logger } from '@/lib/logger';
import { Toast } from '@/ui';

/** Tiempo que el aviso con "Deshacer" queda visible si no hay lector de pantalla. */
export const UNDO_TIMEOUT_MS = 6000;

export interface UndoRequest {
  /** Lo que acaba de pasar, ya traducido: "Gasto borrado". */
  readonly message: string;
  /** Revierte la acción. Si falla, el aviso lo dice. */
  readonly undo: () => void;
}

interface Notice {
  readonly id: number;
  readonly message: string;
  readonly undo?: () => void;
}

interface UndoContextValue {
  /** Muestra el aviso con "Deshacer" y reemplaza el anterior. */
  offerUndo(request: UndoRequest): void;
}

const UndoContext = createContext<UndoContextValue | null>(null);

/**
 * Aviso con "Deshacer" para acciones inmediatas: borrar un movimiento o marcar una
 * transferencia como pagada. Dura 6 segundos; con lector de pantalla activo se anuncia y
 * no se cierra solo, para que dé tiempo de llegar al botón.
 */
export function UndoProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [screenReader, setScreenReader] = useState(false);
  const nextId = useRef(0);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
      if (active) {
        setScreenReader(enabled);
      }
    });
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!notice || screenReader) {
      return;
    }
    const timer = setTimeout(() => setNotice(null), UNDO_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [notice, screenReader]);

  const offerUndo = useCallback(
    ({ message, undo }: UndoRequest) => {
      nextId.current += 1;
      setNotice({ id: nextId.current, message, undo });
      AccessibilityInfo.announceForAccessibility(`${message}. ${t('undo.hint')}`);
    },
    [t],
  );

  const runUndo = useCallback(() => {
    if (!notice?.undo) {
      return;
    }
    try {
      notice.undo();
      setNotice(null);
    } catch (error) {
      logger.warn('No se pudo deshacer', error);
      nextId.current += 1;
      setNotice({ id: nextId.current, message: t('undo.failed') });
    }
  }, [notice, t]);

  const value = useMemo(() => ({ offerUndo }), [offerUndo]);

  return (
    <UndoContext.Provider value={value}>
      {children}
      {notice ? (
        <View
          pointerEvents="box-none"
          className="absolute inset-x-0 px-4"
          style={{ bottom: insets.bottom + 72 }}
        >
          <Toast
            key={notice.id}
            message={notice.message}
            actionLabel={notice.undo ? t('undo.action') : undefined}
            onAction={notice.undo ? runUndo : undefined}
            onDismiss={() => setNotice(null)}
          />
        </View>
      ) : null}
    </UndoContext.Provider>
  );
}

export function useUndo(): UndoContextValue {
  const value = useContext(UndoContext);
  if (!value) {
    throw new Error('useUndo solo se puede usar dentro de UndoProvider');
  }
  return value;
}
