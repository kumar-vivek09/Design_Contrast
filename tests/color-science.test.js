const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  hexToRGB,
  rgbToHex,
  linearize,
  delinearize,
  luminance,
  wcagContrast,
  apcaLc,
  srgbToOklab,
  oklabToHex
} = require('../app.js');

describe('Layer 0: Color Science (L0)', () => {

  describe('hexToRGB() & rgbToHex()', () => {
    test('TC-COLOR-01: parses 6-digit hex string correctly', () => {
      assert.deepEqual(hexToRGB('#000000'), [0, 0, 0]);
      assert.deepEqual(hexToRGB('#FFFFFF'), [255, 255, 255]);
      assert.deepEqual(hexToRGB('#FF0000'), [255, 0, 0]);
      assert.deepEqual(hexToRGB('#00FF00'), [0, 255, 0]);
      assert.deepEqual(hexToRGB('#0000FF'), [0, 0, 255]);
      assert.deepEqual(hexToRGB('#2B4ACB'), [43, 74, 203]);
    });

    test('TC-COLOR-02: parses 3-digit shorthand hex string correctly', () => {
      assert.deepEqual(hexToRGB('#FFF'), [255, 255, 255]);
      assert.deepEqual(hexToRGB('#000'), [0, 0, 0]);
      assert.deepEqual(hexToRGB('#F00'), [255, 0, 0]);
    });

    test('TC-COLOR-03: parses 4-digit and 8-digit hex strings (ignoring alpha)', () => {
      assert.deepEqual(hexToRGB('#FFFF'), [255, 255, 255]);
      assert.deepEqual(hexToRGB('#FFFFFF80'), [255, 255, 255]);
    });

    test('TC-COLOR-04: handles invalid hex gracefully with fallback to black', () => {
      assert.deepEqual(hexToRGB('invalid'), [0, 0, 0]);
      assert.deepEqual(hexToRGB('#ZZZZZZ'), [0, 0, 0]);
    });

    test('TC-COLOR-05: converts [r, g, b] to uppercase 6-char hex string', () => {
      assert.equal(rgbToHex(0, 0, 0), '#000000');
      assert.equal(rgbToHex(255, 255, 255), '#FFFFFF');
      assert.equal(rgbToHex(43, 74, 203), '#2B4ACB');
    });

    test('TC-COLOR-06: clamps RGB values outside [0, 255] gamut boundaries', () => {
      assert.equal(rgbToHex(-20, 300, 128), '#00FF80');
    });
  });

  describe('linearize() & delinearize()', () => {
    test('TC-COLOR-07: converts sRGB channels to linear light and back', () => {
      const samples = [0, 0.03, 0.18, 0.5, 0.8, 1.0];
      for (const val of samples) {
        const lin = linearize(val);
        const delin = delinearize(lin);
        assert.ok(Math.abs(val - delin) < 1e-4, `Expected ${val} to round-trip close to ${delin}`);
      }
    });

    test('TC-COLOR-08: linearizes zero and full scale exactly', () => {
      assert.equal(linearize(0), 0);
      assert.equal(linearize(1), 1);
    });
  });

  describe('luminance()', () => {
    test('TC-COLOR-09: computes normative relative luminance per WCAG 2.x', () => {
      assert.equal(luminance('#000000'), 0);
      assert.equal(luminance('#FFFFFF'), 1);

      // Standard sRGB primary coefficient checks
      const lumRed = luminance('#FF0000');
      const lumGreen = luminance('#00FF00');
      const lumBlue = luminance('#0000FF');

      assert.ok(Math.abs(lumRed - 0.2126) < 1e-3, `Red luminance ${lumRed} should be close to 0.2126`);
      assert.ok(Math.abs(lumGreen - 0.7152) < 1e-3, `Green luminance ${lumGreen} should be close to 0.7152`);
      assert.ok(Math.abs(lumBlue - 0.0722) < 1e-3, `Blue luminance ${lumBlue} should be close to 0.0722`);
    });
  });

  describe('wcagContrast()', () => {
    test('TC-COLOR-10: maximum possible contrast (black on white is 21:1)', () => {
      const ratio = wcagContrast('#000000', '#FFFFFF');
      assert.equal(ratio, 21);
    });

    test('TC-COLOR-11: minimum possible contrast (identical colors is 1:1)', () => {
      assert.equal(wcagContrast('#FFFFFF', '#FFFFFF'), 1);
      assert.equal(wcagContrast('#2B4ACB', '#2B4ACB'), 1);
      assert.equal(wcagContrast('#000000', '#000000'), 1);
    });

    test('TC-COLOR-12: contrast is symmetric (commutative)', () => {
      const c1 = '#2B4ACB';
      const c2 = '#FFFFFF';
      assert.equal(wcagContrast(c1, c2), wcagContrast(c2, c1));
    });

    test('TC-COLOR-13: calculates known reference color pairs correctly', () => {
      // Danger (#D64545) on White (#FFFFFF) is ~4.38:1 (fails body text 4.5:1)
      const dangerOnWhite = wcagContrast('#D64545', '#FFFFFF');
      assert.ok(Math.abs(dangerOnWhite - 4.38) < 0.05, `Expected ~4.38, got ${dangerOnWhite}`);

      // Brand (#2B4ACB) on White (#FFFFFF) is ~7.12:1 (passes AAA body text)
      const brandOnWhite = wcagContrast('#2B4ACB', '#FFFFFF');
      assert.ok(Math.abs(brandOnWhite - 7.12) < 0.05, `Expected ~7.12, got ${brandOnWhite}`);
    });
  });

  describe('apcaLc()', () => {
    test('TC-COLOR-14: calculates APCA lightness contrast polarity', () => {
      const darkOnLight = apcaLc('#1A1F27', '#FFFFFF');
      const lightOnDark = apcaLc('#FFFFFF', '#1A1F27');

      // Normal polarity is positive, reverse is negative
      assert.ok(darkOnLight > 80, `Expected dark on light Lc > 80, got ${darkOnLight}`);
      assert.ok(lightOnDark < -80, `Expected light on dark Lc < -80, got ${lightOnDark}`);
    });

    test('TC-COLOR-15: identical colors have 0 APCA contrast', () => {
      assert.equal(apcaLc('#FFFFFF', '#FFFFFF'), 0);
      assert.equal(apcaLc('#000000', '#000000'), 0);
    });
  });

  describe('srgbToOklab() & oklabToHex()', () => {
    test('TC-COLOR-16: converts sRGB to OKLab and round-trips with high fidelity', () => {
      const testHexes = ['#000000', '#FFFFFF', '#2B4ACB', '#D64545', '#1B7D3A', '#666E7C'];
      for (const hex of testHexes) {
        const [L, a, b] = srgbToOklab(hex);
        const reconstructed = oklabToHex(L, a, b);
        assert.equal(reconstructed, hex, `Round-trip mismatch for ${hex}`);
      }
    });

    test('TC-COLOR-17: OKLab lightness L correlates with perceived brightness', () => {
      const [lBlack] = srgbToOklab('#000000');
      const [lMid] = srgbToOklab('#888888');
      const [lWhite] = srgbToOklab('#FFFFFF');

      assert.ok(lBlack < 0.01, `Black L should be ~0, got ${lBlack}`);
      assert.ok(lWhite > 0.99, `White L should be ~1, got ${lWhite}`);
      assert.ok(lBlack < lMid && lMid < lWhite, 'Lightness should be strictly monotonic');
    });
  });

});

