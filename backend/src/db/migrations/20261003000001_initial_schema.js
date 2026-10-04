/**
 * Initial schema for the contract review workflow.
 *
 * contracts ─< contract_versions ─< documents (contract | policy) ─< sections
 *                     │
 *                     ├─< extraction_runs ─< extracted_items ─< item_citations >─ sections
 *                     │                                    └─< item_reviews (audit trail)
 *
 * Status-like columns use text + CHECK constraints (not native enums) so
 * allowed values can evolve with a simple migration.
 */

const timestamps = (table, db) => {
  table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
  table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
};

export async function up(knex) {
  await knex.schema.createTable('contracts', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('title').notNullable();
    timestamps(table, knex);
  });

  await knex.schema.createTable('contract_versions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('contract_id').notNullable().references('id').inTable('contracts').onDelete('CASCADE');
    table.integer('version_number').notNullable();
    table.text('note');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['contract_id', 'version_number']);
  });

  await knex.schema.createTable('documents', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table
      .uuid('contract_version_id')
      .notNullable()
      .references('id')
      .inTable('contract_versions')
      .onDelete('CASCADE');
    table.enu('role', ['contract', 'policy'], { useNative: false }).notNullable();
    table.enu('source_type', ['pdf', 'docx', 'text'], { useNative: false }).notNullable();
    table.text('original_filename');
    table.text('mime_type');
    table.text('raw_text').notNullable();
    table.specificType('text_hash', 'char(64)').notNullable();
    table.integer('char_count').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['contract_version_id', 'role']);
  });

  await knex.schema.createTable('sections', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('document_id').notNullable().references('id').inTable('documents').onDelete('CASCADE');
    table.integer('position').notNullable();
    table.text('section_ref').notNullable();
    table.text('heading');
    table.text('text').notNullable();
    table.specificType('text_hash', 'char(64)').notNullable();
    table.integer('start_offset').notNullable();
    table.integer('end_offset').notNullable();
    table.unique(['document_id', 'position']);
    table.index(['document_id', 'section_ref']);
  });

  await knex.schema.createTable('extraction_runs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table
      .uuid('contract_version_id')
      .notNullable()
      .references('id')
      .inTable('contract_versions')
      .onDelete('CASCADE');
    table
      .enu('status', ['queued', 'running', 'succeeded', 'failed'], { useNative: false })
      .notNullable()
      .defaultTo('queued');
    table.text('model');
    table.text('prompt_version');
    table.integer('input_tokens');
    table.integer('output_tokens');
    table.integer('latency_ms');
    table.integer('item_count');
    table.integer('unverified_citation_count');
    table.text('error_code');
    table.text('error_message');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('started_at', { useTz: true });
    table.timestamp('finished_at', { useTz: true });
    table.index(['contract_version_id', 'created_at']);
    table.index(['status']);
  });

  await knex.schema.createTable('extracted_items', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table
      .uuid('contract_version_id')
      .notNullable()
      .references('id')
      .inTable('contract_versions')
      .onDelete('CASCADE');
    table
      .uuid('extraction_run_id')
      .notNullable()
      .references('id')
      .inTable('extraction_runs')
      .onDelete('CASCADE');
    table
      .enu(
        'item_type',
        [
          'party',
          'effective_date',
          'expiry',
          'renewal',
          'termination',
          'notice',
          'obligation',
          'ambiguity',
          'conflict',
        ],
        { useNative: false },
      )
      .notNullable();
    table.text('label').notNullable();
    // Original AI output is immutable; user corrections are applied to current_value.
    table.jsonb('ai_value').notNullable();
    table.jsonb('current_value').notNullable();
    table.enu('certainty', ['confirmed', 'interpretation'], { useNative: false }).notNullable();
    table.text('certainty_reason');
    table.text('responsible_party');
    table.text('clarification_question');
    table
      .enu('status', ['pending', 'approved', 'rejected'], { useNative: false })
      .notNullable()
      .defaultTo('pending');
    table.boolean('is_edited').notNullable().defaultTo(false);
    table.boolean('potentially_stale').notNullable().defaultTo(false);
    table.text('stale_reason');
    table.uuid('stale_since_version_id').references('id').inTable('contract_versions').onDelete('SET NULL');
    table.timestamp('reviewed_at', { useTz: true });
    timestamps(table, knex);
    table.index(['contract_version_id', 'status']);
    table.index(['status', 'potentially_stale']);
  });

  await knex.schema.createTable('item_citations', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('item_id').notNullable().references('id').inTable('extracted_items').onDelete('CASCADE');
    table.uuid('section_id').references('id').inTable('sections').onDelete('SET NULL');
    // Kept denormalised so the citation stays readable even if a section row is removed.
    table.text('section_ref').notNullable();
    table.enu('document_role', ['contract', 'policy'], { useNative: false }).notNullable();
    table.text('quote').notNullable();
    // True only when the quote was found verbatim (whitespace-normalised) in the cited section.
    table.boolean('verified').notNullable().defaultTo(false);
    table.index(['item_id']);
  });

  await knex.schema.createTable('item_reviews', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('item_id').notNullable().references('id').inTable('extracted_items').onDelete('CASCADE');
    table
      .enu('action', ['edit', 'approve', 'reject', 'reconfirm', 'reopen'], { useNative: false })
      .notNullable();
    table.jsonb('before');
    table.jsonb('after');
    table.text('note');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['item_id', 'created_at']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('item_reviews');
  await knex.schema.dropTableIfExists('item_citations');
  await knex.schema.dropTableIfExists('extracted_items');
  await knex.schema.dropTableIfExists('extraction_runs');
  await knex.schema.dropTableIfExists('sections');
  await knex.schema.dropTableIfExists('documents');
  await knex.schema.dropTableIfExists('contract_versions');
  await knex.schema.dropTableIfExists('contracts');
}
