import { describe, it, expect } from 'vitest';
import { generateCorrelationId, createRequestLogger, createLogger } from '../lib/logger';

describe('Logger', () => {
  describe('generateCorrelationId', () => {
    it('should generate a correlation ID', () => {
      const id = generateCorrelationId();
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
    });

    it('should generate unique IDs', () => {
      const id1 = generateCorrelationId();
      const id2 = generateCorrelationId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('createRequestLogger', () => {
    it('should create logger with correlation ID', () => {
      const logger = createRequestLogger('test-123');
      expect(logger).toBeTruthy();
      expect(logger.bindings()).toHaveProperty('correlationId', 'test-123');
    });

    it('should create logger with user ID', () => {
      const logger = createRequestLogger('test-123', 'user-456');
      expect(logger.bindings()).toHaveProperty('userId', 'user-456');
    });

    it('should auto-generate correlation ID if not provided', () => {
      const logger = createRequestLogger();
      expect(logger.bindings()).toHaveProperty('correlationId');
      expect(logger.bindings()['correlationId']).toBeTruthy();
    });
  });

  describe('createLogger', () => {
    it('should create logger with module name', () => {
      const logger = createLogger('test-module');
      expect(logger).toBeTruthy();
      expect(logger.bindings()).toHaveProperty('module', 'test-module');
    });
  });
});
