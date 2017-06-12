const logger = require('winston');
const prWorker = require('../../lib/workers/pr');
const defaultConfig = require('../../lib/config/defaults').getConfig();

logger.remove(logger.transports.Console);

const getChangeLog = jest.fn();
getChangeLog.mockReturnValue('Mocked changelog');

describe('workers/pr', () => {
  describe('checkAutoMerge(pr, config)', () => {
    let config;
    let pr;
    beforeEach(() => {
      config = Object.assign({}, defaultConfig);
      pr = {
        head: {
          ref: 'somebranch',
        },
      };
      config.api = {
        mergePr: jest.fn(),
        getBranchStatus: jest.fn(),
      };
    });
    it('should not automerge if not configured', async () => {
      await prWorker.checkAutoMerge(pr, config);
      expect(config.api.mergePr.mock.calls.length).toBe(0);
    });
    it('should automerge if enabled and pr is mergeable', async () => {
      config.automergeEnabled = true;
      pr.mergeable = true;
      config.api.getBranchStatus.mockReturnValueOnce('success');
      await prWorker.checkAutoMerge(pr, config);
      expect(config.api.mergePr.mock.calls.length).toBe(1);
    });
    it('should not automerge if enabled and pr is mergeable but branch status is not success', async () => {
      config.automergeEnabled = true;
      pr.mergeable = true;
      config.api.getBranchStatus.mockReturnValueOnce('pending');
      await prWorker.checkAutoMerge(pr, config);
      expect(config.api.mergePr.mock.calls.length).toBe(0);
    });
    it('should not automerge if enabled and pr is mergeable but unstable', async () => {
      config.automergeEnabled = true;
      pr.mergeable = true;
      pr.mergeable_state = 'unstable';
      await prWorker.checkAutoMerge(pr, config);
      expect(config.api.mergePr.mock.calls.length).toBe(0);
    });
    it('should not automerge if enabled and pr is unmergeable', async () => {
      config.automergeEnabled = true;
      pr.mergeable = false;
      await prWorker.checkAutoMerge(pr, config);
      expect(config.api.mergePr.mock.calls.length).toBe(0);
    });
  });
  describe('ensurePr(upgrades)', () => {
    let config;
    let existingPr;
    beforeEach(() => {
      config = Object.assign({}, defaultConfig);
      config.api = {
        createPr: jest.fn(() => ({ displayNumber: 'New Pull Request' })),
        getBranchStatus: jest.fn(),
      };
      existingPr = {
        title: 'Update dependency dummy to version 1.1.0',
        body:
          'This Pull Request updates dependency dummy from version `1.0.0` to `1.1.0`\n\nNo changelog available',
        displayNumber: 'Existing PR',
      };
    });
    it('should return null if check fails', async () => {
      config.api.getBranchPr = jest.fn(() => {
        throw new Error('oops');
      });
      const pr = await prWorker.ensurePr([config]);
      expect(pr).toBe(null);
    });
    it('should return null if waiting for success', async () => {
      config.api.getBranchStatus = jest.fn(() => 'failed');
      config.prCreation = 'status-success';
      const pr = await prWorker.ensurePr([config]);
      expect(pr).toBe(null);
    });
    it('should create PR if success', async () => {
      config.api.getBranchStatus = jest.fn(() => 'success');
      config.api.getBranchPr = jest.fn();
      config.prCreation = 'status-success';
      const pr = await prWorker.ensurePr([config]);
      expect(pr).toMatchObject({ displayNumber: 'New Pull Request' });
    });
    it('should return null if waiting for not pending', async () => {
      config.api.getBranchStatus = jest.fn(() => 'pending');
      config.prCreation = 'not-pending';
      const pr = await prWorker.ensurePr([config]);
      expect(pr).toBe(null);
    });
    it('should create PR if no longer pending', async () => {
      config.api.getBranchStatus = jest.fn(() => 'failed');
      config.api.getBranchPr = jest.fn();
      config.prCreation = 'not-pending';
      const pr = await prWorker.ensurePr([config]);
      expect(pr).toMatchObject({ displayNumber: 'New Pull Request' });
    });
    it('should create new branch if none exists', async () => {
      config.api.getBranchPr = jest.fn();
      const pr = await prWorker.ensurePr([config]);
      expect(pr).toMatchObject({ displayNumber: 'New Pull Request' });
    });
    it('should add labels to new PR', async () => {
      config.api.getBranchPr = jest.fn();
      config.api.addLabels = jest.fn();
      config.labels = ['foo'];
      const pr = await prWorker.ensurePr([config]);
      expect(pr).toMatchObject({ displayNumber: 'New Pull Request' });
      expect(config.api.addLabels.mock.calls.length).toBe(1);
    });
    it('should add not labels to new PR if empty', async () => {
      config.api.getBranchPr = jest.fn();
      config.api.addLabels = jest.fn();
      config.labels = [];
      const pr = await prWorker.ensurePr([config]);
      expect(pr).toMatchObject({ displayNumber: 'New Pull Request' });
      expect(config.api.addLabels.mock.calls.length).toBe(0);
    });
    it('should add assignees and reviewers to new PR', async () => {
      config.api.getBranchPr = jest.fn();
      config.api.addAssignees = jest.fn();
      config.api.addReviewers = jest.fn();
      config.assignees = ['bar'];
      config.reviewers = ['baz'];
      const pr = await prWorker.ensurePr([config]);
      expect(pr).toMatchObject({ displayNumber: 'New Pull Request' });
      expect(config.api.addAssignees.mock.calls.length).toBe(1);
      expect(config.api.addReviewers.mock.calls.length).toBe(1);
    });
    it('should not add assignees and reviewers to new PR if automerging enabled', async () => {
      config.api.getBranchPr = jest.fn();
      config.api.addAssignees = jest.fn();
      config.api.addReviewers = jest.fn();
      config.assignees = ['bar'];
      config.reviewers = ['baz'];
      config.automergeEnabled = true;
      const pr = await prWorker.ensurePr([config]);
      expect(pr).toMatchObject({ displayNumber: 'New Pull Request' });
      expect(config.api.addAssignees.mock.calls.length).toBe(0);
      expect(config.api.addReviewers.mock.calls.length).toBe(0);
    });
    it('should return unmodified existing PR', async () => {
      config.depName = 'dummy';
      config.currentVersion = '1.0.0';
      config.newVersion = '1.1.0';
      config.api.getBranchPr = jest.fn(() => existingPr);
      config.api.updatePr = jest.fn();
      const pr = await prWorker.ensurePr([config]);
      expect(pr).toMatchObject(existingPr);
    });
    it('should return modified existing PR', async () => {
      config.depName = 'dummy';
      config.currentVersion = '1.0.0';
      config.newVersion = '1.2.0';
      config.api.getBranchPr = jest.fn(() => existingPr);
      config.api.updatePr = jest.fn();
      const pr = await prWorker.ensurePr([config]);
      const updatedPr = Object.assign(existingPr, {
        body:
          'This Pull Request updates dependency dummy from version `1.0.0` to `1.2.0`\n\nNo changelog available',
      });
      expect(pr).toMatchObject(updatedPr);
    });
    it('should create PR if branch automerging failed', async () => {
      config.automergeEnabled = true;
      config.automergeType = 'branch-push';
      config.api.getBranchStatus.mockReturnValueOnce('failed');
      config.api.getBranchPr = jest.fn();
      const pr = await prWorker.ensurePr([config]);
      expect(pr).toMatchObject({ displayNumber: 'New Pull Request' });
    });
    it('should return null if branch automerging not failed', async () => {
      config.automergeEnabled = true;
      config.automergeType = 'branch-push';
      config.api.getBranchStatus.mockReturnValueOnce('pending');
      const pr = await prWorker.ensurePr([config]);
      expect(pr).toBe(null);
    });
  });
});