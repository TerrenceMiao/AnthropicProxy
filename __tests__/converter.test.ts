import { jest, describe, beforeEach, test, expect } from '@jest/globals';
import { selectTargetModel } from '../src/converter';
import { Logger } from '../src/logger';

// Mock logger for testing
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  critical: jest.fn(),
} as unknown as Logger;

describe('Model Selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should select big model for opus', () => {
    const result = selectTargetModel(
      'claude-3-opus-20240229',
      'big-model',
      'small-model',
      mockLogger,
      'test-request-id'
    );
    expect(result).toBe('big-model');
  });

  test('should select big model for sonnet', () => {
    const result = selectTargetModel(
      'claude-3-sonnet-20240229',
      'big-model',
      'small-model',
      mockLogger,
      'test-request-id'
    );
    expect(result).toBe('big-model');
  });

  test('should select small model for haiku', () => {
    const result = selectTargetModel(
      'claude-3-haiku-20240307',
      'big-model',
      'small-model',
      mockLogger,
      'test-request-id'
    );
    expect(result).toBe('small-model');
  });

  test('should default to small model for unknown models', () => {
    const result = selectTargetModel(
      'unknown-model',
      'big-model',
      'small-model',
      mockLogger,
      'test-request-id'
    );
    expect(result).toBe('small-model');
    expect(mockLogger.warning).toHaveBeenCalled();
  });

  test('should be case insensitive', () => {
    const result = selectTargetModel(
      'CLAUDE-3-OPUS-20240229',
      'big-model',
      'small-model',
      mockLogger,
      'test-request-id'
    );
    expect(result).toBe('big-model');
  });
});