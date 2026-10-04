import { sha256 } from '../utils/hash.js';
import { collapseWhitespace } from '../utils/text.js';

/**
 * Deterministically splits normalised document text into citable sections.
 *
 * Sections are created BEFORE the AI sees the document so every extracted item
 * can cite a stable section reference that we can verify in code.
 *
 * Recognised headings (at the start of a line):
 *   ARTICLE IV / Article 4      -> "Article IV"
 *   Section 5.1 / Clause 7      -> "5.1" / "7"
 *   Schedule 1 / Exhibit A / Annex / Appendix -> "Schedule 1"
 *   1.  /  1)  /  4.2  /  4.2.1 -> "1" / "4.2" / "4.2.1"
 * Text before the first heading becomes "Preamble" (parties usually live there).
 * Documents with fewer than two headings fall back to blank-line paragraphs ("Para N").
 */

const HEADING_PATTERNS = [
  {
    regex: /^(?:ARTICLE|Article)\s+([IVXLC]+|\d{1,3})\b[.:\-–]?\s*(.*)$/,
    ref: (m) => `Article ${m[1]}`,
  },
  {
    regex: /^(?:SECTION|Section|CLAUSE|Clause)\s+(\d{1,3}(?:\.\d{1,3})*)\b[.:\-–]?\s*(.*)$/,
    ref: (m) => m[1],
  },
  {
    regex: /^(SCHEDULE|Schedule|EXHIBIT|Exhibit|ANNEX|Annex|APPENDIX|Appendix)\s+([A-Z0-9]{1,4})\b[.:\-–]?\s*(.*)$/,
    ref: (m) => `${m[1][0]}${m[1].slice(1).toLowerCase()} ${m[2]}`,
    titleGroup: 3,
  },
  // Multi-level numbering: 4.2 / 4.2.1 (optional trailing dot).
  { regex: /^(\d{1,3}(?:\.\d{1,3}){1,4})\.?\s+(\S.*)$/, ref: (m) => m[1] },
  // Single-level numbering requires "." or ")" to avoid matching numbers in wrapped prose.
  { regex: /^(\d{1,3})[.)]\s+(\S.*)$/, ref: (m) => m[1] },
];

const MAX_HEADING_LENGTH = 80;
const MAX_HEADING_WORDS = 6;

function matchHeading(line) {
  const trimmed = line.trimStart();
  for (const pattern of HEADING_PATTERNS) {
    const match = trimmed.match(pattern.regex);
    if (match) {
      const title = (match[pattern.titleGroup ?? 2] ?? '').trim();
      return { ref: pattern.ref(match), heading: toHeading(title) };
    }
  }
  return null;
}

/** Keep the remainder of a heading line only when it looks like a title, not clause prose. */
function toHeading(title) {
  if (!title || title.length > MAX_HEADING_LENGTH) return null;
  const words = title.split(/\s+/).length;
  if (/[.;:]$/.test(title) && words > MAX_HEADING_WORDS) return null;
  return title.replace(/[.:]$/, '');
}

function lineOffsets(text) {
  const lines = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    lines.push({ line, start: offset });
    offset += line.length + 1;
  }
  return lines;
}

function buildSection(text, { ref, heading, start, end }) {
  // Trim while keeping offsets consistent with the stored document text.
  const raw = text.slice(start, end);
  const leading = raw.length - raw.trimStart().length;
  const body = raw.trim();
  if (!body) return null;
  return {
    sectionRef: ref,
    heading: heading ?? null,
    text: body,
    textHash: sha256(collapseWhitespace(body)),
    startOffset: start + leading,
    endOffset: start + leading + body.length,
  };
}

function headingSections(text, headingLines) {
  const sections = [];
  const firstStart = headingLines[0].start;
  if (text.slice(0, firstStart).trim()) {
    sections.push(buildSection(text, { ref: 'Preamble', heading: null, start: 0, end: firstStart }));
  }
  headingLines.forEach((h, i) => {
    const end = i + 1 < headingLines.length ? headingLines[i + 1].start : text.length;
    sections.push(buildSection(text, { ref: h.ref, heading: h.heading, start: h.start, end }));
  });
  return sections;
}

function paragraphSections(text) {
  const sections = [];
  const separator = /\n\s*\n/g;
  let start = 0;
  let match;
  const pushParagraph = (end) => {
    const section = buildSection(text, { ref: `Para ${sections.length + 1}`, heading: null, start, end });
    if (section) sections.push(section);
  };
  while ((match = separator.exec(text)) !== null) {
    pushParagraph(match.index);
    start = match.index + match[0].length;
  }
  pushParagraph(text.length);
  return sections;
}

/** Repeated numbering (e.g. "1." inside a schedule) gets a suffix so refs stay unique per document. */
function uniquifyRefs(sections) {
  const seen = new Map();
  return sections.map((section) => {
    const count = (seen.get(section.sectionRef) ?? 0) + 1;
    seen.set(section.sectionRef, count);
    return count === 1 ? section : { ...section, sectionRef: `${section.sectionRef} (${count})` };
  });
}

export function sectionize(text) {
  const lines = lineOffsets(text);
  const headingLines = [];
  for (const { line, start } of lines) {
    const heading = matchHeading(line);
    if (heading) headingLines.push({ ...heading, start });
  }

  const sections = headingLines.length >= 2 ? headingSections(text, headingLines) : paragraphSections(text);

  return uniquifyRefs(sections.filter(Boolean)).map((section, position) => ({ ...section, position }));
}
