/**
 * Bookmark Unfurling API
 *
 * Fetches and extracts metadata from URLs with SSRF protection
 * Implements ADR-0003: SSRF-Protected Unfurling
 * Implements ADR-0011: Server-Side Caching Strategy
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { safeFetch } from '@/lib/utils/ssrf-protection';
import { extractMetadata, validateMetadata } from '@/lib/utils/metadata-extractor';
import { getCachedUnfurl, setCachedUnfurl } from '@/lib/cache/unfurl-cache';

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const { url } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // Check cache first (ADR-0011)
    const cachedMetadata = await getCachedUnfurl(url);
    if (cachedMetadata) {
      console.log(`Cache hit for unfurl: ${url}`);
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
  } catch (error) {
    console.error('Unfurl error:', error);
    return NextResponse.json(
      { error: 'Failed to unfurl URL' },
      { status: 500 }
    );
  }
}
