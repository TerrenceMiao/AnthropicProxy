import {
  Message,
  SystemContent,
  ContentBlock,
  Tool,
  ToolChoice,
  StopReasonType,
  LogEvent,
  MessagesResponse,
  Usage,
  ContentBlockText,
  ContentBlockToolUse,
} from './types';
import { Logger } from './logger';
import { ChatCompletion } from 'openai/resources/chat/completions';
import type { ChatCompletionMessageParam, ChatCompletionTool, ChatCompletionToolChoiceOption } from 'openai/resources/chat/completions';

export function selectTargetModel(clientModelName: string, bigModelName: string, smallModelName: string, logger: Logger, requestId: string): string {
  const clientModelLower = clientModelName.toLowerCase();
  let targetModel: string;

  if (clientModelLower.includes('opus') || clientModelLower.includes('sonnet')) {
    targetModel = bigModelName;
  } else if (clientModelLower.includes('haiku')) {
    targetModel = smallModelName;
  } else {
    targetModel = smallModelName;
    logger.warning({
      event: LogEvent.MODEL_SELECTION,
      message: `Unknown client model '${clientModelName}', defaulting to SMALL model '${targetModel}'.`,
      request_id: requestId,
      data: {
        client_model: clientModelName,
        default_target_model: targetModel,
      },
    });
  }

  logger.debug({
    event: LogEvent.MODEL_SELECTION,
    message: `Client model '${clientModelName}' mapped to target model '${targetModel}'.`,
    request_id: requestId,
    data: { client_model: clientModelName, target_model: targetModel },
  });

  return targetModel;
}

export function convertAnthropicToOpenAIMessages(
  anthropicMessages: Message[],
  anthropicSystem?: string | SystemContent[],
  logger?: Logger,
  requestId?: string
): ChatCompletionMessageParam[] {
  const openaiMessages: ChatCompletionMessageParam[] = [];

  // Handle system prompt
  let systemTextContent = '';
  if (typeof anthropicSystem === 'string') {
    systemTextContent = anthropicSystem;
  } else if (Array.isArray(anthropicSystem)) {
    const systemTexts = anthropicSystem
      .filter((block): block is SystemContent => block.type === 'text')
      .map(block => block.text);
    
    if (systemTexts.length < anthropicSystem.length && logger) {
      logger.warning({
        event: LogEvent.SYSTEM_PROMPT_ADJUSTED,
        message: 'Non-text content blocks in Anthropic system prompt were ignored.',
        request_id: requestId,
      });
    }
    systemTextContent = systemTexts.join('\n');
  }

  if (systemTextContent) {
    openaiMessages.push({ role: 'system', content: systemTextContent });
  }

  // Convert messages
  for (let i = 0; i < anthropicMessages.length; i++) {
    const msg = anthropicMessages[i];
    const { role, content } = msg;

    if (typeof content === 'string') {
      openaiMessages.push({ role, content });
      continue;
    }

    if (Array.isArray(content)) {
      const openaiPartsForUserMessage: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
      const assistantToolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];
      const textContentForAssistant: string[] = [];

      if (content.length === 0) {
        openaiMessages.push({ role, content: '' });
        continue;
      }

      for (let blockIdx = 0; blockIdx < content.length; blockIdx++) {
        const block = content[blockIdx];
        const blockLogCtx = {
          anthropic_message_index: i,
          block_index: blockIdx,
          block_type: block.type,
        };

        switch (block.type) {
          case 'text':
            if (role === 'user') {
              openaiPartsForUserMessage.push({ type: 'text', text: block.text });
            } else if (role === 'assistant') {
              textContentForAssistant.push(block.text);
            }
            break;

          case 'image':
            if (role === 'user') {
              if (block.source.type === 'base64') {
                openaiPartsForUserMessage.push({
                  type: 'image_url',
                  image_url: {
                    url: `data:${block.source.media_type};base64,${block.source.data}`,
                  },
                });
              } else if (logger) {
                logger.warning({
                  event: LogEvent.IMAGE_FORMAT_UNSUPPORTED,
                  message: `Image block with source type '${block.source.type}' (expected 'base64') ignored in user message ${i}.`,
                  request_id: requestId,
                  data: blockLogCtx,
                });
              }
            }
            break;

          case 'tool_use':
            if (role === 'assistant') {
              try {
                const argsStr = JSON.stringify(block.input);
                assistantToolCalls.push({
                  id: block.id,
                  type: 'function',
                  function: { name: block.name, arguments: argsStr },
                });
              } catch (error) {
                if (logger) {
                  logger.error({
                    event: LogEvent.TOOL_INPUT_SERIALIZATION_FAILURE,
                    message: `Failed to serialize tool input for tool '${block.name}'. Using empty JSON.`,
                    request_id: requestId,
                    data: {
                      ...blockLogCtx,
                      tool_id: block.id,
                      tool_name: block.name,
                    },
                  }, error as Error);
                }
                assistantToolCalls.push({
                  id: block.id,
                  type: 'function',
                  function: { name: block.name, arguments: '{}' },
                });
              }
            }
            break;

          case 'tool_result':
            if (role === 'user') {
              const serializedContent = serializeToolResultContentForOpenAI(
                block.content,
                logger,
                requestId,
                blockLogCtx
              );
              openaiMessages.push({
                role: 'tool',
                tool_call_id: block.tool_use_id,
                content: serializedContent,
              });
            }
            break;
        }
      }

      // Handle user message parts
      if (role === 'user' && openaiPartsForUserMessage.length > 0) {
        const isMultimodal = openaiPartsForUserMessage.some(part => part.type === 'image_url');
        if (isMultimodal || openaiPartsForUserMessage.length > 1) {
          openaiMessages.push({ role: 'user', content: JSON.stringify(openaiPartsForUserMessage) });
        } else if (openaiPartsForUserMessage.length === 1 && openaiPartsForUserMessage[0].type === 'text') {
          openaiMessages.push({ role: 'user', content: openaiPartsForUserMessage[0].text! });
        }
      } else if (role === 'user' && openaiPartsForUserMessage.length === 0) {
        openaiMessages.push({ role: 'user', content: '' });
      }

      // Handle assistant messages
      if (role === 'assistant') {
        const assistantText = textContentForAssistant.filter(Boolean).join('\n');
        if (assistantText) {
          openaiMessages.push({ role: 'assistant', content: assistantText });
        }

        if (assistantToolCalls.length > 0) {
          const lastMessage = openaiMessages[openaiMessages.length - 1];
          if (lastMessage?.role === 'assistant' && lastMessage.content && !lastMessage.tool_calls) {
            // Add tool calls to separate message
            openaiMessages.push({
              role: 'assistant',
              content: null,
              tool_calls: assistantToolCalls,
            });
          } else if (lastMessage?.role === 'assistant' && !lastMessage.tool_calls) {
            // Add tool calls to existing message
            lastMessage.tool_calls = assistantToolCalls;
            lastMessage.content = null;
          } else {
            // Create new message with tool calls
            openaiMessages.push({
              role: 'assistant',
              content: null,
              tool_calls: assistantToolCalls,
            });
          }
        }
      }
    }
  }

  // Normalize messages with tool_calls
  const finalOpenAIMessages = openaiMessages.map(msg => {
    if (msg.role === 'assistant' && msg.tool_calls && msg.content !== null && logger) {
      logger.warning({
        event: LogEvent.MESSAGE_FORMAT_NORMALIZED,
        message: 'Corrected assistant message with tool_calls to have content: null.',
        request_id: requestId,
        data: { original_content: msg.content },
      });
      return { ...msg, content: null };
    }
    return msg;
  });

  return finalOpenAIMessages;
}

function serializeToolResultContentForOpenAI(
  anthropicToolResultContent: string | Record<string, unknown>[] | unknown[],
  logger?: Logger,
  requestId?: string,
  logContext?: Record<string, unknown>
): string {
  if (typeof anthropicToolResultContent === 'string') {
    return anthropicToolResultContent;
  }

  if (Array.isArray(anthropicToolResultContent)) {
    const processedParts: string[] = [];
    let containsNonTextBlock = false;

    for (const item of anthropicToolResultContent) {
      if (typeof item === 'object' && item !== null && 'type' in item && item.type === 'text' && 'text' in item) {
        processedParts.push(String(item.text));
      } else {
        try {
          processedParts.push(JSON.stringify(item));
          containsNonTextBlock = true;
        } catch {
          processedParts.push(`<unserializable_item type='${typeof item}'>`);
          containsNonTextBlock = true;
        }
      }
    }

    const resultStr = processedParts.join('\n');
    if (containsNonTextBlock && logger) {
      logger.warning({
        event: LogEvent.TOOL_RESULT_PROCESSING,
        message: 'Tool result content list contained non-text or complex items; parts were JSON stringified.',
        request_id: requestId,
        data: { ...logContext, result_str_preview: resultStr.substring(0, 100) },
      });
    }
    return resultStr;
  }

  try {
    return JSON.stringify(anthropicToolResultContent);
  } catch (error) {
    if (logger) {
      logger.warning({
        event: LogEvent.TOOL_RESULT_SERIALIZATION_FAILURE,
        message: `Failed to serialize tool result content to JSON: ${error}. Returning error JSON.`,
        request_id: requestId,
        data: logContext,
      });
    }
    return JSON.stringify({
      error: 'Serialization failed',
      original_type: typeof anthropicToolResultContent,
    });
  }
}

export function convertAnthropicToolsToOpenAI(anthropicTools?: Tool[]): ChatCompletionTool[] | undefined {
  if (!anthropicTools) {
    return undefined;
  }
  return anthropicTools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));
}

export function convertAnthropicToolChoiceToOpenAI(
  anthropicChoice?: ToolChoice,
  logger?: Logger,
  requestId?: string
): ChatCompletionToolChoiceOption | undefined {
  if (!anthropicChoice) {
    return undefined;
  }

  if (anthropicChoice.type === 'auto') {
    return 'auto';
  }

  if (anthropicChoice.type === 'any') {
    if (logger) {
      logger.warning({
        event: LogEvent.TOOL_CHOICE_UNSUPPORTED,
        message: "Anthropic tool_choice type 'any' mapped to OpenAI 'auto'. Exact behavior might differ (OpenAI 'auto' allows no tool use).",
        request_id: requestId,
        data: { anthropic_tool_choice: anthropicChoice },
      });
    }
    return 'auto';
  }

  if (anthropicChoice.type === 'tool' && anthropicChoice.name) {
    return { type: 'function' as const, function: { name: anthropicChoice.name } };
  }

  if (logger) {
    logger.warning({
      event: LogEvent.TOOL_CHOICE_UNSUPPORTED,
      message: `Unsupported Anthropic tool_choice: ${JSON.stringify(anthropicChoice)}. Defaulting to 'auto'.`,
      request_id: requestId,
      data: { anthropic_tool_choice: anthropicChoice },
    });
  }
  return 'auto';
}

export function convertOpenAIToAnthropicResponse(
  openaiResponse: ChatCompletion,
  originalAnthropicModelName: string,
  logger?: Logger,
  requestId?: string
): MessagesResponse {
  const anthropicContent: ContentBlock[] = [];
  let anthropicStopReason: StopReasonType = null;

  const stopReasonMap: Record<string, StopReasonType> = {
    stop: 'end_turn',
    length: 'max_tokens',
    tool_calls: 'tool_use',
    function_call: 'tool_use',
    content_filter: 'stop_sequence',
  };

  if (openaiResponse.choices && openaiResponse.choices.length > 0) {
    const choice = openaiResponse.choices[0];
    const message = choice.message;
    const finishReason = choice.finish_reason;

    anthropicStopReason = stopReasonMap[finishReason || ''] || 'end_turn';

    if (message.content) {
      anthropicContent.push({
        type: 'text',
        text: message.content,
      } as ContentBlockText);
    }

    if (message.tool_calls) {
      for (const call of message.tool_calls) {
        if (call.type === 'function') {
          let toolInputDict: Record<string, unknown> = {};
          try {
            const parsedInput = JSON.parse(call.function.arguments);
            if (typeof parsedInput === 'object' && parsedInput !== null) {
              toolInputDict = parsedInput;
            } else {
              toolInputDict = { value: parsedInput };
              if (logger) {
                logger.warning({
                  event: LogEvent.TOOL_ARGS_TYPE_MISMATCH,
                  message: `OpenAI tool arguments for '${call.function.name}' parsed to non-dict type '${typeof parsedInput}'. Wrapped in 'value'.`,
                  request_id: requestId,
                  data: {
                    tool_name: call.function.name,
                    tool_id: call.id,
                  },
                });
              }
            }
          } catch (error) {
            if (logger) {
              logger.error({
                event: LogEvent.TOOL_ARGS_PARSE_FAILURE,
                message: `Failed to parse JSON arguments for tool '${call.function.name}'. Storing raw string.`,
                request_id: requestId,
                data: {
                  tool_name: call.function.name,
                  tool_id: call.id,
                  raw_args: call.function.arguments,
                },
              }, error as Error);
            }
            toolInputDict = { error_parsing_arguments: call.function.arguments };
          }

          anthropicContent.push({
            type: 'tool_use',
            id: call.id,
            name: call.function.name,
            input: toolInputDict,
          } as ContentBlockToolUse);
        }
      }
      if (finishReason === 'tool_calls') {
        anthropicStopReason = 'tool_use';
      }
    }
  }

  if (anthropicContent.length === 0) {
    anthropicContent.push({
      type: 'text',
      text: '',
    } as ContentBlockText);
  }

  const usage = openaiResponse.usage;
  const anthropicUsage: Usage = {
    input_tokens: usage?.prompt_tokens || 0,
    output_tokens: usage?.completion_tokens || 0,
  };

  const responseId = openaiResponse.id 
    ? `msg_${openaiResponse.id}` 
    : `msg_${requestId}_completed`;

  return {
    id: responseId,
    type: 'message',
    role: 'assistant',
    model: originalAnthropicModelName,
    content: anthropicContent,
    stop_reason: anthropicStopReason,
    usage: anthropicUsage,
  };
}