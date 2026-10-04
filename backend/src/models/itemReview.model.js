const TABLE = 'itemReviews';

export async function insertReview(db, { itemId, action, before, after, note, actor = 'user' }) {
  const [row] = await db(TABLE)
    .insert({
      itemId,
      action,
      actor,
      before: before === undefined ? null : JSON.stringify(before),
      after: after === undefined ? null : JSON.stringify(after),
      note: note ?? null,
    })
    .returning('*');
  return row;
}

export async function insertReviews(db, reviews) {
  if (reviews.length === 0) return;
  await db(TABLE).insert(
    reviews.map((review) => ({
      itemId: review.itemId,
      action: review.action,
      actor: review.actor ?? 'user',
      before: review.before === undefined ? null : JSON.stringify(review.before),
      after: review.after === undefined ? null : JSON.stringify(review.after),
      note: review.note ?? null,
    })),
  );
}

export async function listReviewsForItem(db, itemId) {
  return db(TABLE).where({ itemId }).orderBy('createdAt', 'asc');
}
