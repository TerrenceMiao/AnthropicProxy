# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Environment Setup
```bash
# Install dependencies
npm install

# Run the server in development mode
npm run dev

# Build the project
npm run build

# Start the compiled server
npm start

# Run tests
npm test

# Run type checking
npm run type-check

# Run linting
npm run lint

# Format code (if using prettier)
npm run lint:fix
```

### CLI Usage
```bash
# Start the proxy server with CLI
npx anthropic-proxy start --port 8080 --base-url=http://localhost:4000 --big-model-name=github-copilot-claude-sonnet-4 --small-model-name=github-copilot-claude-3.5-sonnet --openai-api-key=sk-your-key --log-level=DEBUG

# Test with Claude Code
ANTHROPIC_BASE_URL=http://localhost:8080 claude
```

## Architecture Overview

This is a **TypeScript Express.js application** that serves as a proxy between Anthropic's Claude API and OpenAI-compatible APIs. The application is modular with well-separated concerns.

### Core Modules

- **`src/cli.ts`**: Command-line interface using Commander.js
- **`src/server.ts`**: Express server setup with routing and middleware
- **`src/types.ts`**: TypeScript types and Zod schemas for validation
- **`src/converter.ts`**: Request/response conversion between Anthropic and OpenAI formats
- **`src/streaming.ts`**: Server-Sent Events streaming response handler
- **`src/tokenizer.ts`**: Token counting using tiktoken
- **`src/logger.ts`**: Structured JSON logging with Winston
- **`src/errors.ts`**: Error handling and mapping

### Key Functionality
- **API Translation**: Converts between Anthropic Messages API and OpenAI Chat Completions format
- **Dynamic Model Selection**: Maps Claude model names (Opus/Sonnet → big model, Haiku → small model)
- **Streaming Support**: Handles SSE streaming with proper content block indexing for mixed text/tool_use content
- **Tool/Function Translation**: Converts between Anthropic's tool system and OpenAI's function calling
- **Comprehensive Error Handling**: Maps OpenAI errors to Anthropic-compatible error formats

### Model Selection Logic
```typescript
// In converter.ts
if (clientModelLower.includes('opus') || clientModelLower.includes('sonnet')) {
  targetModel = bigModelName;
} else if (clientModelLower.includes('haiku')) {
  targetModel = smallModelName;
} else {
  targetModel = smallModelName; // default
}
```

### Configuration
All configuration is handled through:
1. **CLI arguments** (primary)
2. **Environment variables** (fallback)
3. **`.env` file** (development)

Required configuration:
- `baseUrl`: Target OpenAI-compatible API endpoint
- `openaiApiKey`: API key for the target service
- `bigModelName` / `smallModelName`: Model mapping configuration

## API Endpoints

- `POST /v1/messages`: Main Anthropic Messages API compatible endpoint
- `POST /v1/messages/count_tokens`: Token counting utility
- `GET /`: Health check and server info

## Important Implementation Details

### Type Safety
Uses Zod schemas for runtime validation of:
- Anthropic request/response formats
- Configuration objects
- Internal data structures

### Streaming Implementation
The streaming handler (`src/streaming.ts`) maintains:
- Content block indexing for mixed text/tool_use responses
- Tool state tracking during streaming
- Proper SSE event formatting for Anthropic compatibility
- Token counting during stream processing

### Error Handling
Comprehensive error mapping with:
- OpenAI API error extraction and conversion
- Provider-specific error details preservation
- Structured logging for debugging
- Proper HTTP status code mapping

### Logging System
Structured JSON logging with:
- Request/response tracking
- Performance metrics
- Error context preservation
- File and console output support

## Development Notes

- **Package Manager**: Uses npm (could be migrated to yarn/pnpm if needed)
- **Build System**: TypeScript compiler with standard tsconfig.json
- **Code Quality**: ESLint + TypeScript strict mode
- **Testing**: Jest framework (tests need to be implemented)
- **CLI Distribution**: Published as npm package with binary

## Deployment

The application compiles to a standalone Node.js application that can be:
1. **Installed globally**: `npm install -g anthropic-proxy`
2. **Run directly**: `npx anthropic-proxy@latest start [options]`
3. **Used programmatically**: Import as a TypeScript/JavaScript module

## Migration Notes

This TypeScript version maintains 100% API compatibility with the original Python FastAPI version while adding:
- CLI interface for easy deployment
- npm package distribution
- Better type safety
- Modular architecture for easier maintenance