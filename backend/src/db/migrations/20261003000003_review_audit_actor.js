/**
 * Review audit trail additions:
 *  - action 'mark_stale': recorded by the system when a new contract version makes an approved item potentially stale
 *  - actor: 'user' for human review decisions, 'system' for automatic changes
 */
const OLD_ACTIONS = ['edit', 'approve', 'reject', 'reconfirm', 'reopen'];
const NEW_ACTIONS = [...OLD_ACTIONS, 'mark_stale'];

const checkSql = (actions) =>
  `alter table item_reviews add constraint item_reviews_action_check check (action in (${actions.map((a) => `'${a}'`).join(', ')}))`;

export async function up(knex) {
  await knex.raw('alter table item_reviews drop constraint if exists item_reviews_action_check');
  await knex.raw(checkSql(NEW_ACTIONS));
  await knex.schema.alterTable('item_reviews', (table) => {
    table.enu('actor', ['user', 'system'], { useNative: false }).notNullable().defaultTo('user');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('item_reviews', (table) => {
    table.dropColumn('actor');
  });
  await knex('item_reviews').where({ action: 'mark_stale' }).delete();
  await knex.raw('alter table item_reviews drop constraint if exists item_reviews_action_check');
  await knex.raw(checkSql(OLD_ACTIONS));
}
