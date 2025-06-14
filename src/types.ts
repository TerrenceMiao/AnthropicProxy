import { z } from 'zod';

// Configuration types
export interface Config {
  host: string;
  port: number;
  baseUrl: string;
  openaiApiKey: string;
  bigModelName: string;
  smallModelName: string;
  referrerUrl: string;
  logLevel: string;
  logFilePath?: string;
  reload: boolean;
  appName: string;
  appVersion: string;
  claudeCodeVersion?: string;
}

// Anthropic API types
export const ContentBlockTextSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export const ContentBlockImageSourceSchema = z.object({
  type: z.string(),
  media_type: z.string(),
  data: z.string(),
});

export const ContentBlockImageSchema = z.object({
  type: z.literal('image'),
  source: ContentBlockImageSourceSchema,
});

export const ContentBlockToolUseSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.record(z.any()),
});

export const ContentBlockToolResultSchema = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string(),
  content: z.union([z.string(), z.array(z.record(z.any())), z.array(z.any())]),
  is_error: z.boolean().optional(),
});

export const ContentBlockSchema = z.union([
  ContentBlockTextSchema,
  ContentBlockImageSchema,
  ContentBlockToolUseSchema,
  ContentBlockToolResultSchema,
]);

export const SystemContentSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([z.string(), z.array(ContentBlockSchema)]),
});

export const ToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  input_schema: z.record(z.any()),
});

export const ToolChoiceSchema = z.object({
  type: z.enum(['auto', 'any', 'tool']),
  name: z.string().optional(),
});

export const MessagesRequestSchema = z.object({
  model: z.string(),
  max_tokens: z.number(),
  messages: z.array(MessageSchema),
  system: z.union([z.string(), z.array(SystemContentSchema)]).optional(),
  stop_sequences: z.array(z.string()).optional(),
  stream: z.boolean().optional().default(false),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  top_k: z.number().optional(),
  metadata: z.record(z.any()).optional(),
  tools: z.array(ToolSchema).optional(),
  tool_choice: ToolChoiceSchema.optional(),
});

export const TokenCountRequestSchema = z.object({
  model: z.string(),
  messages: z.array(MessageSchema),
  system: z.union([z.string(), z.array(SystemContentSchema)]).optional(),
  tools: z.array(ToolSchema).optional(),
});

export const UsageSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
});

export const MessagesResponseSchema = z.object({
  id: z.string(),
  type: z.literal('message'),
  role: z.literal('assistant'),
  model: z.string(),
  content: z.array(ContentBlockSchema),
  stop_reason: z.enum(['end_turn', 'max_tokens', 'stop_sequence', 'tool_use', 'error']).nullable().optional(),
  stop_sequence: z.string().nullable().optional(),
  usage: UsageSchema,
});

export const TokenCountResponseSchema = z.object({
  input_tokens: z.number(),
});

// Error types
export enum AnthropicErrorType {
  INVALID_REQUEST = 'invalid_request_error',
  AUTHENTICATION = 'authentication_error',
  PERMISSION = 'permission_error',
  NOT_FOUND = 'not_found_error',
  RATE_LIMIT = 'rate_limit_error',
  API_ERROR = 'api_error',
  OVERLOADED = 'overloaded_error',
  REQUEST_TOO_LARGE = 'request_too_large_error',
}

export const AnthropicErrorDetailSchema = z.object({
  type: z.nativeEnum(AnthropicErrorType),
  message: z.string(),
  provider: z.string().optional(),
  provider_message: z.string().optional(),
  provider_code: z.union([z.string(), z.number()]).optional(),
});

export const AnthropicErrorResponseSchema = z.object({
  type: z.literal('error'),
  error: AnthropicErrorDetailSchema,
});

// Logging types
export enum LogEvent {
  MODEL_SELECTION = 'model_selection',
  REQUEST_START = 'request_start',
  REQUEST_COMPLETED = 'request_completed',
  REQUEST_FAILURE = 'request_failure',
  ANTHROPIC_REQUEST = 'anthropic_body',
  OPENAI_REQUEST = 'openai_request',
  OPENAI_RESPONSE = 'openai_response',
  ANTHROPIC_RESPONSE = 'anthropic_response',
  STREAMING_REQUEST = 'streaming_request',
  STREAM_INTERRUPTED = 'stream_interrupted',
  TOKEN_COUNT = 'token_count',
  TOKEN_ENCODER_LOAD_FAILED = 'token_encoder_load_failed',
  SYSTEM_PROMPT_ADJUSTED = 'system_prompt_adjusted',
  TOOL_INPUT_SERIALIZATION_FAILURE = 'tool_input_serialization_failure',
  IMAGE_FORMAT_UNSUPPORTED = 'image_format_unsupported',
  MESSAGE_FORMAT_NORMALIZED = 'message_format_normalized',
  TOOL_RESULT_SERIALIZATION_FAILURE = 'tool_result_serialization_failure',
  TOOL_RESULT_PROCESSING = 'tool_result_processing',
  TOOL_CHOICE_UNSUPPORTED = 'tool_choice_unsupported',
  TOOL_ARGS_TYPE_MISMATCH = 'tool_args_type_mismatch',
  TOOL_ARGS_PARSE_FAILURE = 'tool_args_parse_failure',
  TOOL_ARGS_UNEXPECTED = 'tool_args_unexpected',
  TOOL_ID_PLACEHOLDER = 'tool_id_placeholder',
  TOOL_ID_UPDATED = 'tool_id_updated',
  PARAMETER_UNSUPPORTED = 'parameter_unsupported',
  HEALTH_CHECK = 'health_check',
  PROVIDER_ERROR_DETAILS = 'provider_error_details',
}

export interface LogError {
  name: string;
  message: string;
  stack_trace?: string;
  args?: any[];
}

export interface LogRecord {
  event: string;
  message: string;
  request_id?: string;
  data?: Record<string, any>;
  error?: LogError;
}

export interface ProviderErrorMetadata {
  provider_name: string;
  raw_error?: Record<string, any>;
}

// Type exports for Zod schemas
export type ContentBlockText = z.infer<typeof ContentBlockTextSchema>;
export type ContentBlockImage = z.infer<typeof ContentBlockImageSchema>;
export type ContentBlockToolUse = z.infer<typeof ContentBlockToolUseSchema>;
export type ContentBlockToolResult = z.infer<typeof ContentBlockToolResultSchema>;
export type ContentBlock = z.infer<typeof ContentBlockSchema>;
export type SystemContent = z.infer<typeof SystemContentSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type Tool = z.infer<typeof ToolSchema>;
export type ToolChoice = z.infer<typeof ToolChoiceSchema>;
export type MessagesRequest = z.infer<typeof MessagesRequestSchema>;
export type TokenCountRequest = z.infer<typeof TokenCountRequestSchema>;
export type Usage = z.infer<typeof UsageSchema>;
export type MessagesResponse = z.infer<typeof MessagesResponseSchema>;
export type TokenCountResponse = z.infer<typeof TokenCountResponseSchema>;
export type AnthropicErrorDetail = z.infer<typeof AnthropicErrorDetailSchema>;
export type AnthropicErrorResponse = z.infer<typeof AnthropicErrorResponseSchema>;

// OpenAI types
export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'function' | 'tool';
  content?: string | null;
  name?: string;
  function_call?: {
    name: string;
    arguments: string;
  };
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

export type StopReasonType = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'error' | null;

// Status code to error type mapping
export const STATUS_CODE_ERROR_MAP: Record<number, AnthropicErrorType> = {
  400: AnthropicErrorType.INVALID_REQUEST,
  401: AnthropicErrorType.AUTHENTICATION,
  403: AnthropicErrorType.PERMISSION,
  404: AnthropicErrorType.NOT_FOUND,
  413: AnthropicErrorType.REQUEST_TOO_LARGE,
  422: AnthropicErrorType.INVALID_REQUEST,
  429: AnthropicErrorType.RATE_LIMIT,
  500: AnthropicErrorType.API_ERROR,
  502: AnthropicErrorType.API_ERROR,
  503: AnthropicErrorType.OVERLOADED,
  504: AnthropicErrorType.API_ERROR,
};