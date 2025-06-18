import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import type { ChatCompletionCreateParams } from 'openai/resources/chat/completions';
import { 
  Config, 
  MessagesRequestSchema, 
  TokenCountRequestSchema,
  LogEvent,
  AnthropicErrorType 
} from './types.js';
import { Logger } from './logger.js';
import {
  selectTargetModel,
  convertAnthropicToOpenAIMessages,
  convertAnthropicToolsToOpenAI,
  convertAnthropicToolChoiceToOpenAI,
  convertOpenAIToAnthropicResponse
} from './converter.js';
import { countTokensForAnthropicRequest } from './tokenizer.js';
import { handleAnthropicStreamingResponseFromOpenAIStream } from './streaming.js';
import {
  logAndReturnErrorResponse,
  getAnthropicErrorDetailsFromException,
  createOpenAIAPIErrorHandler,
  createValidationErrorHandler,
  createJSONDecodeErrorHandler,
  createGenericErrorHandler
} from './errors.js';

export async function startServer(config: Config, logger: Logger): Promise<void> {
  const app = express();
  
  // Initialize OpenAI client
  let openaiClient: OpenAI;
  try {
    openaiClient = new OpenAI({
      apiKey: config.openaiApiKey,
      baseURL: config.baseUrl,
      defaultHeaders: {
        'HTTP-Referer': config.referrerUrl,
        'X-Title': config.appName,
      },
      timeout: 180000,
    });
  } catch (error) {
    logger.critical({
      event: 'openai_client_init_failed',
      message: 'Failed to initialize OpenAI client',
    }, error as Error);
    process.exit(1);
  }

  // Middleware
  app.use(express.json({ limit: '100mb' }));
  
  // Request logging middleware
  app.use((req: Request, res: Response, next) => {
    (req as Request & { requestId: string; startTimeMonotonic: number }).requestId = uuidv4();
    (req as Request & { requestId: string; startTimeMonotonic: number }).startTimeMonotonic = Date.now();
    
    res.setHeader('X-Request-ID', (req as Request & { requestId: string }).requestId);
    
    const originalSend = res.send;
    res.send = function(body) {
      const durationMs = Date.now() - (req as Request & { startTimeMonotonic: number }).startTimeMonotonic;
      res.setHeader('X-Response-Time-ms', durationMs.toString());
      return originalSend.call(this, body);
    };
    
    next();
  });

  // Health check endpoint
  app.get('/', (req: Request, res: Response) => {
    logger.debug({
      event: LogEvent.HEALTH_CHECK,
      message: 'Root health check accessed',
    });
    
    res.json({
      proxy_name: config.appName,
      version: config.appVersion,
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  // Token counting endpoint
  app.post('/v1/messages/count_tokens', async (req: Request, res: Response) => {
    const requestId = (req as Request & { requestId: string }).requestId;
    const startTimeMono = (req as Request & { startTimeMonotonic: number }).startTimeMonotonic;
    
    try {
      const countRequest = TokenCountRequestSchema.parse(req.body);
      
      const tokenCount = countTokensForAnthropicRequest(
        countRequest.messages,
        countRequest.system,
        countRequest.model,
        countRequest.tools,
        logger,
        requestId
      );
      
      const durationMs = Date.now() - startTimeMono;
      logger.info({
        event: LogEvent.TOKEN_COUNT,
        message: `Counted ${tokenCount} tokens`,
        request_id: requestId,
        data: {
          duration_ms: durationMs,
          token_count: tokenCount,
          model: countRequest.model,
        },
      });
      
      res.json({ input_tokens: tokenCount });
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        await logAndReturnErrorResponse(
          req,
          res,
          422,
          AnthropicErrorType.INVALID_REQUEST,
          `Invalid request body: ${error.message}`,
          logger,
          undefined,
          error
        );
      } else {
        await logAndReturnErrorResponse(
          req,
          res,
          400,
          AnthropicErrorType.INVALID_REQUEST,
          'Invalid JSON body.',
          logger,
          undefined,
          error as Error
        );
      }
    }
  });

  // Main messages endpoint
  app.post('/v1/messages', async (req: Request, res: Response) => {
    const requestId = (req as Request & { requestId: string }).requestId;
    const startTimeMono = (req as Request & { startTimeMonotonic: number }).startTimeMonotonic;
    
    try {
      logger.debug({
        event: LogEvent.ANTHROPIC_REQUEST,
        message: 'Received Anthropic request body',
        request_id: requestId,
        data: { body: req.body },
      });

      const anthropicRequest = MessagesRequestSchema.parse(req.body);
      
      // Validate top_k parameter
      if (anthropicRequest.top_k !== undefined) {
        logger.warning({
          event: LogEvent.PARAMETER_UNSUPPORTED,
          message: "Parameter 'top_k' provided by client but is not directly supported by the OpenAI Chat Completions API and will be ignored.",
          request_id: requestId,
          data: { parameter: 'top_k', value: anthropicRequest.top_k },
        });
      }
      
      const isStream = anthropicRequest.stream || false;
      const targetModelName = selectTargetModel(
        anthropicRequest.model,
        config.bigModelName,
        config.smallModelName,
        logger,
        requestId
      );
      
      const estimatedInputTokens = countTokensForAnthropicRequest(
        anthropicRequest.messages,
        anthropicRequest.system,
        anthropicRequest.model,
        anthropicRequest.tools,
        logger,
        requestId
      );
      
      logger.info({
        event: LogEvent.REQUEST_START,
        message: 'Processing new message request',
        request_id: requestId,
        data: {
          client_model: anthropicRequest.model,
          target_model: targetModelName,
          stream: isStream,
          estimated_input_tokens: estimatedInputTokens,
          client_ip: req.ip || req.connection.remoteAddress || 'unknown',
          user_agent: req.get('user-agent') || 'unknown',
        },
      });
      
      // Convert request
      const openaiMessages = convertAnthropicToOpenAIMessages(
        anthropicRequest.messages,
        anthropicRequest.system,
        logger,
        requestId
      );
      const openaiTools = convertAnthropicToolsToOpenAI(anthropicRequest.tools);
      const openaiToolChoice = convertAnthropicToolChoiceToOpenAI(
        anthropicRequest.tool_choice,
        logger,
        requestId
      );
      
      const openaiParams: ChatCompletionCreateParams = {
        model: targetModelName,
        messages: openaiMessages,
        max_tokens: anthropicRequest.max_tokens,
        stream: isStream,
      };
      
      if (anthropicRequest.temperature !== undefined) {
        openaiParams.temperature = anthropicRequest.temperature;
      }
      if (anthropicRequest.top_p !== undefined) {
        openaiParams.top_p = anthropicRequest.top_p;
      }
      if (anthropicRequest.stop_sequences) {
        openaiParams.stop = anthropicRequest.stop_sequences;
      }
      if (openaiTools) {
        openaiParams.tools = openaiTools;
      }
      if (openaiToolChoice) {
        openaiParams.tool_choice = openaiToolChoice;
      }
      if (anthropicRequest.metadata?.user_id) {
        openaiParams.user = String(anthropicRequest.metadata.user_id);
      }
      
      logger.debug({
        event: LogEvent.OPENAI_REQUEST,
        message: 'Prepared OpenAI request parameters',
        request_id: requestId,
        data: { params: openaiParams },
      });
      
      if (isStream) {
        logger.debug({
          event: LogEvent.STREAMING_REQUEST,
          message: 'Initiating streaming request to OpenAI-compatible API',
          request_id: requestId,
        });
        
        const streamParams: ChatCompletionCreateParams = { ...openaiParams, stream: true };
        const openaiStreamResponse = await openaiClient.chat.completions.create(streamParams);
        
        await handleAnthropicStreamingResponseFromOpenAIStream(
          openaiStreamResponse,
          anthropicRequest.model,
          estimatedInputTokens,
          requestId,
          startTimeMono,
          res,
          logger
        );
      } else {
        logger.debug({
          event: LogEvent.OPENAI_REQUEST,
          message: 'Sending non-streaming request to OpenAI-compatible API',
          request_id: requestId,
        });
        
        const nonStreamParams: ChatCompletionCreateParams = { ...openaiParams, stream: false };
        const openaiResponseObj = await openaiClient.chat.completions.create(nonStreamParams);
        
        logger.debug({
          event: LogEvent.OPENAI_RESPONSE,
          message: 'Received OpenAI response',
          request_id: requestId,
          data: { response: openaiResponseObj },
        });
        
        const anthropicResponseObj = convertOpenAIToAnthropicResponse(
          openaiResponseObj,
          anthropicRequest.model,
          logger,
          requestId
        );
        
        const durationMs = Date.now() - startTimeMono;
        logger.info({
          event: LogEvent.REQUEST_COMPLETED,
          message: 'Non-streaming request completed successfully',
          request_id: requestId,
          data: {
            status_code: 200,
            duration_ms: durationMs,
            input_tokens: anthropicResponseObj.usage.input_tokens,
            output_tokens: anthropicResponseObj.usage.output_tokens,
            stop_reason: anthropicResponseObj.stop_reason,
          },
        });
        
        logger.debug({
          event: LogEvent.ANTHROPIC_RESPONSE,
          message: 'Prepared Anthropic response',
          request_id: requestId,
          data: { response: anthropicResponseObj },
        });
        
        res.json(anthropicResponseObj);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        await logAndReturnErrorResponse(
          req,
          res,
          422,
          AnthropicErrorType.INVALID_REQUEST,
          `Invalid request body: ${error.message}`,
          logger,
          undefined,
          error
        );
      } else if (error instanceof SyntaxError && error.message.includes('JSON')) {
        await logAndReturnErrorResponse(
          req,
          res,
          400,
          AnthropicErrorType.INVALID_REQUEST,
          'Invalid JSON body.',
          logger,
          undefined,
          error
        );
      } else if (error instanceof OpenAI.APIError) {
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
      } else {
        await logAndReturnErrorResponse(
          req,
          res,
          500,
          AnthropicErrorType.API_ERROR,
          'An unexpected error occurred while processing the request.',
          logger,
          undefined,
          error as Error
        );
      }
    }
  });

  // Error handlers
  app.use(createOpenAIAPIErrorHandler(logger));
  app.use(createValidationErrorHandler(logger));
  app.use(createJSONDecodeErrorHandler(logger));
  app.use(createGenericErrorHandler(logger));

  // Start server
  return new Promise((resolve, reject) => {
    const server = app.listen(config.port, config.host, () => {
      console.log('\x1b[34m%s\x1b[0m', `
  /$$$$$$              /$$     /$$                                     /$$                 /$$$$$$$                                        
 /$$__  $$            | $$    | $$                                    |__/                | $$__  $$                                       
| $$  \\ $$ /$$$$$$$  /$$$$$$  | $$$$$$$   /$$$$$$   /$$$$$$   /$$$$$$  /$$  /$$$$$$$      | $$  \\ $$ /$$$$$$   /$$$$$$  /$$   /$$ /$$   /$$
| $$$$$$$$| $$__  $$|_  $$_/  | $$__  $$ /$$__  $$ /$$__  $$ /$$__  $$| $$ /$$_____/      | $$$$$$$//$$__  $$ /$$__  $$|  $$ /$$/| $$  | $$
| $$__  $$| $$  \\ $$  | $$    | $$  \\ $$| $$  \\__/| $$  \\ $$| $$  \\ $$| $$| $$            | $$____/| $$  \\__/| $$  \\ $$ \\  $$$$/ | $$  | $$
| $$  | $$| $$  | $$  | $$ /$$| $$  | $$| $$      | $$  | $$| $$  | $$| $$| $$            | $$     | $$      | $$  | $$  >$$  $$ | $$  | $$
| $$  | $$| $$  | $$  |  $$$$/| $$  | $$| $$      |  $$$$$$/| $$$$$$$/| $$|  $$$$$$$      | $$     | $$      |  $$$$$$/ /$$/\\  $$|  $$$$$$$
|__/  |__/|__/  |__/   \\___/  |__/  |__/|__/       \\______/ | $$____/ |__/ \\_______/      |__/     |__/       \\______/ |__/  \\__/ \\____  $$
                                                            | $$                                                                  /$$  | $$
                                                            | $$                                                                 |  $$$$$$/
                                                            |__/                                                       NextGen™   \\______/  
      `);
      
      console.log('\n📊 \x1b[36m%s\x1b[0m', 'Anthropic Proxy Configuration');
      console.log('   Version       :', `\x1b[96mv${config.appVersion}\x1b[0m`);
      console.log('   Listening on  :', `\x1b[33mhttp://${config.host}:${config.port}\x1b[0m`);
      console.log('   Forwarding to :', `\x1b[94m${config.baseUrl}\x1b[0m`);
      console.log('   Big Model     :', `\x1b[95m${config.bigModelName}\x1b[0m`);
      console.log('   Small Model   :', `\x1b[92m${config.smallModelName}\x1b[0m`);
      console.log('   Log Level     :', `\x1b[93m${config.logLevel.toUpperCase()}\x1b[0m`);
      console.log('   Log File      :', `\x1b[90m${config.logFilePath || 'Disabled'}\x1b[0m`);
      console.log('   Reload        :', config.reload ? '\x1b[91mEnabled\x1b[0m' : '\x1b[90mDisabled\x1b[0m');
      console.log('   Claude CLI    :', `\x1b[32m${config.claudeCodeVersion || '?.?.?'}\x1b[0m`);
      console.log('\n🚀 \x1b[36m%s\x1b[0m', 'Server started successfully!');
      
      resolve();
    });

    server.on('error', (error) => {
      logger.critical({
        event: 'server_start_failed',
        message: 'Failed to start server',
      }, error);
      reject(error);
    });
  });
}
