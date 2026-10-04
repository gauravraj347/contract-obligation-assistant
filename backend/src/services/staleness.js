/**
 * Explains, deterministically, why an approved item may be stale after a new version upload.
 * Compares each cited section's text hash (whitespace-insensitive) with the new version's sections.
 * This is a hint for the reviewer, not a decision: every previously approved item is flagged.
 *
 * @param {Array<{ sectionRef: string, documentRole: 'contract'|'policy', sectionHash: string|null }>} citations
 * @param {{ contract: Array<{ sectionRef, textHash }>, policy: Array<{ sectionRef, textHash }> }} newSections
 * @param {number} newVersionNumber
 * @returns {{ reason: string, citationChanges: Array<{ sectionRef, documentRole, change, newSectionRef? }> }}
 */
export function describeStaleness(citations, newSections, newVersionNumber) {
  const citationChanges = citations.map(({ sectionRef, documentRole, sectionHash }) => {
    if (!sectionHash) return { sectionRef, documentRole, change: 'unknown' };
    const candidates = newSections[documentRole] ?? [];
    const sameText = candidates.find((s) => s.textHash === sectionHash);
    if (sameText) {
      return { sectionRef, documentRole, change: 'unchanged', newSectionRef: sameText.sectionRef };
    }
    const sameRef = candidates.find((s) => s.sectionRef === sectionRef);
    return sameRef
      ? { sectionRef, documentRole, change: 'modified', newSectionRef: sameRef.sectionRef }
      : { sectionRef, documentRole, change: 'removed' };
  });

  const label = (c) => `${c.documentRole === 'policy' ? 'Policy ' : ''}§${c.sectionRef}`;
  const phrases = citationChanges.map((c) => {
    switch (c.change) {
      case 'unchanged':
        return c.newSectionRef === c.sectionRef
          ? `${label(c)} text unchanged`
          : `${label(c)} text unchanged (now §${c.newSectionRef})`;
      case 'modified':
        return `${label(c)} text changed`;
      case 'removed':
        return `${label(c)} text not found`;
      default:
        return `${label(c)} could not be compared`;
    }
  });

  return {
    reason: `Version ${newVersionNumber} uploaded; re-check this approved item. ${phrases.join('; ')}.`,
    citationChanges,
  };
}
