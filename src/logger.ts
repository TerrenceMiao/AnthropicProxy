import winston from 'winston';
import { Config, LogRecord } from './types';

class JSONFormatter {
  transform(info: winston.Logform.TransformableInfo) {
    const logRecord = info.logRecord as LogRecord | undefined;
    const timestamp = new Date().toISOString();
    
    const header: Record<string, unknown> = {
      timestamp,
      level: info.level.toUpperCase(),
      logger: info.label || 'AnthropicProxy',
    };

    if (logRecord) {
      header.detail = logRecord;
    } else {
      header.message = info.message;
      if (info.error) {
        header.error = info.error;
      }
    }

    return JSON.stringify(header);
  }
}

class ConsoleJSONFormatter extends JSONFormatter {
  transform(info: winston.Logform.TransformableInfo) {
    const jsonStr = super.transform(info);
    const logDict = JSON.parse(jsonStr);
    
    // Remove stack_trace from console output for readability
    if (logDict.detail?.error?.stack_trace) {
      delete logDict.detail.error.stack_trace;
    } else if (logDict.error?.stack_trace) {
      delete logDict.error.stack_trace;
    }
    
    return JSON.stringify(logDict);
  }
}

export function createLogger(config: Config): winston.Logger {
  const transports: winston.transport[] = [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.label({ label: config.appName }),
        winston.format.printf((info) => new ConsoleJSONFormatter().transform(info))
      ),
      level: config.logLevel.toLowerCase(),
    }),
  ];

  // Add file transport if log file path is specified
  if (config.logFilePath) {
    try {
      transports.push(
        new winston.transports.File({
          filename: config.logFilePath,
          format: winston.format.combine(
            winston.format.label({ label: config.appName }),
            winston.format.printf((info) => new JSONFormatter().transform(info))
          ),
          level: config.logLevel.toLowerCase(),
        })
      );
    } catch (error) {
      console.error(`Failed to configure file logging to ${config.logFilePath}:`, error);
    }
  }

  const logger = winston.createLogger({
    level: config.logLevel.toLowerCase(),
    transports,
    exitOnError: false,
  });

  return logger;
}

export class Logger {
  constructor(private logger: winston.Logger) {}

  private log(level: string, record: LogRecord, exc?: Error): void {
    if (exc) {
      record.error = {
        name: exc.name,
        message: exc.message,
        stack_trace: exc.stack,
        args: [],
      };
      if (!record.message && exc.message) {
        record.message = exc.message;
      } else if (!record.message) {
        record.message = 'An unspecified error occurred';
      }
    }

    this.logger.log(level, record.message, { logRecord: record });
  }

  debug(record: LogRecord): void {
    this.log('debug', record);
  }

  info(record: LogRecord): void {
    this.log('info', record);
  }

  warning(record: LogRecord, exc?: Error): void {
    this.log('warn', record, exc);
  }

  error(record: LogRecord, exc?: Error): void {
    if (exc) {
      console.error(exc.stack);
    }
    this.log('error', record, exc);
  }

  critical(record: LogRecord, exc?: Error): void {
    this.log('error', record, exc);
  }
}

// Create a context for request IDs
class RequestContext {
  private static instance: RequestContext;
  private requestId?: string;

  static getInstance(): RequestContext {
    if (!RequestContext.instance) {
      RequestContext.instance = new RequestContext();
    }
    return RequestContext.instance;
  }

  setRequestId(id: string): void {
    this.requestId = id;
  }

  getRequestId(): string | undefined {
    return this.requestId;
  }

  clearRequestId(): void {
    this.requestId = undefined;
  }
}

export const requestContext = RequestContext.getInstance();