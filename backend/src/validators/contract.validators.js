import { z } from 'zod';
import { LIMITS } from '../config/limits.js';
import { DOCUMENT_FILE_FIELDS } from '../middleware/upload.js';
import { ValidationError } from '../utils/errors.js';

const optionalTrimmed = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined);

const createBodySchema = z.object({
  title: optionalTrimmed(LIMITS.maxTitleLength),
  contractText: z.string().optional(),
  policyText: z.string().optional(),
});

const versionBodySchema = z.object({
  note: optionalTrimmed(LIMITS.maxNoteLength),
  contractText: z.string().optional(),
  policyText: z.string().optional(),
});

export const contractIdParams = z.object({ contractId: z.uuid('contractId must be a valid id') });
export const versionIdParams = z.object({ versionId: z.uuid('versionId must be a valid id') });

/**
 * Resolves one document from either an uploaded file or pasted text.
 * Exactly one source is allowed; returns null when neither is given.
 */
function resolveDocumentInput(req, body, role, issues) {
  const fileField = DOCUMENT_FILE_FIELDS[role];
  const textField = `${role}Text`;
  const file = req.files?.[fileField]?.[0];
  const text = body[textField]?.trim() ? body[textField] : undefined;

  if (file && text) {
    issues.push({ path: fileField, message: `Provide either ${fileField} or ${textField}, not both` });
    return null;
  }
  if (file) {
    if (file.size === 0) {
      issues.push({ path: fileField, message: 'Uploaded file is empty' });
      return null;
    }
    return { kind: 'file', buffer: file.buffer, originalName: file.originalname, mimeType: file.mimetype };
  }
  if (text) return { kind: 'text', text };
  return null;
}

function parseBody(schema, req) {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    throw new ValidationError(
      'Request validation failed',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}

function resolveDocuments(req, body) {
  const issues = [];
  const contractInput = resolveDocumentInput(req, body, 'contract', issues);
  const policyInput = resolveDocumentInput(req, body, 'policy', issues);
  if (!contractInput && !issues.some((issue) => issue.path.startsWith('contract'))) {
    issues.push({ path: DOCUMENT_FILE_FIELDS.contract, message: 'A contract file or pasted contract text is required' });
  }
  if (issues.length) throw new ValidationError('Request validation failed', issues);
  return { contractInput, policyInput };
}

export function parseCreateContractRequest(req) {
  const body = parseBody(createBodySchema, req);
  return { title: body.title, ...resolveDocuments(req, body) };
}

export function parseAddVersionRequest(req) {
  const body = parseBody(versionBodySchema, req);
  return { note: body.note, ...resolveDocuments(req, body) };
}
