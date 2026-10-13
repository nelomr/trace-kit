/** Escapes text for use in XML character data and in double- or single-quoted attribute values.
 * `&` is replaced first so the entities introduced by the later replacements are not escaped a
 * second time. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
