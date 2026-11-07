const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  USAGE,
  STATUS,
  WCAG_CRITERION,
  LOOKALIKE_THRESHOLD,
  requiredRatio,
  classify,
  pairResults,
  auditIssues,
  deriveTypeIssues,
  deriveSpaceIssues,
  verdictDistribution,
  SAMPLE,
  EMPTY_STATE,
  setState,
  getState
} = require('../app.js');

describe('Layer 1 & 3: Audit Rules & Derived Projections (L1 & L3)', () => {

  describe('requiredRatio()', () => {
    test('TC-AUDIT-01: returns correct WCAG AA contrast ratios per usage', () => {
      assert.equal(requiredRatio(USAGE.BODY_TEXT), 4.5, 'Body text requires 4.5:1');
      assert.equal(requiredRatio(USAGE.LARGE_TEXT), 3.0, 'Large text requires 3.0:1');
      assert.equal(requiredRatio(USAGE.UI_ELEMENT), 3.0, 'UI element requires 3.0:1');
      assert.equal(requiredRatio(USAGE.NOT_USED), null, 'Not used has no requirement');
      assert.equal(requiredRatio('unknown'), null, 'Unknown usage has no requirement');
    });
  });

  describe('classify()', () => {
    test('TC-AUDIT-02: returns NOT_APPLICABLE for not-used or null requirements', () => {
      const res1 = classify(1.2, USAGE.NOT_USED);
      assert.equal(res1.status, STATUS.NOT_APPLICABLE);

      const res2 = classify(15.0, USAGE.NOT_USED);
      assert.equal(res2.status, STATUS.NOT_APPLICABLE);
    });

    test('TC-AUDIT-03: returns PASS when ratio meets or exceeds required ratio', () => {
      const res = classify(4.5, USAGE.BODY_TEXT);
      assert.equal(res.status, STATUS.PASS);

      const resHigh = classify(7.2, USAGE.BODY_TEXT);
      assert.equal(resHigh.status, STATUS.PASS);
    });

    test('TC-AUDIT-04: returns WARNING when ratio is within 90% of requirement', () => {
      // 4.5 * 0.9 = 4.05
      const resWarning = classify(4.1, USAGE.BODY_TEXT);
      assert.equal(resWarning.status, STATUS.WARNING);

      const resEdge = classify(4.05, USAGE.BODY_TEXT);
      assert.equal(resEdge.status, STATUS.WARNING);
    });

    test('TC-AUDIT-05: returns FAIL when ratio is below 90% of requirement', () => {
      const resFail = classify(3.9, USAGE.BODY_TEXT);
      assert.equal(resFail.status, STATUS.FAIL);
    });

    test('TC-AUDIT-06: flags isLookalike when contrast ratio is below 1.6:1', () => {
      const resLookalike = classify(1.4, USAGE.BODY_TEXT);
      assert.equal(resLookalike.isLookalike, true);

      const resNormal = classify(2.5, USAGE.BODY_TEXT);
      assert.equal(resNormal.isLookalike, false);
    });
  });

  describe('deriveTypeIssues()', () => {
    beforeEach(() => {
      setState(SAMPLE());
    });

    test('TC-AUDIT-07: flags typography size below 12px minimum', () => {
      const state = getState();
      state.type = [
        { id: 'tiny', name: 'Tiny Text', size: 10, lineHeight: 1.4, weight: 400 }
      ];
      const issues = deriveTypeIssues();
      const sizeIssue = issues.find(i => i.label.includes('size'));
      assert.ok(sizeIssue, 'Should flag size issue');
      assert.equal(sizeIssue.status, STATUS.WARNING);
      assert.ok(sizeIssue.detail.includes('below 12px minimum'));
    });

    test('TC-AUDIT-08: flags body text with line-height below 1.4', () => {
      const state = getState();
      state.type = [
        { id: 'body', name: 'Body', size: 16, lineHeight: 1.2, weight: 400 }
      ];
      const issues = deriveTypeIssues();
      const lhIssue = issues.find(i => i.label.includes('line-height'));
      assert.ok(lhIssue, 'Should flag line-height issue');
      assert.equal(lhIssue.status, STATUS.WARNING);
      assert.ok(lhIssue.detail.includes('below 1.4'));
    });

    test('TC-AUDIT-09: flags duplicate rendered font sizes across different tokens', () => {
      const state = getState();
      state.type = [
        { id: 'body', name: 'Body', size: 16, lineHeight: 1.5, weight: 400 },
        { id: 'content', name: 'Content', size: 16, lineHeight: 1.5, weight: 400 }
      ];
      const issues = deriveTypeIssues();
      const dupIssue = issues.find(i => i.detail.includes('same pixel size'));
      assert.ok(dupIssue, 'Should flag duplicate scale tokens');
    });
  });

  describe('deriveSpaceIssues()', () => {
    beforeEach(() => {
      setState(SAMPLE());
    });

    test('TC-AUDIT-10: flags negative spacing values as FAIL', () => {
      const state = getState();
      state.space = [
        { id: 's-neg', name: 'space.negative', value: -4 }
      ];
      const issues = deriveSpaceIssues();
      const negIssue = issues.find(i => i.detail.includes('Negative'));
      assert.ok(negIssue, 'Should flag negative spacing');
      assert.equal(negIssue.status, STATUS.FAIL);
    });

    test('TC-AUDIT-11: flags spacing steps that differ by 1px or less', () => {
      const state = getState();
      state.space = [
        { id: 's-1', name: 'space.1', value: 12 },
        { id: 's-2', name: 'space.2', value: 13 }
      ];
      const issues = deriveSpaceIssues();
      const closeIssue = issues.find(i => i.detail.includes('effectively identical'));
      assert.ok(closeIssue, 'Should flag 1px difference as indistinguishable spacing');
      assert.equal(closeIssue.status, STATUS.WARNING);
    });
  });

  describe('pairResults() & verdictDistribution()', () => {
    beforeEach(() => {
      setState(SAMPLE());
    });

    test('TC-AUDIT-12: computes pair results and accurate verdict tallies', () => {
      const results = pairResults();
      assert.ok(Array.isArray(results) && results.length > 0, 'Results should be populated');

      const counts = verdictDistribution(results);
      assert.ok(counts.pass >= 0);
      assert.ok(counts.fail >= 0);
      assert.ok(counts.warning >= 0);
      assert.ok(counts.na >= 0);
      assert.equal(counts.pass + counts.fail + counts.warning + counts.na + counts.dismissed, results.length);
    });

    test('TC-AUDIT-13: marks dismissed pairs correctly', () => {
      const state = getState();
      const firstPair = state.pairs[0];
      state.ui.dismissedPairs[firstPair.id] = true;

      const results = pairResults();
      const auditedFirst = results.find(r => r.id === firstPair.id);
      assert.equal(auditedFirst.status, STATUS.DISMISSED);
    });
  });

});

