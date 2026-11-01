/* ═══════════════════════════════════════════════════════════════════════
   DESIGN SYSTEM AUDITOR — app.js
   ═══════════════════════════════════════════════════════════════════════
   Zero dependencies. Seven layers (L0–L6).
   User tokens are NEVER written to CSS custom properties.
   ═══════════════════════════════════════════════════════════════════════ */

'use strict';

/* ═══════════════════════════════════════════════════════════════════════
   L0 — COLOR SCIENCE
   Pure mathematical functions. No DOM, no application state.
   ═══════════════════════════════════════════════════════════════════════ */

/** Parse a 3, 4, 6, or 8 char hex string to [r, g, b] in 0-255. */
function hexToRGB(hex) {
  let h = hex.replace(/^#/, '');
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  if (h.length === 4) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2]; // ignore alpha
  if (h.length === 8) h = h.slice(0, 6); // ignore alpha
  const n = parseInt(h, 16);
  if (isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Convert [r, g, b] (0-255) to "#RRGGBB". */
function rgbToHex(r, g, b) {
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + [clamp(r), clamp(g), clamp(b)]
    .map(c => c.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/** sRGB channel (0-1) → linear. */
function linearize(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear → sRGB channel (0-1). */
function delinearize(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Hex → relative luminance (WCAG 2.x definition). */
function luminance(hex) {
  const [r, g, b] = hexToRGB(hex).map(c => linearize(c / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two hex colors. */
function wcagContrast(hex1, hex2) {
  const L1 = luminance(hex1);
  const L2 = luminance(hex2);
  const lighter = Math.max(L1, L2);
  const darker  = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * APCA Lc (Lightness Contrast) — supplemental metric.
 * Pinned to SAPC 0.0.98G-4g approximation.
 */
function apcaLc(fgHex, bgHex) {
  const [fR, fG, fB] = hexToRGB(fgHex).map(c => linearize(c / 255));
  const [bR, bG, bB] = hexToRGB(bgHex).map(c => linearize(c / 255));

  const fY = 0.2126729 * fR + 0.7151522 * fG + 0.0721750 * fB;
  const bY = 0.2126729 * bR + 0.7151522 * bG + 0.0721750 * bB;

  // Soft clamp near black
  const fYc = fY > 0.022 ? fY : fY + Math.pow(0.022 - fY, 1.414);
  const bYc = bY > 0.022 ? bY : bY + Math.pow(0.022 - bY, 1.414);

  let SAPC;
  if (bYc > fYc) {
    // Normal polarity (dark text on light background)
    SAPC = (Math.pow(bYc, 0.56) - Math.pow(fYc, 0.57)) * 1.14;
  } else {
    // Reverse polarity (light text on dark background)
    SAPC = (Math.pow(bYc, 0.65) - Math.pow(fYc, 0.62)) * 1.14;
  }

  if (Math.abs(SAPC) < 0.1) return 0;
  return Math.round((SAPC > 0 ? (SAPC - 0.027) : (SAPC + 0.027)) * 1000) / 10;
}

/* ─── OKLab Color Space ─────────────────────────────────────────────── */

/** Hex → OKLab [L, a, b]. L in [0, 1]. */
function srgbToOklab(hex) {
  const [sr, sg, sb] = hexToRGB(hex).map(c => linearize(c / 255));

  // Linear sRGB → LMS
  const l = 0.4122214708 * sr + 0.5363325363 * sg + 0.0514459929 * sb;
  const m = 0.2119034982 * sr + 0.6806995451 * sg + 0.1073969566 * sb;
  const s = 0.0883024619 * sr + 0.2817188376 * sg + 0.6299787005 * sb;

  // Cube root
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  // LMS → OKLab
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
  ];
}

/** OKLab [L, a, b] → hex. Clamps to sRGB gamut by chroma reduction. */
function oklabToHex(L, a, b) {
  // Gamut clip: reduce chroma if out of sRGB
  let scale = 1.0;
  for (let i = 0; i < 24; i++) {
    const rgb = oklabToLinearRGB(L, a * scale, b * scale);
    if (rgb[0] >= -1e-4 && rgb[0] <= 1.0001 &&
        rgb[1] >= -1e-4 && rgb[1] <= 1.0001 &&
        rgb[2] >= -1e-4 && rgb[2] <= 1.0001) {
      break;
    }
    scale *= 0.95;
  }

  const rgb = oklabToLinearRGB(L, a * scale, b * scale);
  return rgbToHex(
    delinearize(Math.max(0, Math.min(1, rgb[0]))) * 255,
    delinearize(Math.max(0, Math.min(1, rgb[1]))) * 255,
    delinearize(Math.max(0, Math.min(1, rgb[2]))) * 255
  );
}

/** OKLab → linear sRGB (may be out of gamut). */
function oklabToLinearRGB(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  ];
}


/* ═══════════════════════════════════════════════════════════════════════
   L1 — AUDIT RULES
   WCAG criteria, usage-specific thresholds, heuristics.
   ═══════════════════════════════════════════════════════════════════════ */

const USAGE = Object.freeze({
  BODY_TEXT:   'body-text',
  LARGE_TEXT:  'large-text',
  UI_ELEMENT:  'ui-element',
  NOT_USED:    'not-used'
});

const STATUS = Object.freeze({
  PASS:           'pass',
  FAIL:           'fail',
  WARNING:        'warning',
  NOT_APPLICABLE: 'not-applicable',
  DISMISSED:      'dismissed'
});

/** WCAG criterion strings per usage type. */
const WCAG_CRITERION = Object.freeze({
  [USAGE.BODY_TEXT]:  'WCAG 1.4.3',
  [USAGE.LARGE_TEXT]: 'WCAG 1.4.3',
  [USAGE.UI_ELEMENT]: 'WCAG 1.4.11'
});

/** Product heuristic — not a WCAG threshold. */
const LOOKALIKE_THRESHOLD = 1.6;

/** Required WCAG AA contrast ratio for a given usage. */
function requiredRatio(usage) {
  switch (usage) {
    case USAGE.BODY_TEXT:  return 4.5;
    case USAGE.LARGE_TEXT: return 3.0;
    case USAGE.UI_ELEMENT: return 3.0;
    default: return null;
  }
}

/**
 * Classify a pair result.
 * Returns { status, isLookalike }.
 * Heuristics are explicitly separated from normative WCAG verdicts.
 */
function classify(ratio, usage) {
  const required = requiredRatio(usage);
  const isLookalike = ratio < LOOKALIKE_THRESHOLD;

  if (usage === USAGE.NOT_USED) {
    return { status: STATUS.NOT_APPLICABLE, isLookalike };
  }
  if (required === null) {
    return { status: STATUS.NOT_APPLICABLE, isLookalike };
  }
  if (ratio >= required) {
    return { status: STATUS.PASS, isLookalike };
  }
  // Below required — but distinguish warning zone from hard fail
  if (ratio >= required * 0.9) {
    return { status: STATUS.WARNING, isLookalike };
  }
  return { status: STATUS.FAIL, isLookalike };
}


/* ═══════════════════════════════════════════════════════════════════════
   L2 — STATE MODEL
   Single source of truth. Persistence. Input validation.
   State invariants. Orphan cleanup.
   ═══════════════════════════════════════════════════════════════════════ */

const STATE_VERSION = 1;
const STORAGE_KEY = 'ds-auditor-state';

/** Validate a hex string (editing buffer is NOT validated here). */
function isValidHex(str) {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(str);
}

/** Normalize a hex to 6-char uppercase. */
function normalizeHex(hex) {
  let h = hex.replace(/^#/, '');
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  return '#' + h.toUpperCase();
}

/** Generate an empty state for onboarding. */
function EMPTY_STATE() {
  return {
    version: STATE_VERSION,
    colors: [],
    pairs: [],
    type: [
      { id: 'heading', name: 'Heading', size: 24, lineHeight: 1.25, weight: 700 },
      { id: 'body',    name: 'Body',    size: 16, lineHeight: 1.5,  weight: 400 },
      { id: 'small',   name: 'Small',   size: 14, lineHeight: 1.4,  weight: 400 },
      { id: 'caption', name: 'Caption', size: 11, lineHeight: 1.3,  weight: 400 }
    ],
    space: [
      { id: 'space-1', name: 'space.1', value: 4 },
      { id: 'space-2', name: 'space.2', value: 8 },
      { id: 'space-3', name: 'space.3', value: 12 },
      { id: 'space-4', name: 'space.4', value: 13 },
      { id: 'space-5', name: 'space.5', value: 16 },
      { id: 'space-6', name: 'space.6', value: 24 },
      { id: 'space-7', name: 'space.7', value: 32 },
      { id: 'space-8', name: 'space.8', value: 48 }
    ],
    ui: {
      theme: 'auto',
      expandedIssue: null,
      dismissedPairs: {},
      exportTab: 'json',
      solverFeedback: {}
    }
  };
}

/** Generate a fresh sample design system. */
function SAMPLE() {
  return {
    version: STATE_VERSION,
    colors: [
      { id: 'ink',      name: 'Ink',      hex: '#1A1F27', role: 'foreground' },
      { id: 'brand',    name: 'Brand',    hex: '#2B4ACB', role: 'foreground' },
      { id: 'muted',    name: 'Muted',    hex: '#666E7C', role: 'foreground' },
      { id: 'danger',   name: 'Danger',   hex: '#D64545', role: 'foreground' },
      { id: 'success',  name: 'Success',  hex: '#1B7D3A', role: 'foreground' },
      { id: 'warning',  name: 'Warning',  hex: '#C17A15', role: 'foreground' },
      { id: 'border',   name: 'Border',   hex: '#D8DCE3', role: 'foreground' },
      { id: 'surface',  name: 'Surface',  hex: '#FFFFFF', role: 'surface' },
      { id: 'canvas',   name: 'Canvas',   hex: '#F4F5F7', role: 'surface' },
      { id: 'dark',     name: 'Dark',     hex: '#2C313A', role: 'surface' }
    ],
    pairs: [
      { id: 'ink__surface',      fg: 'ink',      bg: 'surface', usage: USAGE.BODY_TEXT },
      { id: 'ink__canvas',       fg: 'ink',      bg: 'canvas',  usage: USAGE.BODY_TEXT },
      { id: 'ink__dark',         fg: 'ink',      bg: 'dark',    usage: USAGE.NOT_USED },
      { id: 'brand__surface',    fg: 'brand',    bg: 'surface', usage: USAGE.LARGE_TEXT },
      { id: 'brand__canvas',     fg: 'brand',    bg: 'canvas',  usage: USAGE.BODY_TEXT },
      { id: 'muted__surface',    fg: 'muted',    bg: 'surface', usage: USAGE.BODY_TEXT },
      { id: 'muted__canvas',     fg: 'muted',    bg: 'canvas',  usage: USAGE.BODY_TEXT },
      { id: 'danger__surface',   fg: 'danger',   bg: 'surface', usage: USAGE.BODY_TEXT },
      { id: 'danger__canvas',    fg: 'danger',   bg: 'canvas',  usage: USAGE.BODY_TEXT },
      { id: 'danger__dark',      fg: 'danger',   bg: 'dark',    usage: USAGE.NOT_USED },
      { id: 'success__surface',  fg: 'success',  bg: 'surface', usage: USAGE.BODY_TEXT },
      { id: 'success__canvas',   fg: 'success',  bg: 'canvas',  usage: USAGE.BODY_TEXT },
      { id: 'warning__surface',  fg: 'warning',  bg: 'surface', usage: USAGE.BODY_TEXT },
      { id: 'warning__canvas',   fg: 'warning',  bg: 'canvas',  usage: USAGE.BODY_TEXT },
      { id: 'border__surface',   fg: 'border',   bg: 'surface', usage: USAGE.UI_ELEMENT },
      { id: 'border__canvas',    fg: 'border',   bg: 'canvas',  usage: USAGE.UI_ELEMENT },
      { id: 'canvas__surface',   fg: 'canvas',   bg: 'surface', usage: USAGE.NOT_USED }
    ],
    type: [
      { id: 'heading', name: 'Heading', size: 24, lineHeight: 1.25, weight: 700 },
      { id: 'body',    name: 'Body',    size: 16, lineHeight: 1.5,  weight: 400 },
      { id: 'small',   name: 'Small',   size: 14, lineHeight: 1.4,  weight: 400 },
      { id: 'caption', name: 'Caption', size: 11, lineHeight: 1.3,  weight: 400 }
    ],
    space: [
      { id: 'space-1', name: 'space.1', value: 4 },
      { id: 'space-2', name: 'space.2', value: 8 },
      { id: 'space-3', name: 'space.3', value: 12 },
      { id: 'space-4', name: 'space.4', value: 13 },
      { id: 'space-5', name: 'space.5', value: 16 },
      { id: 'space-6', name: 'space.6', value: 24 },
      { id: 'space-7', name: 'space.7', value: 32 },
      { id: 'space-8', name: 'space.8', value: 48 }
    ],
    ui: {
      theme: 'auto',
      expandedIssue: null,
      dismissedPairs: {},
      exportTab: 'json',
      solverFeedback: {}
    }
  };
}

/**
 * Reconcile pair relationships after a state mutation.
 * Invariant: every pair must reference existing color tokens,
 * and a role change must invalidate affected pair eligibility.
 */
function reconcile(state) {
  const colorIds = new Set(state.colors.map(c => c.id));
  const colorMap = Object.fromEntries(state.colors.map(c => [c.id, c]));

  // 1. Remove pairs with invalid tokens or incompatible roles
  state.pairs = state.pairs.filter(p => {
    if (!colorIds.has(p.fg) || !colorIds.has(p.bg)) return false;
    const fgToken = colorMap[p.fg];
    const bgToken = colorMap[p.bg];
    
    // A pair is strictly valid if fg is foreground and bg is surface.
    // If either token is unassigned (or roles are swapped/incompatible), drop it.
    if (fgToken.role !== 'foreground' || bgToken.role !== 'surface') {
      return false;
    }
    return true;
  });

  // 2. Synthesize missing pairs for every valid Foreground-Surface combination
  const existingPairs = new Set(state.pairs.map(p => p.fg + '__' + p.bg));
  const foregrounds = state.colors.filter(c => c.role === 'foreground');
  const surfaces = state.colors.filter(c => c.role === 'surface');

  foregrounds.forEach(fg => {
    surfaces.forEach(bg => {
      const key = fg.id + '__' + bg.id;
      if (!existingPairs.has(key)) {
        // Inherit explicit semantic usage if the token provides it (e.g. from import), else default to not-used
        state.pairs.push({
          id: key,
          fg: fg.id,
          bg: bg.id,
          usage: fg.usage || USAGE.NOT_USED
        });
      }
    });
  });

  // 3. Clean dismissed pairs referencing deleted pairs
  const pairIds = new Set(state.pairs.map(p => p.id));
  for (const key of Object.keys(state.ui.dismissedPairs)) {
    if (!pairIds.has(key)) {
      delete state.ui.dismissedPairs[key];
    }
  }
}

/** Save state to localStorage. */
function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // Storage unavailable — tool still works
  }
}

/** Load state from localStorage with version validation. */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== STATE_VERSION) {
      // Version mismatch — discard, don't attempt migration for v1
      return null;
    }
    // Validate structure minimally
    if (!Array.isArray(parsed.colors) || !Array.isArray(parsed.pairs)) {
      return null;
    }
    // Ensure ui defaults exist
    parsed.ui = parsed.ui || {};
    parsed.ui.dismissedPairs = parsed.ui.dismissedPairs || {};
    parsed.ui.expandedIssue = parsed.ui.expandedIssue || null;
    parsed.ui.exportTab = parsed.ui.exportTab || 'json';
    parsed.ui.theme = parsed.ui.theme || 'auto';
    parsed.ui.solverFeedback = parsed.ui.solverFeedback || {};
    // Run reconciliation (imported/persisted state gets the same treatment)
    reconcile(parsed);
    return parsed;
  } catch (e) {
    return null;
  }
}

/** The state. Single mutable object. */
let S = loadState() || EMPTY_STATE();

/** Helper: find a color by id. */
function colorById(id) {
  return S.colors.find(c => c.id === id);
}

/** Helper: hex value for a color id (returns black if not found). */
function hexFor(id) {
  const c = colorById(id);
  return c ? c.hex : '#000000';
}

/** Get all surface tokens. */
function surfaces() {
  return S.colors.filter(c => c.role === 'surface');
}

/** Get all foreground tokens. */
function foregrounds() {
  return S.colors.filter(c => c.role === 'foreground');
}

/** Generate a unique id for new tokens. */
function newId(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}


/* ═══════════════════════════════════════════════════════════════════════
   L3 — DERIVED MODEL
   Pure read-only projections. Nothing cached. Nothing stored.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Compute pair results for every declared pair.
 * Returns an array of structured audit pair objects.
 */
function pairResults() {
  return S.pairs.map(pair => {
    const fgHex = hexFor(pair.fg);
    const bgHex = hexFor(pair.bg);
    const ratio = wcagContrast(fgHex, bgHex);
    const lc = apcaLc(fgHex, bgHex);
    const required = requiredRatio(pair.usage);
    const { status, isLookalike } = classify(ratio, pair.usage);
    const isDismissed = !!S.ui.dismissedPairs[pair.id];

    return {
      id: pair.id,
      fg: pair.fg,
      bg: pair.bg,
      fgHex,
      bgHex,
      fgName: (colorById(pair.fg) || {}).name || pair.fg,
      bgName: (colorById(pair.bg) || {}).name || pair.bg,
      usage: pair.usage,
      contrast: Math.round(ratio * 100) / 100,
      apca: lc,
      requirement: required ? { wcag: required, level: 'AA', criterion: WCAG_CRITERION[pair.usage] || '' } : null,
      status: isDismissed ? STATUS.DISMISSED : status,
      isLookalike
    };
  });
}

/**
 * Derive audit issues from pair results.
 * Categorized by type: color, typography, spacing.
 */
function auditIssues(results) {
  const colorIssues = results
    .filter(r => r.status === STATUS.FAIL || r.status === STATUS.WARNING || (S.ui && S.ui.solverFeedback && S.ui.solverFeedback[r.id]))
    .map(r => ({
      type: 'color',
      pairId: r.id,
      status: r.status,
      label: r.fgName + ' / ' + r.bgName,
      ratio: r.contrast,
      required: r.requirement ? r.requirement.wcag : null,
      criterion: r.requirement ? r.requirement.criterion : '',
      usage: r.usage,
      fgHex: r.fgHex,
      bgHex: r.bgHex,
      fg: r.fg,
      bg: r.bg,
      isLookalike: r.isLookalike
    }));

  const typeIssues = deriveTypeIssues();
  const spaceIssues = deriveSpaceIssues();

  return { color: colorIssues, type: typeIssues, space: spaceIssues };
}

/** Typography audit. */
function deriveTypeIssues() {
  const issues = [];
  S.type.forEach(t => {
    if (t.size < 12) {
      issues.push({ type: 'type', tokenId: t.id, label: t.name + ' size', detail: t.size + 'px is below 12px minimum', status: STATUS.WARNING });
    }
    if (t.usage !== 'heading' && t.lineHeight < 1.4 && t.size <= 16) {
      issues.push({ type: 'type', tokenId: t.id, label: t.name + ' line-height', detail: t.lineHeight + ' is below 1.4 for body text', status: STATUS.WARNING });
    }
  });

  // Check for duplicate rendered sizes
  const sizeCounts = {};
  S.type.forEach(t => {
    const px = Math.round(t.size);
    sizeCounts[px] = (sizeCounts[px] || []);
    sizeCounts[px].push(t.name);
  });
  Object.entries(sizeCounts).forEach(([px, names]) => {
    if (names.length > 1) {
      issues.push({ type: 'type', tokenId: null, label: names.join(' & ') + ' → ' + px + 'px', detail: 'Multiple tokens resolve to the same pixel size', status: STATUS.WARNING });
    }
  });

  return issues;
}

/** Spacing audit. */
function deriveSpaceIssues() {
  const issues = [];
  const sorted = [...S.space].sort((a, b) => a.value - b.value);

  for (let i = 1; i < sorted.length; i++) {
    const diff = sorted[i].value - sorted[i - 1].value;
    if (diff <= 1 && diff >= 0) {
      issues.push({
        type: 'space',
        tokenId: sorted[i].id,
        label: sorted[i - 1].name + ' / ' + sorted[i].name,
        detail: sorted[i - 1].value + 'px and ' + sorted[i].value + 'px are effectively identical',
        status: STATUS.WARNING
      });
    }
    if (sorted[i].value < 0) {
      issues.push({ type: 'space', tokenId: sorted[i].id, label: sorted[i].name, detail: 'Negative spacing value', status: STATUS.FAIL });
    }
  }

  // Touch target check
  const hasSmallTouchTarget = S.space.some(sp => sp.value >= 8 && sp.value < 44);
  // (This is informational, not flagged as a failure)

  return issues;
}

/** Verdict distribution for the header bar. */
function verdictDistribution(results) {
  const counts = { pass: 0, fail: 0, warning: 0, na: 0, dismissed: 0 };
  results.forEach(r => {
    if (r.status === STATUS.PASS) counts.pass++;
    else if (r.status === STATUS.FAIL) counts.fail++;
    else if (r.status === STATUS.WARNING) counts.warning++;
    else if (r.status === STATUS.DISMISSED) counts.dismissed++;
    else counts.na++;
  });
  return counts;
}


/* ═══════════════════════════════════════════════════════════════════════
   L4 — SOLVER / PROPOSAL ENGINE
   Produces proposals only. Never mutates S.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Single-constraint solver: adjust foreground lightness in OKLab
 * to reach a target contrast ratio against a fixed background.
 * Returns hex or null if impossible.
 */
function reachTarget(fgHex, bgHex, targetRatio) {
  const [L, a, b] = srgbToOklab(fgHex);
  const bgLum = luminance(bgHex);

  // Binary search on OKLab lightness
  let lo = 0, hi = 1, best = null, bestDist = Infinity;

  for (let iter = 0; iter < 64; iter++) {
    const mid = (lo + hi) / 2;
    const candidate = oklabToHex(mid, a, b);
    const ratio = wcagContrast(candidate, bgHex);

    if (ratio >= targetRatio) {
      const dist = Math.abs(mid - L);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }

    // Determine search direction based on whether bg is light or dark
    const candLum = luminance(candidate);
    if (bgLum > 0.5) {
      // Light background: darkening foreground increases contrast
      if (ratio < targetRatio) hi = mid; else lo = mid;
    } else {
      // Dark background: lightening foreground increases contrast
      if (ratio < targetRatio) lo = mid; else hi = mid;
    }
  }

  return best;
}

/**
 * Multi-constraint solver: find a single hex value for tokenId
 * that satisfies ALL declared constraints.
 *
 * Samples 241 lightness values in OKLab, preserves hue,
 * clips gamut, and returns the candidate nearest to the original.
 *
 * Returns a proposal object (never mutates S).
 */
function satisfyAll(tokenId) {
  const token = colorById(tokenId);
  if (!token) return null;

  const [origL, origA, origB] = srgbToOklab(token.hex);

  // Gather all constraints for this token as foreground
  const constraints = S.pairs
    .filter(p => p.fg === tokenId && p.usage !== USAGE.NOT_USED && !S.ui.dismissedPairs[p.id])
    .map(p => ({
      pairId: p.id,
      surfaceTokenId: p.bg,
      surfaceHex: hexFor(p.bg),
      requiredRatio: requiredRatio(p.usage),
      usage: p.usage
    }))
    .filter(c => c.requiredRatio !== null);

  if (constraints.length === 0) {
    return { tokenId, outcome: 'no-constraints', from: token.hex, to: null };
  }

  // Check if already passing
  const allPass = constraints.every(c => wcagContrast(token.hex, c.surfaceHex) >= c.requiredRatio);
  if (allPass) {
    return { tokenId, outcome: 'already-passing', from: token.hex, to: token.hex };
  }

  // Sample 241 lightness values
  const SAMPLES = 241;
  let bestCandidate = null;
  let bestDist = Infinity;
  let nearestAttempt = null;
  let nearestWorstRatio = 0;

  for (let i = 0; i <= SAMPLES; i++) {
    const L = i / SAMPLES;
    const candidate = oklabToHex(L, origA, origB);
    let passesAll = true;
    let worstRatio = Infinity;

    for (const c of constraints) {
      const ratio = wcagContrast(candidate, c.surfaceHex);
      if (ratio < worstRatio) worstRatio = ratio;
      if (ratio < c.requiredRatio) {
        passesAll = false;
      }
    }

    // Track nearest attempt regardless of pass/fail
    if (worstRatio > nearestWorstRatio) {
      nearestWorstRatio = worstRatio;
      nearestAttempt = { value: candidate, worstRatio: Math.round(worstRatio * 100) / 100 };
    }

    if (passesAll) {
      const dist = Math.abs(L - origL);
      if (dist < bestDist) {
        bestDist = dist;
        bestCandidate = candidate;
      }
    }
  }

  if (bestCandidate) {
    // ── Post-fix verification ──
    // Verify using independent calculation (not trusting the search loop)
    const verified = constraints.every(c => wcagContrast(bestCandidate, c.surfaceHex) >= c.requiredRatio);
    if (!verified) {
      return {
        tokenId,
        outcome: 'verification-failed',
        from: token.hex,
        to: null,
        reason: 'candidate-failed-independent-verification',
        nearestAttempt,
        constraints: constraints.map(c => ({
          pairId: c.pairId,
          requiredRatio: c.requiredRatio,
          actualRatio: Math.round(wcagContrast(bestCandidate, c.surfaceHex) * 100) / 100,
          surfaceTokenId: c.surfaceTokenId
        }))
      };
    }

    return {
      tokenId,
      outcome: 'solved',
      from: token.hex,
      to: bestCandidate,
      reason: 'lightness-adjusted-in-oklab',
      satisfies: constraints.map(c => c.pairId),
      breaks: []
    };
  }

  // Unsatisfiable
  const blockedBy = [...new Set(constraints.map(c => c.surfaceTokenId))];
  return {
    tokenId,
    outcome: 'unsatisfiable',
    from: token.hex,
    to: null,
    reason: 'no-single-value-satisfies-all-constraints',
    constraints: constraints.map(c => ({
      pairId: c.pairId,
      requiredRatio: c.requiredRatio,
      actualRatio: Math.round(wcagContrast(token.hex, c.surfaceHex) * 100) / 100,
      surfaceTokenId: c.surfaceTokenId
    })),
    nearestAttempt,
    blockedBy,
    suggestedAction: 'split-token'
  };
}

/**
 * Generate Fix-All proposals.
 *
 * Contract:
 * - Fix-All is independently transactional, not globally transactional.
 * - Surface proposals resolved first, foreground proposals solved against updated surfaces.
 * - Each token modified at most once.
 * - Lookalike/not-used/dismissed pairs excluded from solving.
 * - No proposal is silently partially applied.
 */
function generateFixAllProposals() {
  const results = pairResults();
  const proposals = [];
  const modified = new Set();

  // Identify failing foreground tokens (excluding lookalikes, dismissed, not-used)
  const failingFgIds = new Set();
  results.forEach(r => {
    if (r.status === STATUS.FAIL || r.status === STATUS.WARNING) {
      if (!r.isLookalike && r.usage !== USAGE.NOT_USED && r.status !== STATUS.DISMISSED) {
        failingFgIds.add(r.fg);
      }
    }
  });

  // Phase 1: Surface proposals (currently none — surfaces aren't adjusted)
  // Reserved for future: if surfaces could be auto-fixed, they'd go here.

  // Phase 2: Foreground proposals
  failingFgIds.forEach(tokenId => {
    if (modified.has(tokenId)) return; // at most once
    const proposal = satisfyAll(tokenId);
    if (proposal) {
      proposals.push(proposal);
      if (proposal.outcome === 'solved') {
        modified.add(tokenId);
      }
    }
  });

  return proposals;
}


/* ═══════════════════════════════════════════════════════════════════════
   L5 — RENDERING
   Seven isolated DOM regions.
   Full innerHTML rebuild per region (except the focus fast-path).
   User tokens appear ONLY as inline styles.
   ═══════════════════════════════════════════════════════════════════════ */

/** HTML-escape user-supplied strings. */
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/* ─── Region 1: Header ──────────────────────────────────────────────── */
function renderHeader() {
  const results = pairResults();
  const dist = verdictDistribution(results);
  const total = results.length || 1;

  const passW = (dist.pass / total * 100).toFixed(1);
  const failW = (dist.fail / total * 100).toFixed(1);
  const warnW = (dist.warning / total * 100).toFixed(1);
  const naW   = ((dist.na + dist.dismissed) / total * 100).toFixed(1);

  document.getElementById('header').innerHTML = `
    <h1 class="header-title"><span>◉</span> Design System Auditor</h1>
    <div class="verdict-bar-wrap">
      <div class="verdict-bar">
        <div class="verdict-segment pass" style="width:${passW}%"></div>
        <div class="verdict-segment fail" style="width:${failW}%"></div>
        <div class="verdict-segment warning" style="width:${warnW}%"></div>
        <div class="verdict-segment na" style="width:${naW}%"></div>
      </div>
      <div class="verdict-counts">
        <span class="verdict-count"><span class="verdict-dot" style="background:var(--ui-pass)"></span>${dist.pass} pass</span>
        <span class="verdict-count"><span class="verdict-dot" style="background:var(--ui-fail)"></span>${dist.fail} fail</span>
        <span class="verdict-count"><span class="verdict-dot" style="background:var(--ui-warning)"></span>${dist.warning} warn</span>
        <span class="verdict-count"><span class="verdict-dot" style="background:var(--ui-na)"></span>${dist.na + dist.dismissed} n/a</span>
      </div>
    </div>
    <div class="header-actions">
      <button class="btn" data-action="import" aria-label="Import design system">Import</button>
      <button class="btn" data-action="export" aria-label="Export design system">Export</button>
      <button class="btn" data-action="reset" aria-label="Clear all data">Clear All</button>
      <button class="btn-icon" data-action="theme" aria-label="Toggle dark mode" title="Toggle theme">${S.ui.theme === 'dark' ? '☀️' : S.ui.theme === 'light' ? '🌙' : '◐'}</button>
    </div>
  `;
}

/* ─── Region 2: Color Editors ───────────────────────────────────────── */
function renderColorEditors() {
  const html = S.colors.map(c => `
    <div class="token-card" data-token-id="${esc(c.id)}">
      <div class="token-card-row">
        <div class="token-swatch" style="background:${esc(c.hex)}">
          <input type="color" value="${esc(c.hex)}" data-action="swatch" data-token="${esc(c.id)}" aria-label="Color picker for ${esc(c.name)}">
        </div>
        <input class="token-name-input" value="${esc(c.name)}" data-action="rename" data-token="${esc(c.id)}" aria-label="Token name" spellcheck="false">
        <button class="token-delete" data-action="delete-color" data-token="${esc(c.id)}" aria-label="Delete ${esc(c.name)}" title="Delete">×</button>
      </div>
      <div class="token-card-row">
        <input class="token-hex-input" value="${esc(c.hex)}" data-action="hex" data-token="${esc(c.id)}" aria-label="Hex value" spellcheck="false">
        <select class="token-role-select" data-action="role" data-token="${esc(c.id)}" aria-label="Token role">
          <option value="unassigned" ${c.role !== 'foreground' && c.role !== 'surface' ? 'selected' : ''}>Unassigned</option>
          <option value="foreground" ${c.role === 'foreground' ? 'selected' : ''}>Foreground</option>
          <option value="surface" ${c.role === 'surface' ? 'selected' : ''}>Surface</option>
        </select>
      </div>
    </div>
  `).join('');

  document.getElementById('color-editors').innerHTML = `
    <div class="editor-section">
      <div class="editor-section-header">
        <span class="editor-section-title">Colors</span>
        <button class="btn" data-action="add-color" aria-label="Add color token">+ Add</button>
      </div>
      ${html}
    </div>
  `;
}

/* ─── Region 3: Typography Editors ──────────────────────────────────── */
function renderTypeEditors() {
  const html = S.type.map(t => `
    <div class="type-token-row" data-type-id="${esc(t.id)}">
      <span class="type-token-name">${esc(t.name)}</span>
      <input class="type-input" type="number" value="${t.size}" data-action="type-size" data-type="${esc(t.id)}" aria-label="${esc(t.name)} size" min="1" step="1">
      <span class="type-label">px</span>
      <input class="type-input" type="number" value="${t.lineHeight}" data-action="type-lh" data-type="${esc(t.id)}" aria-label="${esc(t.name)} line height" min="0.5" step="0.05" style="width:56px">
      <span class="type-label">lh</span>
      <input class="type-input" type="number" value="${t.weight}" data-action="type-weight" data-type="${esc(t.id)}" aria-label="${esc(t.name)} weight" min="100" max="900" step="100" style="width:56px">
      <span class="type-label">w</span>
    </div>
  `).join('');

  document.getElementById('type-editors').innerHTML = `
    <div class="editor-section">
      <div class="editor-section-header">
        <span class="editor-section-title">Typography</span>
      </div>
      ${html}
    </div>
  `;
}

/* ─── Region 4: Spacing Editors ─────────────────────────────────────── */
function renderSpaceEditors() {
  const maxVal = Math.max(...S.space.map(sp => sp.value), 1);
  const spaceIssues = deriveSpaceIssues();
  const warningIds = new Set(spaceIssues.map(i => i.tokenId));

  const html = S.space.map(sp => {
    const barW = Math.max(4, (sp.value / maxVal) * 100);
    return `
      <div class="space-token-row" data-space-id="${esc(sp.id)}">
        <span class="space-name">${esc(sp.name)}</span>
        <div class="space-bar" style="width:${barW}%"></div>
        <input class="space-input" type="number" value="${sp.value}" data-action="space-val" data-space="${esc(sp.id)}" aria-label="${esc(sp.name)} value" min="0" step="1">
        <span class="space-unit">px</span>
        ${warningIds.has(sp.id) ? '<span class="space-warning">⚠</span>' : ''}
      </div>
    `;
  }).join('');

  document.getElementById('space-editors').innerHTML = `
    <div class="editor-section">
      <div class="editor-section-header">
        <span class="editor-section-title">Spacing</span>
      </div>
      ${html}
    </div>
  `;
}

/* ─── Region 5: Contrast Matrix (Hero) ──────────────────────────────── */
function renderMatrix() {
  if (S.colors.length === 0) {
    document.getElementById('matrix').innerHTML = `
      <div style="padding:48px;max-width:540px;margin:0 auto;text-align:center">
        <h2 style="font-size:20px;letter-spacing:0.1em;margin-bottom:16px">DESIGN SYSTEM AUDITOR</h2>
        <p style="color:var(--ui-ink-secondary);margin-bottom:32px;line-height:1.6">
          Build your tokens. Audit them continuously for accessibility.
        </p>
        <div style="text-align:left;background:var(--ui-panel);border:1px solid var(--ui-line);border-radius:8px;padding:24px;margin-bottom:32px">
          <ol style="margin:0;padding-left:20px;color:var(--ui-ink);line-height:2">
            <li>Add a color token</li>
            <li>Define how it is used</li>
            <li>Watch the audit update live</li>
            <li>Inspect or automatically fix accessibility issues</li>
          </ol>
        </div>
        <button class="btn btn-primary" data-action="try-demo" style="padding:12px 32px;font-size:16px">TRY A DEMO</button>
        <div style="text-align:left;margin-top:48px;padding-top:32px;border-top:1px solid var(--ui-line);color:var(--ui-ink-tertiary);font-size:13px;line-height:1.6">
          <strong style="color:var(--ui-ink-secondary)">What is this matrix?</strong><br>
          The matrix compares foreground tokens against surface tokens and shows their contrast ratio. 
          Green indicates a passing relationship; red/amber indicates an issue or warning; 
          — means the relationship is not currently applicable.<br><br>
          Edit a token on the left and the audit updates automatically.
        </div>
      </div>
    `;
    return;
  }

  const surfaceTokens = surfaces();
  const fgTokens = foregrounds();
  const results = pairResults();

  // Build lookup: results by fg__bg
  const lookup = {};
  results.forEach(r => { lookup[r.fg + '__' + r.bg] = r; });

  // Header row
  const headerCells = surfaceTokens.map(s => `
    <th>
      <span class="th-swatch" style="background:${esc(s.hex)}"></span>${esc(s.name)}
      <span class="th-hex">${esc(s.hex)}</span>
    </th>
  `).join('');

  // Body rows
  const bodyRows = fgTokens.map(fg => {
    const cells = surfaceTokens.map(surf => {
      const r = lookup[fg.id + '__' + surf.id];
      if (!r) {
        return '<td><div class="matrix-cell" style="background:var(--ui-panel);color:var(--ui-ink-tertiary);cursor:default;min-height:48px"><span style="font-size:10px">—</span></div></td>';
      }

      const statusClass = r.status;
      const lookalikeClass = r.isLookalike ? ' cell-lookalike' : '';

      return `<td><button class="matrix-cell ${lookalikeClass}"
        style="background:${esc(r.bgHex)};color:${esc(r.fgHex)}"
        data-action="cell-click" data-pair="${esc(r.id)}"
        aria-label="${esc(r.fgName)} on ${esc(r.bgName)}: ${r.contrast}:1, ${r.status}"
        title="${esc(r.fgName)} on ${esc(r.bgName)}">
        <span class="cell-badge ${statusClass}"></span>
        <span class="cell-ratio">${r.contrast.toFixed(1)}</span>
        <span class="cell-apca">Lc ${r.apca}</span>
        <span class="cell-usage">${esc(r.usage)}</span>
      </button></td>`;
    }).join('');

    return `<tr>
      <th class="row-header">
        <span class="th-swatch" style="background:${esc(fg.hex)}"></span>${esc(fg.name)}
        <span class="th-hex">${esc(fg.hex)}</span>
      </th>
      ${cells}
    </tr>`;
  }).join('');

  document.getElementById('matrix').innerHTML = `
    <div class="matrix-title">Contrast Matrix</div>
    <div class="matrix-wrap">
      <table class="matrix-table" role="grid" aria-label="Foreground × Surface contrast matrix">
        <thead><tr><th></th>${headerCells}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  `;
}

/* ─── Region 6: Live Preview ────────────────────────────────────────── */
function renderPreview() {
  if (S.colors.length === 0) {
    document.getElementById('preview').innerHTML = `
      <div class="preview-title">LIVE PREVIEW<br><span style="font-size:12px;font-weight:normal;color:var(--ui-ink-tertiary)">Using current design-system tokens</span></div>
      <div class="preview-frame" style="background:var(--ui-panel);border:1px dashed var(--ui-line);display:flex;align-items:center;justify-content:center;padding:48px">
        <span style="color:var(--ui-ink-tertiary);font-size:12px">Add tokens to see a preview</span>
      </div>
    `;
    return;
  }

  const hasUsage = (tokenId, targetUsage) => S.pairs.some(p => p.fg === tokenId && p.usage === targetUsage && !S.ui.dismissedPairs[p.id]);

  function resolveColor(semanticFn, ids, fallback) {
    let t = S.colors.find(semanticFn);
    if (t) return t.hex;
    for (const id of ids) {
      t = S.colors.find(c => c.id.toLowerCase() === id.toLowerCase() || c.name.toLowerCase() === id.toLowerCase());
      if (t) return t.hex;
    }
    return fallback;
  }

  // 1. Explicit semantic token mapping -> 2. Known ID/name fallback -> 3. Generic fallback
  const textPrimary = resolveColor(
    c => c.role === 'foreground' && (hasUsage(c.id, 'body-text') || hasUsage(c.id, 'large-text') || c.usage === 'body-text'),
    ['text-primary', 'ink', 'text', 'primaryText', 'primary-text'],
    '#111111'
  );

  const brand = resolveColor(
    c => false,
    ['brand', 'primary', 'action', 'blue', 'accent'],
    '#2B4ACB'
  );

  const danger = resolveColor(
    c => false,
    ['danger', 'error', 'critical', 'red'],
    '#D64545'
  );

  const success = resolveColor(
    c => false,
    ['success', 'positive', 'green'],
    '#158F5B'
  );

  const warning = resolveColor(
    c => false,
    ['warning', 'alert', 'yellow', 'amber'],
    '#DD761C'
  );

  const border = resolveColor(
    c => c.role === 'foreground' && (hasUsage(c.id, 'ui-element') || c.usage === 'ui-element'),
    ['border', 'line', 'divider', 'muted'],
    '#D1D5DB'
  );

  const surface = resolveColor(
    c => c.role === 'surface' && c.id !== 'canvas',
    ['surface', 'card', 'background', 'white', 'bg'],
    '#FFFFFF'
  );

  let canvas = resolveColor(
    c => c.role === 'surface' && c.id.includes('canvas'),
    ['canvas', 'pageBackground', 'page-bg', 'gray-50'],
    '#F4F5F7'
  );
  if (canvas === surface) canvas = '#F4F5F7';

  const darkSurface = resolveColor(
    c => c.role === 'surface' && (c.id.includes('dark') || c.id.includes('invert')),
    ['dark-surface', 'dark', 'inverse', 'black'],
    null
  );

  const bodyType = S.type.find(t => t.id === 'body') || { size: 16, lineHeight: 1.5 };
  const headingType = S.type.find(t => t.id === 'heading') || { size: 24, lineHeight: 1.25, weight: 700 };

  document.getElementById('preview').innerHTML = `
    <div class="preview-title">LIVE PREVIEW<br><span style="font-size:12px;font-weight:normal;color:var(--ui-ink-tertiary);letter-spacing:0;text-transform:none">Using current design-system tokens</span></div>
    <div class="preview-frame" style="background:${esc(canvas)}; padding:24px; display:flex; flex-direction:column; gap:24px; border-radius:8px; border:1px solid var(--ui-line);">

      <!-- Nav / Header -->
      <div style="display:flex; justify-content:space-between; align-items:center; padding-bottom:16px; border-bottom:1px solid ${esc(border)}">
        <strong style="color:${esc(brand)}; font-size:${headingType.size}px; font-weight:${headingType.weight}">Acme Corp</strong>
        <div style="display:flex; gap:16px;">
          <span style="color:${esc(textPrimary)}; font-size:${bodyType.size}px; opacity:0.8">Dashboard</span>
          <span style="color:${esc(textPrimary)}; font-size:${bodyType.size}px; opacity:0.8">Settings</span>
        </div>
      </div>

      <!-- Main Content Area -->
      <div style="display:flex; gap:24px; flex-wrap:wrap">
        
        <!-- Left Column: Content & Buttons -->
        <div style="flex:1; min-width:240px; display:flex; flex-direction:column; gap:16px;">
          <div style="color:${esc(textPrimary)}; font-size:${headingType.size}px; font-weight:${headingType.weight}; line-height:${headingType.lineHeight}; margin-top:8px">
            Component Specimen
          </div>
          <div style="color:${esc(textPrimary)}; font-size:${bodyType.size}px; line-height:${bodyType.lineHeight}; opacity:0.8">
            This preview uses your live design system tokens. Changing a token value instantly updates these components and recalculates the contrast matrix.
          </div>
          <div style="display:flex; gap:12px; margin-top:8px;">
            <button style="background:${esc(brand)}; color:${esc(surface)}; border:none; border-radius:4px; padding:8px 16px; font-size:${bodyType.size}px; font-weight:600; cursor:pointer">Primary Action</button>
            <button style="background:transparent; color:${esc(brand)}; border:1px solid ${esc(border)}; border-radius:4px; padding:8px 16px; font-size:${bodyType.size}px; font-weight:600; cursor:pointer">Secondary</button>
          </div>
        </div>

        <!-- Right Column: Alerts & Cards -->
        <div style="flex:1; min-width:240px; display:flex; flex-direction:column; gap:12px;">
          <div style="background:${esc(surface)}; border:1px solid ${esc(border)}; border-radius:6px; padding:16px; box-shadow:0 4px 12px rgba(0,0,0,0.05)">
            <!-- Success Alert -->
            <div style="background:${esc(success)}15; border-left:3px solid ${esc(success)}; color:${esc(success)}; padding:10px 12px; margin-bottom:8px; font-size:${bodyType.size}px; border-radius:0 4px 4px 0">
              ✓ Success message
            </div>
            <!-- Warning Alert -->
            <div style="background:${esc(warning)}15; border-left:3px solid ${esc(warning)}; color:${esc(warning)}; padding:10px 12px; margin-bottom:8px; font-size:${bodyType.size}px; border-radius:0 4px 4px 0">
              ⚠ Warning message
            </div>
            <!-- Error Alert -->
            <div style="background:${esc(danger)}15; border-left:3px solid ${esc(danger)}; color:${esc(danger)}; padding:10px 12px; font-size:${bodyType.size}px; border-radius:0 4px 4px 0">
              ✕ Error / Danger message
            </div>
          </div>
          
          ${darkSurface ? `
          <div style="background:${esc(darkSurface)}; color:${esc(surface)}; border:1px solid ${esc(border)}; border-radius:6px; padding:16px; font-size:${bodyType.size}px; margin-top:4px">
            <strong style="display:block; margin-bottom:4px; font-size:${headingType.size * 0.8}px">Dark Surface Specimen</strong>
            Tokens inverted for dark context.
          </div>
          ` : ''}
        </div>
        
      </div>
    </div>
  `;
}

/* ─── Region 7: Issue Queue ─────────────────────────────────────────── */
function renderQueue() {
  if (S.colors.length === 0) {
    document.getElementById('queue').innerHTML = `
      <div class="queue-header">
        <span class="queue-title">Issues</span>
        <span class="queue-badge" style="color:var(--ui-pass);background:var(--ui-pass-bg)">0</span>
      </div>
      <div class="empty-state">No issues to display</div>
    `;
    return;
  }

  const results = pairResults();
  const issues = auditIssues(results);
  const totalIssues = issues.color.length + issues.type.length + issues.space.length;

  // Color issues section
  const colorHtml = issues.color.length ? issues.color.map(iss => {
    const icon = iss.status === STATUS.FAIL ? '✕' : (iss.status === STATUS.PASS ? '✓' : '⚠');
    const expanded = S.ui.expandedIssue === iss.pairId;

    const feedback = S.ui.solverFeedback ? S.ui.solverFeedback[iss.pairId] : null;
    let feedbackHtml = '';
    
    if (feedback) {
      if (feedback.outcome === 'unsatisfiable') {
        feedbackHtml = `
          <div style="background:var(--ui-fail-bg);color:var(--ui-fail);padding:12px;border:1px solid var(--ui-fail);border-radius:4px;margin-bottom:12px;font-size:12px">
            <strong style="display:block;margin-bottom:8px">✕ UNSATISFIABLE</strong>
            No single value satisfies all active constraints.<br><br>
            Suggested action:<br><strong>SPLIT TOKEN</strong>
          </div>
        `;
      } else if (feedback.outcome === 'solved') {
        feedbackHtml = `
          <div style="background:var(--ui-pass-bg);color:var(--ui-pass);padding:12px;border:1px solid var(--ui-pass);border-radius:4px;margin-bottom:12px;font-size:12px">
            <strong style="display:block;margin-bottom:8px">✓ FIXED</strong>
            ${esc(feedback.from)} → ${esc(feedback.to)}<br><br>
            Ratio: ${feedback.oldRatio}:1 → ${feedback.newRatio}:1<br>
            ${esc(feedback.criterion)} satisfied
          </div>
        `;
      }
    }

    // Provenance detail
    const provenance = `
      <div class="issue-provenance">
        <div class="provenance-row"><span class="prov-label">Foreground</span><span class="prov-value">${esc(iss.fg)} ${esc(iss.fgHex)}</span></div>
        <div class="provenance-row"><span class="prov-label">Background</span><span class="prov-value">${esc(iss.bg)} ${esc(iss.bgHex)}</span></div>
        <div class="provenance-row"><span class="prov-label">Usage</span><span class="prov-value">${esc(iss.usage)}</span></div>
        <div class="provenance-row"><span class="prov-label">Required</span><span class="prov-value">${iss.required ? iss.required + ':1' : '—'}</span></div>
        <div class="provenance-row"><span class="prov-label">Actual</span><span class="prov-value">${iss.ratio}:1</span></div>
        <div class="provenance-row"><span class="prov-label">Criterion</span><span class="prov-value">${esc(iss.criterion)}</span></div>
        <div class="provenance-row"><span class="prov-label">APCA Lc</span><span class="prov-value">${apcaLc(iss.fgHex, iss.bgHex)} (supplemental)</span></div>
        ${feedbackHtml}
        <div class="provenance-actions">
          <button class="btn-fix" data-action="fix" data-token="${esc(iss.fg)}" data-pair="${esc(iss.pairId)}">Fix</button>
          <button class="btn-fix" data-action="dismiss" data-pair="${esc(iss.pairId)}" style="color:var(--ui-ink-tertiary)">Dismiss</button>
        </div>
      </div>
    `;

    return `
      <div class="issue-item ${iss.status}${expanded ? ' expanded' : ''}" data-action="toggle-issue" data-pair="${esc(iss.pairId)}">
        <div class="issue-summary">
          <span class="issue-icon">${icon}</span>
          <span class="issue-label">${esc(iss.label)}</span>
          <span class="issue-ratio">${iss.ratio}:1</span>
        </div>
        ${provenance}
      </div>
    `;
  }).join('') : '<div class="empty-state">No color issues ✓</div>';

  // Type issues section
  const typeHtml = issues.type.length ? issues.type.map(iss => `
    <div class="issue-item warning">
      <div class="issue-summary">
        <span class="issue-icon">⚠</span>
        <span class="issue-label">${esc(iss.label)}</span>
      </div>
      ${S.ui.expandedIssue === iss.tokenId ? `<div class="issue-provenance" style="display:block"><div class="provenance-row"><span class="prov-label">Detail</span><span class="prov-value">${esc(iss.detail)}</span></div></div>` : ''}
    </div>
  `).join('') : '';

  // Space issues section
  const spaceHtml = issues.space.length ? issues.space.map(iss => `
    <div class="issue-item warning">
      <div class="issue-summary">
        <span class="issue-icon">⚠</span>
        <span class="issue-label">${esc(iss.label)}</span>
      </div>
      ${S.ui.expandedIssue === iss.tokenId ? `<div class="issue-provenance" style="display:block"><div class="provenance-row"><span class="prov-label">Detail</span><span class="prov-value">${esc(iss.detail)}</span></div></div>` : ''}
    </div>
  `).join('') : '';

  // Fix-All: check if there are actionable failures
  const hasActionable = issues.color.some(i => i.status === STATUS.FAIL && !i.isLookalike);

  document.getElementById('queue').innerHTML = `
    <div class="queue-header">
      <span class="queue-title">Issues</span>
      ${totalIssues > 0 ? `<span class="queue-badge">${totalIssues}</span>` : '<span class="queue-badge" style="color:var(--ui-pass);background:var(--ui-pass-bg)">0</span>'}
    </div>

    <div class="queue-section">
      <div class="queue-section-header">
        <span class="queue-section-title">Color</span>
        <span class="queue-section-count">${issues.color.length}</span>
      </div>
      ${colorHtml}
    </div>

    ${issues.type.length ? `
    <div class="queue-section">
      <div class="queue-section-header">
        <span class="queue-section-title">Typography</span>
        <span class="queue-section-count">${issues.type.length}</span>
      </div>
      ${typeHtml}
    </div>
    ` : ''}

    ${issues.space.length ? `
    <div class="queue-section">
      <div class="queue-section-header">
        <span class="queue-section-title">Spacing</span>
        <span class="queue-section-count">${issues.space.length}</span>
      </div>
      ${spaceHtml}
    </div>
    ` : ''}

    <div class="queue-actions">
      ${hasActionable ? `<button class="btn btn-primary" data-action="fix-all" style="width:100%">Fix All</button>` : ''}
      <button class="btn" data-action="dismiss-lookalikes" style="width:100%">Dismiss Lookalikes</button>
    </div>
  `;
}

/* ─── Master render ─────────────────────────────────────────────────── */
function render() {
  renderHeader();
  renderColorEditors();
  renderTypeEditors();
  renderSpaceEditors();
  renderMatrix();
  renderPreview();
  renderQueue();
  saveState(S);
}

/**
 * Fast-path render: update everything EXCEPT color editors.
 * Used when the user is typing in a hex/name input to preserve focus.
 */
function renderExceptEditors() {
  renderHeader();
  renderMatrix();
  renderPreview();
  renderQueue();
  saveState(S);
}


/* ═══════════════════════════════════════════════════════════════════════
   L6 — EVENTS / COMMIT
   Delegated listeners. Controlled mutation boundary.
   ═══════════════════════════════════════════════════════════════════════ */

/** Apply theme to document root. */
function applyTheme() {
  if (S.ui.theme === 'auto') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', S.ui.theme);
  }
}

/* ─── Click delegation ──────────────────────────────────────────────── */
document.addEventListener('click', function(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  switch (action) {
    case 'theme': {
      const cycle = { auto: 'dark', dark: 'light', light: 'auto' };
      S.ui.theme = cycle[S.ui.theme] || 'auto';
      applyTheme();
      render();
      break;
    }

    case 'reset': {
      if (confirm('Clear all data and return to the onboarding screen?')) {
        S = EMPTY_STATE();
        applyTheme();
        render();
      }
      break;
    }

    case 'add-color': {
      document.getElementById('add-token-dialog').showModal();
      break;
    }

    case 'close-add-dialog': {
      document.getElementById('add-token-dialog').close();
      break;
    }

    case 'submit-add-token': {
      const nameVal = document.getElementById('add-token-name').value.trim() || 'New Token';
      let hexVal = document.getElementById('add-token-hex').value.trim();
      if (!isValidHex(hexVal)) hexVal = '#888888';
      hexVal = normalizeHex(hexVal);
      const roleVal = document.getElementById('add-token-role').value;
      const usageVal = document.getElementById('add-token-usage').value;
      
      const id = newId('color');
      S.colors.push({ id, name: nameVal, hex: hexVal, role: roleVal });
      
      // Auto-pair with existing tokens
      if (roleVal === 'foreground') {
        surfaces().forEach(surf => {
          S.pairs.push({ id: `${id}__${surf.id}`, fg: id, bg: surf.id, usage: usageVal });
        });
      } else {
        foregrounds().forEach(fg => {
          S.pairs.push({ id: `${fg.id}__${id}`, fg: fg.id, bg: id, usage: usageVal });
        });
      }
      
      document.getElementById('add-token-dialog').close();
      document.getElementById('add-token-name').value = '';
      
      render();
      break;
    }

    case 'try-demo': {
      if (S.colors.length === 0 || confirm('Replace your current tokens with the demo state?')) {
        S = SAMPLE();
        applyTheme();
        render();
      }
      break;
    }

    case 'delete-color': {
      const tokenId = btn.dataset.token;
      S.colors = S.colors.filter(c => c.id !== tokenId);
      reconcile(S);
      render();
      break;
    }

    case 'toggle-issue': {
      const pairId = btn.closest('[data-pair]')?.dataset.pair;
      if (pairId) {
        if (S.ui.expandedIssue === pairId) {
          S.ui.expandedIssue = null;
          if (S.ui.solverFeedback) delete S.ui.solverFeedback[pairId];
        } else {
          S.ui.expandedIssue = pairId;
          S.ui.solverFeedback = {};
        }
        renderQueue();
      }
      break;
    }

    case 'cell-click': {
      const pairId = btn.dataset.pair;
      if (pairId) {
        S.ui.expandedIssue = pairId;
        renderQueue();
        // Scroll to the issue in the queue
        const issueEl = document.querySelector(`.issue-item[data-pair="${pairId}"]`);
        if (issueEl) issueEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      break;
    }

    case 'fix': {
      const tokenId = btn.dataset.token;
      const pairId = btn.dataset.pair;
      
      const oldRatioResult = pairResults().find(r => r.id === pairId);
      const oldRatio = oldRatioResult ? oldRatioResult.contrast : null;

      const proposal = satisfyAll(tokenId);
      if (!proposal) break;

      S.ui.solverFeedback = {};

      if (proposal.outcome === 'solved') {
        // Commit the fix
        const token = colorById(tokenId);
        if (token) {
          const fromHex = token.hex;
          token.hex = proposal.to;
          
          const newRatioResult = pairResults().find(r => r.id === pairId);
          const newRatio = newRatioResult ? newRatioResult.contrast : null;

          S.ui.solverFeedback[pairId] = {
            outcome: 'solved',
            from: fromHex,
            to: proposal.to,
            oldRatio,
            newRatio,
            criterion: newRatioResult?.requirement?.criterion || 'WCAG Requirement'
          };
          render();
        }
      } else if (proposal.outcome === 'unsatisfiable') {
        // Show unsatisfiable detail in UI
        S.ui.solverFeedback[pairId] = { outcome: 'unsatisfiable' };
        renderQueue();
      }
      break;
    }

    case 'dismiss': {
      e.stopPropagation();
      const pairId = btn.dataset.pair;
      if (pairId) {
        S.ui.dismissedPairs[pairId] = true;
        S.ui.expandedIssue = null;
        render();
      }
      break;
    }

    case 'dismiss-lookalikes': {
      const results = pairResults();
      results.forEach(r => {
        if (r.isLookalike && r.usage !== USAGE.NOT_USED) {
          S.ui.dismissedPairs[r.id] = true;
        }
      });
      render();
      break;
    }

    case 'fix-all': {
      const proposals = generateFixAllProposals();
      const fixed = [];
      const skipped = [];

      proposals.forEach(p => {
        if (p.outcome === 'solved') {
          const token = colorById(p.tokenId);
          if (token) {
            token.hex = p.to;
            fixed.push(p);
          }
        } else {
          skipped.push(p);
        }
      });

      render();

      // Report results
      if (fixed.length || skipped.length) {
        let msg = `Fix-All complete.\n\n`;
        if (fixed.length) {
          msg += `Fixed ${fixed.length} token(s):\n`;
          fixed.forEach(p => { msg += `  ${p.tokenId}: ${p.from} → ${p.to}\n`; });
        }
        if (skipped.length) {
          msg += `\nSkipped ${skipped.length} token(s):\n`;
          skipped.forEach(p => { msg += `  ${p.tokenId}: ${p.reason}\n`; });
        }
        alert(msg);
      }
      break;
    }

    case 'export': {
      renderExportDialog();
      document.getElementById('export-dialog').showModal();
      break;
    }

    case 'import': {
      document.getElementById('import-input').click();
      break;
    }

    case 'close-dialog': {
      document.getElementById('export-dialog').close();
      break;
    }

    case 'export-tab': {
      S.ui.exportTab = btn.dataset.tab;
      renderExportDialog();
      break;
    }

    case 'copy-export': {
      const pre = document.querySelector('.dialog-body pre');
      if (pre) {
        navigator.clipboard.writeText(pre.textContent).then(() => {
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
        });
      }
      break;
    }
  }
});

/* ─── Input delegation (fast path for editors) ──────────────────────── */
document.addEventListener('input', function(e) {
  const el = e.target;
  const action = el.dataset.action;
  if (!action) return;

  switch (action) {
    case 'hex': {
      const tokenId = el.dataset.token;
      const token = colorById(tokenId);
      if (!token) break;

      // UI editing state: allow intermediate values
      const raw = el.value;
      if (isValidHex(raw)) {
        token.hex = normalizeHex(raw);
        // Fast path: update swatch inline, render everything except editors
        const swatch = el.closest('.token-card')?.querySelector('.token-swatch');
        if (swatch) swatch.style.background = token.hex;
        renderExceptEditors();
      } else {
        // Mark invalid but don't block typing
        el.classList.toggle('invalid', raw.length > 1);
      }
      break;
    }

    case 'sync-add-hex': {
      const hexInput = document.getElementById('add-token-hex');
      hexInput.value = el.value.toUpperCase();
      break;
    }

    case 'sync-add-swatch': {
      const raw = el.value;
      if (isValidHex(raw)) {
        document.getElementById('add-token-swatch').value = normalizeHex(raw);
      }
      break;
    }

    case 'change-add-role': {
      const usageSelect = document.getElementById('add-token-usage');
      if (el.value === 'surface') {
        usageSelect.innerHTML = `
          <option value="body-text">Surface (Body Text Default)</option>
          <option value="large-text">Canvas (Large Text Default)</option>
          <option value="not-used">Not Used</option>
        `;
        // We preserve valid usage values for the pairs being generated
      } else {
        usageSelect.innerHTML = `
          <option value="body-text">Body Text</option>
          <option value="large-text">Large Text</option>
          <option value="ui-element">UI Element</option>
          <option value="not-used">Not Used</option>
        `;
      }
      break;
    }

    case 'swatch': {
      const tokenId = el.dataset.token;
      const token = colorById(tokenId);
      if (!token) break;
      token.hex = el.value.toUpperCase();
      // Fast path
      const hexInput = el.closest('.token-card')?.querySelector('.token-hex-input');
      if (hexInput) hexInput.value = token.hex;
      renderExceptEditors();
      break;
    }

    case 'rename': {
      const tokenId = el.dataset.token;
      const token = colorById(tokenId);
      if (!token) break;
      token.name = el.value;
      renderExceptEditors();
      break;
    }

    case 'role': {
      const tokenId = el.dataset.token;
      const token = colorById(tokenId);
      if (!token) break;
      token.role = el.value;
      reconcile(S);
      render();
      break;
    }

    case 'type-size': {
      const typeId = el.dataset.type;
      const t = S.type.find(t => t.id === typeId);
      if (t) {
        t.size = parseFloat(el.value) || 0;
        renderExceptEditors();
      }
      break;
    }

    case 'type-lh': {
      const typeId = el.dataset.type;
      const t = S.type.find(t => t.id === typeId);
      if (t) {
        t.lineHeight = parseFloat(el.value) || 0;
        renderExceptEditors();
      }
      break;
    }

    case 'type-weight': {
      const typeId = el.dataset.type;
      const t = S.type.find(t => t.id === typeId);
      if (t) {
        t.weight = parseInt(el.value) || 400;
        renderExceptEditors();
      }
      break;
    }

    case 'space-val': {
      const spaceId = el.dataset.space;
      const sp = S.space.find(s => s.id === spaceId);
      if (sp) {
        sp.value = parseFloat(el.value) || 0;
        renderExceptEditors();
        renderSpaceEditors();
      }
      break;
    }
  }
});

/* ─── Import file handler ───────────────────────────────────────────── */
document.getElementById('import-input').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(ev) {
    try {
      const parsed = JSON.parse(ev.target.result);
      
      console.log('--- IMPORT TRACE ---');
      console.log('1. Raw file content:', ev.target.result);
      console.log('2. Parsed object:', parsed);
      console.log('3. Type of parsed:', typeof parsed);
      console.log('4. parsed.colors:', parsed?.colors);
      console.log('5. Array.isArray(parsed.colors):', Array.isArray(parsed?.colors));

      // Schema validation (Flexible)
      if (!parsed || typeof parsed !== 'object') {
        console.error('Validation failed: Invalid JSON format');
        throw new Error('Invalid JSON format');
      }
      
      if (!Array.isArray(parsed.colors)) {
        console.error('Validation failed: Missing colors array. parsed.colors is:', parsed.colors);
        const gotType = typeof parsed.colors;
        const gotVal = JSON.stringify(parsed.colors) || 'undefined';
        throw new Error(`Missing colors array. Expected array, got ${gotType}: ${gotVal}. (Check if your JSON has "colors": [...] at the root)`);
      }

      let stats = { colors: 0, type: 0, space: 0, missingRole: 0, skippedPairs: 0 };

      // Ensure arrays fallback to current state if absent
      parsed.pairs = Array.isArray(parsed.pairs) ? parsed.pairs : [];
      parsed.type = Array.isArray(parsed.type) ? parsed.type : S.type;
      parsed.space = Array.isArray(parsed.space) ? parsed.space : S.space;

      // Validate colors and normalize roles
      parsed.colors = parsed.colors.filter(c => c.id && c.value && isValidHex(c.value) || c.id && c.hex && isValidHex(c.hex));
      parsed.colors.forEach(c => { 
        c.hex = normalizeHex(c.hex || c.value);
        c.name = c.name || c.id;
        if (c.role !== 'foreground' && c.role !== 'surface') {
          c.role = 'unassigned';
          stats.missingRole++;
        }
        stats.colors++;
      });
      
      stats.type = parsed.type.length;
      stats.space = parsed.space.length;

      // Validate explicitly provided pairs (if any)
      const colorMap = Object.fromEntries(parsed.colors.map(c => [c.id, c]));
      const validPairs = [];
      parsed.pairs.forEach(p => {
        const fg = colorMap[p.fg];
        const bg = colorMap[p.bg];
        if (!fg || !bg || fg.role !== 'foreground' || bg.role !== 'surface') {
          stats.skippedPairs++;
        } else {
          validPairs.push(p);
        }
      });
      parsed.pairs = validPairs;

      // Ensure version & UI
      parsed.version = STATE_VERSION;
      parsed.ui = {
        dismissedPairs: {},
        expandedIssue: null,
        theme: S.ui.theme,
        exportTab: 'json',
        solverFeedback: {}
      };

      // Run reconciliation (auto-generates missing eligible relationships)
      reconcile(parsed);

      S = parsed;
      applyTheme();
      render();

      // Show summary
      let msg = 'IMPORT COMPLETE\n\n';
      msg += `✓ ${stats.colors} color tokens imported\n`;
      msg += `✓ ${stats.type} typography tokens imported\n`;
      msg += `✓ ${stats.space} spacing tokens imported\n\n`;
      if (stats.missingRole > 0) {
        msg += `⚠ ${stats.missingRole} token(s) have no assigned role (marked Unassigned)\n`;
      }
      if (stats.skippedPairs > 0) {
        msg += `⚠ ${stats.skippedPairs} imported relationship(s) were ignored because their token references or roles were invalid\n`;
      }
      alert(msg);

    } catch (err) {
      alert('Import failed: ' + err.message);
    }
  };
  reader.readAsText(file);

  // Reset input so re-importing the same file triggers change
  e.target.value = '';
});

/* ─── Export dialog rendering ───────────────────────────────────────── */
function renderExportDialog() {
  const tab = S.ui.exportTab || 'json';
  let content = '';

  if (tab === 'json') {
    const exportData = {
      version: S.version,
      colors: S.colors,
      pairs: S.pairs,
      type: S.type,
      space: S.space
    };
    content = JSON.stringify(exportData, null, 2);
  } else if (tab === 'css') {
    let css = ':root {\n';
    S.colors.forEach(c => {
      css += `  --${c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}: ${c.hex};\n`;
    });
    css += '\n';
    S.type.forEach(t => {
      const prefix = `--type-${t.id}`;
      css += `  ${prefix}-size: ${t.size}px;\n`;
      css += `  ${prefix}-line-height: ${t.lineHeight};\n`;
      css += `  ${prefix}-weight: ${t.weight};\n`;
    });
    css += '\n';
    S.space.forEach(sp => {
      css += `  --${sp.name.replace(/\./g, '-')}: ${sp.value}px;\n`;
    });
    css += '}';
    content = css;
  } else if (tab === 'tokens') {
    const tokens = {};
    S.colors.forEach(c => {
      tokens[c.name] = { $value: c.hex, $type: 'color', role: c.role };
    });
    S.type.forEach(t => {
      tokens[t.name] = { $value: { fontSize: t.size + 'px', lineHeight: t.lineHeight, fontWeight: t.weight }, $type: 'typography' };
    });
    S.space.forEach(sp => {
      tokens[sp.name] = { $value: sp.value + 'px', $type: 'dimension' };
    });
    content = JSON.stringify(tokens, null, 2);
  } else if (tab === 'report') {
    const results = pairResults();
    const dist = verdictDistribution(results);
    const issues = auditIssues(results);
    const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    let report = '';
    report += 'DESIGN SYSTEM ACCESSIBILITY AUDIT\n';
    report += '══════════════════════════════════\n\n';
    report += 'Date: ' + date + '\n\n';
    report += 'SUMMARY\n';
    report += '────────────────\n';
    report += results.length + ' token pairs audited\n\n';
    report += 'PASS       ' + dist.pass + '\n';
    report += 'FAIL       ' + dist.fail + '\n';
    report += 'WARNING    ' + dist.warning + '\n';
    report += 'N/A        ' + dist.na + '\n';
    report += 'DISMISSED  ' + dist.dismissed + '\n\n';

    if (issues.color.length) {
      report += 'COLOR ISSUES\n';
      report += '────────────────\n';
      issues.color.forEach(iss => {
        const icon = iss.status === STATUS.FAIL ? '✕' : '⚠';
        report += `${icon} ${iss.label}  ${iss.ratio}:1 (required ${iss.required}:1, ${iss.criterion})\n`;
        report += `  Foreground: ${iss.fg} ${iss.fgHex}\n`;
        report += `  Background: ${iss.bg} ${iss.bgHex}\n`;
        report += `  Usage: ${iss.usage}\n\n`;
      });
    }

    if (issues.type.length) {
      report += 'TYPOGRAPHY ISSUES\n';
      report += '────────────────\n';
      issues.type.forEach(iss => {
        report += `⚠ ${iss.label}: ${iss.detail}\n`;
      });
      report += '\n';
    }

    if (issues.space.length) {
      report += 'SPACING ISSUES\n';
      report += '────────────────\n';
      issues.space.forEach(iss => {
        report += `⚠ ${iss.label}: ${iss.detail}\n`;
      });
      report += '\n';
    }

    if (!issues.color.length && !issues.type.length && !issues.space.length) {
      report += 'No issues found. All checks passed.\n';
    }

    content = report;
  }

  document.getElementById('export-content').innerHTML = `
    <div class="dialog-header">
      <span class="dialog-title">Export</span>
      <button class="btn-icon" data-action="close-dialog" aria-label="Close">✕</button>
    </div>
    <div class="dialog-tabs">
      <button class="dialog-tab ${tab === 'json' ? 'active' : ''}" data-action="export-tab" data-tab="json">JSON</button>
      <button class="dialog-tab ${tab === 'css' ? 'active' : ''}" data-action="export-tab" data-tab="css">CSS</button>
      <button class="dialog-tab ${tab === 'tokens' ? 'active' : ''}" data-action="export-tab" data-tab="tokens">Tokens</button>
      <button class="dialog-tab ${tab === 'report' ? 'active' : ''}" data-action="export-tab" data-tab="report">Audit Report</button>
    </div>
    <div class="dialog-body">
      <pre>${esc(content)}</pre>
    </div>
    <div class="dialog-footer">
      <button class="btn" data-action="copy-export">Copy</button>
      <button class="btn btn-primary" data-action="close-dialog">Done</button>
    </div>
  `;
}

/* ─── Close dialog on backdrop click ────────────────────────────────── */
document.getElementById('export-dialog').addEventListener('click', function(e) {
  if (e.target === this) this.close();
});

document.getElementById('add-token-dialog').addEventListener('click', function(e) {
  if (e.target === this) this.close();
});

/* ─── Initial render ────────────────────────────────────────────────── */
applyTheme();
render();
