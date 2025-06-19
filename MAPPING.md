# Comprehensive Mapping Between Anthropic Messages API and OpenAI Chat Completions API

<!--toc:start-->
- [Comprehensive Mapping Between Anthropic Messages API and OpenAI Chat Completions API](#comprehensive-mapping-between-anthropic-messages-api-and-openai-chat-completions-api)
  - [Introduction](#introduction)
  - [API Endpoints](#api-endpoints)
  - [Count Tokens Endpoint](#count-tokens-endpoint)
  - [Request Mapping (Anthropic -> OpenAI)](#request-mapping-anthropic---openai)
    - [Authentication & Headers](#authentication--headers)
    - [Request Body Parameters](#request-body-parameters)
    - [Messages and Content Blocks](#messages-and-content-blocks)
      - [Anthropic Messages Format](#anthropic-messages-format)
      - [OpenAI Messages Format](#openai-messages-format)
      - [Mapping Messages (User & Assistant Turns)](#mapping-messages-user--assistant-turns)
      - [Mapping Tool Result Messages (User Turn)](#mapping-tool-result-messages-user-turn)
    - [System Prompts](#system-prompts)
    - [Tools and Functions](#tools-and-functions)
      - [Tool Definitions](#tool-definitions)
      - [Mapping Tool Definitions](#mapping-tool-definitions)
      - [Tool Usage Control](#tool-usage-control)
      - [Mapping Tool Choices](#mapping-tool-choices)
  - [Response Mapping (OpenAI -> Anthropic)](#response-mapping-openai---anthropic)
    - [Response Body Structure](#response-body-structure)
      - [Anthropic Response Structure](#anthropic-response-structure)
      - [OpenAI Response Structure](#openai-response-structure)
    - [Mapping Response Fields](#mapping-response-fields)
    - [Mapping Assistant Message Content](#mapping-assistant-message-content)
      - [Text Content](#text-content)
      - [Tool Use Content (Function Call)](#tool-use-content-function-call)
    - [Stop Reasons and Finish Reasons](#stop-reasons-and-finish-reasons)
      - [Mapping Stop/Finish Reasons](#mapping-stopfinish-reasons)
    - [Usage Statistics](#usage-statistics)
      - [Mapping Usage](#mapping-usage)
  - [Streaming Responses](#streaming-responses)
    - [Anthropic Streaming Format](#anthropic-streaming-format)
    - [OpenAI Streaming Format](#openai-streaming-format)
    - [Mapping Streaming Responses (OpenAI -> Anthropic)](#mapping-streaming-responses-openai---anthropic)
  - [Error Handling](#error-handling)
    - [Error Response Structures](#error-response-structures)
      - [Anthropic Error Structure](#anthropic-error-structure)
      - [OpenAI Error Structure](#openai-error-structure)
    - [HTTP Status Code Mapping](#http-status-code-mapping)
    - [API Client Errors](#api-client-errors)
    - [Implementation Considerations](#implementation-considerations)
  - [Important Considerations & Gaps](#important-considerations--gaps)
<!--toc:end-->

## Introduction

This document provides a detailed, field-by-field mapping between Anthropic’s **Claude v3 Messages API** and OpenAI’s **GPT-4 (Chat Completions API)**, based on deep research into both APIs. It covers translating requests (Anthropic -> OpenAI) and responses (OpenAI -> Anthropic), focusing on accuracy for features like message roles, content blocks, system prompts, tool usage (function calling), and streaming. This mapping is crucial for building a proxy server that allows clients using the Anthropic API format to interact seamlessly with OpenAI's backend. Differences in fields, values, and behavior are noted, along with required transformations and potential gaps.

**Scope:** Assumes a stateless translator (full context per request) supporting Claude 3 features via OpenAI's equivalent mechanisms (e.g., function calling). The reference models are Claude 3 and GPT-4/GPT-4-Turbo.

---

## API Endpoints

- **Anthropic Messages API Endpoint:**

  ```
  POST /v1/messages
  ```

- **OpenAI Chat Completions API Endpoint:**

  ```
  POST /v1/chat/completions
  ```

---

## Count Tokens Endpoint

- **Anthropic:** Provides `POST /v1/messages/count_tokens` for calculating input token count.
- **OpenAI:** No direct HTTP endpoint. Token usage is returned in completion responses. For estimation, use libraries like `tiktoken`. The proxy needs its own logic for consistent token counting if pre-computation is required.

---

## Request Mapping (Anthropic -> OpenAI)

### Authentication & Headers

- **Authorization:** Translate between header formats.
  - Anthropic: `x-api-key: YOUR_ANTHROPIC_API_KEY`
  - OpenAI: `Authorization: Bearer YOUR_OPENAI_API_KEY`
- **API Version:** Include Anthropic's version header if needed by the client.
  - Anthropic: `anthropic-version: VERSION_STRING` (e.g., `2023-06-01`)
  - OpenAI: Version is typically tied to the model or API path, not a specific header.

### Request Body Parameters

Mapping Anthropic request fields to OpenAI:

| Anthropic Parameter  | OpenAI Parameter        | Mapping and Notes                                                                                                                                                                                               |
| -------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model`              | `model`                 | Map the requested Claude model name (e.g., `claude-3-opus-20240229`) to a corresponding OpenAI model name (e.g., `gpt-4-turbo`). The proxy must maintain this mapping.                                          |
| `system` (string)    | `messages`              | If present, prepend the `system` string as the *first* message in the OpenAI `messages` array: `{"role": "system", "content": "<system_string>"}`. If absent, omit this system message.                         |
| `messages`           | `messages`              | Translate the array of message objects. Roles and content structure require careful conversion (see details below).                                                                                             |
| `max_tokens`         | `max_tokens`            | Direct mapping. The maximum number of tokens to generate in the response. Ensure value respects the target OpenAI model's limits.                                                                               |
| `stop_sequences`     | `stop`                  | Direct mapping. Pass the array of stop strings. Note OpenAI returns `finish_reason: "stop"` if triggered.                                                                                                       |
| `stream`             | `stream`                | Direct mapping (`true`/`false`). If `true`, handle streaming response conversion (see Streaming section).                                                                                                       |
| `temperature`        | `temperature`           | Direct mapping (float, 0.0 to ~2.0). Both default around 1.0.                                                                                                                                                   |
| `top_p`              | `top_p`                 | Direct mapping (float, 0.0 to 1.0). OpenAI defaults to 1.0. Anthropic recommends using only one of `temperature` or `top_p`.                                                                                    |
| `top_k`              | Not supported           | Anthropic-specific sampling parameter. OpenAI Chat API does not support `top_k`. **Action:** Ignore/drop this parameter. Behavior cannot be perfectly replicated.                                               |
| `metadata.user_id`   | `user`                  | Map the optional `metadata.user_id` string from Anthropic to OpenAI's top-level `user` string for tracking/monitoring. Other fields in `metadata` are not mappable.                                             |
| `tools`              | `functions`             | Map the array of Anthropic tool definitions to OpenAI's `functions` array. (See Tool Definitions mapping).                                                                                                      |
| `tool_choice`        | `function_call`         | Map Anthropic's tool choice mechanism to OpenAI's function call control. (See Mapping Tool Choices).                                                                                                            |
| `stream_options`     | Not directly supported  | Anthropic's `stream_options` (e.g., `include_usage`) doesn't map directly. Usage in OpenAI streams is not provided per-chunk. Proxy needs to handle usage reporting at the end of the stream.                   |


### Messages and Content Blocks

#### Anthropic Messages Format

- `role`: Must be `user` or `assistant` within the `messages` array.
- `content`: Can be a string OR an array of content blocks (`text`, `image`, `tool_result`).

```json
// Anthropic User Message with Text
{
  "role": "user",
  "content": "Hello, Claude."
}

// Anthropic User Message with Image (Requires special handling)
{
  "role": "user",
  "content": [
    {"type": "text", "text": "Describe this image:"},
    {"type": "image", "source": {...}} // GPT-4 Chat API cannot process this directly
  ]
}

// Anthropic User Message with Tool Result (Follow-up after tool_use)
{
  "role": "user",
  "content": [
    {"type": "tool_result", "tool_use_id": "toolu_123", "content": "<tool_output_string_or_JSON>"}
  ]
}

// Anthropic Assistant Message (Response)
{
  "role": "assistant",
  "content": [{"type": "text", "text": "Hi there!"}] // Or tool_use block
}
```

#### OpenAI Messages Format

- `role`: Can be `system`, `user`, `assistant`, or `function`.
- `content`: Typically a string (for `system`, `user`, `assistant`, `function` roles). Can be `null` for `assistant` messages containing only a `function_call`.
- `function_call`: Optional object in `assistant` messages indicating a function invocation.
- `name`: Required for `function` role messages, identifying the function whose result is provided.

```json
// OpenAI System Message
{"role": "system", "content": "You are helpful."}

// OpenAI User Message
{"role": "user", "content": "Hello."}

// OpenAI Assistant Message (Text Response)
{"role": "assistant", "content": "Hi there!"}

// OpenAI Assistant Message (Function Call Request)
{"role": "assistant", "content": null, "function_call": {"name": "get_weather", "arguments": "{\"location\": \"Paris\"}"}}

// OpenAI Function Result Message (Provides result back to model)
{"role": "function", "name": "get_weather", "content": "{\"temperature\": 22, \"unit\": \"celsius\"}"}
```

#### Mapping Messages (User & Assistant Turns)

- **Roles:**
  - Anthropic `user` -> OpenAI `user`.
  - Anthropic `assistant` -> OpenAI `assistant`.
  - Anthropic only allows `user` and `assistant` in the `messages` array. OpenAI also uses `system` (mapped from top-level `system`) and `function` (mapped from Anthropic `tool_result`, see below).
- **Content Conversion:**
  - **Text:** If Anthropic `content` is a string or a single `text` block, use the text directly as OpenAI `content`. If multiple `text` blocks, concatenate them into a single string for OpenAI `content`.
  - **Image Blocks:** Anthropic `image` blocks (`type: "image"`) are **not supported** by the standard OpenAI Chat Completions API. **Action:** The proxy must either:
    1.  Omit the image block entirely.
    2.  Attempt conversion (e.g., use a separate Vision API or tool to generate a text description) and include the description in the OpenAI message `content`. This is a significant gap.
  - **Partial Assistant Prefill:** Anthropic allows the last message to be `role: "assistant"` to provide a prefix for the model to continue. OpenAI does **not** support this "prefill" mechanism directly. **Action:** This feature cannot be reliably proxied. Best approach is to disallow or ignore such partial assistant messages in the request.

#### Mapping Tool Result Messages (User Turn)

This is critical for multi-turn tool use:

- **Anthropic Input:** A `user` message containing one or more `tool_result` content blocks.

  ```json
  {
    "role": "user",
    "content": [
      {
        "type": "tool_result",
        "tool_use_id": "toolu_abc",
        "content": "{\"temp\": 72}" // Can be string or JSON object/array
      }
    ]
  }
  ```
- **OpenAI Output:** Map **each** `tool_result` block to a separate OpenAI message with `role: "function"`.
  -   `role`: `"function"`
  -   `name`: The name of the tool/function corresponding to the `tool_use_id`. The proxy needs to track the mapping between the `tool_use_id` generated in the previous assistant response and the tool name.
  -   `content`: The output/result provided in the `content` field of the `tool_result`. OpenAI expects this to be a string (usually JSON stringified).

  ```json
  {
    "role": "function",
    "name": "get_current_weather", // Retrieved via toolu_abc mapping
    "content": "{\"temp\": 72}"
  }
  ```

- **Placement:** These `function` role messages should be placed in the OpenAI `messages` array immediately after the `assistant` message that contained the corresponding `function_call` (which was mapped from Anthropic's `tool_use`).

### System Prompts

- **Anthropic:** Uses a top-level `system` parameter (string).
- **OpenAI:** Uses a message with `role: "system"` at the beginning of the `messages` array.
- **Mapping:** Convert Anthropic's `system` string into `{"role": "system", "content": "<system_string>"}` and make it the first element (`messages[0]`) in the OpenAI request `messages` list. Ensure this is done for every turn if the conversation is stateful on the client side.

### Tools and Functions

#### Tool Definitions

- **Anthropic `tools`:** Array of objects, each with `name`, `description`, `input_schema` (JSON Schema).
- **OpenAI `functions`:** Array of objects, each with `name`, `description`, `parameters` (JSON Schema).

#### Mapping Tool Definitions

- Directly map each Anthropic `tool` to an OpenAI `function`:
  - `name` -> `name`
  - `description` -> `description`
  - `input_schema` -> `parameters` (both expect JSON Schema format).
- **Built-in Tools:** Anthropic mentions beta built-in tools (e.g., `bash`). OpenAI has no direct equivalent.Proxy should treat these as custom tools/functions if needed, defining the expected schema, or simply not support them.

#### Tool Usage Control

- **Anthropic `tool_choice`:** Object controlling how the model uses tools (`type`: `auto`, `any`, `tool`, `none`).
- **OpenAI `function_call`:** String or object controlling function usage (`auto`, `none`, `{"name": "..."}`).

#### Mapping Tool Choices

| Anthropic `tool_choice`                                              | OpenAI `function_call`            | Notes                                                                                                                                                                                             |
| ---------------------------------------------------------------------| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{"type": "auto"}` (or omitted)                                      | `"auto"` (or omitted)             | Model decides whether to call a function and which one. (Default behavior for both).                                                                                                              |
| `{"type": "any"}`                                                    | `"auto"`                          | Force the model to use *any* available tool. OpenAI has no direct equivalent. Map to `"auto"` and potentially add instructions in the system prompt (e.g., "You must use a tool if appropriate"). |
| `{"type": "tool", "name": "tool_name"}`                              | `{"name": "tool_name"}`           | Force the model to call the specified tool/function.                                                                                                                                              |
| Omitted / Default                                                    | Omitted / Default (`"auto"`)      | If Anthropic `tool_choice` is not provided, use OpenAI's default (`"auto"`).                                                                                                                      |
| *(Note: Anthropic also has a "none" type implied by omitting tools)* | `"none"`                          | If no tools are provided, or if explicit prevention is needed, OpenAI can use `"none"`. This doesn't seem to directly map from an Anthropic option but might be needed for specific proxy logic.  |


---

## Response Mapping (OpenAI -> Anthropic)

### Response Body Structure

#### Anthropic Response Structure

```json
{
  "id": "msg_...", // Message ID
  "type": "message", // Fixed type for successful response
  "role": "assistant", // Fixed role
  "model": "claude-3-opus-...", // Model name requested by client
  "content": [ ... ], // Array of content blocks (text or tool_use)
  "stop_reason": "end_turn", // Reason generation stopped
  "stop_sequence": null, // Sequence that caused stop, if applicable
  "usage": {
    "input_tokens": 10,
    "output_tokens": 25
  }
}
```

#### OpenAI Response Structure

```json
{
  "id": "chatcmpl-...", // Completion ID
  "object": "chat.completion",
  "created": 1677652288, // Timestamp
  "model": "gpt-4-turbo-...", // Model name that generated response
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello!", // Can be null if function_call is present
        "function_call": null // Or {"name": "...", "arguments": "..."}
      },
      "logprobs": null,
      "finish_reason": "stop" // Reason generation stopped
    }
    // Potentially more choices if n > 1, but Anthropic only expects one.
  ],
  "usage": {
    "prompt_tokens": 9,
    "completion_tokens": 12,
    "total_tokens": 21
  },
  "system_fingerprint": "fp_..."
}
```

### Mapping Response Fields

Translate fields from the **first choice** (`choices[0]`) of the OpenAI response to the Anthropic format:

| OpenAI Field                                                    | Anthropic Field | Mapping and Notes                                                                                                                                             |
| --------------------------------------------------------------- | ----------------| ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                            | `id`            | Use the OpenAI `id` (e.g., `"chatcmpl-..."`) or generate a new one in Anthropic format (e.g., `"msg_..."`). Using OpenAI's ID is simpler for traceability.    |
| `object` ("chat.completion")                                    | `type`          | Set Anthropic `type` to `"message"` for successful completions.                                                                                               |
| `model`                                                         | `model`         | Return the **Anthropic model name** that the client originally requested (e.g., `"claude-3-opus-..."`), not the OpenAI model name used internally.            |
| `choices[0].message.role`                                       | `role`          | Should always be `"assistant"` from OpenAI. Set Anthropic `role` to `"assistant"`.                                                                            |
| `choices[0].message.content`                                    | `content`       | Map based on whether it's text or null (see below).                                                                                                           |
| `choices[0].message.function_call`                              | `content`       | If present, map to a `tool_use` content block (see below).                                                                                                    |
| `choices[0].finish_reason`                                      | `stop_reason`   | Map the reason code (see Stop/Finish Reasons table).                                                                                                          |
| N/A                                                             | `stop_sequence` | Set only if OpenAI `finish_reason` was `"stop"` AND a stop sequence from the request was matched. Echo the matched sequence here. OpenAI doesn't return this. |
| `usage`                                                         | `usage`         | Map token counts (see Usage Statistics).                                                                                                                      |
| `created`, `system_fingerprint`, `logprobs`, `choices[0].index` | N/A             | These OpenAI fields have no equivalent in the Anthropic response. Omit them.                                                                                  |

### Mapping Assistant Message Content

Map `choices[0].message` to Anthropic's `content` array:

#### Text Content

- **If OpenAI `message.content` is a non-null string and `function_call` is null:**
  - Create an Anthropic `content` array containing a single `text` block:
    ```json
    "content": [{"type": "text", "text": "<OpenAI message.content string>"}]
    ```

#### Tool Use Content (Function Call)

- **If OpenAI `message.function_call` is present (and `content` might be null):**
  - Create an Anthropic `content` array containing a single `tool_use` block:
    ```json
    "content": [
      {
        "type": "tool_use",
        "id": "toolu_<generated_unique_id>", // Generate a unique ID for this tool call
        "name": "<OpenAI function_call.name>",
        "input": <parsed_arguments_object> // Parse the arguments JSON string into a JSON object/value
      }
    ]
    ```
  - **Crucially:**
    - Generate a unique `id` (e.g., `toolu_...`) for the `tool_use` block. This ID must be tracked by the proxy if the client will send back a `tool_result` referencing it.
    - Parse the `arguments` string from OpenAI (which is JSON *stringified*) into an actual JSON object or primitive value for Anthropic's `input` field.

### Stop Reasons and Finish Reasons

#### Mapping Stop/Finish Reasons

| OpenAI `finish_reason` | Anthropic `stop_reason` | Notes                                                                                                                                          |
| ---------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `"stop"`               | `"end_turn"`            | Model finished naturally. (Default case)                                                                                                       |
| `"stop"`               | `"stop_sequence"`       | **Condition:** If the stop occurred because a sequence in `stop_sequences` was hit. Proxy needs to detect this. Set `stop_sequence` field too. |
| `"length"`             | `"max_tokens"`          | Model hit the `max_tokens` limit.                                                                                                              |
| `"function_call"`      | `"tool_use"`            | Model is requesting a tool/function call. This corresponds to the `tool_use` content block.                                                    |
| `"content_filter"`     | `"stop_sequence"` ?     | OpenAI flagged content. Anthropic has no direct equivalent. Could map to `stop_sequence` (as an external stop) or handle as an error.          |
| `null` (streaming)     | `null` (streaming)      | Generation is ongoing during streaming.                                                                                                        |

### Usage Statistics

#### Mapping Usage

Map fields from OpenAI's `usage` object to Anthropic's `usage` object:

| OpenAI Usage Field    | Anthropic Usage Field |
| --------------------- | --------------------- |
| `prompt_tokens`       | `input_tokens`        |
| `completion_tokens`   | `output_tokens`       |
| `total_tokens`        | *(Omit)*              |

Resulting Anthropic structure:
```json
"usage": {
  "input_tokens": <OpenAI prompt_tokens>,
  "output_tokens": <OpenAI completion_tokens>
}
```

---

## Streaming Responses

Both APIs use Server-Sent Events (SSE), but formats differ significantly. The proxy must translate OpenAI SSE chunks into Anthropic SSE events.

### Anthropic Streaming Format

- Event-based, with named events (`message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`, `ping`).
- Structured JSON payloads for each event type.
- Sends message metadata (`message_start`), then content blocks incrementally (`content_block_*` events), then closing metadata (`message_delta`, `message_stop`).
- Text deltas (`content_block_delta` with `delta.type: "text_delta"`) and tool argument deltas (`delta.type: "input_json_delta"`) are possible.

```sse
event: message_start
data: {"type": "message_start", "message": {"id": "msg_123", "type": "message", "role": "assistant", ...}}

event: content_block_start
data: {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hello"}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": " world"}}

event: content_block_stop
data: {"type": "content_block_stop", "index": 0}

# If tool call occurs...
event: content_block_start
data: {"type": "content_block_start", "index": 1, "content_block": {"type": "tool_use", "id": "toolu_abc", "name": "...", "input": {}}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "{\"location\":\""}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "Paris\"}"}}

event: content_block_stop
data: {"type": "content_block_stop", "index": 1}


event: message_delta # Contains stop_reason, usage updates
data: {"type": "message_delta", "delta": {"stop_reason": "tool_use", ...}, "usage": {"output_tokens": 15}}

event: message_stop
data: {"type": "message_stop"}
```

### OpenAI Streaming Format

- Single stream of unnamed `data:` events containing `chat.completion.chunk` JSON objects.
- Each chunk has a `delta` field with incremental changes (`role`, `content`, or `function_call` fragments).
- First chunk usually contains `delta: {"role": "assistant"}`.
- Subsequent chunks contain `delta: {"content": "..."}` or `delta: {"function_call": {"name": "...", "arguments": "..."}}` (arguments often streamed as partial JSON string fragments).
- Final chunk has `finish_reason` set.
- Stream ends with `data: [DONE]`. **Usage is NOT included in SSE chunks.**

```sse
data: {"id":"...", "object":"chat.completion.chunk", "choices":[{"index":0, "delta":{"role":"assistant"}, "finish_reason":null}]}

data: {"id":"...", "object":"chat.completion.chunk", "choices":[{"index":0, "delta":{"content":"Hello"}, "finish_reason":null}]}

data: {"id":"...", "object":"chat.completion.chunk", "choices":[{"index":0, "delta":{"content":" world"}, "finish_reason":null}]}

# Function call streaming example
data: {"id":"...", "object":"chat.completion.chunk", "choices":[{"index":0, "delta":{"function_call": {"name": "get_weather"}}, "finish_reason":null}]}

data: {"id":"...", "object":"chat.completion.chunk", "choices":[{"index":0, "delta":{"function_call": {"arguments": "{\"loca"}}, "finish_reason":null}]}

data: {"id":"...", "object":"chat.completion.chunk", "choices":[{"index":0, "delta":{"function_call": {"arguments": "tion\":\"P"}}, "finish_reason":null}]}

data: {"id":"...", "object":"chat.completion.chunk", "choices":[{"index":0, "delta":{"function_call": {"arguments": "aris\"}"}}, "finish_reason":null}]}


data: {"id":"...", "object":"chat.completion.chunk", "choices":[{"index":0, "delta":{}, "finish_reason":"function_call"}]}

data: [DONE]
```

### Mapping Streaming Responses (OpenAI -> Anthropic)

The proxy must maintain state during streaming to construct Anthropic events:

1.  **On first OpenAI chunk (`delta.role`):** Send Anthropic `message_start` event containing initial message metadata (generate `message_id`, set `role: 'assistant'`, include model). Send initial `ping`? (Optional, depends on client needs).
2.  **On first OpenAI `delta.content` chunk:** Send Anthropic `content_block_start` for index 0 (`type: "text"`).
3.  **On subsequent `delta.content` chunks:** Send Anthropic `content_block_delta` with `delta.type: "text_delta"` and the content fragment.
4.  **On first OpenAI `delta.function_call.name` chunk:** Send Anthropic `content_block_start` for the next available index (e.g., 1) (`type: "tool_use"`, generate `tool_use_id`, include `name`). Accumulate arguments internally.
5.  **On OpenAI `delta.function_call.arguments` chunks:** Send Anthropic `content_block_delta` for the tool's index with `delta.type: "input_json_delta"` and the `partial_json` fragment. Reconstruct the full arguments JSON internally.
6.  **When OpenAI stream provides `finish_reason`:**
    * If text content was streaming, send `content_block_stop` for index 0.
    * If tool call was streaming, send `content_block_stop` for the tool's index.
    * Map OpenAI `finish_reason` to Anthropic `stop_reason`.
    * Send `message_delta` containing the final `stop_reason` and potentially calculated `usage` (input tokens known from request, output tokens counted from stream).
    * Send `message_stop`.
7.  **If OpenAI stream ends (`data: [DONE]`):** Ensure all pending `content_block_stop`, `message_delta`, and `message_stop` events have been sent.
8.  **Handling Multiple Blocks:** If OpenAI hypothetically interleaved text and tool calls (unlikely but possible), manage multiple content blocks with correct indexing for `content_block_*` events.
9.  **Usage:** Since OpenAI doesn't stream usage, the proxy must calculate output tokens by summing streamed content/argument tokens (using a tokenizer like `tiktoken`) and report it in the final `message_delta`. Input tokens are calculated from the original request.

---

## Error Handling

Map error responses between the APIs.

### Error Response Structures

#### Anthropic Error Structure

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error", // Specific error type
    "message": "Error message details."
  }
}
```

#### OpenAI Error Structure

```json
{
  "error": {
    "message": "Error message details.",
    "type": "invalid_request_error", // Specific error type
    "param": null, // Parameter causing error, if applicable
    "code": null // Specific error code, if applicable
  }
}
```

### HTTP Status Code Mapping

Translate HTTP status codes and inherent error types:

| OpenAI HTTP Code | OpenAI Error Type (`error.type`)                | Anthropic HTTP Code | Anthropic Error Type (`error.type`) | Notes                                        |
| ---------------- | ----------------------------------------------- | ------------------- | ----------------------------------- | -------------------------------------------- |
| 400              | `invalid_request_error`                         | 400                 | `invalid_request_error`             | Bad request (syntax, missing fields, etc.)   |
| 401              | `authentication_error`                          | 401                 | `authentication_error`              | Invalid API key                              |
| 403              | `permission_denied_error`                       | 403                 | `permission_error`                  | Insufficient permissions/access              |
| 404              | `not_found_error`                               | 404                 | `not_found_error`                   | Resource/model not found                     |
| 429              | `rate_limit_error`                              | 429                 | `rate_limit_error`                  | Rate limit exceeded                          |
| 500              | `internal_server_error`, `api_error`            | 500                 | `api_error`                         | Internal server error on provider side       |
| 503              | `service_unavailable_error`, `overloaded_error` | 529                 | `overloaded_error`                  | Server overloaded / temporarily unavailable  |
| 400              | *e.g., context length exceeded*                 | 400                 | `invalid_request_error`             | Map specific 400s appropriately              |

*Note:* Error type names might vary slightly depending on specific SDK versions. Use the canonical types where possible.

### API Client Errors

Translate common client-side errors (network issues, timeouts) consistently:

| ------------------------------ | ---------------------------- | -------------------------------------------- |
| `openai.APIConnectionError`    | Network connectivity issue   | Could not connect to OpenAI API.             |
| `openai.APITimeoutError`       | Request timeout issue        | Request to OpenAI timed out.                 |
| `openai.RateLimitError`        | Rate limit exceeded          | Received 429 from OpenAI.                    |
| `openai.BadRequestError`       | Invalid request              | Received 400 from OpenAI (validation, etc.). |
| `openai.AuthenticationError`   | Authentication failed        | Received 401 from OpenAI.                    |
| `openai.PermissionDeniedError` | Permission issue             | Received 403 from OpenAI.                    |
| `openai.NotFoundError`         | Resource not found           | Received 404 from OpenAI.                    |
| `openai.InternalServerError`   | Upstream server error        | Received 5xx from OpenAI.                    |
| OpenAI Client Exception        | Anthropic Equivalent Context | Notes                                        |

The proxy should catch OpenAI client errors and return corresponding Anthropic-style HTTP errors and JSON bodies.

### Implementation Considerations

- **Preserve Messages:** Include the original OpenAI error message within the translated Anthropic error structure for debugging.
- **Request IDs:** Pass through relevant request IDs (`X-Request-ID`, etc.) if available.
- **Proxy Context:** Add context indicating the error originated from the upstream provider (OpenAI).
- **Streaming Errors:** Handle errors that occur *after* the stream has started (e.g., network drop). May require terminating the SSE stream with an error signal if possible, or logging.
- **Retries:** Implement appropriate retry logic (e.g., exponential backoff) for transient errors like rate limits (429) or server issues (5xx).

---

## Important Considerations & Gaps

- **Model Behavior:** Mapping APIs doesn't guarantee identical model performance, reasoning, alignment, or adherence to instructions. Claude and GPT-4 have inherent differences.
- **Unsupported Anthropic Features:**
  - `top_k`: Cannot be mapped.
  - Partial Assistant Prefill: Cannot be mapped.
  - Built-in Tools (beta): Require custom mapping or are unsupported.
- **Unsupported Content Types:**
  - **Images:** Standard OpenAI Chat API does not accept image inputs. This is a major gap requiring workarounds (omission, OCR/captioning).
- **Role Mapping for Tool Results:** The conversion between Anthropic's `user` role + `tool_result` content and OpenAI's `function` role is crucial and requires careful state management in the proxy.
- **Tool Choice `any`:** Anthropic's `{"type": "any"}` cannot be directly enforced in OpenAI; mapping to `"auto"` is the closest functional equivalent.
- **System Prompt Handling:** Ensure the Anthropic `system` prompt is consistently prepended as the first `system` role message in the OpenAI request history for every turn.
- **Streaming Usage:** OpenAI does not provide usage stats in stream chunks. Proxy must calculate and append at the end.
- **Error Granularity:** Error type details might differ slightly. Aim for the closest conceptual match.

This mapping provides a comprehensive guide for translating between the Anthropic Messages API and OpenAI Chat Completions API, leveraging the detailed information from the provided research. Careful implementation considering the nuances and gaps identified is essential for a functional proxy.


# Summary (by Claude Code)

## Task

1. Get the latest OpenAI API documentation use Context7 and thoroughly gather all provided API specifications, endpoints, parameters, and guidelines.
2. Get the latest Anthropic API documentation use Context7 and similarly collect all API details, including endpoints, parameters, and usage policies.
3. Analyze both documents to identify all overlapping/similar features, functionalities, or structures, as well as distinct differences in technical details, design philosophies, rate limits, authentication processes, error handling, or unique capabilities. Provide this comparison in extensive and meticulous detail, ensuring no nuance is overlooked.

## Comprehensive OpenAI vs Anthropic API Analysis

1. API Architecture
    - OpenAI API Architecture
      - **Hierarchical Resource Model**: Deep nesting with resources like <span style="color:#9cdcfe">client.beta.threads.runs.steps.retrieve()</span>
      - **Multi-namespace Design**: Stable <span style="color:#9cdcfe">/v1/</span> and experimental <span style="color:#9cdcfe">/beta/</span> endpoints
      - **Resource-Centric**: Each functionality is a distinct resource (assistants, threads, runs, vector stores)
      - **Complex State Management**: Persistent resources with lifecycle management
      - **SDK-First Approach**: Official SDKs for Python, TypeScript, Java, Go, .NET
      - **Resource-based REST**: Complex hierarchical API structure
      - **State management**: Persistent resources with lifecycle
      - **Comprehensive tooling**: Full-featured development platform
      - **Multimodal focus**: Single API for multiple modalities

    - Anthropic API Architecture
      - **Flat, Simple Structure**: Direct endpoints like <span style="color:#9cdcfe">/v1/messages</span>, <span style="color:#9cdcfe">/v1/complete</span>
      - **Header-Based Versioning**: <span style="color:#9cdcfe">anthropic-version: 2023-06-01</span> for all requests
      - **Message-Centric Design**: Primary focus on conversational AI
      - **Separation of Concerns**: Distinct APIs for core functionality vs administration
      - **Workspace-First**: Multi-tenant architecture built into core design
      - **Simple REST**: Flat, predictable API structure
      - **Stateless design**: Each request is independent
      - **Safety-first**: Constitutional AI and careful feature rollout
      - **Enterprise focus**: Built-in multi-tenancy and administration
      
2. Design Philosophy
    - OpenAI API Design Philosophy
      - Enterprise-grade platform with comprehensive tooling ecosystem
      - Multimodal AI: Vision, audio, image generation
      - Persistent Assistants: Stateful conversations with memory
      - Vector Stores: Managed RAG infrastructure
      - Fine-tuning: Custom model training
      - Realtime API: Bidirectional WebSocket communication
      - Code Interpreter: Sandboxed Python execution
      - Embeddings: Native text vectorization      
    - Anthropic API Design Philosophy
      - Safe, reliable AI with enterprise administration capabilities
      - Extended Thinking: Internal reasoning capabilities
      - Prompt Tools: AI-powered prompt engineering
      - Constitutional AI: Built-in safety and helpfulness
      - Comprehensive Admin API: Enterprise-grade organization management
      - Workspace Architecture: Multi-tenant design
      - Computer Use: More comprehensive desktop control
      - Legacy Completions: Human/Assistant format support

3. Authentication
    - **OpenAI Authentication**

      ```python   
      # Bearer token authentication
      client = OpenAI(api_key="sk-...")

      # Request ID tracking
      print(response._request_id)  # req_123
      ```

    - **Anthropic Authentication**

      ```bash
      # Header-based authentication
      curl -H "x-api-key: $ANTHROPIC_API_KEY" \
           -H "anthropic-version: 2023-06-01"
      ```

4. Security
    - **OpenAI Security Features**:
        - Single API key type for all operations
        - Automatic retry with exponential backoff
        - Request ID tracking for debugging
        - Per-request configuration overrides
        - Bearer token authentication: <span style="color:#9cdcfe">Authorization: Bearer sk-...</span>
        - Organization headers for team management
        - Project-based API keys
        - Usage tracking per organization/project
    - **Anthropic API Security Features**:
        - Dual key types: Regular API keys vs Admin API keys
        - Mandatory versioning: All requests must specify API version
        - Workspace isolation: Keys are workspace-scoped
        - Request tracing: <span style="color:#9cdcfe">_request_id</span> available in SDK responses
        - API key authentication: <span style="color:#9cdcfe">x-api-key: sk-ant-...</span>
        - Anthropic version headers required: <span style="color:#9cdcfe">anthropic-version: 2023-06-01</span>
        - Simpler authentication model
        - No organization-level management        
    - **Key Difference**: Anthropic enforces stricter security through mandatory versioning and dual key types.

5. Core Endpoints & Functionality & Request Structure
    - Chat Completions (Primary Overlap)
        - OpenAI: [/v1/chat/completions](/v1/chat/completions)
          - Models: GPT-4, GPT-4 Turbo, GPT-3.5 Turbo variants
          - Support for system/user/assistant message roles
          - Function calling capabilities
          - Streaming responses via SSE
          ```bash
            # Standard Chat Completions
            POST /v1/chat/completions
            {
                "model": "gpt-4o",
                "messages": [{"role": "user", "content": "Hello"}],
                "max_tokens": 1000,
                "temperature": 0.7,
                "tools": [...],
                "tool_choice": "auto"
            }
            ```
      - Anthropic: [/v1/messages](/v1/messages)
          - Models: Claude 3 (Opus, Sonnet, Haiku), Claude 3.5 Sonnet
          - Support for user/assistant roles (no explicit system role)
          - Tool use capabilities (similar to function calling)
          - Streaming responses via SSE
          ```bash
            # Unified Messages API
            POST /v1/messages
            {
                "model": "claude-opus-4-20250514",
                "messages": [{"role": "user", "content": "Hello"}],
                "max_tokens": 1000,
                "temperature": 0.7,
                "tools": [...],
                "tool_choice": {"type": "auto"}
            }

            # Extended Thinking (Unique)
            POST /v1/messages
            {
                "model": "claude-sonnet-4-20250514",
                "thinking": {
                    "type": "enabled",
                    "budget_tokens": 10000
                },
                "messages": [...]
            }
          ```

6. Unique Endpoints
    - OpenAI Unique Endpoints
        - [/v1/responses](/v1/responses) - New Responses API (experimental)

          ```bash
            POST /v1/responses
            {
                "model": "gpt-4o",
                "input": "Hello world",
                "tools": [{"type": "web_search"}],
                "stream": true
            }
          ```
        - [/v1/completions](/v1/completions) - Legacy text completion
        - [/v1/embeddings](/v1/embeddings) - Text embeddings generation
        - [/v1/images/generations](/v1/images/generations) - DALL-E image generation
        - [/v1/images/variations](/v1/images/variations) - Image variations
        - [/v1/images/edits](/v1/images/edits) - Image editing
        - [/v1/audio/transcriptions](/v1/audio/transcriptions) - Whisper speech-to-text
        - [/v1/audio/translations](/v1/audio/translations) - Audio translation
        - [/v1/audio/speech](/v1/audio/speech) - Text-to-speech
        - [/v1/fine-tuning/*](/v1/fine-tuning/*) - Fine-tuning management
        - [/v1/assistants/*](/v1/assistants/*) - Assistants API, complete stateful interaction
        - [/v1/threads](/v1/threads) - Thread management
        - [/v1/threads/{thread_id}/runs](/v1/threads/{thread_id}/runs)
        - [/v1/threads/{thread_id}/runs/{run_id}/submit_tool_outputs](/v1/threads/{thread_id}/runs/{run_id}/submit_tool_outputs)
        - [/v1/files/*](/v1/files/*) - File management
        - [/v1/moderations](/v1/moderations) - Content moderation
    - Anthropic Unique Endpoints
        - [/v1/complete](/v1/complete) - Legacy text completion

          ```bash
            # Legacy format support
            POST /v1/complete
            {
                "model": "claude-2.1",
                "prompt": "\n\nHuman: Hello\n\nAssistant:",
                "max_tokens_to_sample": 1000
            }
          ``` 

7. Advanced & Exclusive Features
   - OpenAI Advanced & Exclusive Features
      1. Multimodal AI: Vision, audio, image generation
      2. Persistent Assistants: Stateful conversations with memory
      3. Vector Stores: Managed RAG infrastructure
      4. Fine-tuning: Custom model training
      5. Realtime API: Bidirectional WebSocket communication
      6. Code Interpreter: Sandboxed Python execution
      7. Embeddings: Native text vectorization   
      8. Assistants API (No Anthropic Equivalent)

          ```python
          # Persistent, stateful AI assistants
          assistant = client.beta.assistants.create(
              name="Math Tutor",
              instructions="You are helpful",
              model="gpt-4o",
              tools=[{"type": "code_interpreter"}]
          )

          thread = client.beta.threads.create()
          run = client.beta.threads.runs.create(
              thread_id=thread.id,
              assistant_id=assistant.id
          )
          ```
      9. Vector Stores (No Anthropic Equivalent)

            ```python
            # Managed RAG infrastructure
            vector_store = client.vector_stores.create(name="FAQ")
            client.vector_stores.files.create(
                vector_store_id=vector_store.id,
                file_id=file.id
            )
            client.vector_stores.search(
                vector_store_id=vector_store.id,
                query="search query"
            )
            ```
      10. Batch Processing

            ```python
            # Asynchronous batch processing
            batch = client.batches.create(
                input_file_id=file.id,
                endpoint="/v1/chat/completions",
                completion_window="24h"
            )
            ```
      11. Fine-tuning API

            ```python
            # Custom model training
            job = client.fine_tuning.jobs.create(
                model="gpt-4o",
                training_file="file-abc123",
                hyperparameters={
                    "n_epochs": 3,
                    "batch_size": 1,
                    "learning_rate_multiplier": 0.1
                }
            )
            ```
      12. Realtime API

            ```javascript
            // WebSocket-based real-time interactions
            import { OpenAIRealtimeWebSocket } from 'openai/beta/realtime/websocket';

            const rt = new OpenAIRealtimeWebSocket({
                model: 'gpt-4o-realtime-preview-2024-12-17'
            });
            rt.on('response.text.delta', (event) => process.stdout.write(event.delta));
            ```
   - Anthropic Advanced & Exclusive Features
      1. Extended Thinking: Internal reasoning capabilities
      2. Prompt Tools: AI-powered prompt engineering
      3. Constitutional AI: Built-in safety and helpfulness
      4. Comprehensive Admin API: Enterprise-grade organization management
      5. Workspace Architecture: Multi-tenant design
      6. Computer Use: More comprehensive desktop control
      7. Legacy Completions: Human/Assistant format support   
      8. No image generation or audio capabilities
      9. No fine-tuning options
      10. Focus purely on text-based conversational AI
      11. Superior context window (up to 200K tokens for Claude-3)
      12. Extended Thinking (Unique)

          ```python
          # Internal reasoning capabilities
          response = client.messages.create(
              model="claude-sonnet-4-20250514",
              thinking={
                  "type": "enabled",
                  "budget_tokens": 10000
              },
              messages=[{"role": "user", "content": "Complex reasoning task"}]
          )

          # Access thinking process
          print(response.thinking)
          ```
      13. Prompt Tools (Beta)

          ```python
          # AI-powered prompt engineering
          client.experimental.generate_prompt(
              task="a chef for meal prep planning",
              target_model="claude-3-7-sonnet-20250219"
          )

          client.experimental.improve_prompt(
              messages=[...],
              feedback="Make the recipes shorter"
          )

          client.experimental.templatize_prompt(
              messages=[...],
              system="You are a translator"
          )
          ```
      14. Comprehensive Admin API

          ```bash
          # Organization management
          GET /v1/organizations/users
          POST /v1/organizations/workspaces
          GET /v1/organizations/api_keys
          POST /v1/organizations/invites

          # Workspace management
          POST /v1/organizations/workspaces/{workspace_id}/archive
          GET /v1/organizations/workspaces/{workspace_id}/members
          ```
      15. Message Batches

          ```python
          # Batch processing for messages
          client.messages.batches.create(
              requests=[
                  {
                      "custom_id": "request-1",
                      "params": {
                          "model": "claude-3-7-sonnet-20250219",
                          "max_tokens": 1024,
                          "messages": [{"role": "user", "content": "Hello"}]
                      }
                  }
              ]
          )
          ```

8. Request/Response Structure
    - OpenAI:

      ```json
      {
        "model": "gpt-4",
        "messages": [
          {"role": "system", "content": "You are a helpful assistant"},
          {"role": "user", "content": "Hello"}
        ]
      }
      ```
    - Anthropic:

      ```json
      {
        "model": "claude-3-sonnet-20240229",
        "system": "You are a helpful assistant",
        "messages": [
          {"role": "user", "content": "Hello"}
        ]
      }
      ```

9. Key Parameters
    - OpenAI Parameters:
      - <span style="color:#9cdcfe">temperature</span> (0-2)
      - <span style="color:#9cdcfe">max_tokens</span>
      - <span style="color:#9cdcfe">top_p</span>
      - <span style="color:#9cdcfe">frequency_penalty</span>
      - <span style="color:#9cdcfe">presence_penalty</span>
      - <span style="color:#9cdcfe">functions</span> / <span style="color:#9cdcfe">tools</span>
      - <span style="color:#9cdcfe">function_call</span> / <span style="color:#9cdcfe">tool_choice</span>
    - Anthropic Parameters:
      - <span style="color:#9cdcfe">temperature</span> (0-1)
      - <span style="color:#9cdcfe">max_tokens</span>
      - <span style="color:#9cdcfe">top_p</span>
      - <span style="color:#9cdcfe">top_k</span>
      - <span style="color:#9cdcfe">tools</span>
      - <span style="color:#9cdcfe">tool_choice</span>
      - <span style="color:#9cdcfe">stop_sequences</span>

10. Rate Limits & Pricing Philosophy
    - OpenAI
      - Tier-based rate limiting (Tier 1-5)
      - RPM (Requests Per Minute) and TPM (Tokens Per Minute) limits
      - Complex pricing tiers based on usage volume
      - Input/output token pricing differentiation
    - Anthropic
      - Simpler rate limiting structure
      - Focus on requests per minute
      - More straightforward pricing model
      - Generally more expensive per token but higher quality

  11. Error Handling
      - OpenAI
        - Standard HTTP status codes
        - Detailed error objects with <span style="color:#9cdcfe">type</span>, <span style="color:#9cdcfe">message</span>, <span style="color:#9cdcfe">param</span>, <span style="color:#9cdcfe">code</span>
        - Rate limit headers in responses
        - Specific error types: <span style="color:#9cdcfe">invalid_request_error</span>, <span style="color:#9cdcfe">authentication_error</span>, etc.
        -  Error Types:
            - <span style="color:#9cdcfe">APIStatusError</span>
            - <span style="color:#9cdcfe">APIConnectionTimeoutError</span>
            - <span style="color:#9cdcfe">RateLimitError</span>
            - <span style="color:#9cdcfe">BadRequestError</span>
            - <span style="color:#9cdcfe">AuthenticationError</span>
        ```python
        try:
            response = client.chat.completions.create(...)
        except openai.APIStatusError as e:
            print(f"Status: {e.status_code}")
            print(f"Request ID: {e.request_id}")
            print(f"Error: {e.response.json()}")
        except openai.APIConnectionTimeoutError as e:
            print("Request timed out")
        except openai.RateLimitError as e:
            print("Rate limit exceeded")        
        ```

      - Anthropic
        - HTTP status codes
        - Error objects with <span style="color:#9cdcfe">type</span>, <span style="color:#9cdcfe">message</span>
        - Simpler error taxonomy
        - Focus on clear, actionable error messages
        - Error Types distinguishes between successful responses with stop reasons vs actual API errors
            - <span style="color:#9cdcfe">invalid_request_error</span>
            - <span style="color:#9cdcfe">authentication_error</span>
            - <span style="color:#9cdcfe">billing_error</span>
            - <span style="color:#9cdcfe">permission_error</span>
            - <span style="color:#9cdcfe">not_found_error</span>
            - <span style="color:#9cdcfe">rate_limit_error</span>
            - <span style="color:#9cdcfe">gateway_timeout_error</span>
            - <span style="color:#9cdcfe">api_error</span>
            - <span style="color:#9cdcfe">overloaded_error</span>
        ```python
        try:
              response = client.messages.create(...)
              if response.stop_reason == "max_tokens":
                  print("Response was truncated")
          except anthropic.APIError as e:
              if e.status_code == 429:
                  print("Rate limit exceeded")
              elif e.status_code == 500:
                  print("Server error")

          Error Structure:
          {
              "type": "error",
              "error": {
                  "type": "rate_limit_error",
                  "message": "Rate limited"
              }
          }        
        ```
  12. Streaming Differences
      - OpenAI
        - Server-Sent Events with <span style="color:#9cdcfe">data</span>:  prefix
        - <span style="color:#9cdcfe">[DONE]</span> marker at stream end
        - Delta-based streaming (partial content updates)
        - Realtime API for bidirectional WebSocket communication

        ```python
        # Chat Completions Streaming
        stream = client.chat.completions.create(
            model="gpt-4o",
            messages=[...],
            stream=True
        )

        for chunk in stream:
            if chunk.choices[0].delta.content:
                print(chunk.choices[0].delta.content, end="")

        # Responses API Streaming
        stream = client.responses.create(
            model="gpt-4o",
            input="Hello",
            stream=True
        )

        for event in stream:
            print(event)        
        ```
      - Anthropic
        - Server-Sent Events
        - Event types: <span style="color:#9cdcfe">message_start</span>, <span style="color:#9cdcfe">content_block_delta</span>, <span style="color:#9cdcfe">message_stop</span>
        - More granular streaming events
        - unidirectional streaming

        ```python
        # Messages API Streaming
        with client.messages.stream(
            model="claude-opus-4-20250514",
            messages=[...],
            max_tokens=1000
        ) as stream:
            for text in stream.text_stream:
                print(text, end="")        
        ```
  13. Content Safety & Moderation
      - OpenAI
        - Dedicated [/v1/moderations](/v1/moderations) endpoint
        - Built-in content filtering
        - Configurable safety settings
      - Anthropic
        - Built-in constitutional AI safety
        - No separate moderation endpoint
        - Philosophy-driven safety approach

  14. Context & Token Limits
      - OpenAI
        - GPT-4: 8K-128K tokens depending on variant
        - GPT-3.5: 4K-16K tokens
        - Function calling reduces available context
      - Anthropic
        - Claude-3: Up to 200K tokens
        - Generally larger context windows
        - More efficient context utilization

  15. Tool Use & Function Calling
      - OpenAI
        - <span style="color:#9cdcfe">functions</span> (legacy) and <span style="color:#9cdcfe">tools</span> (current)
        - Parallel function calling
        - Forced function calling via <span style="color:#9cdcfe">tool_choice</span>
        - Schema naming: uses <span style="color:#9cdcfe">parameters</span>
        - Tool choice format: uses <span style="color:#9cdcfe">strings</span>
        - Structure: wraps functions in <span style="color:#9cdcfe">function</span> object

          ```python
          tools = [{
              "type": "function",
              "function": {
                  "name": "get_weather",
                  "description": "Get current weather",
                  "parameters": {
                      "type": "object",
                      "properties": {
                          "location": {"type": "string"}
                      },
                      "required": ["location"]
                  }
              }
          }]

          response = client.chat.completions.create(
              model="gpt-4o",
              messages=[{"role": "user", "content": "Weather in NYC?"}],
              tools=tools,
              tool_choice="auto",  # or "required" or specific tool
              parallel_tool_calls=True
          )        
          ```
        - Built-in Tools

          ```python
          # Code Interpreter
          {"type": "code_interpreter"}

          # File Search
          {"type": "file_search"}

          # Web Search (in Responses API)
          {"type": "web_search"}

          # Computer Use (beta)
          {"type": "computer_use_20250124"}        
          ```
      - Anthropic
        - <span style="color:#9cdcfe">tools</span> parameter
        - Similar parallel tool execution
        - Tool choice control via <span style="color:#9cdcfe">tool_choice</span>
        - Schema naming: uses <span style="color:#9cdcfe">input_schema</span>
        - Tool choice format: uses <span style="color:#9cdcfe">objects</span>
        - Structure: wraps in flat structure

          ```python
          tools = [{
              "name": "get_weather",
              "description": "Get current weather",
              "input_schema": {
                  "type": "object",
                  "properties": {
                      "location": {"type": "string"}
                  },
                  "required": ["location"]
              }
          }]

          response = client.messages.create(
              model="claude-opus-4-20250514",
              messages=[{"role": "user", "content": "Weather in NYC?"}],
              tools=tools,
              tool_choice={"type": "auto"}  # or {"type": "tool", "name": "get_weather"}
          )
          ```
        - Built-in Tools provide more granular control with explicit versioning and usage limits

          ```python
          # Code Execution
          {"type": "code_execution_20250522", "name": "code_execution"}

          # Web Search
          {"type": "web_search_20250305", "name": "web_search", "max_uses": 5}

          # Computer Use
          {"type": "computer_20250124", "name": "computer"}

          # Text Editor
          {"type": "text_editor_20250429", "name": "str_replace_editor"}

          # Bash
          {"type": "bash_20250124", "name": "bash"}        
          ```

  16. Design Philosophy Differences
      - OpenAI
        - Broad AI platform approach
        - Multiple modalities (text, image, audio)
        - Focus on developer ecosystem and integrations
        - More experimental features
      - Anthropic
        - AI safety and alignment focus
        - Constitutional AI approach
        - Text-focused excellence
        - Conservative, research-driven development

  17. SDK Support & Developer Experience& Integration Support
      - OpenAI
        - Official SDKs: Python, TypeScript, Java, Go, C#/.NET
        - Extensive third-party integrations
        - Rich ecosystem: Extensive community tools and integrations
        - Helper methods: Pagination, polling, streaming utilities
        - Type safety: Full TypeScript support with structured outputs        
      - Anthropic
        - Official SDKs: Python, TypeScript
        - Growing but smaller ecosystem
        - Focus on quality over quantity
        - Limited ecosystem: Fewer community tools
        - Basic helpers: Standard CRUD operations
        - Type safety: TypeScript support but less extensive

  18. Rate Limits & Usage Policies
      - OpenAI Rate Limits
        - Tier-based system: Usage tiers with increasing limits
        - RPM (Requests Per Minute) and TPM (Tokens Per Minute) limits
        - Model-specific limits: Different limits per model
        - Batch API benefits: Lower costs and higher throughput for async processing
      - Anthropic Rate Limits
        - Workspace-based limits: Limits apply per workspace
        - Admin API limits: Separate limits for organization management
        - Message batch benefits: Reduced rate limits for batch processing
        - Beta feature limits: Separate limits for experimental features

  19. Enterprise & Administration Features
      - OpenAI Organization Management
        - Basic organization structure
        - API key management
        - Usage monitoring
        - Team management (limited documentation)
      - Anthropic Admin API
        - Significantly more comprehensive enterprise administration capabilities

          ```bash
          # Comprehensive administration
          # User Management
          GET /v1/organizations/users
          POST /v1/organizations/users/{user_id}
          DELETE /v1/organizations/users/{user_id}

          # Workspace Management
          POST /v1/organizations/workspaces
          GET /v1/organizations/workspaces/{workspace_id}
          POST /v1/organizations/workspaces/{workspace_id}/archive

          # API Key Management
          POST /v1/organizations/api_keys
          PUT /v1/organizations/api_keys/{key_id}
          GET /v1/organizations/api_keys

          # Invite Management
          POST /v1/organizations/invites
          DELETE /v1/organizations/invites/{invite_id}

          # Workspace Member Management
          GET /v1/organizations/workspaces/{workspace_id}/members
          POST /v1/organizations/workspaces/{workspace_id}/members
          DELETE /v1/organizations/workspaces/{workspace_id}/members/{user_id}        
          ```

  This comprehensive comparison covers all major aspects of both APIs, highlighting their overlapping features, distinct differences, and underlying design philosophies.

## References

- OpenAI API documentation, _https://platform.openai.com/docs/api-reference_
- Anthropic API documentation, _https://docs.anthropic.com/en/api_
