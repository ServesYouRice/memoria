/**
 * Search Service
 *
 * Client-side search utilities with fuzzy matching.
 *
 * @module lib/services/search
 */

/**
 * Simple fuzzy search score
 */
export function fuzzyMatch(query: string, text: string): number {
    if (!query || !text) return 0;

    const queryLower = query.toLowerCase();
    const textLower = text.toLowerCase();

    // Exact match
    if (textLower === queryLower) return 100;

    // Contains full query
    if (textLower.includes(queryLower)) return 80;

    // Word starts with query
    const words = textLower.split(/\s+/);
    if (words.some((word) => word.startsWith(queryLower))) return 70;

    // Fuzzy character matching
    let score = 0;
    let queryIndex = 0;
    let consecutiveMatches = 0;

    for (let i = 0; i < textLower.length && queryIndex < queryLower.length; i++) {
        if (textLower[i] === queryLower[queryIndex]) {
            score += 1 + consecutiveMatches;
            consecutiveMatches++;
            queryIndex++;
        } else {
            consecutiveMatches = 0;
        }
    }

    // All query characters found
    if (queryIndex === queryLower.length) {
        return Math.min(60, (score / queryLower.length) * 10);
    }

    return 0;
}

/**
 * Search items with scoring
 */
export function searchItems<T>(
    items: T[],
    query: string,
    getSearchableText: (item: T) => string[],
    minScore = 10
): Array<{ item: T; score: number }> {
    if (!query.trim()) return items.map((item) => ({ item, score: 0 }));

    const results: Array<{ item: T; score: number }> = [];

    for (const item of items) {
        const texts = getSearchableText(item);
        let maxScore = 0;

        for (const text of texts) {
            const score = fuzzyMatch(query, text);
            maxScore = Math.max(maxScore, score);
        }

        if (maxScore >= minScore) {
            results.push({ item, score: maxScore });
        }
    }

    return results.sort((a, b) => b.score - a.score);
}

/**
 * Highlight matching parts of text
 */
export function highlightQuery(text: string, query: string): string {
    if (!query.trim()) return text;

    const queryLower = query.toLowerCase();
    const textLower = text.toLowerCase();
    const index = textLower.indexOf(queryLower);

    if (index === -1) return text;

    return (
        text.slice(0, index) +
        '<mark>' +
        text.slice(index, index + query.length) +
        '</mark>' +
        text.slice(index + query.length)
    );
}

/**
 * Debounced search hook helper
 */
export function createDebouncedSearch<T>(
    searchFn: (query: string) => Promise<T[]>,
    delay = 300
): (query: string) => Promise<T[]> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let lastPromise: Promise<T[]> | null = null;

    return (query: string): Promise<T[]> => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }

        return new Promise((resolve) => {
            timeoutId = setTimeout(async () => {
                lastPromise = searchFn(query);
                const results = await lastPromise;
                resolve(results);
            }, delay);
        });
    };
}

/**
 * Extract searchable content from canvas items
 */
export function getItemSearchableContent(item: { type: string; content?: unknown; tags?: string[] }): string[] {
    const content = item.content as Record<string, unknown> | null;
    const texts: string[] = [];

    if (content) {
        if (typeof content.title === 'string') texts.push(content.title);
        if (typeof content.text === 'string') texts.push(content.text);
        if (typeof content.description === 'string') texts.push(content.description);
        if (typeof content.url === 'string') texts.push(content.url);
        if (typeof content.alt === 'string') texts.push(content.alt);
        if (typeof content.caption === 'string') texts.push(content.caption);
    }

    if (item.tags) {
        texts.push(...item.tags);
    }

    return texts.filter(Boolean);
}
