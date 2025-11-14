import { describe, it, expect } from 'vitest';
import {
  createProblem,
  createValidationProblem,
  Problems,
  problemToResponse,
} from '@/lib/errors';

describe('RFC 7807 Problem Details', () => {
  describe('createProblem', () => {
    it('should create a basic problem', () => {
      const problem = createProblem(404, 'Not Found', 'Resource not found');

      expect(problem.status).toBe(404);
      expect(problem.title).toBe('Not Found');
      expect(problem.detail).toBe('Resource not found');
      expect(problem.type).toContain('/404');
    });

    it('should include custom type', () => {
      const problem = createProblem(
        400,
        'Bad Request',
        'Invalid input',
        'https://example.com/errors/invalid-input'
      );

      expect(problem.type).toBe('https://example.com/errors/invalid-input');
    });

    it('should include additional fields', () => {
      const problem = createProblem(429, 'Too Many Requests', undefined, undefined, {
        retryAfter: 60,
      });

      expect(problem['retryAfter']).toBe(60);
    });
  });

  describe('createValidationProblem', () => {
    it('should create a validation problem with errors', () => {
      const errors = [
        { field: 'email', message: 'Invalid email', code: 'INVALID_EMAIL' },
        { field: 'password', message: 'Too weak', code: 'WEAK_PASSWORD' },
      ];

      const problem = createValidationProblem(errors);

      expect(problem.status).toBe(400);
      expect(problem.title).toBe('Validation Error');
      expect(problem['errors']).toHaveLength(2);
      expect((problem['errors'] as any)[0].field).toBe('email');
    });
  });

  describe('Problems presets', () => {
    it('should create Unauthorized problem', () => {
      const problem = Problems.Unauthorized();
      expect(problem.status).toBe(401);
      expect(problem.title).toBe('Unauthorized');
    });

    it('should create Forbidden problem', () => {
      const problem = Problems.Forbidden();
      expect(problem.status).toBe(403);
      expect(problem.title).toBe('Forbidden');
    });

    it('should create NotFound problem', () => {
      const problem = Problems.NotFound('User not found');
      expect(problem.status).toBe(404);
      expect(problem.detail).toBe('User not found');
    });

    it('should create Conflict problem', () => {
      const problem = Problems.Conflict('Email already exists');
      expect(problem.status).toBe(409);
      expect(problem.detail).toBe('Email already exists');
    });
  });

  describe('problemToResponse', () => {
    it('should convert problem to Response', () => {
      const problem = Problems.NotFound('Resource not found');
      const response = problemToResponse(problem);

      expect(response.status).toBe(404);
      expect(response.headers.get('Content-Type')).toBe('application/problem+json');
    });

    it('should include problem details in response body', async () => {
      const problem = Problems.BadRequest('Invalid input');
      const response = problemToResponse(problem);
      const body = await response.json();

      expect(body.status).toBe(400);
      expect(body.title).toBe('Bad Request');
      expect(body.detail).toBe('Invalid input');
    });
  });
});
