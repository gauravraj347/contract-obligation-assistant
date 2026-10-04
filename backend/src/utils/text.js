// Control characters except tab (\x09) and newline (\x0A).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

/**
 * Canonical form for stored document text. Every offset, section and citation
 * refers to this normalised text, so it must be applied exactly once on ingest.
 */
export function normalizeDocumentText(raw) {
  return raw
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[   ]/g, ' ')
    .replace(/\t/g, ' ')
    .replace(CONTROL_CHARS, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Whitespace-insensitive form used for hashing and comparing section content. */
export function collapseWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

export function countNonWhitespace(text) {
  return text.replace(/\s/g, '').length;
}
