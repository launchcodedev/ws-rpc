/* eslint-disable no-console */

export enum LogLevel {
  Verbose = 'verbose',
  Info = 'info',
  Warn = 'warn',
  Error = 'error',
  None = 'none',
}

let logLevel: LogLevel = typeof test !== 'undefined' ? LogLevel.Error : LogLevel.Warn;

export const logger = {
  setLevel(level: LogLevel) {
    logLevel = level;
  },
  verbose(message: string) {
    if (logLevel === LogLevel.Verbose) {
      console.log(`[ws-rpc][VERBOSE] ${message}`);
    }
  },
  info(message: string) {
    if (logLevel === LogLevel.Info || logLevel === LogLevel.Verbose) {
      console.log(`[ws-rpc][INFO] ${message}`);
    }
  },
  warn(message: string) {
    if (logLevel === LogLevel.Warn || logLevel === LogLevel.Info || logLevel === LogLevel.Verbose) {
      console.warn(`[ws-rpc][WARN] ${message}`);
    }
  },
  error(message: string) {
    if (
      logLevel === LogLevel.Error ||
      logLevel === LogLevel.Warn ||
      logLevel === LogLevel.Info ||
      logLevel === LogLevel.Verbose
    ) {
      console.error(`[ws-rpc][ERROR] ${message}`);
    }
  },
};

export const setLogLevel = (level: LogLevel) => logger.setLevel(level);
