/**
 * Audit fields for AI extraction runs:
 *  - invalid_item_count: items the model returned that failed validation and were discarded
 *  - warnings: structured validation/citation warnings shown to reviewers
 *  - raw_response: the model's raw JSON output, kept in the DB (never in logs) for traceability
 */
export async function up(knex) {
  await knex.schema.alterTable('extraction_runs', (table) => {
    table.integer('invalid_item_count');
    table.jsonb('warnings');
    table.jsonb('raw_response');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('extraction_runs', (table) => {
    table.dropColumn('raw_response');
    table.dropColumn('warnings');
    table.dropColumn('invalid_item_count');
  });
}
