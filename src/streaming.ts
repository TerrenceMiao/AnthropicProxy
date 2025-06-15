import { Response } from 'express';
import { ChatCompletionChunk } from 'openai/resources/chat/completions';
import { Stream } from 'openai/streaming';
import { v4 as uuidv4 } from 'uuid';
import { getTokenEncoder } from './tokenizer';
import { Logger } from './logger';
import { LogEvent, StopReasonType, AnthropicErrorType } from './types';

interface ToolState {
  id: string;
  name: string;
  arguments_buffer: string;
}

export async function handleAnthropicStreamingResponseFromOpenAIStream(
  openaiStream: Stream<ChatCompletionChunk>,
  originalAnthropicModelName: string,
  estimatedInputTokens: number,
  requestId: string,
  startTimeMono: number,
  res: Response,
  logger: Logger
): Promise<void> {
  const anthropicMessageId = `msg_stream_${requestId}_${uuidv4().slice(0, 8)}`;
  
  let nextAnthropicBlockIdx = 0;
  let textBlockAnthropicIdx: number | null = null;
  const openaiToolIdxToAnthropicBlockIdx: Map<number, number> = new Map();
  const toolStates: Map<number, ToolState> = new Map();
  const sentToolBlockStarts = new Set<number>();
  
  let outputTokenCount = 0;
  let finalAnthropicStopReason: StopReasonType = null;
  
  const encoder = getTokenEncoder(logger, requestId);
  
  const openaiToAnthropicStopReasonMap: Record<string, StopReasonType> = {
    stop: 'end_turn',
    length: 'max_tokens',
    tool_calls: 'tool_use',
    function_call: 'tool_use',
    content_filter: 'stop_sequence',
  };
  
  let streamStatusCode = 200;
  let streamFinalMessage = 'Streaming request completed successfully.';
  let streamLogEvent = LogEvent.REQUEST_COMPLETED;
  
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Request-ID': requestId,
  });
  
  function writeSSE(event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  
  try {
    // Send initial message_start event
    const messageStartEventData = {
      type: 'message_start',
      message: {
        id: anthropicMessageId,
        type: 'message',
        role: 'assistant',
        model: originalAnthropicModelName,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: estimatedInputTokens, output_tokens: 0 },
      },
    };
    writeSSE('message_start', messageStartEventData);
    writeSSE('ping', { type: 'ping' });
    
    for await (const chunk of openaiStream) {
      if (!chunk.choices || chunk.choices.length === 0) {
        continue;
      }
      
      const delta = chunk.choices[0].delta;
      const openaiFinishReason = chunk.choices[0].finish_reason;
      
      // Handle content delta
      if (delta.content) {
        outputTokenCount += encoder.encode(delta.content).length;
        
        if (textBlockAnthropicIdx === null) {
          textBlockAnthropicIdx = nextAnthropicBlockIdx;
          nextAnthropicBlockIdx += 1;
          
          const startTextEvent = {
            type: 'content_block_start',
            index: textBlockAnthropicIdx,
            content_block: { type: 'text', text: '' },
          };
          writeSSE('content_block_start', startTextEvent);
        }
        
        const textDeltaEvent = {
          type: 'content_block_delta',
          index: textBlockAnthropicIdx,
          delta: { type: 'text_delta', text: delta.content },
        };
        writeSSE('content_block_delta', textDeltaEvent);
      }
      
      // Handle tool calls delta
      if (delta.tool_calls) {
        for (const toolDelta of delta.tool_calls) {
          const openaiTcIdx = toolDelta.index!;
          
          if (!openaiToolIdxToAnthropicBlockIdx.has(openaiTcIdx)) {
            const currentAnthropicToolBlockIdx = nextAnthropicBlockIdx;
            nextAnthropicBlockIdx += 1;
            openaiToolIdxToAnthropicBlockIdx.set(openaiTcIdx, currentAnthropicToolBlockIdx);
            
            toolStates.set(currentAnthropicToolBlockIdx, {
              id: toolDelta.id || `tool_ph_${requestId}_${currentAnthropicToolBlockIdx}`,
              name: '',
              arguments_buffer: '',
            });
            
            if (!toolDelta.id) {
              logger.warning({
                event: LogEvent.TOOL_ID_PLACEHOLDER,
                message: `Generated placeholder Tool ID for OpenAI tool index ${openaiTcIdx} -> Anthropic block ${currentAnthropicToolBlockIdx}`,
                request_id: requestId,
              });
            }
          }
          
          const currentAnthropicToolBlockIdx = openaiToolIdxToAnthropicBlockIdx.get(openaiTcIdx)!;
          const toolState = toolStates.get(currentAnthropicToolBlockIdx)!;
          
          if (toolDelta.id && toolState.id.startsWith('tool_ph_')) {
            logger.debug({
              event: LogEvent.TOOL_ID_UPDATED,
              message: `Updated placeholder Tool ID for Anthropic block ${currentAnthropicToolBlockIdx} to ${toolDelta.id}`,
              request_id: requestId,
            });
            toolState.id = toolDelta.id;
          }
          
          if (toolDelta.function) {
            if (toolDelta.function.name) {
              toolState.name = toolDelta.function.name;
            }
            if (toolDelta.function.arguments) {
              toolState.arguments_buffer += toolDelta.function.arguments;
              outputTokenCount += encoder.encode(toolDelta.function.arguments).length;
            }
          }
          
          // Send content_block_start for tool if ready
          if (
            !sentToolBlockStarts.has(currentAnthropicToolBlockIdx) &&
            toolState.id &&
            !toolState.id.startsWith('tool_ph_') &&
            toolState.name
          ) {
            const startToolEvent = {
              type: 'content_block_start',
              index: currentAnthropicToolBlockIdx,
              content_block: {
                type: 'tool_use',
                id: toolState.id,
                name: toolState.name,
                input: {},
              },
            };
            writeSSE('content_block_start', startToolEvent);
            sentToolBlockStarts.add(currentAnthropicToolBlockIdx);
          }
          
          // Send tool arguments delta
          if (
            toolDelta.function?.arguments &&
            sentToolBlockStarts.has(currentAnthropicToolBlockIdx)
          ) {
            const argsDeltaEvent = {
              type: 'content_block_delta',
              index: currentAnthropicToolBlockIdx,
              delta: {
                type: 'input_json_delta',
                partial_json: toolDelta.function.arguments,
              },
            };
            writeSSE('content_block_delta', argsDeltaEvent);
          }
        }
      }
      
      // Handle finish reason
      if (openaiFinishReason) {
        finalAnthropicStopReason = openaiToAnthropicStopReasonMap[openaiFinishReason] || 'end_turn';
        if (openaiFinishReason === 'tool_calls') {
          finalAnthropicStopReason = 'tool_use';
        }
        break;
      }
    }
    
    // Send content_block_stop events
    if (textBlockAnthropicIdx !== null) {
      writeSSE('content_block_stop', { type: 'content_block_stop', index: textBlockAnthropicIdx });
    }
    
    for (const anthropicToolIdx of sentToolBlockStarts) {
      const toolStateToFinalize = toolStates.get(anthropicToolIdx);
      if (toolStateToFinalize) {
        try {
          JSON.parse(toolStateToFinalize.arguments_buffer);
        } catch {
          logger.warning({
            event: LogEvent.TOOL_ARGS_PARSE_FAILURE,
            message: `Buffered arguments for tool '${toolStateToFinalize.name}' (Anthropic block ${anthropicToolIdx}) did not form valid JSON.`,
            request_id: requestId,
            data: {
              buffered_args: toolStateToFinalize.arguments_buffer.substring(0, 100),
            },
          });
        }
      }
      writeSSE('content_block_stop', { type: 'content_block_stop', index: anthropicToolIdx });
    }
    
    if (finalAnthropicStopReason === null) {
      finalAnthropicStopReason = 'end_turn';
    }
    
    // Send final events
    const messageDeltaEvent = {
      type: 'message_delta',
      delta: {
        stop_reason: finalAnthropicStopReason,
        stop_sequence: null,
      },
      usage: { output_tokens: outputTokenCount },
    };
    writeSSE('message_delta', messageDeltaEvent);
    writeSSE('message_stop', { type: 'message_stop' });
    
  } catch (error) {
    streamStatusCode = 500;
    streamLogEvent = LogEvent.REQUEST_FAILURE;
    const errorType = AnthropicErrorType.API_ERROR;
    const errorMsgStr = error instanceof Error ? error.message : String(error);
    streamFinalMessage = `Error during OpenAI stream conversion: ${errorMsgStr}`;
    finalAnthropicStopReason = 'error';
    
    logger.error({
      event: LogEvent.STREAM_INTERRUPTED,
      message: streamFinalMessage,
      request_id: requestId,
      data: {
        error_type: errorType,
      },
    }, error as Error);
    
    const errorResponse = {
      type: 'error',
      error: {
        type: errorType,
        message: errorMsgStr,
      },
    };
    writeSSE('error', errorResponse);
  } finally {
    const durationMs = (Date.now() - startTimeMono);
    const logData = {
      status_code: streamStatusCode,
      duration_ms: durationMs,
      input_tokens: estimatedInputTokens,
      output_tokens: outputTokenCount,
      stop_reason: finalAnthropicStopReason,
    };
    
    if (streamLogEvent === LogEvent.REQUEST_COMPLETED) {
      logger.info({
        event: streamLogEvent,
        message: streamFinalMessage,
        request_id: requestId,
        data: logData,
      });
    } else {
      logger.error({
        event: streamLogEvent,
        message: streamFinalMessage,
        request_id: requestId,
        data: logData,
      });
    }
    
    res.end();
  }
}