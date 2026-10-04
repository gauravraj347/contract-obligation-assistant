const toSnake = (value) => value.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (value) => value.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

function isPlainRow(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

/** Shallow key conversion only: JSONB column contents are left untouched. */
function rowToCamel(row) {
  if (!isPlainRow(row)) return row;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [toCamel(key), value]));
}

/** Knex hooks so application code uses camelCase while the database uses snake_case. */
export const knexCaseMappers = {
  wrapIdentifier: (value, originalImpl) => originalImpl(value === '*' ? value : toSnake(value)),
  postProcessResponse: (result) => (Array.isArray(result) ? result.map(rowToCamel) : rowToCamel(result)),
};
