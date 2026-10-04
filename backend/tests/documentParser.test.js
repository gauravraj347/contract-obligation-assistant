import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/config/limits.js';
import { parseDocument } from '../src/services/documentParser.js';
import { makeDocx, makePdf, SAMPLE_CONTRACT_LINES, SAMPLE_CONTRACT_TEXT } from './helpers/fixtures.js';

const fileInput = (buffer, originalName) => ({ kind: 'file', buffer, originalName, mimeType: 'application/octet-stream' });

async function expectAppError(promise, code, status) {
  await expect(promise).rejects.toMatchObject({ code, status });
}

describe('parseDocument', () => {
  it('extracts text from a multi-page text-based PDF without page markers', async () => {
    const pdf = await makePdf([SAMPLE_CONTRACT_LINES.slice(0, 4), SAMPLE_CONTRACT_LINES.slice(4)]);
    const result = await parseDocument(fileInput(pdf, 'msa.pdf'), 'contract');

    expect(result.sourceType).toBe('pdf');
    expect(result.pageCount).toBe(2);
    expect(result.text).toContain('1.1 This Agreement commences on 1 January 2026');
    expect(result.text).toContain('3.1 Either party may terminate');
    expect(result.text).not.toMatch(/-- \d+ of \d+ --/);
  }, 30_000);

  it('extracts text from a DOCX file', async () => {
    const docx = await makeDocx(SAMPLE_CONTRACT_LINES);
    const result = await parseDocument(fileInput(docx, 'msa.docx'), 'contract');

    expect(result.sourceType).toBe('docx');
    expect(result.originalFilename).toBe('msa.docx');
    expect(result.text).toContain('2.1 The Agreement renews automatically');
  }, 30_000);

  it('accepts pasted text and normalises it', async () => {
    const result = await parseDocument({ kind: 'text', text: `${SAMPLE_CONTRACT_TEXT.replace(/\n/g, '\r\n')}\r\n` }, 'contract');
    expect(result.sourceType).toBe('text');
    expect(result.text).toBe(SAMPLE_CONTRACT_TEXT);
  });

  it('rejects a scanned (image-only) PDF with an OCR-not-supported message', async () => {
    const pdf = await makePdf([[], []]);
    const promise = parseDocument(fileInput(pdf, 'scan.pdf'), 'contract');
    await expectAppError(promise, 'NO_EXTRACTABLE_TEXT', 422);
    await expect(parseDocument(fileInput(pdf, 'scan.pdf'), 'contract')).rejects.toThrow(/OCR is not supported/);
  }, 30_000);

  it('rejects a file whose content does not match its extension', async () => {
    await expectAppError(parseDocument(fileInput(Buffer.from('plain text'), 'fake.pdf'), 'contract'), 'UNREADABLE_DOCUMENT', 422);
  });

  it('rejects a corrupt PDF', async () => {
    const corrupt = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('garbage'.repeat(50))]);
    await expectAppError(parseDocument(fileInput(corrupt, 'broken.pdf'), 'contract'), 'UNREADABLE_DOCUMENT', 422);
  }, 30_000);

  it('rejects unsupported file types', async () => {
    await expectAppError(parseDocument(fileInput(Buffer.from('x'), 'old.doc'), 'contract'), 'UNSUPPORTED_FILE_TYPE', 400);
  });

  it('rejects text that is too short to be a contract', async () => {
    await expectAppError(parseDocument({ kind: 'text', text: 'Too short.' }, 'contract'), 'NO_EXTRACTABLE_TEXT', 422);
  });

  it('enforces a smaller size limit for policy documents than for contracts', async () => {
    const text = 'Policy clause text. '.repeat(Math.ceil((LIMITS.maxPolicyChars + 10) / 20));
    await expectAppError(parseDocument({ kind: 'text', text }, 'policy'), 'DOCUMENT_TOO_LONG', 422);
    await expect(parseDocument({ kind: 'text', text }, 'contract')).resolves.toMatchObject({ role: 'contract' });
  });
});
