import { contractIdParams } from '../validators/contract.validators.js';
import { decisionBody, editItemBody, itemIdParams } from '../validators/review.validators.js';

export function createReviewController({ reviewService }) {
  const decision = (method) => async (req, res) => {
    const { itemId } = itemIdParams.parse(req.params);
    const body = decisionBody.parse(req.body ?? {});
    res.json({ item: await reviewService[method](itemId, body) });
  };

  return {
    async getItem(req, res) {
      const { itemId } = itemIdParams.parse(req.params);
      res.json({ item: await reviewService.getItem(itemId) });
    },

    async editItem(req, res) {
      const { itemId } = itemIdParams.parse(req.params);
      const patch = editItemBody.parse(req.body ?? {});
      res.json({ item: await reviewService.editItem(itemId, patch) });
    },

    approve: decision('approveItem'),
    reject: decision('rejectItem'),
    reopen: decision('reopenItem'),

    async contractReview(req, res) {
      const { contractId } = contractIdParams.parse(req.params);
      res.json(await reviewService.getContractReview(contractId));
    },
  };
}
