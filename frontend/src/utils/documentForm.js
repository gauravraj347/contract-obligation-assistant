/** Client-side mirror of the API's upload rules, for immediate feedback. The API re-validates everything. */
export const UPLOAD_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  minTextChars: 50,
  maxTitleLength: 200,
  maxNoteLength: 500,
  extensions: ['.pdf', '.docx'],
};

export const emptyDocument = () => ({ mode: 'file', file: null, text: '' });

const fieldName = (role, mode) => `${role}${mode === 'file' ? 'File' : 'Text'}`;

function validateDocument(role, doc, { required }, errors) {
  const label = role === 'policy' ? 'Policy document' : 'Contract';
  if (doc.mode === 'file') {
    if (!doc.file) {
      if (required) errors[fieldName(role, 'file')] = `${label} file is required`;
      return;
    }
    const name = doc.file.name.toLowerCase();
    if (!UPLOAD_LIMITS.extensions.some((ext) => name.endsWith(ext))) {
      errors[fieldName(role, 'file')] = 'Only PDF or DOCX files are supported (or paste the text)';
    } else if (doc.file.size === 0) {
      errors[fieldName(role, 'file')] = 'The selected file is empty';
    } else if (doc.file.size > UPLOAD_LIMITS.maxFileBytes) {
      errors[fieldName(role, 'file')] = 'File is larger than 10 MB';
    }
    return;
  }
  const chars = doc.text.replace(/\s/g, '').length;
  if (chars === 0) {
    if (required) errors[fieldName(role, 'text')] = `Paste the ${label.toLowerCase()} text`;
    return;
  }
  if (chars < UPLOAD_LIMITS.minTextChars) {
    errors[fieldName(role, 'text')] = `Text is too short (at least ${UPLOAD_LIMITS.minTextChars} characters)`;
  }
}

/**
 * @param {{ contract, policy, title?: string, note?: string }} values
 * @returns {Record<string, string>} field -> message (empty when valid)
 */
export function validateDocumentForm(values) {
  const errors = {};
  if (values.title && values.title.trim().length > UPLOAD_LIMITS.maxTitleLength) {
    errors.title = `Title must be at most ${UPLOAD_LIMITS.maxTitleLength} characters`;
  }
  if (values.note && values.note.trim().length > UPLOAD_LIMITS.maxNoteLength) {
    errors.note = `Note must be at most ${UPLOAD_LIMITS.maxNoteLength} characters`;
  }
  validateDocument('contract', values.contract, { required: true }, errors);
  validateDocument('policy', values.policy, { required: false }, errors);
  return errors;
}

/** Builds the multipart body the API expects; only the active mode of each document is sent. */
export function buildDocumentFormData(values) {
  const formData = new FormData();
  if (values.title?.trim()) formData.append('title', values.title.trim());
  if (values.note?.trim()) formData.append('note', values.note.trim());
  for (const role of ['contract', 'policy']) {
    const doc = values[role];
    if (doc.mode === 'file' && doc.file) formData.append(fieldName(role, 'file'), doc.file);
    if (doc.mode === 'text' && doc.text.trim()) formData.append(fieldName(role, 'text'), doc.text);
  }
  return formData;
}
