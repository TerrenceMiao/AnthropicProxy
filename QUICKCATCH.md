This Python script creates a **FastAPI web server that acts as a proxy**, translating API requests from the Anthropic format to an OpenAI-compatible format.

Here is a summary of its functionality:

### Core Purpose

The main goal of this application is to allow a client that is designed to communicate with Anthropic's API (like the Claude model series) to instead send its requests to an API endpoint that is compatible with OpenAI (such as OpenRouter, or a locally hosted model). It acts as a middleman, performing the necessary translations in both directions.

### Key Features

1.  **Request/Response Translation**:
    *   It converts incoming requests structured for the Anthropic Messages API into the format expected by the OpenAI Chat Completions API. This includes translating message structures, system prompts, and tool usage syntax.
    *   Conversely, it takes the response from the OpenAI-compatible API and transforms it back into the structure that an Anthropic client expects.

2.  **Dynamic Model Routing**:
    *   The proxy reads the model name from the incoming Anthropic request (e.g., `claude-3-opus-20240229`).
    *   Based on keywords in the model name (like "opus", "sonnet", or "haiku"), it routes the request to one of two pre-configured OpenAI-compatible models (a "big" model or a "small" model), which are defined in the application's settings.

3.  **Streaming Support**:
    *   It fully supports streaming responses. It consumes the stream of data chunks from the OpenAI-compatible API and translates them on-the-fly into the Server-Sent Events (SSE) format that Anthropic's streaming API uses.

4.  **Complex Message Handling**:
    *   The script can process complex message contents, including text, images (by converting them to base64 data URLs), and function/tool calls, translating them between the two API formats.

5.  **Configuration and Logging**:
    *   It loads its configuration (API keys, model names, URLs) from environment variables or a `.env` file.
    *   It features extensive and structured JSON logging to monitor requests, responses, errors, and internal operations, using the `rich` library for user-friendly console output.

6.  **Error Handling**:
    *   It gracefully handles errors from the upstream API (e.g., rate limits, invalid requests) and translates them into the specific error format that an Anthropic client would expect.

### Endpoints

*   [`POST /v1/messages`](src/main.py:1487): The main endpoint that mimics Anthropic's API for sending messages. It handles both standard and streaming requests.
*   [`POST /v1/messages/count_tokens`](src/main.py:1694): A utility endpoint to estimate the token count of a request without actually sending it to the model.
*   [`GET /`](src/main.py:1736): A simple health check endpoint.

In short, this script is a powerful compatibility layer that enables applications built for Anthropic's API to seamlessly use OpenAI-compatible models without changing the client-side code.
