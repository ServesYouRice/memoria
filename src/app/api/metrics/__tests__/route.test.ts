import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/metrics/route';

describe('/api/metrics', () => {
  it('returns Prometheus text metrics', async () => {
    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/plain');
    expect(body).toContain('process_cpu_user_seconds_total');
    expect(body).toContain('nodejs_heap_size_total_bytes');
    expect(body).toContain('canvascollect_http_requests_total');
    expect(body).toContain('canvascollect_http_request_duration_seconds');
  });

  it('sets no-cache headers', async () => {
    const response = await GET();

    expect(response.headers.get('Cache-Control')).toBe(
      'no-cache, no-store, must-revalidate'
    );
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(response.headers.get('Expires')).toBe('0');
  });
});
