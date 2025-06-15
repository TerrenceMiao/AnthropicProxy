import { Tiktoken, encoding_for_model, get_encoding } from 'tiktoken';
import { Message, SystemContent, Tool, ContentBlock, LogEvent } from './types';
import { Logger } from './logger';

const tokenEncoderCache: Map<string, Tiktoken> = new Map();

export function getTokenEncoder(logger?: Logger, requestId?: string): Tiktoken {
  const cacheKey = 'gpt-4';
  
  if (!tokenEncoderCache.has(cacheKey)) {
    try {
      const encoder = encoding_for_model('gpt-4');
      tokenEncoderCache.set(cacheKey, encoder);
    } catch {
      try {
        const encoder = get_encoding('cl100k_base');
        tokenEncoderCache.set(cacheKey, encoder);
        if (logger) {
          logger.warning({
            event: LogEvent.TOKEN_ENCODER_LOAD_FAILED,
            message: `Could not load tiktoken encoder for '${cacheKey}', using 'cl100k_base'. Token counts may be approximate.`,
            request_id: requestId,
            data: { model_tried: cacheKey },
          });
        }
      } catch {
        if (logger) {
          logger.critical({
            event: LogEvent.TOKEN_ENCODER_LOAD_FAILED,
            message: 'Failed to load any tiktoken encoder (gpt-4, cl100k_base). Token counting will be inaccurate.',
            request_id: requestId,
          });
        }
        
        // Create a dummy encoder as last resort
        const dummyEncoder = {
          encode: (text: string) => Array.from({ length: text.length }, (_, i) => i),
          decode: (tokens: number[]) => tokens.map(String).join(''),
          free: () => {},
          encode_ordinary: (text: string) => Array.from({ length: text.length }, (_, i) => i),
          encode_with_unstable: (text: string) => [Array.from({ length: text.length }, (_, i) => i), new Set()],
          encode_single_token: () => 0,
          decode_single_token_bytes: () => new Uint8Array(),
          decode_bytes: () => new Uint8Array(),
          name: 'dummy',
        } as unknown as Tiktoken;
        
        tokenEncoderCache.set(cacheKey, dummyEncoder);
      }
    }
  }
  
  return tokenEncoderCache.get(cacheKey)!;
}

export function countTokensForAnthropicRequest(
  messages: Message[],
  system: string | SystemContent[] | undefined,
  modelName: string,
  tools?: Tool[],
  logger?: Logger,
  requestId?: string
): number {
  const encoder = getTokenEncoder(logger, requestId);
  let totalTokens = 0;

  // Count system prompt tokens
  if (typeof system === 'string') {
    totalTokens += encoder.encode(system).length;
  } else if (Array.isArray(system)) {
    for (const block of system) {
      if (block.type === 'text') {
        totalTokens += encoder.encode(block.text).length;
      }
    }
  }

  // Count message tokens
  for (const msg of messages) {
    totalTokens += 4; // Base tokens per message
    if (msg.role) {
      totalTokens += encoder.encode(msg.role).length;
    }

    if (typeof msg.content === 'string') {
      totalTokens += encoder.encode(msg.content).length;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        totalTokens += countContentBlockTokens(block, encoder, logger, requestId);
      }
    }
  }

  // Count tool tokens
  if (tools) {
    totalTokens += 2; // Base tokens for tools
    for (const tool of tools) {
      totalTokens += encoder.encode(tool.name).length;
      if (tool.description) {
        totalTokens += encoder.encode(tool.description).length;
      }
      try {
        const schemaStr = JSON.stringify(tool.input_schema);
        totalTokens += encoder.encode(schemaStr).length;
      } catch {
        if (logger) {
          logger.warning({
            event: LogEvent.TOOL_INPUT_SERIALIZATION_FAILURE,
            message: 'Failed to serialize tool schema for token counting.',
            data: { tool_name: tool.name },
            request_id: requestId,
          });
        }
      }
    }
  }

  if (logger) {
    logger.debug({
      event: LogEvent.TOKEN_COUNT,
      message: `Estimated ${totalTokens} input tokens for model ${modelName}`,
      data: { model: modelName, token_count: totalTokens },
      request_id: requestId,
    });
  }

  return totalTokens;
}

function countContentBlockTokens(
  block: ContentBlock,
  encoder: Tiktoken,
  logger?: Logger,
  requestId?: string
): number {
  switch (block.type) {
    case 'text':
      return encoder.encode(block.text).length;
      
    case 'image':
      return 768; // Standard image token count
      
    case 'tool_use': {
      let tokens = encoder.encode(block.name).length;
      try {
        const inputStr = JSON.stringify(block.input);
        tokens += encoder.encode(inputStr).length;
      } catch {
        if (logger) {
          logger.warning({
            event: LogEvent.TOOL_INPUT_SERIALIZATION_FAILURE,
            message: 'Failed to serialize tool input for token counting.',
            data: { tool_name: block.name },
            request_id: requestId,
          });
        }
      }
      return tokens;
    }
      
    case 'tool_result':
      try {
        let contentStr = '';
        if (typeof block.content === 'string') {
          contentStr = block.content;
        } else if (Array.isArray(block.content)) {
          for (const item of block.content) {
            if (typeof item === 'object' && item !== null && 'type' in item && item.type === 'text') {
              contentStr += (item as { text?: string }).text || '';
            } else {
              contentStr += JSON.stringify(item);
            }
          }
        } else {
          contentStr = JSON.stringify(block.content);
        }
        return encoder.encode(contentStr).length;
      } catch {
        if (logger) {
          logger.warning({
            event: LogEvent.TOOL_RESULT_SERIALIZATION_FAILURE,
            message: 'Failed to serialize tool result for token counting.',
            request_id: requestId,
          });
        }
        return 0;
      }
      
    default:
      return 0;
  }
}