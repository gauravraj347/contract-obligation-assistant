/**
 * Deterministic check that an AI citation quote really appears in the source text.
 * This is the guard against hallucinated quotes and section references.
 */

/** Canonical form for matching: case, typographic quotes/dashes and whitespace are ignored. */
export function normalizeForMatch(text) {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits a quote on ellipses; models use "..." to skip words between exact fragments. */
function quoteFragments(quote) {
  return quote
    .split(/\.{3}|…/)
    .map((fragment) => normalizeForMatch(fragment).replace(/^[\s,;:]+|[\s,;:]+$/g, ''))
    .filter((fragment) => fragment.length > 0);
}

/** True when every fragment appears in the text, in order. */
export function quoteAppearsIn(quote, text) {
  const fragments = quoteFragments(quote);
  if (fragments.length === 0) return false;
  const haystack = normalizeForMatch(text);
  let from = 0;
  for (const fragment of fragments) {
    const index = haystack.indexOf(fragment, from);
    if (index === -1) return false;
    from = index + fragment.length;
  }
  return true;
}

/**
 * Resolves a model citation to a stored section.
 *  - verified in the cited section                 -> { verified: true,  remapped: false }
 *  - wrong key but quote found in exactly one place -> { verified: true,  remapped: true } (deterministic correction)
 *  - not found anywhere                            -> { verified: false } (item will be forced to "interpretation")
 *
 * @param {{ sectionKey: string, quote: string }} citation
 * @param {Map<string, { key, role, section }>} sectionsByKey
 */
export function resolveCitation(citation, sectionsByKey) {
  const cited = sectionsByKey.get(citation.sectionKey.toUpperCase());
  if (cited && quoteAppearsIn(citation.quote, cited.section.text)) {
    return { entry: cited, verified: true, remapped: false };
  }

  const matches = [...sectionsByKey.values()].filter((entry) => quoteAppearsIn(citation.quote, entry.section.text));
  if (matches.length === 1) {
    return { entry: matches[0], verified: true, remapped: true };
  }

  return { entry: cited ?? null, verified: false, remapped: false, ambiguousMatches: matches.length };
}
