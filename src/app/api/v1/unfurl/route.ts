import { NextResponse } from 'next/server';
import { safeFetch } from '@/lib/utils/ssrf-protection';
import { extractMetadata, validateMetadata } from '@/lib/utils/metadata-extractor';
import { getCachedUnfurl, setCachedUnfurl } from '@/lib/cache/unfurl-cache';
import { logger } from '@/lib/logger';
import { withAuthValidation } from '@/lib/api/route-handler';
import { unfurlSchema } from '@/lib/validation/unfurl';

export const POST = withAuthValidation(unfurlSchema, async ({ url }) => {
  // Check cache first (ADR-0011)
  const cachedMetadata = await getCachedUnfurl(url);
  if (cachedMetadata) {
    logger.info({ url }, 'Cache hit for unfurl');
    return NextResponse.json(cachedMetadata);
  }

  // Validate and fetch URL with SSRF protection
  const fetchResult = await safeFetch(url, {
    maxRedirects: 5,
    timeout: 10000,      // 10 seconds
    maxSize: 2 * 1024 * 1024, // 2MB max response size
  });

  if (!fetchResult.ok) {
    return NextResponse.json(
      { error: fetchResult.error || 'Failed to fetch URL' },
      { status: fetchResult.status }
    );
  }

  if (!fetchResult.data) {
    return NextResponse.json({ error: 'No data received' }, { status: 500 });
  }

  // Extract metadata from HTML
  const metadata = extractMetadata(fetchResult.data, url);

  // Validate and clean metadata
  const cleanedMetadata = validateMetadata(metadata);

  // Add unfurl timestamp
  const result = {
    ...cleanedMetadata,
    unfurledAt: new Date().toISOString(),
  };

  // Store in cache for future requests
  await setCachedUnfurl(url, result);

  return NextResponse.json(result);
});
