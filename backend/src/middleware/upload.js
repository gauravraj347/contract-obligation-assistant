import path from 'node:path';
import multer from 'multer';
import { ALLOWED_FILE_EXTENSIONS, LIMITS } from '../config/limits.js';
import { AppError } from '../utils/errors.js';

export const DOCUMENT_FILE_FIELDS = Object.freeze({ contract: 'contractFile', policy: 'policyFile' });

const MULTER_ERRORS = {
  LIMIT_FILE_SIZE: {
    status: 413,
    code: 'FILE_TOO_LARGE',
    message: `File exceeds the ${LIMITS.maxFileBytes / (1024 * 1024)} MB limit`,
  },
  LIMIT_FIELD_VALUE: {
    status: 413,
    code: 'TEXT_TOO_LARGE',
    message: `Pasted text exceeds the ${LIMITS.maxPastedTextBytes / 1024} KB limit`,
  },
  LIMIT_UNEXPECTED_FILE: {
    status: 400,
    code: 'UNEXPECTED_FILE_FIELD',
    message: `Upload files only as "${DOCUMENT_FILE_FIELDS.contract}" or "${DOCUMENT_FILE_FIELDS.policy}" (one each)`,
  },
};

const parser = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: LIMITS.maxFileBytes,
    fieldSize: LIMITS.maxPastedTextBytes,
    files: 2,
    fields: 10,
  },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_FILE_EXTENSIONS.includes(extension)) return callback(null, true);
    return callback(
      new AppError(`"${file.originalname}" is not supported. Upload a PDF or DOCX file, or paste the text.`, {
        status: 400,
        code: 'UNSUPPORTED_FILE_TYPE',
      }),
    );
  },
}).fields([
  { name: DOCUMENT_FILE_FIELDS.contract, maxCount: 1 },
  { name: DOCUMENT_FILE_FIELDS.policy, maxCount: 1 },
]);

/** Accepts multipart uploads (files held in memory, never written to disk) and maps multer errors to API errors. */
export function documentUpload(req, res, next) {
  parser(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const mapped = MULTER_ERRORS[err.code] ?? { status: 400, code: 'INVALID_UPLOAD', message: err.message };
      return next(new AppError(mapped.message, { status: mapped.status, code: mapped.code }));
    }
    return next(err);
  });
}
