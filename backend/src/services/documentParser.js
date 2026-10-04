import path from 'node:path';
import mammoth from 'mammoth';
import { PasswordException, PDFParse } from 'pdf-parse';
import { LIMITS } from '../config/limits.js';
import { AppError } from '../utils/errors.js';
import { countNonWhitespace, normalizeDocumentText } from '../utils/text.js';

const PDF_MAGIC = '%PDF-';
const ZIP_MAGIC = 'PK\u0003\u0004';

const unreadable = (message, code = 'UNREADABLE_DOCUMENT') => new AppError(message, { status: 422, code });

function detectFileType({ buffer, originalName }) {
  const extension = path.extname(originalName ?? '').toLowerCase();
  const head = buffer.subarray(0, 5).toString('latin1');

  if (extension === '.pdf' && head.startsWith(PDF_MAGIC)) return 'pdf';
  if (extension === '.docx' && head.startsWith(ZIP_MAGIC)) return 'docx';
  if (extension === '.pdf' || extension === '.docx') {
    throw unreadable(`"${originalName}" does not look like a valid ${extension.slice(1).toUpperCase()} file`);
  }
  throw new AppError('Only PDF and DOCX files are supported (or paste the text instead)', {
    status: 400,
    code: 'UNSUPPORTED_FILE_TYPE',
  });
}

function withTimeout(promise, ms, onTimeout) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function extractPdf(buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await withTimeout(parser.getText(), LIMITS.pdfParseTimeoutMs, () =>
      unreadable('PDF took too long to read'),
    );
    // Join per-page text ourselves: result.text contains "-- n of m --" page markers.
    const text = result.pages.map((page) => page.text).join('\n');
    return { text, pageCount: result.total };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof PasswordException || err?.name === 'PasswordException') {
      throw unreadable('Password-protected PDFs are not supported', 'PASSWORD_PROTECTED_PDF');
    }
    throw unreadable('The PDF could not be read; it may be corrupt');
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extractDocx(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value, pageCount: null };
  } catch {
    throw unreadable('The DOCX file could not be read; it may be corrupt');
  }
}

function assertTextUsable(text, { role, sourceType, pageCount }) {
  const label = role === 'policy' ? 'Policy document' : 'Contract';
  const chars = countNonWhitespace(text);

  if (sourceType === 'pdf' && pageCount && chars / pageCount < LIMITS.minPdfCharsPerPage) {
    throw unreadable(
      `${label} PDF has no extractable text. It is probably scanned; OCR is not supported, so upload a text-based PDF, DOCX, or paste the text.`,
      'NO_EXTRACTABLE_TEXT',
    );
  }
  if (chars < LIMITS.minTextChars) {
    throw unreadable(
      `${label} text is too short (minimum ${LIMITS.minTextChars} non-space characters)`,
      'NO_EXTRACTABLE_TEXT',
    );
  }
  const max = role === 'policy' ? LIMITS.maxPolicyChars : LIMITS.maxContractChars;
  if (text.length > max) {
    throw unreadable(
      `${label} is too long (${text.length.toLocaleString('en-US')} characters, maximum ${max.toLocaleString('en-US')})`,
      'DOCUMENT_TOO_LONG',
    );
  }
}

/**
 * Turns an uploaded file or pasted text into normalised plain text.
 * @param {{ kind: 'file', buffer: Buffer, originalName: string, mimeType?: string } | { kind: 'text', text: string }} input
 * @param {'contract' | 'policy'} role
 */
export async function parseDocument(input, role) {
  let sourceType;
  let extracted;

  if (input.kind === 'text') {
    sourceType = 'text';
    extracted = { text: input.text, pageCount: null };
  } else {
    sourceType = detectFileType(input);
    extracted = sourceType === 'pdf' ? await extractPdf(input.buffer) : await extractDocx(input.buffer);
  }

  const text = normalizeDocumentText(extracted.text);
  assertTextUsable(text, { role, sourceType, pageCount: extracted.pageCount });

  return {
    role,
    sourceType,
    originalFilename: input.kind === 'file' ? input.originalName : null,
    mimeType: input.kind === 'file' ? (input.mimeType ?? null) : null,
    pageCount: extracted.pageCount,
    text,
  };
}
