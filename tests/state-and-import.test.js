const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidHex,
  normalizeHex,
  EMPTY_STATE,
  SAMPLE,
  reconcile,
  processImport,
  USAGE,
  setState,
  getState
} = require('../app.js');

describe('Layer 2 & 6: State Model & Flexible Importer (L2 & L6)', () => {

  describe('isValidHex() & normalizeHex()', () => {
    test('TC-STATE-01: validates 3-digit and 6-digit hex strings', () => {
      assert.equal(isValidHex('#FFF'), true);
      assert.equal(isValidHex('#ffffff'), true);
      assert.equal(isValidHex('#1A1F27'), true);

      assert.equal(isValidHex('1A1F27'), false, 'Missing hash prefix is invalid');
      assert.equal(isValidHex('#12'), false, '2-digit hex is invalid');
      assert.equal(isValidHex('#GGGGGG'), false, 'Non-hex characters are invalid');
      assert.equal(isValidHex(''), false, 'Empty string is invalid');
    });

    test('TC-STATE-02: normalizes 3-char hex to 6-char uppercase', () => {
      assert.equal(normalizeHex('#fff'), '#FFFFFF');
      assert.equal(normalizeHex('#123'), '#112233');
      assert.equal(normalizeHex('#abc'), '#AABBCC');
      assert.equal(normalizeHex('#2b4acb'), '#2B4ACB');
    });
  });

  describe('EMPTY_STATE() & SAMPLE()', () => {
    test('TC-STATE-03: EMPTY_STATE returns clean zero-token structure', () => {
      const state = EMPTY_STATE();
      assert.equal(state.version, 1);
      assert.deepEqual(state.colors, []);
      assert.deepEqual(state.pairs, []);
      assert.ok(state.type.length > 0, 'Should have default typography scale');
      assert.ok(state.space.length > 0, 'Should have default spacing scale');
    });

    test('TC-STATE-04: SAMPLE returns populated starter tokens', () => {
      const state = SAMPLE();
      assert.ok(state.colors.length >= 8);
      assert.ok(state.pairs.length >= 10);
      assert.ok(state.colors.some(c => c.id === 'brand'));
      assert.ok(state.colors.some(c => c.id === 'surface'));
    });
  });

  describe('reconcile() invariants', () => {
    test('TC-STATE-05: auto-synthesizes missing foreground x surface relationships', () => {
      const state = {
        version: 1,
        colors: [
          { id: 'fg1', name: 'Text', hex: '#111111', role: 'foreground' },
          { id: 'bg1', name: 'Card', hex: '#FFFFFF', role: 'surface' }
        ],
        pairs: [],
        type: [],
        space: [],
        ui: {}
      };

      reconcile(state);
      assert.equal(state.pairs.length, 1);
      assert.equal(state.pairs[0].fg, 'fg1');
      assert.equal(state.pairs[0].bg, 'bg1');
      assert.equal(state.pairs[0].usage, USAGE.NOT_USED, 'Default usage when unspecified is safely not-used');
    });

    test('TC-STATE-06: respects explicit usage defined on foreground token', () => {
      const state = {
        version: 1,
        colors: [
          { id: 'btn', name: 'Button', hex: '#2B4ACB', role: 'foreground', usage: USAGE.LARGE_TEXT },
          { id: 'bg1', name: 'Card', hex: '#FFFFFF', role: 'surface' }
        ],
        pairs: [],
        type: [],
        space: [],
        ui: {}
      };

      reconcile(state);
      assert.equal(state.pairs.length, 1);
      assert.equal(state.pairs[0].usage, USAGE.LARGE_TEXT);
    });

    test('TC-STATE-07: does NOT create pairs for unassigned tokens', () => {
      const state = {
        version: 1,
        colors: [
          { id: 'danger', name: 'Danger', hex: '#D64545', role: 'unassigned' },
          { id: 'surface', name: 'Surface', hex: '#FFFFFF', role: 'surface' }
        ],
        pairs: [],
        type: [],
        space: [],
        ui: {}
      };

      reconcile(state);
      assert.equal(state.pairs.length, 0, 'Unassigned tokens must not create relationships');
    });

    test('TC-STATE-08: removes orphan pairs when tokens are deleted or change roles', () => {
      const state = {
        version: 1,
        colors: [
          { id: 'fg1', name: 'Text', hex: '#111111', role: 'foreground' },
          { id: 'bg1', name: 'Card', hex: '#FFFFFF', role: 'surface' }
        ],
        pairs: [
          { id: 'fg1__bg1', fg: 'fg1', bg: 'bg1', usage: USAGE.BODY_TEXT },
          { id: 'deleted__bg1', fg: 'deleted', bg: 'bg1', usage: USAGE.BODY_TEXT }
        ],
        type: [],
        space: [],
        ui: {}
      };

      reconcile(state);
      assert.equal(state.pairs.length, 1);
      assert.equal(state.pairs[0].fg, 'fg1');
    });
  });

  describe('processImport() (Flexible Importer)', () => {
    test('TC-IMPORT-01: imports minimal JSON with only colors array and .value properties', () => {
      const minimalJson = {
        colors: [
          { id: 'danger', value: '#D64545' },
          { id: 'surface', value: '#FFFFFF' }
        ]
      };

      const { state, stats } = processImport(minimalJson, SAMPLE());
      assert.equal(stats.colors, 2);
      assert.equal(state.colors.length, 2);
      assert.equal(state.colors[0].hex, '#D64545');
      assert.equal(state.colors[0].role, 'unassigned', 'Roles without declaration default to unassigned');
      assert.equal(stats.missingRole, 2);
    });

    test('TC-IMPORT-02: imports JSON with explicit semantic roles and usages', () => {
      const semanticJson = {
        colors: [
          { id: 'text-primary', value: '#1A1F27', role: 'foreground', usage: 'body-text' },
          { id: 'brand', value: '#2B4ACB', role: 'foreground', usage: 'large-text' },
          { id: 'surface', value: '#FFFFFF', role: 'surface' }
        ]
      };

      const { state, stats } = processImport(semanticJson, SAMPLE());
      assert.equal(stats.colors, 3);
      assert.equal(state.pairs.length, 2);

      const textPair = state.pairs.find(p => p.fg === 'text-primary');
      assert.equal(textPair.usage, 'body-text');

      const brandPair = state.pairs.find(p => p.fg === 'brand');
      assert.equal(brandPair.usage, 'large-text');
    });

    test('TC-IMPORT-03: rejects JSON missing colors array with descriptive error', () => {
      assert.throws(() => {
        processImport({ invalidKey: [] });
      }, /Missing colors array/);
    });

    test('TC-IMPORT-04: rejects non-object or malformed input', () => {
      assert.throws(() => {
        processImport(null);
      }, /Invalid JSON format/);

      assert.throws(() => {
        processImport('not a json');
      });
    });

    test('TC-IMPORT-05: ignores explicitly invalid pairs from imported data', () => {
      const jsonWithBadPairs = {
        colors: [
          { id: 'fg1', hex: '#111111', role: 'foreground' },
          { id: 'bg1', hex: '#FFFFFF', role: 'surface' }
        ],
        pairs: [
          { id: 'p1', fg: 'fg1', bg: 'bg1', usage: 'body-text' },
          { id: 'p2', fg: 'non-existent', bg: 'bg1', usage: 'body-text' }
        ]
      };

      const { state, stats } = processImport(jsonWithBadPairs, SAMPLE());
      assert.equal(stats.skippedPairs, 1, 'Should record skipped invalid pair');
      assert.equal(state.pairs.length, 1);
    });
  });

});
