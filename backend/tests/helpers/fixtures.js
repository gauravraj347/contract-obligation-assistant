import { Document, Packer, Paragraph } from 'docx';
import PDFDocument from 'pdfkit';

/** Builds a text-based PDF; each inner array is one page of lines. Empty arrays give blank (scan-like) pages. */
export function makePdf(pages) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    for (const lines of pages) {
      doc.addPage();
      for (const line of lines) doc.text(line);
    }
    doc.end();
  });
}

export function makeDocx(lines) {
  return Packer.toBuffer(new Document({ sections: [{ children: lines.map((line) => new Paragraph(line)) }] }));
}

export const SAMPLE_CONTRACT_LINES = [
  'MASTER SERVICES AGREEMENT',
  'This Agreement is made between Acme Ltd ("Customer") and Beta Services Inc ("Supplier").',
  '1. Term',
  '1.1 This Agreement commences on 1 January 2026 and continues for 12 months.',
  '2. Renewal',
  '2.1 The Agreement renews automatically for successive 12 month periods unless either party gives 60 days written notice.',
  '3. Termination',
  '3.1 Either party may terminate for material breach on 30 days written notice.',
];

export const SAMPLE_CONTRACT_TEXT = SAMPLE_CONTRACT_LINES.join('\n');

export const SAMPLE_POLICY_TEXT = [
  'PROCUREMENT POLICY',
  '1. Notice periods',
  '1.1 All supplier contracts must allow termination on no more than 30 days notice.',
  '2. Approvals',
  '2.1 Renewals above 50,000 USD require finance approval.',
].join('\n');
