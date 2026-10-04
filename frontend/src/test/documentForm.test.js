import { describe, expect, it } from 'vitest';
import { buildDocumentFormData, emptyDocument, validateDocumentForm } from '../utils/documentForm.js';

const file = (name, size = 1000) => new File([new Uint8Array(size)], name);
const longText = 'This contract text is long enough to pass the minimum length check easily.';
const values = (overrides = {}) => ({ title: '', note: '', contract: emptyDocument(), policy: emptyDocument(), ...overrides });

describe('validateDocumentForm', () => {
  it('requires a contract but not a policy', () => {
    expect(validateDocumentForm(values())).toEqual({ contractFile: 'Contract file is required' });
    expect(validateDocumentForm(values({ contract: { mode: 'text', file: null, text: '  ' } }))).toEqual({
      contractText: 'Paste the contract text',
    });
  });

  it('accepts a PDF/DOCX file or long enough pasted text', () => {
    expect(validateDocumentForm(values({ contract: { mode: 'file', file: file('msa.PDF'), text: '' } }))).toEqual({});
    expect(validateDocumentForm(values({ contract: { mode: 'text', file: null, text: longText } }))).toEqual({});
  });

  it('rejects unsupported, empty and oversized files', () => {
    const check = (f) => validateDocumentForm(values({ contract: { mode: 'file', file: f, text: '' } })).contractFile;
    expect(check(file('scan.png'))).toMatch(/Only PDF or DOCX/);
    expect(check(file('msa.docx', 0))).toMatch(/empty/);
    expect(check(file('msa.pdf', 10 * 1024 * 1024 + 1))).toMatch(/10 MB/);
  });

  it('validates the optional policy only when provided, and the title length', () => {
    const errors = validateDocumentForm(
      values({
        title: 'x'.repeat(201),
        contract: { mode: 'text', file: null, text: longText },
        policy: { mode: 'text', file: null, text: 'short' },
      }),
    );
    expect(errors).toEqual({ title: expect.stringMatching(/200/), policyText: expect.stringMatching(/too short/) });
  });
});

describe('buildDocumentFormData', () => {
  it('sends only the active input of each document', () => {
    const contractFile = file('msa.pdf');
    const formData = buildDocumentFormData(
      values({
        title: ' Acme ',
        contract: { mode: 'file', file: contractFile, text: 'stale pasted text' },
        policy: { mode: 'text', file: file('old.pdf'), text: longText },
      }),
    );
    expect(formData.get('title')).toBe('Acme');
    expect(formData.get('contractFile').name).toBe('msa.pdf');
    expect(formData.get('contractText')).toBeNull();
    expect(formData.get('policyText')).toBe(longText);
    expect(formData.get('policyFile')).toBeNull();
  });
});
