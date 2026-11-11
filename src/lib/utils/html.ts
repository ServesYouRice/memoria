/**
 * HTML utility functions
 */

/**
 * Strips HTML tags from a string and returns plain text
 * This is used for displaying rich text content in Konva canvas
 * where HTML rendering is not supported
 */
export function stripHtmlTags(html: string): string {
  if (typeof window === "undefined") {
    // Server-side: use a simple regex approach
    return html
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }

  // Client-side: parse in an inert DOMParser document. It has no browsing
  // context, so markup such as <img onerror> is never fetched or run, unlike
  // an element created by the live `document`.
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return parsed.body?.textContent ?? "";
}

/**
 * Truncates text to a maximum length with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + "...";
}

/**
 * Checks if a string contains HTML tags
 */
export function containsHtml(str: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(str);
}
