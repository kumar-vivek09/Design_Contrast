const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  reachTarget,
  satisfyAll,
  wcagContrast,
  USAGE,
  SAMPLE,
  EMPTY_STATE,
  setState,
  getState
} = require('../app.js');

describe('Layer 4: Constraint Solver & Proposal Engine (L4)', () => {

  describe('reachTarget()', () => {
    test('TC-SOLVER-01: darkens foreground to reach target contrast against light background', () => {
      const fg = '#D64545'; // Danger (~4.38:1 on #FFF)
      const bg = '#FFFFFF';
      const target = 4.5;

      const solution = reachTarget(fg, bg, target);
      assert.ok(solution, 'Should return a valid hex solution');
      const contrast = wcagContrast(solution, bg);
      assert.ok(contrast >= target, `Solution ${solution} contrast ${contrast} should be >= ${target}`);
    });

    test('TC-SOLVER-02: lightens foreground to reach target contrast against dark background', () => {
      const fg = '#666E7C';
      const bg = '#111111';
      const target = 4.5;

      const solution = reachTarget(fg, bg, target);
      assert.ok(solution, 'Should return a valid hex solution');
      const contrast = wcagContrast(solution, bg);
      assert.ok(contrast >= target, `Solution ${solution} contrast ${contrast} should be >= ${target}`);
    });

    test('TC-SOLVER-03: returns original or near-original if already meeting target', () => {
      const fg = '#000000';
      const bg = '#FFFFFF';
      const solution = reachTarget(fg, bg, 4.5);
      assert.ok(solution);
      assert.ok(wcagContrast(solution, bg) >= 4.5);
    });
  });

  describe('satisfyAll() Multi-Surface Solver', () => {
    beforeEach(() => {
      setState(SAMPLE());
    });

    test('TC-SOLVER-04: returns "already-passing" for tokens that already satisfy all constraints', () => {
      // Ink is #1A1F27 on #FFFFFF and #F4F5F7, which is > 14:1
      const proposal = satisfyAll('ink');
      assert.equal(proposal.outcome, 'already-passing');
      assert.equal(proposal.to, proposal.from);
    });

    test('TC-SOLVER-05: returns "no-constraints" for tokens without active usage constraints', () => {
      const state = getState();
      state.pairs.forEach(p => {
        if (p.fg === 'brand') p.usage = USAGE.NOT_USED;
      });

      const proposal = satisfyAll('brand');
      assert.equal(proposal.outcome, 'no-constraints');
    });

    test('TC-SOLVER-06: successfully solves solvable multi-surface constraints', () => {
      // Danger (#D64545) fails 4.5:1 on #FFFFFF (~4.38:1) and #F4F5F7 (~3.9:1)
      const proposal = satisfyAll('danger');
      assert.equal(proposal.outcome, 'solved');
      assert.ok(proposal.to, 'Should provide replacement hex');
      assert.notEqual(proposal.to, proposal.from);

      // Verify independently against all active surfaces
      const state = getState();
      const dangerPairs = state.pairs.filter(p => p.fg === 'danger' && p.usage === USAGE.BODY_TEXT);
      for (const pair of dangerPairs) {
        const bgHex = state.colors.find(c => c.id === pair.bg).hex;
        const contrast = wcagContrast(proposal.to, bgHex);
        assert.ok(contrast >= 4.5, `Contrast on ${pair.bg} (${bgHex}) was ${contrast}, expected >= 4.5`);
      }
    });

    test('TC-SOLVER-07: diagnoses "unsatisfiable" when constraints are mathematically incompatible', () => {
      // Force an impossible constraint: body text (4.5:1) simultaneously against dark, mid-gray, and light surfaces
      const state = getState();
      state.colors = [
        { id: 'fg-conflict', name: 'Conflicted Text', hex: '#333333', role: 'foreground', usage: USAGE.BODY_TEXT },
        { id: 'bg-white', name: 'White Surface', hex: '#FFFFFF', role: 'surface' },
        { id: 'bg-mid', name: 'Mid Surface', hex: '#888888', role: 'surface' },
        { id: 'bg-black', name: 'Black Surface', hex: '#000000', role: 'surface' }
      ];
      state.pairs = [
        { id: 'c1', fg: 'fg-conflict', bg: 'bg-white', usage: USAGE.BODY_TEXT },
        { id: 'c2', fg: 'fg-conflict', bg: 'bg-mid', usage: USAGE.BODY_TEXT },
        { id: 'c3', fg: 'fg-conflict', bg: 'bg-black', usage: USAGE.BODY_TEXT }
      ];

      const proposal = satisfyAll('fg-conflict');
      assert.equal(proposal.outcome, 'unsatisfiable');
      assert.equal(proposal.to, null);
      assert.ok(proposal.constraints.length >= 3);
      assert.ok(proposal.blockedBy.length >= 2);
    });

    test('TC-SOLVER-08: never mutates application state S during calculation', () => {
      const stateBefore = JSON.stringify(getState());
      satisfyAll('danger');
      const stateAfter = JSON.stringify(getState());
      assert.equal(stateBefore, stateAfter, 'satisfyAll must be a pure proposal engine and not mutate S');
    });
  });

});
