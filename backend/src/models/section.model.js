const TABLE = 'sections';

export async function insertSections(db, documentId, sections) {
  if (sections.length === 0) return [];
  const rows = sections.map((section) => ({
    documentId,
    position: section.position,
    sectionRef: section.sectionRef,
    heading: section.heading,
    text: section.text,
    textHash: section.textHash,
    startOffset: section.startOffset,
    endOffset: section.endOffset,
  }));
  return db(TABLE).insert(rows).returning(['id', 'position', 'sectionRef']);
}

export async function listSectionsByDocumentIds(db, documentIds) {
  if (documentIds.length === 0) return [];
  return db(TABLE).whereIn('documentId', documentIds).orderBy([{ column: 'documentId' }, { column: 'position' }]);
}
