/**
 * Minimal well-formedness check for the exporter's output, usable under the plain Node test
 * environment (no `DOMParser`). It tokenizes tags and text, verifies attribute quoting, matched
 * and properly nested tags, a single root, and that every `&` in text or attributes begins one of
 * the five predefined entities.
 */
const ENTITY_OR_PLAIN = /^(?:[^&<]|&(?:amp|lt|gt|quot|apos);)*$/;
const TAG =
  /^<(\/?)([A-Za-z][\w:-]*)((?:\s+[A-Za-z][\w:-]*="[^"<]*")*)\s*(\/?)>$/;
const ATTRIBUTE_VALUES = /="([^"]*)"/g;

export function assertWellFormedXml(xml: string): void {
  const stack: string[] = [];
  let roots = 0;
  const tokens = xml.match(/<[^>]*>|[^<]+/g) ?? [];
  if (tokens.join("") !== xml) throw new Error("tokenization lost characters");
  for (const token of tokens) {
    if (token.startsWith("<")) {
      const match = TAG.exec(token);
      if (match === null) throw new Error(`malformed tag: ${token.slice(0, 80)}`);
      const [, closing, name, attributes, selfClosing] = match;
      for (const value of (attributes ?? "").matchAll(ATTRIBUTE_VALUES)) {
        if (!ENTITY_OR_PLAIN.test(value[1] ?? "")) throw new Error(`bad entity in attribute: ${value[1] ?? ""}`);
      }
      if (closing === "/") {
        const open = stack.pop();
        if (open !== name) throw new Error(`mismatched </${name ?? ""}>, expected </${open ?? ""}>`);
      } else {
        if (stack.length === 0) roots += 1;
        if (selfClosing !== "/") stack.push(name ?? "");
      }
    } else if (!ENTITY_OR_PLAIN.test(token)) {
      throw new Error(`bad entity in text: ${token.slice(0, 80)}`);
    }
  }
  if (stack.length !== 0) throw new Error(`unclosed tags: ${stack.join(",")}`);
  if (roots !== 1) throw new Error(`expected exactly one root element, found ${roots}`);
}
