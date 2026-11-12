/**
 * PixiJS scene: wheel, ball, chip stacks, glows and sparks.
 * Logic (promises, timers, DOM text) lives in GameStage.svelte; this class only
 * drives the visuals. It uses a single Application; textures are painted with Canvas2D.
 */
import { Application, CanvasSource, Container, Sprite, Texture } from 'pixi.js';
import * as art from './art';
import {
  CHIP_T,
  MAX_STACK,
  RAD,
  TAU,
  ballAt,
  clamp,
  decompose,
  lerp,
  makeBallPath,
  mod,
  pocketAngle,
  pocketIndex,
  type BallPath,
  type BallState,
  type StageLayout,
} from './geometry';

const FONT_NUM = "'Barlow Condensed', 'Roboto Condensed', 'Arial Narrow', sans-serif";

const IDLE_SPEED = 0.22; // rad/s
const SPIN_SPEED = 2.5;
const QUICK_SPEED = 6.5;
const TURBO_SPEED = 15;
/** World angle where the dealer launches the ball (top right) */
const LAUNCH_ANGLE = -Math.PI * 0.28;

const GOLD = 0xf6c95a;
const RED = 0xff3b30;
const WHITE = 0xfff1d6;
const GREEN = 0x58ffa0;

const E_OUT = 1;
const E_IN = 2;
const E_BACK = 3;
function ease(kind: number, p: number): number {
  switch (kind) {
    case E_OUT:
      return 1 - (1 - p) ** 3;
    case E_IN:
      return p * p * p;
    case E_BACK: {
      const c1 = 1.4;
      const c3 = c1 + 1;
      return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2;
    }
    default:
      return p;
  }
}

function toTexture(p: art.Painted): Texture {
  return new Texture({ source: new CanvasSource({ resource: p.canvas, resolution: p.res }) });
}

/** Attack → hold → exponential decay → resting level */
class Env {
  private t0 = -1e12;
  private a = 0;
  private peak = 0;
  private hold = 0;
  private decay = 1;
  private rest = 0;
  set(t0: number, attack: number, peak: number, hold: number, decay: number, rest: number) {
    this.t0 = t0;
    this.a = attack;
    this.peak = peak;
    this.hold = hold;
    this.decay = Math.max(0.001, decay);
    this.rest = rest;
  }
  value(now: number): number {
    let t = (now - this.t0) / 1000;
    if (t < 0) return 0;
    if (t < this.a) return (this.peak * t) / this.a;
    t -= this.a;
    if (t < this.hold) return this.peak;
    t -= this.hold;
    return this.rest + (this.peak - this.rest) * Math.exp(-t / this.decay);
  }
  fade(now: number, decay: number) {
    this.set(now, 0, this.value(now), 0, decay, 0);
  }
  off() {
    this.set(-1e12, 0, 0, 0, 1, 0);
  }
}

type Home = 'bet' | 'pay' | 'spot' | null;

const JITTER = [0, 0.6, -0.45, 0.3, -0.7, 0.5, -0.2, 0.42, -0.55, 0.22];

/** Chip stack — a fixed pool of sprites, updated without allocating. */
class ChipStack {
  readonly view = new Container();
  private readonly shadow = new Sprite();
  readonly glow = new Sprite();
  private readonly chips: Sprite[] = [];
  private readonly idx = new Int16Array(MAX_STACK);
  count = 0;
  amount = -1;
  x = 0;
  y = 0;
  alpha = 0;
  scale = 1;
  home: Home = null;
  glowLevel = 0;
  // motion
  private mv = false;
  private t0 = 0;
  private dur = 1;
  private x0 = 0;
  private y0 = 0;
  private x1 = 0;
  private y1 = 0;
  private a0 = 0;
  private a1 = 0;
  private s0 = 1;
  private s1 = 1;
  private ek = E_OUT;
  private endHome: Home = null;
  private hideEnd = false;

  constructor() {
    this.shadow.anchor.set(0.5);
    this.glow.anchor.set(0.5);
    this.glow.blendMode = 'add';
    this.glow.tint = GOLD;
    this.view.addChild(this.shadow, this.glow);
    for (let i = 0; i < MAX_STACK; i++) {
      const s = new Sprite();
      s.visible = false;
      this.chips.push(s);
      this.view.addChild(s);
    }
    this.view.visible = false;
  }

  /** Re-apply the current amount after the textures change (repaint) */
  refresh(chipTex: Texture[], ax: number, ay: number, r: number, shadowTex: Texture, glowTex: Texture) {
    const a = this.amount;
    this.amount = -1;
    this.shadow.texture = shadowTex;
    this.glow.texture = glowTex;
    this.setAmount(Math.max(0, a), chipTex, ax, ay, r);
  }

  setAmount(amount: number, chipTex: Texture[], ax: number, ay: number, r: number) {
    if (amount === this.amount) return;
    this.amount = amount;
    const n = decompose(amount, this.idx);
    this.count = n;
    const t = CHIP_T * r;
    for (let i = 0; i < MAX_STACK; i++) {
      const s = this.chips[i];
      if (i < n) {
        s.texture = chipTex[art.paletteFor(this.idx[i])];
        s.anchor.set(ax, ay);
        s.position.set(JITTER[i] * r * 0.06, -i * t);
        s.visible = true;
      } else s.visible = false;
    }
    this.shadow.position.set(r * 0.12, t * 0.9);
    const sh = this.shadow.texture.width || 1;
    this.shadow.scale.set((r * 2.5) / sh, (r * 1.5) / sh);
    const gh = this.glow.texture.width || 1;
    this.glow.position.set(0, -((Math.max(1, n) - 1) * t) / 2);
    this.glow.scale.set((r * 3.6) / gh, (r * 2.8 + n * t) / gh);
  }

  place(x: number, y: number, home: Home) {
    this.mv = false;
    this.x = x;
    this.y = y;
    this.alpha = 1;
    this.scale = 1;
    this.home = home;
  }

  hide() {
    this.mv = false;
    this.alpha = 0;
    this.home = null;
  }

  move(t0: number, dur: number, x0: number, y0: number, x1: number, y1: number, a0: number, a1: number, s0: number, s1: number, ek: number, endHome: Home, hideEnd: boolean) {
    this.mv = true;
    this.t0 = t0;
    this.dur = Math.max(1, dur);
    this.x0 = x0;
    this.y0 = y0;
    this.x1 = x1;
    this.y1 = y1;
    this.a0 = a0;
    this.a1 = a1;
    this.s0 = s0;
    this.s1 = s1;
    this.ek = ek;
    this.endHome = endHome;
    this.hideEnd = hideEnd;
    this.x = x0;
    this.y = y0;
    this.alpha = a0;
    this.scale = s0;
  }

  /** Jump a running motion to its end state */
  finish() {
    if (!this.mv) return;
    this.update(this.t0 + this.dur + 1);
  }

  copyFrom(o: ChipStack, chipTex: Texture[], ax: number, ay: number, r: number) {
    this.setAmount(o.amount, chipTex, ax, ay, r);
    this.mv = false;
    this.x = o.x;
    this.y = o.y;
    this.alpha = o.alpha;
    this.scale = o.scale;
    this.home = o.home;
  }

  get busy() {
    return this.mv;
  }

  update(now: number) {
    if (this.mv) {
      const p = now <= this.t0 ? 0 : Math.min(1, (now - this.t0) / this.dur);
      const e = ease(this.ek, p);
      this.x = lerp(this.x0, this.x1, e);
      this.y = lerp(this.y0, this.y1, e);
      this.scale = lerp(this.s0, this.s1, Math.min(1, e));
      const k = this.a1 >= this.a0 ? Math.min(1, p / 0.3) : p * p;
      this.alpha = lerp(this.a0, this.a1, k);
      if (p >= 1) {
        this.mv = false;
        this.home = this.endHome;
        if (this.hideEnd) this.alpha = 0;
      }
    }
  }

  apply(chipScale: number) {
    const vis = this.alpha > 0.004 && this.count > 0;
    this.view.visible = vis;
    if (!vis) return;
    this.view.position.set(this.x, this.y);
    this.view.alpha = Math.min(1, this.alpha);
    this.view.scale.set(this.scale * chipScale);
    this.glow.alpha = this.glowLevel;
    this.glow.visible = this.glowLevel > 0.01;
  }
}

export interface SpinArgs {
  d: number;
  quick: boolean;
  pocket: number;
  win: boolean;
  bet: number;
  nextBet: number;
  showNext: boolean;
}

export interface SyncState {
  pocket: number | null;
  win: boolean | null;
  bet: number | null;
  pendingAmount: number;
  showPending: boolean;
  ended: 'bust' | 'cap' | null;
}

interface Plan {
  t0: number;
  d: number;
  quick: boolean;
  pocket: number;
  idx: number;
  win: boolean;
  bet: number;
  nextBet: number;
  showNext: boolean;
  tA: number;
  tL: number;
  tOut0: number;
  tOut1: number;
  tNext: number;
  speed: number;
  path: BallPath;
  fired: number;
}
const F_LAND = 1;
const F_OUT = 2;
const F_SPARK = 4;
const F_NEXT = 8;

type Mode = 'idle' | 'spin' | 'result' | 'turbo' | 'ended';

const N_SPARKS = 36;
const N_TRAIL = 3;

export class StageScene {
  private app: Application | null = null;
  private dead = false;
  private L: StageLayout | null = null;
  private res = 1;
  private failed = false;

  // textures
  private texBowl: Texture | null = null;
  private texRotor: Texture | null = null;
  private texBlur: Texture | null = null;
  private texShade: Texture | null = null;
  private texWheelShadow: Texture | null = null;
  private texBall: Texture | null = null;
  private texDot: Texture | null = null;
  private texBlob: Texture | null = null;
  private texSpark: Texture | null = null;
  private texBox: Texture | null = null;
  private texChipGlow: Texture | null = null;
  private texChips: Texture[] = [];
  private chipAx = 0.5;
  private chipAy = 0.5;
  private rotorPainted: art.Painted | null = null;
  private blurDirty = true;
  private texR = 0;
  private texChipR = 0;
  private texRes = 0;
  private texBoxW = 0;
  private texBoxH = 0;
  private repaintTimer: ReturnType<typeof setTimeout> | undefined;

  // display objects
  private readonly wheelShadow = new Sprite();
  private readonly bowl = new Sprite();
  private readonly rotorWrap = new Container();
  private readonly rotor = new Sprite();
  private readonly rotorBlur = new Sprite();
  private readonly pocketGlow = new Sprite();
  private readonly shade = new Sprite();
  private readonly ballShadow = new Sprite();
  private readonly ball = new Sprite();
  private readonly trail: Sprite[] = [];
  private readonly boxGlow = new Sprite();
  private readonly pending = new ChipStack();
  private readonly oldBet = new ChipStack();
  private readonly oldPay = new ChipStack();
  private readonly bet = new ChipStack();
  private readonly pay = new ChipStack();
  private readonly sparks: Sprite[] = [];
  private readonly sp = new Float32Array(N_SPARKS * 8); // x y vx vy age life rot vr

  // state
  private mode: Mode = 'idle';
  private ended: 'bust' | 'cap' | null = null;
  private wheelAngle = Math.random() * TAU;
  private wheelSpeed = IDLE_SPEED;
  private ballOn = false;
  private ballAlpha = 0;
  private ballRel = 0;
  private ballRf: number = RAD.ballPocket;
  private ballHop = 0;
  private plan: Plan | null = null;
  private seq = 0;
  private pocketIdx = -1;
  private pocketTint = WHITE;
  private readonly pocketEnv = new Env();
  private readonly boxEnv = new Env();
  private boxTint = GOLD;
  private boxPulse = false;
  private readonly chipGlowEnv = new Env();
  private pendingAmount = 0;
  private pendingWanted = true;
  private lastT = 0;
  private lastTurbo = 0;
  private readonly bs: BallState = { phi: 0, r: 0, hop: 0 };
  private readonly bt: BallState = { phi: 0, r: 0, hop: 0 };

  /** Starts Pixi. Returns false if the component unmounted meanwhile (the app is destroyed). */
  async init(host: HTMLElement, L: StageLayout, res: number): Promise<boolean> {
    const app = new Application();
    await app.init({
      width: L.W,
      height: L.H,
      backgroundAlpha: 0,
      antialias: true,
      resolution: res,
      autoDensity: true,
      preference: 'webgl',
      powerPreference: 'high-performance',
    });
    if (this.dead) {
      app.destroy(true, { children: true });
      return false;
    }
    this.app = app;
    this.L = L;
    this.res = res;
    const cv = app.canvas;
    cv.style.position = 'absolute';
    cv.style.inset = '0';
    cv.style.display = 'block';
    cv.setAttribute('aria-hidden', 'true');
    host.appendChild(cv);

    this.build();
    this.paint();
    this.layoutSprites();
    this.reset(this.pendingAmount);
    this.lastT = performance.now();
    app.ticker.add(this.tick);

    // Repaint the rotor once the number font has loaded
    document.fonts
      ?.load(`600 40px ${FONT_NUM}`)
      .then(() => {
        if (!this.dead && this.app && this.L) this.repaintRotor();
      })
      .catch(() => {});
    return true;
  }

  destroy() {
    this.dead = true;
    clearTimeout(this.repaintTimer);
    const app = this.app;
    this.app = null;
    if (app) {
      app.ticker.remove(this.tick);
      try {
        app.destroy(true, { children: true });
      } catch {
        /* ignore */
      }
    }
    const all = [this.texBowl, this.texRotor, this.texBlur, this.texShade, this.texWheelShadow, this.texBall, this.texDot, this.texBlob, this.texSpark, this.texBox, this.texChipGlow, ...this.texChips];
    for (const t of all) t?.destroy(true);
    this.texChips = [];
    this.texBowl = this.texRotor = this.texBlur = this.texShade = this.texWheelShadow = null;
    this.texBall = this.texDot = this.texBlob = this.texSpark = this.texBox = this.texChipGlow = null;
    this.rotorPainted = null;
  }

  // ——————————————————————— setup / painting ———————————————————————

  private build() {
    const st = this.app!.stage;
    for (const s of [this.wheelShadow, this.bowl, this.rotor, this.rotorBlur, this.pocketGlow, this.shade, this.ballShadow, this.ball, this.boxGlow]) {
      s.anchor.set(0.5);
    }
    this.pocketGlow.blendMode = 'add';
    this.boxGlow.blendMode = 'add';
    this.rotorBlur.visible = false;
    this.rotorWrap.addChild(this.rotor, this.rotorBlur, this.pocketGlow);
    st.addChild(this.wheelShadow, this.bowl, this.rotorWrap, this.shade);
    for (let i = 0; i < N_TRAIL; i++) {
      const s = new Sprite();
      s.anchor.set(0.5);
      s.visible = false;
      this.trail.push(s);
    }
    st.addChild(...this.trail, this.ballShadow, this.ball, this.boxGlow);
    st.addChild(this.pending.view, this.oldBet.view, this.oldPay.view, this.bet.view, this.pay.view);
    const sparkLayer = new Container();
    for (let i = 0; i < N_SPARKS; i++) {
      const s = new Sprite();
      s.anchor.set(0.5);
      s.blendMode = 'add';
      s.visible = false;
      this.sparks.push(s);
      sparkLayer.addChild(s);
    }
    st.addChild(sparkLayer);
  }

  private swap(old: Texture | null, next: Texture): Texture {
    if (old && old !== next) {
      // assign the new texture first, destroy the old one afterwards
      queueMicrotask(() => old.destroy(true));
    }
    return next;
  }

  /** Paints every texture at the current size and dpr. */
  private paint() {
    const L = this.L!;
    const res = this.res;
    const R = L.R;
    if (Math.abs(R - this.texR) > 0.5 || res !== this.texRes) {
      this.texBowl = this.swap(this.texBowl, toTexture(art.paintBowl(R, res)));
      this.rotorPainted = art.paintRotor(R, res, FONT_NUM);
      this.texRotor = this.swap(this.texRotor, toTexture(this.rotorPainted));
      this.texShade = this.swap(this.texShade, toTexture(art.paintShade(R, res)));
      this.texWheelShadow = this.swap(this.texWheelShadow, toTexture(art.paintWheelShadow(R, res)));
      this.texBall = this.swap(this.texBall, toTexture(art.paintBall(R * RAD.ball, res)));
      this.texDot = this.swap(this.texDot, toTexture(art.paintSoftDot(R * 0.08, res)));
      if (this.texBlur) {
        this.texBlur = this.swap(this.texBlur, toTexture(art.paintRotorBlur(this.rotorPainted)));
        this.blurDirty = false;
      } else this.blurDirty = true;
      this.bowl.texture = this.texBowl;
      this.rotor.texture = this.texRotor;
      if (this.texBlur) this.rotorBlur.texture = this.texBlur;
      this.shade.texture = this.texShade;
      this.wheelShadow.texture = this.texWheelShadow;
      this.ball.texture = this.texBall;
      for (const t of this.trail) t.texture = this.texBall;
      this.pocketGlow.texture = this.texDot;
      this.texR = R;
    }
    const cr = L.chipR;
    if (Math.abs(cr - this.texChipR) > 0.25 || res !== this.texRes) {
      const old = this.texChips;
      const chips: Texture[] = [];
      let ax = 0.5;
      let ay = 0.5;
      for (const pal of art.CHIP_PALETTES) {
        const p = art.paintChip(cr, pal, res);
        ax = p.ax;
        ay = p.ay;
        chips.push(toTexture(p));
      }
      this.texChips = chips;
      this.chipAx = ax;
      this.chipAy = ay;
      this.texBlob = this.swap(this.texBlob, toTexture(art.paintShadowBlob(cr * 1.2, res)));
      this.texSpark = this.swap(this.texSpark, toTexture(art.paintSparkle(Math.max(6, cr * 0.42), res)));
      this.texChipGlow = this.swap(this.texChipGlow, toTexture(art.paintSoftDot(cr * 1.6, res, 0.05)));
      for (const s of [this.pending, this.oldBet, this.oldPay, this.bet, this.pay]) s.refresh(chips, ax, ay, cr, this.texBlob, this.texChipGlow);
      this.ballShadow.texture = this.texBlob;
      for (const s of this.sparks) s.texture = this.texSpark;
      if (old.length) queueMicrotask(() => old.forEach((t) => t.destroy(true)));
      this.texChipR = cr;
    }
    if (Math.abs(L.red.w - this.texBoxW) > 0.5 || Math.abs(L.red.h - this.texBoxH) > 0.5 || res !== this.texRes) {
      this.texBox = this.swap(this.texBox, toTexture(art.paintBoxGlow(L.red.w, L.red.h, 10, res)));
      this.boxGlow.texture = this.texBox;
      this.texBoxW = L.red.w;
      this.texBoxH = L.red.h;
    }
    this.texRes = res;
  }

  private repaintRotor() {
    if (!this.L) return;
    this.rotorPainted = art.paintRotor(this.texR || this.L.R, this.texRes || this.res, FONT_NUM);
    this.texRotor = this.swap(this.texRotor, toTexture(this.rotorPainted));
    this.rotor.texture = this.texRotor;
    this.blurDirty = true;
  }

  private ensureBlur() {
    if (!this.blurDirty || !this.rotorPainted) return;
    this.blurDirty = false;
    this.texBlur = this.swap(this.texBlur, toTexture(art.paintRotorBlur(this.rotorPainted)));
    this.rotorBlur.texture = this.texBlur;
  }

  /** Static sprite positions (on every resize) */
  private layoutSprites() {
    const L = this.L!;
    const k = this.texR ? L.R / this.texR : 1;
    this.wheelShadow.position.set(L.cx + L.R * 0.035, L.cy + L.R * 0.07);
    this.wheelShadow.scale.set(k);
    this.bowl.position.set(L.cx, L.cy);
    this.bowl.scale.set(k);
    this.rotorWrap.position.set(L.cx, L.cy);
    this.rotorWrap.scale.set(k);
    this.shade.position.set(L.cx, L.cy);
    this.shade.scale.set(k);
    this.boxGlow.position.set(L.red.x + L.red.w / 2, L.red.y + L.red.h / 2);
    this.boxGlow.scale.set(this.texBoxW ? L.red.w / this.texBoxW : 1, this.texBoxH ? L.red.h / this.texBoxH : 1);
    // move stacks to the new anchor points
    for (const s of [this.pending, this.oldBet, this.oldPay, this.bet, this.pay]) {
      s.finish();
      const p = s.home === 'bet' ? L.betAnchor : s.home === 'pay' ? L.payAnchor : s.home === 'spot' ? L.spot : null;
      if (p) s.place(p.x, p.y, s.home);
      else s.hide();
    }
  }

  resize(L: StageLayout, res: number) {
    this.L = L;
    this.res = res;
    const app = this.app;
    if (!app) return;
    app.renderer.resize(L.W, L.H, res);
    this.layoutSprites();
    // Repaint textures once resizing settles (scaled textures are used until then)
    clearTimeout(this.repaintTimer);
    this.repaintTimer = setTimeout(() => {
      if (this.dead || !this.app || !this.L) return;
      this.paint();
      this.layoutSprites();
    }, 140);
  }

  // ——————————————————————— API ———————————————————————

  spin(a: SpinArgs) {
    const L = this.L;
    if (!L || !this.app) return;
    this.finishSpin();
    const now = performance.now();
    const d = Math.max(120, a.d);
    const quick = a.quick;
    this.mode = 'spin';
    this.ended = null;

    // Chips from the previous win go back to the player
    this.retire(now, quick ? Math.max(90, 0.2 * d) : Math.min(420, 0.16 * d));
    this.boxEnv.fade(now, 0.12);
    this.chipGlowEnv.fade(now, 0.12);
    this.pocketEnv.fade(now, 0.25);
    this.boxPulse = false;

    // The waiting stack slides onto the table (RED)
    this.pending.hide();
    this.bet.setAmount(a.bet, this.texChips, this.chipAx, this.chipAy, this.texChipR);
    if (!quick) {
      this.bet.move(now, 0.17 * d, L.spot.x, L.spot.y, L.betAnchor.x, L.betAnchor.y, 1, 1, 1, 1, E_BACK, 'bet', false);
    } else {
      this.bet.move(now, Math.max(60, 0.16 * d), L.betAnchor.x, L.betAnchor.y - L.chipR * 0.6, L.betAnchor.x, L.betAnchor.y, 0, 1, 1.08, 1, E_OUT, 'bet', false);
    }
    this.pay.hide();

    const idx = pocketIndex(a.pocket);
    let phi0: number;
    let r0: number;
    if (this.ballOn && this.ballAlpha > 0.5) {
      phi0 = this.ballRel;
      r0 = this.ballRf;
    } else {
      phi0 = LAUNCH_ANGLE - this.wheelAngle;
      r0 = RAD.ballTrack;
      this.ballRel = phi0;
      this.ballRf = r0;
      this.ballAlpha = 0;
    }
    this.ballOn = true;
    const turns = quick ? (d >= 400 ? 1 : 0) : d >= 2000 ? 3 : d >= 1100 ? 2 : 1;
    const tA = quick ? 0 : 0.06 * d;
    const tL = quick ? 0.62 * d : 0.8 * d;
    const tOut0 = quick ? tL : tL + 0.03 * d;
    const tOut1 = quick ? tL + 0.2 * d : tOut0 + 0.15 * d;
    this.plan = {
      t0: now,
      d,
      quick,
      pocket: a.pocket,
      idx,
      win: a.win,
      bet: a.bet,
      nextBet: a.nextBet,
      showNext: a.showNext,
      tA,
      tL,
      tOut0,
      tOut1,
      tNext: quick ? tL + 0.15 * d : tL + 0.12 * d,
      speed: quick ? QUICK_SPEED : SPIN_SPEED,
      path: makeBallPath(phi0, idx, turns, r0, quick, this.seq++),
      fired: 0,
    };
  }

  /** Finish a running spin at once: ball into the pocket, chips to their final places. */
  finishSpin() {
    const p = this.plan;
    if (!p) return;
    const now = performance.now();
    if (!(p.fired & F_LAND)) this.land(p, now);
    if (!(p.fired & F_OUT)) this.outcome(p, now, true);
    if (!(p.fired & F_NEXT)) this.showNext(p, now, true);
    p.fired |= F_SPARK;
    for (const s of [this.bet, this.pay, this.pending]) s.finish();
    this.oldBet.hide();
    this.oldPay.hide();
    this.plan = null;
    this.mode = 'result';
  }

  instant(pocket: number, win: boolean, bet: number) {
    const L = this.L;
    if (!L || !this.app) return;
    this.finishSpin();
    const now = performance.now();
    this.mode = 'turbo';
    this.ended = null;
    this.lastTurbo = now;
    const idx = pocketIndex(pocket);
    this.ballOn = true;
    this.ballAlpha = 1;
    this.ballRel = pocketAngle(idx);
    this.ballRf = RAD.ballPocket;
    this.ballHop = 0;
    this.pocketIdx = idx;
    this.pocketTint = win ? GOLD : pocket === 0 ? GREEN : WHITE;
    this.pocketEnv.set(now, 0, 1, 0, 0.2, 0);
    const ct = this.texChips;
    this.bet.setAmount(bet, ct, this.chipAx, this.chipAy, this.texChipR);
    this.bet.place(L.betAnchor.x, L.betAnchor.y, 'bet');
    if (win) {
      this.pay.setAmount(bet, ct, this.chipAx, this.chipAy, this.texChipR);
      this.pay.place(L.payAnchor.x, L.payAnchor.y, 'pay');
    } else this.pay.hide();
    this.oldBet.hide();
    this.oldPay.hide();
    this.pending.hide();
    this.boxTint = win ? GOLD : RED;
    this.boxPulse = false;
    this.boxEnv.set(now, 0, 0.65, 0, 0.14, 0);
    this.chipGlowEnv.off();
  }

  turboOff(lastWin: boolean) {
    if (this.mode !== 'turbo' || !this.L) return;
    this.mode = 'result';
    const now = performance.now();
    const b = this.bet;
    if (!lastWin) b.move(now, 300, b.x, b.y, this.L.house.x, this.L.house.y, b.alpha, 0, 1, 0.85, E_IN, null, true);
    else this.chipGlowEnv.set(now, 0.1, 0.7, 0.1, 0.5, 0.35);
    this.applyPending(now);
  }

  setPending(amount: number, show: boolean) {
    this.pendingAmount = amount;
    this.pendingWanted = show;
    if (!this.app || this.mode === 'spin' || this.mode === 'turbo' || this.mode === 'ended') return;
    this.applyPending(performance.now());
  }

  end(kind: 'bust' | 'cap') {
    if (!this.L || !this.app) {
      this.ended = kind;
      this.mode = 'ended';
      return;
    }
    this.finishSpin();
    const now = performance.now();
    this.mode = 'ended';
    this.ended = kind;
    const p = this.pending;
    if (p.alpha > 0.01) p.move(now, 320, p.x, p.y, p.x, p.y + 4, p.alpha, 0, 1, 0.95, E_IN, null, true);
    if (kind === 'bust') {
      // A bust always follows a loss: sweep any chips left on the table (turbo / skip)
      const b = this.bet;
      if (b.alpha > 0.01) b.move(now, 420, b.x, b.y, this.L.house.x, this.L.house.y, b.alpha, 0, 1, 0.8, E_IN, null, true);
      this.pay.hide();
      this.boxTint = RED;
      this.boxPulse = false;
      this.boxEnv.set(now, 0.08, 1, 0.35, 0.8, 0.45);
      this.pocketTint = RED;
      this.pocketEnv.set(now, 0.05, 1, 0.4, 1.4, 0.65);
    } else {
      this.boxTint = GOLD;
      this.boxPulse = true;
      this.boxEnv.set(now, 0.15, 0.95, 0.3, 0.9, 0.45);
      this.chipGlowEnv.set(now, 0.15, 1, 0.3, 0.8, 0.5);
      const L = this.L;
      this.burst(L.red.x + L.red.w / 2, L.red.y + L.red.h * 0.45, 30, GOLD);
    }
  }

  reset(pendingAmount: number) {
    this.pendingAmount = pendingAmount;
    this.pendingWanted = true;
    this.plan = null;
    this.mode = 'idle';
    this.ended = null;
    for (const s of [this.oldBet, this.oldPay, this.bet, this.pay]) s.hide();
    this.pocketEnv.off();
    this.boxEnv.off();
    this.chipGlowEnv.off();
    this.boxPulse = false;
    this.ballOn = false;
    for (let i = 0; i < N_SPARKS; i++) this.sp[i * 8 + 5] = 0;
    const L = this.L;
    if (!L || !this.app) return;
    this.pending.setAmount(pendingAmount, this.texChips, this.chipAx, this.chipAy, this.texChipR);
    this.pending.place(L.spot.x, L.spot.y, 'spot');
  }

  /** If the scene became ready late, mirror the component's current state. */
  sync(s: SyncState) {
    if (!this.L || !this.app) return;
    this.reset(s.pendingAmount);
    if (s.pocket !== null) {
      const idx = pocketIndex(s.pocket);
      this.ballOn = true;
      this.ballAlpha = 1;
      this.ballRel = pocketAngle(idx);
      this.ballRf = RAD.ballPocket;
      this.pocketIdx = idx;
    }
    if (s.bet !== null && s.win) {
      const L = this.L;
      this.bet.setAmount(s.bet, this.texChips, this.chipAx, this.chipAy, this.texChipR);
      this.bet.place(L.betAnchor.x, L.betAnchor.y, 'bet');
      this.pay.setAmount(s.bet, this.texChips, this.chipAx, this.chipAy, this.texChipR);
      this.pay.place(L.payAnchor.x, L.payAnchor.y, 'pay');
    }
    if (!s.showPending) this.pending.hide();
    this.pendingWanted = s.showPending;
    this.mode = 'result';
    if (s.ended) this.end(s.ended);
  }

  // ——————————————————————— events ———————————————————————

  private retire(now: number, dur: number) {
    const L = this.L!;
    const ct = this.texChips;
    const pairs: [ChipStack, ChipStack][] = [
      [this.bet, this.oldBet],
      [this.pay, this.oldPay],
    ];
    for (const [src, dst] of pairs) {
      src.finish();
      if (src.alpha > 0.05 && src.count > 0) {
        dst.copyFrom(src, ct, this.chipAx, this.chipAy, this.texChipR);
        dst.move(now, dur, src.x, src.y, L.spot.x, L.spot.y + L.chipR * 0.3, src.alpha, 0, 1, 0.85, E_IN, null, true);
      } else dst.hide();
      src.hide();
    }
  }

  private land(p: Plan, now: number) {
    p.fired |= F_LAND;
    this.ballRel = mod(p.path.phiT, TAU);
    this.ballRf = RAD.ballPocket;
    this.ballHop = 0;
    this.ballAlpha = 1;
    this.pocketIdx = p.idx;
    this.pocketTint = p.win ? GOLD : p.pocket === 0 ? GREEN : WHITE;
    this.pocketEnv.set(now, 0.06, 1, 0.3, 0.9, 0.6);
    this.boxTint = p.win ? GOLD : RED;
    this.boxPulse = p.win;
    if (p.win) this.boxEnv.set(now, 0.12, 0.95, 0.25, 0.6, 0.42);
    else this.boxEnv.set(now, 0.03, 0.9, 0.08, 0.3, 0);
  }

  private outcome(p: Plan, now: number, instant: boolean) {
    p.fired |= F_OUT;
    const L = this.L!;
    const ct = this.texChips;
    const dur = Math.max(80, p.tOut1 - p.tOut0);
    if (p.win) {
      this.bet.finish();
      this.bet.place(L.betAnchor.x, L.betAnchor.y, 'bet');
      this.pay.setAmount(p.bet, ct, this.chipAx, this.chipAy, this.texChipR);
      if (instant) {
        this.pay.place(L.payAnchor.x, L.payAnchor.y, 'pay');
        this.chipGlowEnv.set(now, 0, 0.6, 0, 0.4, 0.45);
      } else {
        this.pay.move(now, dur, L.house.x, L.house.y, L.payAnchor.x, L.payAnchor.y, 0, 1, 0.9, 1, E_OUT, 'pay', false);
        this.chipGlowEnv.set(now + dur * 0.55, 0.12, 1, 0.2, 0.6, 0.45);
      }
    } else if (instant) {
      this.bet.hide();
    } else {
      this.bet.finish();
      this.bet.move(now, dur, L.betAnchor.x, L.betAnchor.y, L.house.x, L.house.y, 1, 0, 1, 0.8, E_IN, null, true);
    }
  }

  private showNext(p: Plan, now: number, instant: boolean) {
    p.fired |= F_NEXT;
    if (!p.showNext) return;
    this.pendingAmount = p.nextBet;
    this.pendingWanted = true;
    const L = this.L!;
    this.pending.setAmount(p.nextBet, this.texChips, this.chipAx, this.chipAy, this.texChipR);
    if (instant) this.pending.place(L.spot.x, L.spot.y, 'spot');
    else this.pending.move(now, 260, L.spot.x, L.spot.y - L.chipR * 0.7, L.spot.x, L.spot.y, 0, 1, 1.06, 1, E_OUT, 'spot', false);
  }

  private applyPending(now: number) {
    const L = this.L;
    if (!L) return;
    const p = this.pending;
    if (this.pendingWanted && this.pendingAmount > 0) {
      const wasHidden = p.alpha < 0.05 && !p.busy;
      p.setAmount(this.pendingAmount, this.texChips, this.chipAx, this.chipAy, this.texChipR);
      if (wasHidden) p.move(now, 240, L.spot.x, L.spot.y - L.chipR * 0.7, L.spot.x, L.spot.y, 0, 1, 1.06, 1, E_OUT, 'spot', false);
    } else if (p.alpha > 0.01 && !p.busy) {
      p.move(now, 200, p.x, p.y, p.x, p.y, p.alpha, 0, 1, 1, E_IN, null, true);
    }
  }

  private burst(x: number, y: number, n: number, tint: number) {
    const L = this.L;
    if (!L) return;
    const u = L.chipR;
    let made = 0;
    for (let i = 0; i < N_SPARKS && made < n; i++) {
      const o = i * 8;
      if (this.sp[o + 5] > 0 && this.sp[o + 4] < this.sp[o + 5]) continue;
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const v = u * (3 + Math.random() * 6);
      this.sp[o] = x + (Math.random() - 0.5) * u;
      this.sp[o + 1] = y + (Math.random() - 0.5) * u * 0.5;
      this.sp[o + 2] = Math.cos(a) * v;
      this.sp[o + 3] = Math.sin(a) * v;
      this.sp[o + 4] = 0;
      this.sp[o + 5] = 0.55 + Math.random() * 0.6;
      this.sp[o + 6] = Math.random() * TAU;
      this.sp[o + 7] = (Math.random() - 0.5) * 8;
      this.sparks[i].tint = tint;
      made++;
    }
  }

  // ——————————————————————— frame loop ———————————————————————

  private tick = () => {
    if (this.dead || !this.L || this.failed) return;
    try {
      this.frame(performance.now());
    } catch (e) {
      this.failed = true;
      console.error('[GameStage] scene error — animation stopped', e);
      this.app?.ticker.stop();
    }
  };

  private frame(now: number) {
    const L = this.L!;
    const dt = Math.min(0.05, Math.max(0, (now - this.lastT) / 1000));
    this.lastT = now;
    const R = L.R;
    const k = this.texR ? R / this.texR : 1;

    // Spin plan events
    const p = this.plan;
    let flight = -1;
    if (p) {
      const t = now - p.t0;
      if (!(p.fired & F_LAND)) {
        if (t >= p.tL) this.land(p, now);
        else if (t >= p.tA) flight = (t - p.tA) / (p.tL - p.tA);
      }
      if (!(p.fired & F_OUT) && t >= p.tOut0) this.outcome(p, now, false);
      if (!(p.fired & F_SPARK) && t >= p.tOut1) {
        p.fired |= F_SPARK;
        if (p.win) this.burst(L.payAnchor.x, L.payAnchor.y - L.chipR, p.quick ? 10 : 22, GOLD);
      }
      if (!(p.fired & F_NEXT) && t >= p.tNext) this.showNext(p, now, false);
      if (t >= p.d) {
        this.plan = null;
        this.mode = 'result';
      }
    }
    // turbo safety net (in case the component never turns it off)
    if (this.mode === 'turbo' && now - this.lastTurbo > 2000) this.turboOff(true);

    // Wheel speed
    let target = IDLE_SPEED;
    if (this.mode === 'spin' && this.plan) target = now - this.plan.t0 < this.plan.tL + this.plan.d * 0.05 ? this.plan.speed : IDLE_SPEED * 2;
    else if (this.mode === 'turbo') target = TURBO_SPEED;
    else if (this.mode === 'ended') target = this.ended === 'bust' ? 0 : IDLE_SPEED;
    // Brake hard when leaving turbo speed (so the blur clears quickly), then slow down gently
    const rate = target > this.wheelSpeed ? 3.2 : this.wheelSpeed > 4 ? 4.5 : this.mode === 'ended' ? 0.8 : 1.2;
    this.wheelSpeed += (target - this.wheelSpeed) * (1 - Math.exp(-rate * dt));
    this.wheelAngle = mod(this.wheelAngle + this.wheelSpeed * dt, TAU);
    this.rotorWrap.rotation = this.wheelAngle;
    const blur = clamp((this.wheelSpeed - 3.2) / 6.5, 0, 0.92);
    if (blur > 0.01) this.ensureBlur();
    this.rotorBlur.visible = blur > 0.01 && this.texBlur !== null;
    this.rotorBlur.alpha = blur;

    // Ball
    if (flight >= 0 && p) {
      ballAt(p.path, flight, this.bs);
      this.ballRel = this.bs.phi;
      this.ballRf = this.bs.r;
      this.ballHop = this.bs.hop;
    }
    const wantBall = this.ballOn ? 1 : 0;
    this.ballAlpha += (wantBall - this.ballAlpha) * (1 - Math.exp(-dt * 10));
    const rb = R * RAD.ball;
    const ang = this.wheelAngle + this.ballRel;
    const rr = this.ballRf * R;
    const bx = L.cx + Math.cos(ang) * rr;
    const by = L.cy + Math.sin(ang) * rr;
    const hop = this.ballHop;
    const showBall = this.ballAlpha > 0.01;
    this.ball.visible = this.ballShadow.visible = showBall;
    if (showBall) {
      this.ball.position.set(bx, by - hop * rb * 0.8);
      this.ball.scale.set(k * (1 + 0.38 * hop));
      this.ball.alpha = this.ballAlpha;
      const bsw = this.ballShadow.texture.width || 1;
      this.ballShadow.position.set(bx + rb * (0.3 + hop * 1.1), by + rb * (0.45 + hop * 1.5));
      this.ballShadow.scale.set(((rb * 2.6) / bsw) * (1 + 0.35 * hop));
      this.ballShadow.alpha = this.ballAlpha * (0.75 - 0.4 * hop);
    }
    // motion trail
    const showTrail = flight >= 0 && p !== null && flight < p.path.uHit && showBall;
    for (let i = 0; i < N_TRAIL; i++) {
      const s = this.trail[i];
      s.visible = showTrail;
      if (!showTrail || !p) continue;
      const du = ((16 / Math.max(60, p.tL - p.tA)) * 0.55 * (i + 1));
      ballAt(p.path, flight - du, this.bt);
      const a2 = this.wheelAngle + this.bt.phi;
      s.position.set(L.cx + Math.cos(a2) * this.bt.r * R, L.cy + Math.sin(a2) * this.bt.r * R);
      s.scale.set(k * (1 - i * 0.08));
      s.alpha = this.ballAlpha * (0.32 / (i + 1));
    }

    // Winning-pocket glow (rotates with the rotor)
    const pv = this.pocketIdx >= 0 ? this.pocketEnv.value(now) : 0;
    this.pocketGlow.visible = pv > 0.01;
    if (pv > 0.01) {
      const pa = pocketAngle(this.pocketIdx);
      const pr = RAD.ballPocket * this.texR;
      this.pocketGlow.position.set(Math.cos(pa) * pr, Math.sin(pa) * pr);
      this.pocketGlow.tint = this.pocketTint;
      this.pocketGlow.alpha = Math.min(1, pv) * 0.95;
      this.pocketGlow.scale.set(1.1);
    }

    // RED box glow
    let bv = this.boxEnv.value(now);
    if (this.boxPulse) bv *= 0.82 + 0.18 * Math.sin(now * 0.005);
    this.boxGlow.visible = bv > 0.01;
    this.boxGlow.alpha = Math.min(1, bv);
    this.boxGlow.tint = this.boxTint;

    // Chip stacks
    const cs = this.texChipR ? L.chipR / this.texChipR : 1;
    const cg = this.chipGlowEnv.value(now) * (0.85 + 0.15 * Math.sin(now * 0.006));
    this.bet.glowLevel = this.pay.alpha > 0.05 ? cg : 0;
    this.pay.glowLevel = cg;
    this.pending.glowLevel = 0;
    this.oldBet.glowLevel = 0;
    this.oldPay.glowLevel = 0;
    for (const s of [this.pending, this.oldBet, this.oldPay, this.bet, this.pay]) {
      s.update(now);
      s.apply(cs);
    }

    // Sparks
    const grav = L.chipR * 14;
    for (let i = 0; i < N_SPARKS; i++) {
      const o = i * 8;
      const sp = this.sparks[i];
      const life = this.sp[o + 5];
      if (life <= 0) {
        sp.visible = false;
        continue;
      }
      const age = this.sp[o + 4] + dt;
      if (age >= life) {
        this.sp[o + 5] = 0;
        sp.visible = false;
        continue;
      }
      this.sp[o + 4] = age;
      this.sp[o + 3] += grav * dt;
      this.sp[o] += this.sp[o + 2] * dt;
      this.sp[o + 1] += this.sp[o + 3] * dt;
      this.sp[o + 6] += this.sp[o + 7] * dt;
      const f = 1 - age / life;
      sp.visible = true;
      sp.position.set(this.sp[o], this.sp[o + 1]);
      sp.rotation = this.sp[o + 6];
      sp.alpha = f ** 1.4;
      sp.scale.set(0.35 + 0.75 * f);
    }
  }
}
