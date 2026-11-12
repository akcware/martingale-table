/**
 * Stage geometry — pure functions, independent of Pixi.
 *  - wheel pocket angles (the rotor painter and the ball use the SAME function)
 *  - the ball's path into its pocket
 *  - splitting amounts into chip denominations
 *  - table layout
 */
import { WHEEL_ORDER } from './types';

export const TAU = Math.PI * 2;
export const N_POCKETS = WHEEL_ORDER.length; // 37
export const STEP = TAU / N_POCKETS;

export function mod(a: number, m: number): number {
  return ((a % m) + m) % m;
}
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const INDEX: number[] = [];
WHEEL_ORDER.forEach((n, i) => (INDEX[n] = i));

/** Number (0–36) → index in wheel order */
export function pocketIndex(n: number): number {
  return INDEX[n] ?? 0;
}

/** Angle of a pocket centre in the rotor's own frame (pocket 0 is at the top at rotation 0). */
export function pocketAngle(idx: number): number {
  return -Math.PI / 2 + idx * STEP;
}

/** Wheel radius ratios (R = outer radius of the bowl) */
export const RAD = {
  rimInner: 0.86,
  trackInner: 0.755,
  ballTrack: 0.805,
  deflector: 0.71,
  rotor: 0.665,
  numOuter: 0.655,
  numInner: 0.548,
  pocketInner: 0.44,
  ballPocket: 0.493,
  ball: 0.036,
} as const;

// ——————————————————— Ball path ———————————————————

export interface BallPath {
  /** Starting relative angle (ball angle − rotor angle) */
  phi0: number;
  /** Target pocket angle (rotor frame) */
  phiT: number;
  /** Total relative travel (positive; the ball runs against the rotor) */
  delta: number;
  /** Radii — as a fraction of R */
  r0: number;
  rTrack: number;
  rPocket: number;
  uLift: number;
  uDrop: number;
  uHit: number;
  /** Amplitude of hopping across pockets while bouncing (rad) */
  jitter: number;
  quick: boolean;
}

export function makeBallPath(phi0: number, pocketIdx: number, turns: number, r0: number, quick: boolean, seed = 0): BallPath {
  const phiT = pocketAngle(pocketIdx);
  let rest = mod(phi0 - phiT, TAU);
  if (rest < Math.PI / 2) rest += TAU; // always travel at least a little
  const delta = rest + Math.max(0, Math.floor(turns)) * TAU;
  const sgn = (seed & 1) === 0 ? 1 : -1;
  return {
    phi0,
    phiT,
    delta,
    r0,
    rTrack: RAD.ballTrack,
    rPocket: RAD.ballPocket,
    uLift: quick ? 0.12 : 0.07,
    uDrop: quick ? 0.45 : 0.68,
    uHit: quick ? 0.72 : 0.86,
    jitter: sgn * STEP * (quick ? 0.45 : 0.9),
    quick,
  };
}

export interface BallState {
  phi: number;
  r: number;
  /** 0..1 — ball hop height (drives shadow and scale) */
  hop: number;
}

const easeOutCubic = (u: number) => 1 - (1 - u) ** 3;
const easeOutQuad = (u: number) => 1 - (1 - u) ** 2;
const smooth = (u: number) => u * u * (3 - 2 * u);

/** Ball state for u ∈ [0,1]. At u = 1: phi ≡ phiT (mod 2π), r = rPocket, hop = 0. */
export function ballAt(p: BallPath, uIn: number, out: BallState): BallState {
  const u = clamp(uIn, 0, 1);
  const e = p.quick ? easeOutQuad(u) : easeOutCubic(u);
  let phi = p.phi0 - p.delta * e;
  let r: number;
  let hop = 0;
  if (u < p.uLift) {
    r = lerp(p.r0, p.rTrack, smooth(u / p.uLift));
  } else if (u < p.uDrop) {
    r = p.rTrack;
  } else if (u < p.uHit) {
    const k = (u - p.uDrop) / (p.uHit - p.uDrop);
    r = lerp(p.rTrack, p.rPocket, k * k);
    // hitting the deflectors: two small hops
    if (k > 0.35) hop = 0.4 * Math.abs(Math.sin((k - 0.35) * Math.PI * 3.1)) * (1 - k);
  } else {
    const v = (u - p.uHit) / (1 - p.uHit);
    const env = Math.exp(-4 * v) * (1 - v);
    hop = Math.abs(Math.sin(v * Math.PI * 3)) * env;
    r = p.rPocket + (p.rTrack - p.rPocket) * 0.24 * hop;
    phi += p.jitter * Math.sin(v * Math.PI * 2.5) * env;
  }
  out.phi = phi;
  out.r = r;
  out.hop = hop;
  return out;
}

// ——————————————————— Chips ———————————————————

/** Denominations (minor units): 1-5-25 × 100ⁿ → 1¢, 5¢, 25¢, $1, $5, $25, $100, $500, $2,500, $10,000 … */
export const DENOMS: number[] = (() => {
  const out: number[] = [];
  for (let k = 0; k < 30; k++) {
    const d = [1, 5, 25][k % 3] * Math.pow(100, Math.floor(k / 3));
    if (d > 1e18) break;
    out.push(d);
  }
  return out;
})();

export const MAX_STACK = 10;

/**
 * Greedily splits an amount into denominations (largest first = bottom of the stack).
 * Writes denomination indices into `out` and returns the chip count (at most `max`).
 */
export function decompose(amount: number, out: Int16Array | number[], max = MAX_STACK): number {
  let rest = Math.max(0, Math.round(amount));
  let n = 0;
  for (let k = DENOMS.length - 1; k >= 0 && n < max && rest > 0; k--) {
    const d = DENOMS[k];
    while (rest >= d && n < max) {
      out[n++] = k;
      rest -= d;
    }
  }
  return n;
}

// ——————————————————— Layout ———————————————————

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Pt {
  x: number;
  y: number;
}

export interface StageLayout {
  W: number;
  H: number;
  pad: number;
  barH: number;
  compact: boolean;
  /** Wheel centre and bowl radius */
  cx: number;
  cy: number;
  R: number;
  table: Rect;
  panel: Rect;
  zero: Rect;
  red: Rect;
  black: Rect;
  /** The player's chip spot (ellipse) */
  spot: { x: number; y: number; rx: number; ry: number };
  spotLabelY: number;
  /** Chip radius */
  chipR: number;
  betAnchor: Pt;
  payAnchor: Pt;
  house: Pt;
  plaqueH: number;
}

/** Chip top-face squash and thickness (as a fraction of chipR) */
export const CHIP_SQUISH = 0.6;
export const CHIP_T = 0.2;

export function computeLayout(Win: number, Hin: number): StageLayout {
  const W = Math.max(200, Win);
  const H = Math.max(200, Hin);
  const pad = clamp(Math.min(W, H) * 0.035, 8, 22);
  const barH = clamp(H * 0.075, 26, 38);
  const top = pad + barH + pad * 0.6;
  const availH = H - top - pad;
  const R = Math.max(40, Math.min(availH / 2, W * 0.3));
  const cx = pad + R;
  const cy = top + availH / 2;

  const gap = clamp(W * 0.03, 10, 34);
  const x0 = cx + R + gap;
  const x1 = W - pad;
  const tw = Math.max(60, x1 - x0);
  const y0 = top;
  const th = H - pad - y0;
  const table: Rect = { x: x0, y: y0, w: tw, h: th };

  const g = clamp(tw * 0.02, 3, 6);
  const zw = clamp(tw * 0.15, 22, 52);
  const rx0 = x0 + zw + g;
  const rw = tw - zw - g;
  const labelH = clamp(th * 0.06, 14, 20);
  const fs = clamp(rw * 0.07, 9.5, 16); // RED label size (same formula as GameStage)

  // Chip size must fit both the width and the height of the RED box (an 8-chip stack
  // must fit between the label and the amount tag). Box height depends on chip size → iterate a few times.
  let chipR = clamp(Math.min(tw / 6, th / 12), 9, 32);
  let panelH = 0;
  let redH = 0;
  for (let it = 0; it < 4; it++) {
    const stackRise = (MAX_STACK - 1) * CHIP_T * chipR + chipR * CHIP_SQUISH; // height of a 10-chip stack
    const sry0 = chipR * 1.45 * CHIP_SQUISH;
    panelH = Math.max(80, th - (stackRise + 8 + 2 * sry0 + 2 + labelH));
    redH = panelH * 0.6 - g / 2;
    const plaque = clamp(redH * 0.13, 16, 22);
    const maxR = (0.93 * redH - plaque - 1.2 * fs - 9) / 2.6;
    if (chipR <= maxR + 0.05) break;
    chipR = Math.max(9, maxR);
  }
  const srx = chipR * 1.45;
  const sry = srx * CHIP_SQUISH;
  const panel: Rect = { x: x0, y: y0, w: tw, h: panelH };
  const zero: Rect = { x: x0, y: y0, w: zw, h: panelH };
  const red: Rect = { x: rx0, y: y0, w: rw, h: redH };
  const black: Rect = { x: rx0, y: y0 + redH + g, w: rw, h: panelH - redH - g };

  const spotY = H - pad - labelH - sry - 2;
  const spot = { x: x0 + tw / 2, y: spotY, rx: srx, ry: sry };

  const plaqueH = clamp(red.h * 0.13, 16, 22);
  const baseY = red.y + red.h - plaqueH - chipR * CHIP_SQUISH - 5;
  const slot = chipR * 1.1;
  const midX = red.x + red.w / 2;

  return {
    W,
    H,
    pad,
    barH,
    compact: W < 560,
    cx,
    cy,
    R,
    table,
    panel,
    zero,
    red,
    black,
    spot,
    spotLabelY: spotY + sry + 3,
    chipR,
    betAnchor: { x: midX - slot, y: baseY },
    payAnchor: { x: midX + slot, y: baseY },
    house: { x: x0 - gap * 0.5, y: y0 + chipR * 0.4 },
    plaqueH,
  };
}
