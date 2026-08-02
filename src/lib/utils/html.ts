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

  // Client-side: use DOM parser for better accuracy
  const temp = document.createElement("div");
  temp.innerHTML = html;
  return temp.textContent || temp.innerText || "";
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
