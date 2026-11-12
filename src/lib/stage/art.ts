/**
 * Canvas2D painters — wheel, ball, chip and glow textures.
 * All draw in logical pixels; the canvas is scaled by dpr.
 * Pixi uses these canvases as textures through CanvasSource.
 */
import { WHEEL_ORDER, colorOf } from './types';
import { RAD, STEP, TAU, pocketAngle, CHIP_SQUISH, CHIP_T } from './geometry';

export interface Painted {
  canvas: HTMLCanvasElement;
  /** Texture resolution (dpr) */
  res: number;
  /** Anchor point (0..1) */
  ax: number;
  ay: number;
}

function make(w: number, h: number, res: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w * res));
  c.height = Math.max(1, Math.ceil(h * res));
  const ctx = c.getContext('2d')!;
  ctx.scale(res, res);
  return [c, ctx];
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ring(ctx: CanvasRenderingContext2D, c: number, r0: number, r1: number) {
  ctx.beginPath();
  ctx.arc(c, c, r1, 0, TAU);
  ctx.arc(c, c, r0, 0, TAU, true);
  ctx.closePath();
}

function goldLinear(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, '#fff1c2');
  g.addColorStop(0.22, '#e3bd62');
  g.addColorStop(0.5, '#9c6f22');
  g.addColorStop(0.75, '#e8c56f');
  g.addColorStop(1, '#7a5418');
  return g;
}

// ———————————————————————— Bowl (static) ————————————————————————

export function paintBowl(R: number, res: number): Painted {
  const m = Math.ceil(R * 0.02) + 2;
  const S = 2 * R + 2 * m;
  const c = S / 2;
  const [cv, ctx] = make(S, S, res);
  const rand = rng(7);

  // Outer wooden rim
  const rimIn = RAD.rimInner * R;
  ring(ctx, c, rimIn, R);
  let g: CanvasGradient = ctx.createRadialGradient(c, c, rimIn, c, c, R);
  g.addColorStop(0, '#2c140a');
  g.addColorStop(0.18, '#5e321a');
  g.addColorStop(0.55, '#7b4423');
  g.addColorStop(0.85, '#532b15');
  g.addColorStop(1, '#2a1309');
  ctx.fillStyle = g;
  ctx.fill();

  // Wood grain (tangential)
  ctx.save();
  ring(ctx, c, rimIn, R);
  ctx.clip();
  for (let i = 0; i < 140; i++) {
    const r = rimIn + rand() * (R - rimIn);
    const a0 = rand() * TAU;
    const len = 0.2 + rand() * 1.6;
    const light = rand() < 0.45;
    ctx.strokeStyle = light ? `rgba(255, 210, 150, ${0.03 + rand() * 0.09})` : `rgba(20, 7, 2, ${0.06 + rand() * 0.14})`;
    ctx.lineWidth = 0.4 + rand() * 1.4;
    ctx.beginPath();
    ctx.arc(c, c, r, a0, a0 + len);
    ctx.stroke();
  }
  // Lighting: bright top-left, dark bottom-right
  g = ctx.createLinearGradient(c - R, c - R, c + R, c + R);
  g.addColorStop(0, 'rgba(255, 232, 190, 0.26)');
  g.addColorStop(0.45, 'rgba(255, 232, 190, 0.02)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0.38)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  ctx.restore();

  // Gold outer trim + inner bevel
  const lw = Math.max(1.6, R * 0.013);
  ctx.lineWidth = lw;
  ctx.strokeStyle = goldLinear(ctx, c - R, c - R, c + R, c + R);
  ctx.beginPath();
  ctx.arc(c, c, R - lw / 2, 0, TAU);
  ctx.stroke();
  ctx.lineWidth = Math.max(1, R * 0.007);
  ctx.beginPath();
  ctx.arc(c, c, rimIn + ctx.lineWidth / 2, 0, TAU);
  ctx.stroke();

  // Ball track (polished dark wood)
  const tIn = RAD.trackInner * R;
  ring(ctx, c, tIn, rimIn);
  g = ctx.createRadialGradient(c, c, tIn, c, c, rimIn);
  g.addColorStop(0, '#0b0604');
  g.addColorStop(0.45, '#22130a');
  g.addColorStop(0.85, '#3d2414');
  g.addColorStop(1, '#170b05');
  ctx.fillStyle = g;
  ctx.fill();
  // track highlight
  ctx.save();
  ring(ctx, c, tIn, rimIn);
  ctx.clip();
  ctx.shadowColor = 'rgba(255, 236, 200, 0.6)';
  ctx.shadowBlur = R * 0.03;
  ctx.strokeStyle = 'rgba(255, 238, 210, 0.22)';
  ctx.lineWidth = R * 0.014;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(c, c, (tIn + rimIn) / 2 + R * 0.01, -2.75, -1.25);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 238, 210, 0.08)';
  ctx.beginPath();
  ctx.arc(c, c, (tIn + rimIn) / 2 + R * 0.01, 0.55, 1.6);
  ctx.stroke();
  ctx.restore();

  // Sloped apron (down to the rotor)
  const rotor = RAD.rotor * R;
  ring(ctx, c, rotor, tIn);
  g = ctx.createRadialGradient(c, c, rotor, c, c, tIn);
  g.addColorStop(0, '#0a0503');
  g.addColorStop(0.6, '#1e110a');
  g.addColorStop(1, '#2f1b0f');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(214, 170, 74, 0.55)';
  ctx.lineWidth = Math.max(0.8, R * 0.004);
  ctx.beginPath();
  ctx.arc(c, c, tIn, 0, TAU);
  ctx.stroke();

  // Diamond deflectors
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU + TAU / 16;
    const rr = RAD.deflector * R;
    const radial = k % 2 === 0;
    const L = R * (radial ? 0.034 : 0.026);
    const Wd = R * (radial ? 0.014 : 0.02);
    ctx.save();
    ctx.translate(c + Math.cos(a) * rr, c + Math.sin(a) * rr);
    ctx.rotate(radial ? a : a + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(-L, 0);
    ctx.lineTo(0, -Wd);
    ctx.lineTo(L, 0);
    ctx.lineTo(0, Wd);
    ctx.closePath();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = R * 0.012;
    ctx.shadowOffsetY = R * 0.004;
    ctx.fillStyle = goldLinear(ctx, -L, -Wd, L, Wd);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = 'rgba(60, 35, 5, 0.8)';
    ctx.stroke();
    ctx.restore();
  }

  // Gap between rotor and apron
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.lineWidth = Math.max(1.2, R * 0.008);
  ctx.beginPath();
  ctx.arc(c, c, rotor + ctx.lineWidth / 2, 0, TAU);
  ctx.stroke();

  return { canvas: cv, res, ax: 0.5, ay: 0.5 };
}

// ———————————————————————— Rotor (rotating) ————————————————————————

const SECTOR: Record<string, [string, string]> = {
  red: ['#c4161f', '#7a0a10'],
  black: ['#1b1b1f', '#08080a'],
  green: ['#12924a', '#06572a'],
};

export function paintRotor(R: number, res: number, family: string): Painted {
  const rot = RAD.rotor * R;
  const S = 2 * rot + 2;
  const c = S / 2;
  const [cv, ctx] = make(S, S, res);
  const nO = RAD.numOuter * R;
  const nI = RAD.numInner * R;
  const pI = RAD.pocketInner * R;

  // outer metal ring (rotor edge)
  ring(ctx, c, nO, rot);
  ctx.fillStyle = goldLinear(ctx, c - rot, c - rot, c + rot, c + rot);
  ctx.fill();

  for (let i = 0; i < WHEEL_ORDER.length; i++) {
    const a = pocketAngle(i);
    const a0 = a - STEP / 2;
    const a1 = a + STEP / 2;
    const [base, deep] = SECTOR[colorOf(WHEEL_ORDER[i])];
    // number band
    ctx.beginPath();
    ctx.arc(c, c, nO, a0, a1);
    ctx.arc(c, c, nI, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = base;
    ctx.fill();
    // pocket floor
    ctx.beginPath();
    ctx.arc(c, c, nI, a0, a1);
    ctx.arc(c, c, pI, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = deep;
    ctx.fill();
  }

  // number band lighting
  ring(ctx, c, nI, nO);
  let g: CanvasGradient = ctx.createRadialGradient(c, c, nI, c, c, nO);
  g.addColorStop(0, 'rgba(0,0,0,0.28)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.05)');
  g.addColorStop(1, 'rgba(255,255,255,0.12)');
  ctx.fillStyle = g;
  ctx.fill();

  // pocket depth
  ring(ctx, c, pI, nI);
  g = ctx.createRadialGradient(c, c, pI, c, c, nI);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.35, 'rgba(0,0,0,0.12)');
  g.addColorStop(0.75, 'rgba(0,0,0,0.05)');
  g.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = g;
  ctx.fill();

  // number separators (thin gold) + pocket frets
  for (let i = 0; i < WHEEL_ORDER.length; i++) {
    const a = pocketAngle(i) + STEP / 2;
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    ctx.strokeStyle = 'rgba(232, 200, 120, 0.75)';
    ctx.lineWidth = Math.max(0.6, R * 0.0035);
    ctx.beginPath();
    ctx.moveTo(c + cs * nI, c + sn * nI);
    ctx.lineTo(c + cs * nO, c + sn * nO);
    ctx.stroke();
    // fret: shadow + bright metal
    const fw = Math.max(1.2, R * 0.009);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = fw * 1.8;
    ctx.beginPath();
    ctx.moveTo(c + cs * (pI + 1), c + sn * (pI + 1));
    ctx.lineTo(c + cs * (nI - 0.5), c + sn * (nI - 0.5));
    ctx.stroke();
    ctx.strokeStyle = '#f1dca0';
    ctx.lineWidth = fw;
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  // rings
  ctx.strokeStyle = goldLinear(ctx, c - rot, c - rot, c + rot, c + rot);
  ctx.lineWidth = Math.max(1, R * 0.008);
  ctx.beginPath();
  ctx.arc(c, c, nI, 0, TAU);
  ctx.stroke();
  ctx.lineWidth = Math.max(1, R * 0.006);
  ctx.beginPath();
  ctx.arc(c, c, nO, 0, TAU);
  ctx.stroke();

  // numbers
  const fs = Math.max(7, R * 0.072);
  ctx.font = `600 ${fs}px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f8f2e4';
  const rm = (nO + nI) / 2 + fs * 0.04;
  for (let i = 0; i < WHEEL_ORDER.length; i++) {
    const a = pocketAngle(i);
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(String(WHEEL_ORDER[i]), 0, -rm);
    ctx.restore();
  }

  // Cone (wood inlay)
  ctx.beginPath();
  ctx.arc(c, c, pI, 0, TAU);
  g = ctx.createRadialGradient(c, c, 0, c, c, pI);
  g.addColorStop(0, '#8a5730');
  g.addColorStop(0.55, '#6a3d1f');
  g.addColorStop(1, '#3a1f0e');
  ctx.fillStyle = g;
  ctx.fill();
  for (let k = 0; k < 8; k++) {
    if (k % 2) continue;
    const a0 = (k / 8) * TAU;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, pI * 0.97, a0, a0 + TAU / 8);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 220, 170, 0.06)';
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(214, 170, 74, 0.8)';
  ctx.lineWidth = Math.max(1, R * 0.006);
  ctx.beginPath();
  ctx.arc(c, c, pI * 0.92, 0, TAU);
  ctx.stroke();
  ctx.lineWidth = Math.max(0.8, R * 0.004);
  ctx.beginPath();
  ctx.arc(c, c, pI * 0.6, 0, TAU);
  ctx.stroke();

  // Turret: four arms + knob (concentric lighting; directional light lives in the static layer)
  const armIn = R * 0.05;
  const armOut = R * 0.27;
  const armW = Math.max(2, R * 0.032);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + TAU / 8;
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(a);
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = R * 0.02;
    const lg = ctx.createLinearGradient(0, -armW / 2, 0, armW / 2);
    lg.addColorStop(0, '#fff0bd');
    lg.addColorStop(0.45, '#d4a842');
    lg.addColorStop(1, '#7c5517');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(armIn, -armW / 2);
    ctx.lineTo(armOut, -armW * 0.32);
    ctx.lineTo(armOut, armW * 0.32);
    ctx.lineTo(armIn, armW / 2);
    ctx.closePath();
    ctx.fill();
    const rg = ctx.createRadialGradient(armOut, 0, 0, armOut, 0, armW * 0.9);
    rg.addColorStop(0, '#fff2c8');
    rg.addColorStop(0.5, '#d9ad48');
    rg.addColorStop(1, '#7c5517');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(armOut, 0, armW * 0.85, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = R * 0.025;
  g = ctx.createRadialGradient(c, c, 0, c, c, R * 0.085);
  g.addColorStop(0, '#fff4cf');
  g.addColorStop(0.35, '#e6c065');
  g.addColorStop(0.8, '#a37424');
  g.addColorStop(1, '#5e3f10');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, R * 0.085, 0, TAU);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  return { canvas: cv, res, ax: 0.5, ay: 0.5 };
}

/** Spin blur: the rotor averaged over a small angle range (turbo / fast spins). */
export function paintRotorBlur(src: Painted, samples = 18, spread = 0.55, scale = 0.5): Painted {
  const res = src.res * scale;
  const w = src.canvas.width / src.res;
  const h = src.canvas.height / src.res;
  const [cv, ctx] = make(w, h, res);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const pw = cv.width;
  const ph = cv.height;
  for (let i = 0; i < samples; i++) {
    const a = (i / (samples - 1) - 0.5) * spread;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(pw / 2, ph / 2);
    ctx.rotate(a);
    ctx.translate(-pw / 2, -ph / 2);
    ctx.globalAlpha = 1 / (i + 1);
    ctx.drawImage(src.canvas, 0, 0, pw, ph);
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // speed lines: faint bright rings
  ctx.globalCompositeOperation = 'source-atop';
  const c = pw / 2;
  for (let k = 0; k < 6; k++) {
    ctx.strokeStyle = `rgba(255, 240, 210, ${0.04 + (k % 2) * 0.03})`;
    ctx.lineWidth = Math.max(1, pw * 0.004);
    ctx.beginPath();
    ctx.arc(c, c, c * (0.3 + k * 0.12), 0, TAU);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  return { canvas: cv, res, ax: 0.5, ay: 0.5 };
}

/** Static light/shadow layer above the rotor (the light direction does not rotate). */
export function paintShade(R: number, res: number): Painted {
  const rot = RAD.rotor * R;
  const S = 2 * rot + 2;
  const c = S / 2;
  const [cv, ctx] = make(S, S, res);
  ctx.beginPath();
  ctx.arc(c, c, rot, 0, TAU);
  ctx.clip();
  // shadow cast by the rim
  let g: CanvasGradient = ctx.createRadialGradient(c, c, rot * 0.78, c, c, rot);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.75, 'rgba(0,0,0,0.12)');
  g.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  // directional light
  g = ctx.createLinearGradient(c - rot, c - rot, c + rot, c + rot);
  g.addColorStop(0, 'rgba(255, 244, 220, 0.13)');
  g.addColorStop(0.5, 'rgba(255, 244, 220, 0)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0.2)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  // cone dome highlight
  const hx = c - R * 0.12;
  const hy = c - R * 0.13;
  g = ctx.createRadialGradient(hx, hy, 0, hx, hy, R * 0.26);
  g.addColorStop(0, 'rgba(255, 246, 225, 0.2)');
  g.addColorStop(1, 'rgba(255, 246, 225, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  // knob highlight
  g = ctx.createRadialGradient(c - R * 0.028, c - R * 0.03, 0, c - R * 0.028, c - R * 0.03, R * 0.045);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return { canvas: cv, res, ax: 0.5, ay: 0.5 };
}

/** The wheel's soft shadow on the felt */
export function paintWheelShadow(R: number, res: number): Painted {
  const S = R * 2.5;
  const c = S / 2;
  const [cv, ctx] = make(S, S, res * 0.5);
  const g = ctx.createRadialGradient(c, c, R * 0.85, c, c, R * 1.24);
  g.addColorStop(0, 'rgba(0,0,0,0.6)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.3)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return { canvas: cv, res: res * 0.5, ax: 0.5, ay: 0.5 };
}

// ———————————————————————— Ball ————————————————————————

export function paintBall(rb: number, res: number): Painted {
  const m = 2;
  const S = 2 * rb + 2 * m;
  const c = S / 2;
  const [cv, ctx] = make(S, S, res);
  const g = ctx.createRadialGradient(c - rb * 0.35, c - rb * 0.4, 0, c, c, rb * 1.05);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.28, '#f3f2ee');
  g.addColorStop(0.65, '#cfcdc6');
  g.addColorStop(1, '#85837c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, rb, 0, TAU);
  ctx.fill();
  ctx.lineWidth = Math.max(0.5, rb * 0.08);
  ctx.strokeStyle = 'rgba(40, 30, 20, 0.35)';
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.ellipse(c - rb * 0.38, c - rb * 0.42, rb * 0.26, rb * 0.18, -0.6, 0, TAU);
  ctx.fill();
  return { canvas: cv, res, ax: 0.5, ay: 0.5 };
}

/** Soft white dot (tinted for glows / sparks) */
export function paintSoftDot(r: number, res: number, core = 0.15): Painted {
  const S = 2 * r;
  const [cv, ctx] = make(S, S, res);
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(core, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return { canvas: cv, res, ax: 0.5, ay: 0.5 };
}

/** Soft black ellipse (chip / ball shadow) */
export function paintShadowBlob(r: number, res: number): Painted {
  const S = 2 * r;
  const [cv, ctx] = make(S, S, res);
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(0,0,0,0.6)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.32)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return { canvas: cv, res, ax: 0.5, ay: 0.5 };
}

/** Four-pointed sparkle star (white) */
export function paintSparkle(r: number, res: number): Painted {
  const S = 2 * r;
  const [cv, ctx] = make(S, S, res);
  const g = ctx.createRadialGradient(r, r, 0, r, r, r * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU - Math.PI / 2;
    const rr = k % 2 === 0 ? r : r * 0.16;
    const x = r + Math.cos(a) * rr;
    const y = r + Math.sin(a) * rr;
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  return { canvas: cv, res, ax: 0.5, ay: 0.5 };
}

/** Rounded-rectangle glow ring (white; coloured via tint) */
export function paintBoxGlow(w: number, h: number, radius: number, res: number): Painted {
  const m = Math.max(14, Math.min(w, h) * 0.16);
  const W = w + 2 * m;
  const H = h + 2 * m;
  const [cv, ctx] = make(W, H, res);
  const path = () => {
    const x = m;
    const y = m;
    const k = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + k, y);
    ctx.arcTo(x + w, y, x + w, y + h, k);
    ctx.arcTo(x + w, y + h, x, y + h, k);
    ctx.arcTo(x, y + h, x, y, k);
    ctx.arcTo(x, y, x + w, y, k);
    ctx.closePath();
  };
  ctx.shadowColor = 'rgba(255,255,255,1)';
  ctx.shadowBlur = m * 0.9;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 2.5;
  path();
  ctx.stroke();
  ctx.shadowBlur = m * 0.4;
  ctx.stroke();
  ctx.shadowColor = 'transparent';
  path();
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fill();
  return { canvas: cv, res, ax: 0.5, ay: 0.5 };
}

// ———————————————————————— Chips ————————————————————————

export interface ChipPalette {
  base: string;
  edge: string;
  stripe: string;
  inlay: string;
}

/** By denomination order (1¢, 5¢, 25¢, $1, $5, $25, $100, $500, $2.5K, $10K, $50K, $250K …) */
export const CHIP_PALETTES: ChipPalette[] = [
  { base: '#7d8a9c', edge: '#4c5664', stripe: '#eef1f5', inlay: '#a3afbf' },
  { base: '#178c8a', edge: '#0c5553', stripe: '#f2efe6', inlay: '#3fb2ae' },
  { base: '#8f5d2c', edge: '#583718', stripe: '#f5e6c8', inlay: '#b07c46' },
  { base: '#ece6d6', edge: '#b3a98f', stripe: '#2c63b4', inlay: '#fbf8ef' },
  { base: '#c3232c', edge: '#7c1117', stripe: '#f6f0e2', inlay: '#de4a4f' },
  { base: '#1f7f46', edge: '#114b28', stripe: '#f6f0e2', inlay: '#35a05f' },
  { base: '#1c1c22', edge: '#050507', stripe: '#d8ac4c', inlay: '#2e2e36' },
  { base: '#6c2ea0', edge: '#401a61', stripe: '#f6f0e2', inlay: '#8a4fc0' },
  { base: '#e3881b', edge: '#93530b', stripe: '#2a1606', inlay: '#f4a646' },
  { base: '#d9ad4c', edge: '#8a6420', stripe: '#4a300a', inlay: '#f2d27e' },
  { base: '#c93f7e', edge: '#7c2049', stripe: '#f6f0e2', inlay: '#e0679b' },
  { base: '#2558aa', edge: '#13336a', stripe: '#f6f0e2', inlay: '#4a7bcb' },
];

export function paletteFor(denomIndex: number): number {
  return denomIndex % CHIP_PALETTES.length;
}

export function paintChip(r: number, pal: ChipPalette, res: number): Painted {
  const ry = r * CHIP_SQUISH;
  const t = r * CHIP_T;
  const m = 2;
  const W = 2 * r + 2 * m;
  const H = 2 * ry + t + 2 * m;
  const cx = m + r;
  const cy = m + ry;
  const [cv, ctx] = make(W, H, res);

  // Side
  ctx.fillStyle = pal.edge;
  ctx.beginPath();
  ctx.ellipse(cx, cy + t, r, ry, 0, 0, Math.PI);
  ctx.lineTo(cx - r, cy);
  ctx.ellipse(cx, cy, r, ry, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fill();
  // edge stripes (on the front-facing half)
  const N = 8;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * TAU + TAU / (2 * N);
    const s = Math.sin(a);
    if (s < 0.08) continue;
    const x = cx + r * Math.cos(a);
    const w = r * 0.3 * s;
    ctx.fillStyle = pal.stripe;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(x - w / 2, cy + ry * s, w, t);
  }
  ctx.globalAlpha = 1;
  // side shading
  let g: CanvasGradient = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.45)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.08)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.05)');
  g.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy + t, r, ry, 0, 0, Math.PI);
  ctx.lineTo(cx - r, cy);
  ctx.ellipse(cx, cy, r, ry, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fill();

  // Top face (draw a circle, then squash)
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / r);
  ctx.fillStyle = pal.base;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  // rim stripes
  ctx.fillStyle = pal.stripe;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * TAU + TAU / (2 * N);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.985, a - 0.17, a + 0.17);
    ctx.arc(0, 0, r * 0.74, a + 0.13, a - 0.13, true);
    ctx.closePath();
    ctx.fill();
  }
  // dashed inner ring
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = Math.max(0.6, r * 0.045);
  ctx.setLineDash([r * 0.1, r * 0.07]);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.68, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  // centre inlay
  ctx.fillStyle = pal.inlay;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.55, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = Math.max(0.5, r * 0.03);
  ctx.stroke();
  // ornament: four-pointed star
  ctx.fillStyle = pal.stripe;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU - Math.PI / 2;
    const rr = k % 2 === 0 ? r * 0.26 : r * 0.08;
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  // sheen
  g = ctx.createRadialGradient(-r * 0.4, -r * 0.5, 0, -r * 0.2, -r * 0.2, r * 1.2);
  g.addColorStop(0, 'rgba(255,255,255,0.35)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  g.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.restore();

  // outline
  ctx.strokeStyle = 'rgba(0,0,0,0.38)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, ry, 0, 0, TAU);
  ctx.stroke();

  return { canvas: cv, res, ax: cx / W, ay: cy / H };
}
