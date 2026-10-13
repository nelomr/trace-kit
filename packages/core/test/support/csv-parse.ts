/**
 * Minimal RFC 4180 reader for tests: quoted fields with doubled quotes, embedded `,`, CR and LF
 * inside quotes, and `\n` or `\r\n` record terminators. Strict: a malformed quote throws.
 */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;
  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        const next = text.charAt(i);
        if (i < text.length && next !== "," && next !== "\n" && next !== "\r") {
          throw new Error(`unexpected character after closing quote at ${String(i)}`);
        }
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      if (fieldStarted) throw new Error(`quote inside an unquoted field at ${String(i)}`);
      inQuotes = true;
      fieldStarted = true;
      i += 1;
    } else if (ch === ",") {
      record.push(field);
      field = "";
      fieldStarted = false;
      i += 1;
    } else if (ch === "\n" || ch === "\r") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      fieldStarted = false;
      i += ch === "\r" && text.charAt(i + 1) === "\n" ? 2 : 1;
    } else {
      field += ch;
      fieldStarted = true;
      i += 1;
    }
  }
  if (inQuotes) throw new Error("unterminated quoted field");
  if (fieldStarted || field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}
