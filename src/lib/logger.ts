type Level = 'debug' | 'info' | 'warn' | 'error';

/**
 * Registro mínimo de la app. En desarrollo escribe en la consola y en producción no
 * hace nada hasta que se integre un servicio de errores.
 * Nunca registres montos, tokens ni datos personales.
 */
function log(level: Level, message: string, ...details: unknown[]): void {
  if (!__DEV__) {
    return;
  }
  console[level](`[SplitMate] ${message}`, ...details);
}

export const logger = {
  debug: (message: string, ...details: unknown[]) => log('debug', message, ...details),
  info: (message: string, ...details: unknown[]) => log('info', message, ...details),
  warn: (message: string, ...details: unknown[]) => log('warn', message, ...details),
  error: (message: string, ...details: unknown[]) => log('error', message, ...details),
};
