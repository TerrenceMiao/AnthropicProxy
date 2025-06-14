import { Request, Response } from 'express';
import { APIError, AuthenticationError, RateLimitError, BadRequestError, PermissionDeniedError, NotFoundError, InternalServerError } from 'openai';
import { 
  AnthropicErrorType, 
  AnthropicErrorDetail, 
  AnthropicErrorResponse, 
  STATUS_CODE_ERROR_MAP, 
  ProviderErrorMetadata,
  LogEvent,
  LogRecord
} from './types';
import { Logger } from './logger';

export function extractProviderErrorDetails(errorDetails?: any): ProviderErrorMetadata | undefined {
  if (!errorDetails || typeof errorDetails !== 'object') {
    return undefined;
  }
  
  const metadata = errorDetails.metadata;
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }
  
  const providerName = metadata.provider_name;
  const rawErrorStr = metadata.raw;
  
  if (!providerName || typeof providerName !== 'string') {
    return undefined;
  }
  
  let parsedRawError: Record<string, any> | undefined;
  if (typeof rawErrorStr === 'string') {
    try {
      parsedRawError = JSON.parse(rawErrorStr);
    } catch {
      parsedRawError = { raw_string_parse_failed: rawErrorStr };
    }
  } else if (typeof rawErrorStr === 'object' && rawErrorStr !== null) {
    parsedRawError = rawErrorStr;
  }
  
  return {
    provider_name: providerName,
    raw_error: parsedRawError,
  };
}

export function getAnthropicErrorDetailsFromException(
  exc: Error
): {
  errorType: AnthropicErrorType;
  errorMessage: string;
  statusCode: number;
  providerDetails?: ProviderErrorMetadata;
} {
  let errorType = AnthropicErrorType.API_ERROR;
  let errorMessage = exc.message || String(exc);
  let statusCode = 500;
  let providerDetails: ProviderErrorMetadata | undefined;
  
  if (exc instanceof APIError) {
    errorMessage = exc.message || String(exc);
    statusCode = exc.status || 500;
    errorType = STATUS_CODE_ERROR_MAP[statusCode] || AnthropicErrorType.API_ERROR;
    
    // Extract provider details if available
    if ('body' in exc && typeof exc.body === 'object' && exc.body !== null) {
      const actualErrorDetails = (exc.body as any).error || exc.body;
      providerDetails = extractProviderErrorDetails(actualErrorDetails);
    }
  }
  
  // More specific error type mapping
  if (exc instanceof AuthenticationError) {
    errorType = AnthropicErrorType.AUTHENTICATION;
  } else if (exc instanceof RateLimitError) {
    errorType = AnthropicErrorType.RATE_LIMIT;
  } else if (exc instanceof BadRequestError) {
    errorType = AnthropicErrorType.INVALID_REQUEST;
  } else if (exc instanceof PermissionDeniedError) {
    errorType = AnthropicErrorType.PERMISSION;
  } else if (exc instanceof NotFoundError) {
    errorType = AnthropicErrorType.NOT_FOUND;
  } else if (exc instanceof InternalServerError) {
    errorType = AnthropicErrorType.API_ERROR;
  }
  
  return { errorType, errorMessage, statusCode, providerDetails };
}

export function formatAnthropicErrorSSEEvent(
  errorType: AnthropicErrorType,
  message: string,
  providerDetails?: ProviderErrorMetadata
): string {
  const anthropicErrDetail: AnthropicErrorDetail = {
    type: errorType,
    message,
  };
  
  if (providerDetails) {
    anthropicErrDetail.provider = providerDetails.provider_name;
    if (providerDetails.raw_error && typeof providerDetails.raw_error === 'object') {
      const provErrObj = providerDetails.raw_error.error;
      if (provErrObj && typeof provErrObj === 'object') {
        anthropicErrDetail.provider_message = provErrObj.message;
        anthropicErrDetail.provider_code = provErrObj.code;
      } else if (typeof providerDetails.raw_error.message === 'string') {
        anthropicErrDetail.provider_message = providerDetails.raw_error.message;
        anthropicErrDetail.provider_code = providerDetails.raw_error.code;
      }
    }
  }
  
  const errorResponse: AnthropicErrorResponse = {
    type: 'error',
    error: anthropicErrDetail,
  };
  
  return `event: error\ndata: ${JSON.stringify(errorResponse)}\n\n`;
}

export function buildAnthropicErrorResponse(
  errorType: AnthropicErrorType,
  message: string,
  statusCode: number,
  providerDetails?: ProviderErrorMetadata
): { statusCode: number; body: AnthropicErrorResponse } {
  const errDetail: AnthropicErrorDetail = {
    type: errorType,
    message,
  };
  
  if (providerDetails) {
    errDetail.provider = providerDetails.provider_name;
    if (providerDetails.raw_error && typeof providerDetails.raw_error === 'object') {
      const provErrObj = providerDetails.raw_error.error;
      if (provErrObj && typeof provErrObj === 'object') {
        errDetail.provider_message = provErrObj.message;
        errDetail.provider_code = provErrObj.code;
      } else if (typeof providerDetails.raw_error.message === 'string') {
        errDetail.provider_message = providerDetails.raw_error.message;
        errDetail.provider_code = providerDetails.raw_error.code;
      }
    }
  }
  
  const errorRespModel: AnthropicErrorResponse = {
    type: 'error',
    error: errDetail,
  };
  
  return {
    statusCode,
    body: errorRespModel,
  };
}

export async function logAndReturnErrorResponse(
  req: Request,
  res: Response,
  statusCode: number,
  anthropicErrorType: AnthropicErrorType,
  errorMessage: string,
  logger: Logger,
  providerDetails?: ProviderErrorMetadata,
  caughtException?: Error
): Promise<void> {
  const requestId = (req as any).requestId || 'unknown';
  const startTimeMono = (req as any).startTimeMonotonic || Date.now();
  const durationMs = Date.now() - startTimeMono;
  
  const logData: Record<string, any> = {
    status_code: statusCode,
    duration_ms: durationMs,
    error_type: anthropicErrorType,
    client_ip: req.ip || req.connection.remoteAddress || 'unknown',
  };
  
  if (providerDetails) {
    logData.provider_name = providerDetails.provider_name;
    logData.provider_raw_error = providerDetails.raw_error;
  }
  
  logger.error({
    event: LogEvent.REQUEST_FAILURE,
    message: `Request failed: ${errorMessage}`,
    request_id: requestId,
    data: logData,
  }, caughtException);
  
  const errorResponse = buildAnthropicErrorResponse(
    anthropicErrorType,
    errorMessage,
    statusCode,
    providerDetails
  );
  
  res.status(statusCode).json(errorResponse.body);
}

// Express error handlers
export function createOpenAIAPIErrorHandler(logger: Logger) {
  return async (error: APIError, req: Request, res: Response, next: Function) => {
    const { errorType, errorMessage, statusCode, providerDetails } = getAnthropicErrorDetailsFromException(error);
    await logAndReturnErrorResponse(
      req,
      res,
      statusCode,
      errorType,
      errorMessage,
      logger,
      providerDetails,
      error
    );
  };
}

export function createValidationErrorHandler(logger: Logger) {
  return async (error: Error, req: Request, res: Response, next: Function) => {
    if (error.name === 'ZodError') {
      await logAndReturnErrorResponse(
        req,
        res,
        422,
        AnthropicErrorType.INVALID_REQUEST,
        `Validation error: ${error.message}`,
        logger,
        undefined,
        error
      );
    } else {
      next(error);
    }
  };
}

export function createJSONDecodeErrorHandler(logger: Logger) {
  return async (error: SyntaxError, req: Request, res: Response, next: Function) => {
    if (error.message.includes('JSON')) {
      await logAndReturnErrorResponse(
        req,
        res,
        400,
        AnthropicErrorType.INVALID_REQUEST,
        'Invalid JSON format.',
        logger,
        undefined,
        error
      );
    } else {
      next(error);
    }
  };
}

export function createGenericErrorHandler(logger: Logger) {
  return async (error: Error, req: Request, res: Response, next: Function) => {
    await logAndReturnErrorResponse(
      req,
      res,
      500,
      AnthropicErrorType.API_ERROR,
      'An unexpected internal server error occurred.',
      logger,
      undefined,
      error
    );
  };
}