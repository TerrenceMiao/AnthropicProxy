#!/usr/bin/env node

import { Command } from 'commander';
import { startServer } from './server';
import { Config } from './types';
import { createLogger, Logger } from './logger';
import { execSync } from 'child_process';

const program = new Command();

program
  .name('anthropic-proxy-nextgen')
  .description('A proxy service that allows Anthropic/Claude API requests to be routed through an OpenAI compatible API')
  .version('1.0.0');

program
  .command('start')
  .description('Start the Anthropic proxy server')
  .option('-p, --port <port>', 'Port to listen on', '8080')
  .option('-h, --host <host>', 'Host to bind to', '127.0.0.1')
  .option('--base-url <url>', 'Base URL for the OpenAI-compatible API', 'http://localhost:4000')
  .option('--openai-api-key <key>', 'API key for the OpenAI-compatible service', 'sk-')
  .option('--big-model-name <name>', 'Model name for Opus/Sonnet requests', 'github-copilot-claude-sonnet-4')
  .option('--small-model-name <name>', 'Model name for Haiku requests', 'github-copilot-claude-3.5-sonnet')
  .option('--referrer-url <url>', 'Referrer URL for requests')
  .option('--log-level <level>', 'Log level (DEBUG, INFO, WARN, ERROR)', 'INFO')
  .option('--log-file <path>', 'Log file path for JSON logs')
  .option('--no-reload', 'Disable auto-reload in development')
  .action(async (options) => {
    let claudeCodeVersion = 'unknown';
    try {
      const versionOutput = execSync('claude --version', { encoding: 'utf-8' });
      const match = versionOutput.match(/([\d.]+) \(Claude Code\)/);
      if (match) {
        claudeCodeVersion = match[1] + ' (Claude Code)';
      } else {
        claudeCodeVersion = versionOutput.trim();
      }
    } catch {
      claudeCodeVersion = 'unknown';
    }
    const config: Config = {
      host: options.host,
      port: parseInt(options.port, 10),
      baseUrl: options.baseUrl,
      openaiApiKey: options.openaiApiKey,
      bigModelName: options.bigModelName,
      smallModelName: options.smallModelName,
      referrerUrl: options.referrerUrl || `http://${options.host}:${options.port}/AnthropicProxy`,
      logLevel: options.logLevel.toUpperCase(),
      logFilePath: options.logFile,
      reload: options.reload !== false,
      appName: 'AnthropicProxy',
      appVersion: '1.0.0',
      claudeCodeVersion,
    };

    // Validate required options
    if (!config.openaiApiKey || config.openaiApiKey === 'sk-') {
      console.error('Error: --openai-api-key is required and must be a valid API key');
      process.exit(1);
    }

    const winstonLogger = createLogger(config);
    const logger = new Logger(winstonLogger);
    
    try {
      await startServer(config, logger);
    } catch (error) {
      logger.error({
        event: 'server_start_failed',
        message: 'Failed to start server',
      }, error instanceof Error ? error : new Error(String(error)));
      process.exit(1);
    }
  });

program.parse();