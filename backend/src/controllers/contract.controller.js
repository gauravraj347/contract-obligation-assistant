import {
  contractIdParams,
  parseAddVersionRequest,
  parseCreateContractRequest,
  versionIdParams,
} from '../validators/contract.validators.js';

export function createContractController({ contractService, extractionService }) {
  return {
    /** Stores the documents, then queues AI extraction; the client polls the returned run. */
    async create(req, res) {
      const input = parseCreateContractRequest(req);
      const result = await contractService.createContract(input);
      const extractionRun = await extractionService.startExtraction(result.version.id);
      res.status(201).json({ ...result, extractionRun });
    },

    async list(_req, res) {
      res.json({ contracts: await contractService.listContracts() });
    },

    async get(req, res) {
      const { contractId } = contractIdParams.parse(req.params);
      res.json(await contractService.getContract(contractId));
    },

    async addVersion(req, res) {
      const { contractId } = contractIdParams.parse(req.params);
      const input = parseAddVersionRequest(req);
      const result = await contractService.addVersion(contractId, input);
      const extractionRun = await extractionService.startExtraction(result.version.id);
      res.status(201).json({ ...result, extractionRun });
    },

    async getVersion(req, res) {
      const { versionId } = versionIdParams.parse(req.params);
      res.json(await contractService.getVersion(versionId));
    },
  };
}
