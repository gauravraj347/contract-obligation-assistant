/** Input limits for document ingestion. Kept in one place so validation and docs agree. */
export const LIMITS = Object.freeze({
  maxFileBytes: 10 * 1024 * 1024,
  maxPastedTextBytes: 1024 * 1024,
  maxContractChars: 200_000,
  // The brief describes the policy as a "small" document.
  maxPolicyChars: 50_000,
  minTextChars: 50,
  // A text-based PDF has far more than this per page; below it the PDF is most likely scanned.
  minPdfCharsPerPage: 20,
  pdfParseTimeoutMs: 20_000,
  maxTitleLength: 200,
  maxNoteLength: 500,
});

export const ALLOWED_FILE_EXTENSIONS = Object.freeze(['.pdf', '.docx']);
