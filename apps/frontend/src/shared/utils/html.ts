/**
 * Strip HTML tags from a string
 */
export function stripHtmlTags(html: string | undefined): string {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '').trim();
}
