<script lang="ts">
  /**
   * Game stage — roulette-style wheel, felt table, chips.
   *  - Felt, wooden rail and printed bet areas: CSS/DOM (below the canvas)
   *  - Wheel, ball, chips, glows: PixiJS (lazy-loaded, ./scene.ts)
   *  - Result board, round counter, amount tags, ± amounts, BUSTED moment: DOM (above the canvas)
   * Logic (promises/timers) is independent of Pixi; the API keeps working if Pixi fails to start.
   */
  import { onMount, untrack } from 'svelte';
  import type { RoundResult, SimStats } from '../engine/martingale';
  import { pocketFor, colorOf, WHEEL_ORDER, type StageApi } from './types';
  import { money, moneyShort, moneySigned, num } from '../engine/format';
  import { computeLayout, clamp, type StageLayout, type Rect } from './geometry';
  import { crackPaths, type Cracks } from './cracks';
  import type { StageScene } from './scene';

  interface Props {
    /** The bet waiting to be placed (minor units) — shown as the idle chip stack */
    nextBet: number;
  }
  let { nextBet }: Props = $props();

  const BOARD_N = 12;
  const board = $state<number[]>(Array(BOARD_N).fill(-1));
  let round = $state(0);
  let betTag = $state<number | null>(null);
  let pendingAmt = $state(0);
  let showPending = $state(true);
  let turbo = $state(false);
  let L = $state<StageLayout | null>(null);
  let fallback = $state(false);
  type EndView = { kind: 'bust' | 'cap'; eyebrow: string; title: string; line1: string; line2: string };
  let endView = $state<EndView | null>(null);
  let cracks = $state<Cracks | null>(null);
  let shaking = $state(false);
  let fx = $state<{ id: number; text: string; win: boolean; dur: number } | null>(null);
  let flash = $state<{ id: number; win: boolean } | null>(null);
  let aria = $state('');

  // ——— logic state (not reactive) ———
  type Phase = 'idle' | 'spinning' | 'result' | 'turbo' | 'ended';
  let phase: Phase = 'idle';
  let feltEl: HTMLDivElement;
  let host: HTMLDivElement;
  let scene: StageScene | null = null;
  let candidate: StageScene | null = null;
  let disposed = false;
  let gen = 0;
  let fxSeq = 0;
  let resolver: (() => void) | null = null;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let turboTimer: ReturnType<typeof setTimeout> | undefined;
  let shakeTimer: ReturnType<typeof setTimeout> | undefined;
  let current: { r: RoundResult; pocket: number; d: number; revealed: boolean } | null = null;
  let lastShownRound = -1;
  let lastPocket: number | null = null;
  let lastWin: boolean | null = null;
  let lastDpr = 0;
  let lastTurboResult: RoundResult | null = null;

  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dprNow = () => Math.min(2, Math.max(1, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
  const signed = (k: number) => (k >= 0 ? '+' : '−') + moneyShort(Math.abs(k));
  const colorName = (n: number) => (colorOf(n) === 'red' ? 'red' : colorOf(n) === 'black' ? 'black' : 'green');

  // ——————————————————— helpers ———————————————————

  function later(g: number, ms: number, fn: () => void) {
    timers.push(
      setTimeout(() => {
        if (g === gen && !disposed) fn();
      }, ms),
    );
  }

  function clearTimers() {
    for (const t of timers) clearTimeout(t);
    timers = [];
  }

  function resolvePending() {
    const r = resolver;
    resolver = null;
    r?.();
  }

  function pushBoard(roundNo: number, pocket: number, animate: boolean) {
    if (roundNo === lastShownRound) return;
    lastShownRound = roundNo;
    for (let i = BOARD_N - 1; i > 0; i--) board[i] = board[i - 1];
    board[0] = pocket;
    lastPocket = pocket;
    if (animate && !reduceMotion) {
      const el = feltEl?.querySelector<HTMLElement>('.tile.first');
      el?.animate(
        [
          { transform: 'translateY(-70%) scale(1.5)', opacity: 0 },
          { transform: 'translateY(0) scale(1.06)', opacity: 1 },
        ],
        { duration: 420, easing: 'cubic-bezier(.2,.9,.3,1.35)' },
      );
    }
  }

  /** Show the result (board, tags, effects). Once per round. */
  function reveal(withFx: boolean) {
    const c = current;
    if (!c || c.revealed) return;
    c.revealed = true;
    const r = c.r;
    pushBoard(r.round, c.pocket, withFx);
    lastWin = r.win;
    if (withFx) {
      const id = ++fxSeq;
      fx = { id, text: signed(r.net), win: r.win, dur: clamp(c.d * 0.6, 560, 1400) };
      flash = { id, win: r.win };
      aria = `Round ${num(r.round)}: ${c.pocket} ${colorName(c.pocket)} — ${r.win ? 'won' : 'lost'} ${signed(r.net)}`;
    }
    if (!r.win) {
      if (withFx) later(gen, Math.max(60, c.d * 0.18), () => (betTag = null));
      else betTag = null;
    }
    if (r.ended !== 'bust') {
      pendingAmt = r.nextBet;
      showPending = true;
    }
  }

  /** Finish a running spin now: show the result, seat the ball, resolve the promise. */
  function settle() {
    clearTimers();
    if (current) {
      // A loss that was shown but whose tag-clear timer got cancelled: clear the tag too
      if (current.revealed) {
        if (!current.r.win) betTag = null;
      } else reveal(false);
      current = null;
    }
    scene?.finishSpin();
    if (phase === 'spinning') phase = 'result';
    resolvePending();
  }

  function stopTurbo() {
    clearTimeout(turboTimer);
    turboTimer = undefined;
    turbo = false;
  }

  function clearEnd() {
    endView = null;
    cracks = null;
    shaking = false;
    clearTimeout(shakeTimer);
  }

  // ——————————————————— StageApi ———————————————————

  export function spin(result: RoundResult, durationMs: number): Promise<void> {
    settle();
    stopTurbo();
    if (endView) clearEnd();
    const g = ++gen;
    const d = clamp(Number.isFinite(durationMs) ? durationMs : 1000, 120, 10000);
    const quick = d < 600;
    const pocket = pocketFor(result);
    phase = 'spinning';
    round = result.round;
    betTag = result.bet;
    showPending = false;
    current = { r: result, pocket, d, revealed: false };
    scene?.spin({
      d,
      quick,
      pocket,
      win: result.win,
      bet: result.bet,
      nextBet: result.nextBet,
      showNext: result.ended !== 'bust',
    });
    const p = new Promise<void>((res) => {
      resolver = res;
    });
    later(g, quick ? 0.62 * d : 0.8 * d, () => reveal(true));
    later(g, d, () => {
      reveal(true);
      current = null;
      phase = 'result';
      resolvePending();
    });
    return p;
  }

  export function instant(result: RoundResult): void {
    const same = (current !== null && current.r.round === result.round) || (current === null && result.round === lastShownRound);
    settle(); // kill the running tween, resolve its promise, seat the ball
    if (same) {
      // Same round as the cut or finished spin: don't show the result twice.
      round = result.round;
      return;
    }
    if (endView) clearEnd();
    const g = ++gen;
    phase = 'turbo';
    turbo = true;
    lastTurboResult = result;
    const pocket = pocketFor(result);
    round = result.round;
    betTag = result.bet;
    showPending = false;
    pushBoard(result.round, pocket, false);
    lastWin = result.win;
    scene?.instant(pocket, result.win, result.bet);
    clearTimeout(turboTimer);
    turboTimer = setTimeout(() => {
      if (g !== gen || disposed) return;
      turbo = false;
      phase = 'result';
      const last = lastTurboResult;
      if (last && !last.win) betTag = null;
      const nb = untrack(() => nextBet);
      pendingAmt = nb;
      showPending = true;
      scene?.turboOff(last?.win ?? true);
      scene?.setPending(nb, true);
    }, 420);
  }

  export function end(stats: SimStats, last: RoundResult | null): void {
    settle();
    stopTurbo();
    gen++;
    if (!stats.ended) return;
    phase = 'ended';
    showPending = false;
    if (last) {
      if (last.round !== lastShownRound) pushBoard(last.round, pocketFor(last), false);
      lastWin = last.win;
      round = last.round;
      if (!last.win) betTag = null;
    }
    const net = stats.balance - stats.startBalance;
    if (stats.ended === 'bust') {
      endView = {
        kind: 'bust',
        eyebrow: `Round ${num(stats.round)}`,
        title: 'BUSTED',
        line1: `Bet needed ${money(stats.nextBet)} · Left ${money(stats.balance)}`,
        line2: `Net ${moneySigned(net)} · Longest losing streak ${num(stats.longestLossStreak)}`,
      };
      if (L) cracks = crackPaths(L.W, L.H, L.red.x + L.red.w * 0.5, L.red.y + L.red.h * 0.45, stats.round + 7);
      if (!reduceMotion) {
        shaking = true;
        clearTimeout(shakeTimer);
        shakeTimer = setTimeout(() => (shaking = false), 750);
      }
    } else {
      endView = {
        kind: 'cap',
        eyebrow: 'round limit',
        title: 'SURVIVED',
        line1: `${num(stats.round)} rounds · Balance ${money(stats.balance)}`,
        line2: `Net ${moneySigned(net)} · Peak ${money(stats.peakBalance)}`,
      };
    }
    aria = stats.ended === 'bust' ? `Busted: the bet could not be doubled in round ${num(stats.round)}.` : `Survived: round limit reached after ${num(stats.round)} rounds.`;
    scene?.end(stats.ended);
  }

  export function reset(): void {
    settle();
    stopTurbo();
    gen++;
    clearEnd();
    phase = 'idle';
    current = null;
    lastShownRound = -1;
    lastPocket = null;
    lastWin = null;
    lastTurboResult = null;
    board.fill(-1);
    round = 0;
    betTag = null;
    fx = null;
    flash = null;
    aria = '';
    const nb = untrack(() => nextBet);
    pendingAmt = nb;
    showPending = true;
    scene?.reset(nb);
  }

  // Contract check: this component satisfies StageApi
  const _api = { spin, instant, end, reset } satisfies StageApi;
  void _api;

  // Update the waiting stack when the next bet changes (while idle / showing a result)
  $effect(() => {
    const nb = nextBet;
    untrack(() => {
      if (phase === 'idle' || phase === 'result') {
        pendingAmt = nb;
        scene?.setPending(nb, showPending);
      }
    });
  });

  // ——————————————————— lifecycle ———————————————————

  function measure() {
    if (!feltEl) return;
    const w = feltEl.clientWidth;
    const h = feltEl.clientHeight;
    if (w < 20 || h < 20) return;
    const d = dprNow();
    if (L && Math.abs(L.W - w) < 0.5 && Math.abs(L.H - h) < 0.5 && d === lastDpr) return;
    lastDpr = d;
    const lay = computeLayout(w, h);
    L = lay;
    scene?.resize(lay, d);
  }

  async function boot() {
    try {
      const mod = await import('./scene');
      if (disposed) return;
      measure();
      const lay = L ?? computeLayout(Math.max(320, feltEl.clientWidth), Math.max(300, feltEl.clientHeight));
      const s = new mod.StageScene();
      candidate = s;
      const ok = await s.init(host, lay, dprNow());
      if (disposed || !ok) {
        s.destroy();
        return;
      }
      candidate = null;
      scene = s;
      if (L && L !== lay) s.resize(L, dprNow());
      s.sync({
        pocket: lastPocket,
        win: lastWin,
        bet: betTag,
        pendingAmount: pendingAmt,
        showPending: showPending && phase !== 'turbo' && phase !== 'spinning',
        ended: endView?.kind ?? null,
      });
    } catch (e) {
      console.warn('[GameStage] PixiJS failed to start; falling back to the simple view.', e);
      candidate?.destroy();
      candidate = null;
      scene = null;
      fallback = true;
    }
  }

  onMount(() => {
    const ro = new ResizeObserver(() => measure());
    ro.observe(feltEl);
    measure();
    window.addEventListener('resize', measure);
    void boot();
    return () => {
      disposed = true;
      gen++;
      ro.disconnect();
      window.removeEventListener('resize', measure);
      clearTimers();
      clearTimeout(turboTimer);
      clearTimeout(shakeTimer);
      resolvePending();
      candidate?.destroy();
      candidate = null;
      scene?.destroy();
      scene = null;
    };
  });

  // ——————————————————— view helpers ———————————————————

  const px = (r: Rect) => `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;

  // Simple CSS wheel (conic-gradient) if Pixi cannot start
  const cssWheel = (() => {
    const step = 360 / WHEEL_ORDER.length;
    const col = { red: '#c4161f', black: '#1b1b1f', green: '#12924a' } as const;
    return WHEEL_ORDER.map((n, i) => `${col[colorOf(n)]} ${(i - 0.5) * step}deg ${(i + 0.5) * step}deg`).join(',');
  })();
</script>

<div class="stage" class:turbo class:is-ended={endView !== null} class:compact={L?.compact}>
  <div class="rail">
    <div
      class="felt"
      class:shake={shaking}
      bind:this={feltEl}
      style={L ? `--W:${L.W};--cr:${L.chipR}px;--bar:${L.barH}px` : ''}
    >
      {#if L}
        <!-- Bet layout printed on the felt -->
        <div class="print" aria-hidden="true">
          <div class="cell zero" style={px(L.zero)}>
            <span class="zero-num" style="font-size:{clamp(L.zero.w * 0.5, 12, 26)}px">0</span>
          </div>
          <div class="cell red" style="{px(L.red)};--fs:{clamp(L.red.w * 0.07, 9.5, 16)}px">
            <i class="diamond red-d"></i>
            <span class="cell-lbl">RED</span>
            {#if !L.compact && L.red.h > 150}<span class="cell-pay">PAYS 1 : 1</span>{/if}
          </div>
          <div class="cell black" style="{px(L.black)};--fs:{clamp(L.red.w * 0.07, 9.5, 16)}px">
            <i class="diamond black-d"></i>
            <span class="cell-lbl">BLACK</span>
          </div>
          <div
            class="spot"
            style="left:{L.spot.x - L.spot.rx}px;top:{L.spot.y - L.spot.ry}px;width:{L.spot.rx * 2}px;height:{L.spot.ry * 2}px"
          ></div>
          {#if fallback}
            <div
              class="css-wheel"
              style="left:{L.cx - L.R}px;top:{L.cy - L.R}px;width:{L.R * 2}px;height:{L.R * 2}px;--g:conic-gradient({cssWheel})"
            ></div>
          {/if}
        </div>
      {/if}

      <div class="pixi" bind:this={host}></div>

      {#if L}
        <!-- Amount tags -->
        {#if betTag !== null}
          <div
            class="tag bet-tag"
            style="left:{L.red.x + L.red.w / 2}px;top:{L.red.y + L.red.h - L.plaqueH - 4}px;height:{L.plaqueH}px"
          >
            <span>BET</span>{moneyShort(betTag)}
          </div>
        {/if}
        <div class="spot-lbl" style="left:{L.spot.x}px;top:{L.spotLabelY}px">
          {#if showPending}
            <span class="dim">NEXT</span> <b>{moneyShort(pendingAmt)}</b>
          {:else}
            <span class="dim">NEXT BET</span>
          {/if}
        </div>

        <!-- Result board + round counter -->
        <div class="hud" style="top:{L.pad * 0.6}px;left:{L.pad}px;right:{L.pad}px;height:{L.barH}px">
          <div class="board" role="list" aria-label="Recent results">
            {#each board as n, i}
              <span
                role="listitem"
                class="tile {n < 0 ? 'empty' : colorOf(n)}"
                class:first={i === 0}
                style="opacity:{n < 0 ? 1 : 1 - i * 0.05}"
              >{n < 0 ? '' : n}</span>
            {/each}
          </div>
          <div class="plaque">
            <span>ROUND</span><b>{num(round)}</b>
          </div>
        </div>

        <!-- Win/loss effects -->
        {#if flash}
          {#key flash.id}
            <div
              class="flash"
              class:win={flash.win}
              style="--x:{L.red.x + L.red.w / 2}px;--y:{L.red.y + L.red.h / 2}px"
            ></div>
          {/key}
        {/if}
        {#if fx}
          {#key fx.id}
            <div
              class="float"
              class:win={fx.win}
              style="left:{L.red.x + L.red.w / 2}px;top:{Math.max(L.red.y + 4, L.betAnchor.y - L.chipR * 3.6)}px;--dur:{fx.dur}ms"
            >
              {fx.text}
            </div>
          {/key}
        {/if}
      {/if}

      {#if endView}
        <div class="end {endView.kind}" role="status">
          {#if endView.kind === 'bust' && cracks}
            <svg class="cracks" viewBox="0 0 {cracks.w} {cracks.h}" preserveAspectRatio="none" aria-hidden="true">
              <path class="c-sh" d={cracks.main} pathLength="1" />
              <path class="c-main" d={cracks.main} pathLength="1" />
              <path class="c-fine" d={cracks.fine} pathLength="1" />
            </svg>
          {/if}
          <div class="end-card">
            <div class="eyebrow">{endView.eyebrow}</div>
            <div class="title">{endView.title}</div>
            <div class="rule"></div>
            <div class="line">{endView.line1}</div>
            <div class="line dim">{endView.line2}</div>
          </div>
        </div>
      {/if}
    </div>
  </div>
  <div class="sr-only" aria-live="polite">{aria}</div>
</div>

<style>
  .stage {
    position: relative;
    box-sizing: border-box;
    width: 100%;
    isolation: isolate;
    text-align: left;
    line-height: 1.2;
    font-family: var(--font-ui, system-ui, sans-serif);
    color: var(--text, #f4ecd8);
    user-select: none;
    -webkit-user-select: none;
    /* inline-size containment: the stage never widens its parent column; height via cqw */
    container-type: inline-size;
    min-width: 0;
  }
  .stage *,
  .stage *::before,
  .stage *::after {
    box-sizing: border-box;
  }

  /* ——— Wooden rail ——— */
  .rail {
    --rail-w: clamp(8px, 1.3vw, 15px);
    position: relative;
    width: 100%;
    /* ≈16:10, at least 360px, at most 84% of the viewport height */
    height: clamp(360px, 62.5cqw, min(84vh, 860px));
    padding: var(--rail-w);
    border-radius: calc(var(--rail-w) + 14px);
    background:
      linear-gradient(180deg, rgba(255, 226, 180, 0.18) 0%, rgba(255, 226, 180, 0) 22%, rgba(0, 0, 0, 0) 65%, rgba(0, 0, 0, 0.4) 100%),
      repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.12) 0 2px, transparent 2px 9px, rgba(255, 210, 160, 0.05) 9px 11px, transparent 11px 23px),
      repeating-linear-gradient(90deg, transparent 0 57px, rgba(0, 0, 0, 0.1) 57px 60px, transparent 60px 131px),
      linear-gradient(90deg, #3a1d0e, #5b301a 14%, #4a2614 31%, #6a3a1f 50%, #4b2715 68%, #5d321b 85%, #3a1d0e);
    box-shadow:
      0 22px 48px -14px rgba(0, 0, 0, 0.85),
      0 2px 0 rgba(255, 220, 170, 0.16) inset,
      0 -3px 0 rgba(0, 0, 0, 0.45) inset,
      0 0 0 1px rgba(0, 0, 0, 0.7);
  }

  /* ——— Felt ——— */
  .felt {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: 14px;
    background:
      radial-gradient(ellipse 70% 65% at 40% 48%, rgba(60, 170, 115, 0.3), transparent 70%),
      radial-gradient(ellipse 120% 110% at 50% 45%, var(--felt, #126142) 0%, var(--felt-deep, #073a26) 100%);
    box-shadow:
      0 0 0 2px #7c561c,
      0 0 0 3px rgba(246, 217, 140, 0.55),
      0 0 0 4px rgba(0, 0, 0, 0.5),
      inset 0 0 0 1px rgba(0, 0, 0, 0.55),
      inset 0 0 90px rgba(0, 0, 0, 0.6);
  }
  .felt::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: var(--noise, none);
    background-size: 150px 150px;
    opacity: 0.4;
    mix-blend-mode: soft-light;
    pointer-events: none;
  }
  .felt::after {
    content: '';
    position: absolute;
    inset: 7px;
    border-radius: 9px;
    border: 1px dashed rgba(246, 217, 140, 0.13);
    pointer-events: none;
  }
  .felt.shake {
    animation: shake 0.7s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
  }
  @keyframes shake {
    10%,
    90% {
      transform: translate(-2px, 1px);
    }
    20%,
    80% {
      transform: translate(4px, -2px);
    }
    30%,
    50%,
    70% {
      transform: translate(-7px, 3px) rotate(-0.3deg);
    }
    40%,
    60% {
      transform: translate(7px, -3px) rotate(0.3deg);
    }
  }

  .print {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
  }
  .pixi {
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
  }

  /* ——— Printed bet boxes ——— */
  .cell {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    border: 1.5px solid rgba(232, 196, 110, 0.78);
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.1);
    box-shadow:
      inset 0 0 0 1px rgba(0, 0, 0, 0.2),
      inset 0 0 24px rgba(0, 0, 0, 0.18),
      0 1px 0 rgba(255, 240, 200, 0.06);
    font-family: var(--font-display, serif);
    color: rgba(255, 244, 214, 0.9);
    overflow: hidden;
  }
  .zero {
    justify-content: center;
    border-radius: 999px 6px 6px 999px;
    background: linear-gradient(90deg, rgba(18, 146, 74, 0.55), rgba(6, 87, 42, 0.5));
  }
  .zero-num {
    font-family: var(--font-num, sans-serif);
    font-weight: 600;
    color: #f4fff6;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  }
  .cell-lbl {
    position: relative;
    margin-top: 7%;
    font-size: var(--fs);
    font-weight: 700;
    letter-spacing: 0.2em;
    text-indent: 0.2em;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55);
  }
  .black .cell-lbl {
    margin-top: auto;
    margin-bottom: 8%;
  }
  .cell-pay {
    position: relative;
    margin-top: 2px;
    font-family: var(--font-ui, sans-serif);
    font-size: calc(var(--fs) * 0.62);
    font-weight: 700;
    letter-spacing: 0.22em;
    color: rgba(246, 217, 140, 0.55);
  }
  .diamond {
    position: absolute;
    left: 50%;
    top: 56%;
    height: 30%;
    max-height: 86px;
    aspect-ratio: 1.75;
    max-width: 52%;
    transform: translate(-50%, -50%);
    clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
    background: linear-gradient(135deg, #f8e2a0, #b8862b 50%, #f0cd73);
  }
  .diamond::after {
    content: '';
    position: absolute;
    inset: 3px 5px;
    clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
  }
  .red-d::after {
    background: radial-gradient(ellipse at 40% 35%, #e0333b, #a3121a 60%, #6e080d);
  }
  .black-d {
    top: 42%;
    height: 36%;
    max-height: 70px;
  }
  .black-d::after {
    background: radial-gradient(ellipse at 40% 35%, #3a3a42, #141417 60%, #050506);
  }

  .spot {
    position: absolute;
    border-radius: 50%;
    border: 1.5px dashed rgba(246, 217, 140, 0.6);
    background: radial-gradient(ellipse, rgba(0, 0, 0, 0.22), rgba(0, 0, 0, 0.05) 70%);
    box-shadow: 0 0 0 4px rgba(246, 217, 140, 0.06);
  }

  .css-wheel {
    position: absolute;
    border-radius: 50%;
    background:
      radial-gradient(circle, #6a3d1f 0 30%, #2a1408 30% 31%, transparent 31% 48%, #3b2213 48% 66%, #5e321a 66% 100%),
      var(--g);
    box-shadow:
      0 0 0 2px #b8862b,
      0 18px 40px rgba(0, 0, 0, 0.6);
  }

  /* ——— Tags ——— */
  .tag {
    position: absolute;
    z-index: 2;
    transform: translateX(-50%);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 9px;
    border-radius: 999px;
    background: rgba(8, 12, 10, 0.82);
    border: 1px solid rgba(214, 170, 74, 0.6);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
    font-family: var(--font-num, sans-serif);
    font-variant-numeric: tabular-nums;
    font-size: 12.5px;
    font-weight: 500;
    color: #fff3d6;
    white-space: nowrap;
    pointer-events: none;
  }
  .tag span {
    font-family: var(--font-ui, sans-serif);
    font-size: 8.5px;
    font-weight: 800;
    letter-spacing: 0.16em;
    color: var(--gold, #d6aa4a);
  }
  .compact .tag span {
    display: none;
  }
  .spot-lbl {
    position: absolute;
    z-index: 2;
    transform: translateX(-50%);
    white-space: nowrap;
    font-size: 11px;
    line-height: 1;
    letter-spacing: 0.04em;
    pointer-events: none;
  }
  .spot-lbl .dim {
    font-family: var(--font-display, serif);
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.16em;
    color: rgba(246, 217, 140, 0.7);
  }
  .spot-lbl b {
    font-family: var(--font-num, sans-serif);
    font-variant-numeric: tabular-nums;
    font-weight: 500;
    font-size: 12.5px;
    color: #fff3d6;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
  }

  /* ——— Result board ——— */
  .hud {
    position: absolute;
    z-index: 6; /* above the game-over dim so the final results stay readable */
    display: flex;
    align-items: stretch;
    gap: 8px;
    pointer-events: none;
  }
  .board,
  .plaque {
    border-radius: 10px;
    background: linear-gradient(180deg, rgba(14, 10, 6, 0.86), rgba(26, 18, 10, 0.8));
    border: 1px solid rgba(214, 170, 74, 0.5);
    box-shadow:
      inset 0 1px 0 rgba(255, 236, 190, 0.1),
      0 4px 14px rgba(0, 0, 0, 0.45);
  }
  .board {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 6px;
    overflow: hidden;
  }
  .tile {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: calc(var(--bar) - 12px);
    height: calc(var(--bar) - 12px);
    border-radius: 6px;
    font-family: var(--font-num, sans-serif);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    font-size: calc(var(--bar) * 0.42);
    line-height: 1;
    color: #fff;
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.5);
  }
  .tile.red {
    background: linear-gradient(180deg, #dc3039, #8e0f16);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2);
  }
  .tile.black {
    background: linear-gradient(180deg, #34343c, #0b0b0e);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.12),
      inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  }
  .tile.green {
    background: linear-gradient(180deg, #1cb15f, #075a2b);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
  }
  .tile.empty {
    background: rgba(255, 255, 255, 0.035);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
  }
  .tile.first {
    margin-right: 4px;
    transform: scale(1.06);
    outline: 2px solid var(--gold-bright, #f6d98c);
    outline-offset: 1px;
  }
  .tile.first.empty {
    outline-color: rgba(246, 217, 140, 0.3);
  }
  .plaque {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0 11px;
  }
  .plaque span {
    font-family: var(--font-display, serif);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.2em;
    color: var(--gold, #d6aa4a);
  }
  .plaque b {
    min-width: 2ch;
    text-align: right;
    font-family: var(--font-num, sans-serif);
    font-variant-numeric: tabular-nums;
    font-size: calc(var(--bar) * 0.46);
    font-weight: 600;
    color: var(--text, #f4ecd8);
  }
  .compact .plaque {
    padding: 0 8px;
    gap: 5px;
  }
  .compact .plaque span {
    font-size: 8.5px;
  }

  /* ——— Effects ——— */
  .flash {
    position: absolute;
    inset: 0;
    z-index: 4;
    pointer-events: none;
    opacity: 0;
    animation: flash 0.75s ease-out forwards;
  }
  .flash.win {
    background: radial-gradient(circle at var(--x) var(--y), rgba(246, 201, 90, 0.38), rgba(246, 201, 90, 0.08) 30%, transparent 55%);
  }
  .flash:not(.win) {
    background:
      radial-gradient(circle at var(--x) var(--y), rgba(255, 40, 30, 0.34), transparent 50%),
      rgba(255, 0, 0, 0.07);
    box-shadow: inset 0 0 90px rgba(255, 30, 20, 0.5);
  }
  @keyframes flash {
    0% {
      opacity: 0;
    }
    16% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
  .float {
    position: absolute;
    z-index: 4;
    transform: translate(-50%, 0);
    white-space: nowrap;
    pointer-events: none;
    font-family: var(--font-num, sans-serif);
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    font-size: clamp(17px, calc(var(--cr) * 0.95), 32px);
    letter-spacing: 0.02em;
    opacity: 0;
    animation: floatUp var(--dur, 1s) cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
  }
  .float.win {
    color: #ffe18c;
    text-shadow:
      0 0 14px rgba(246, 201, 90, 0.9),
      0 2px 0 #6b4a10,
      0 4px 10px rgba(0, 0, 0, 0.6);
  }
  .float:not(.win) {
    color: #ff7d70;
    text-shadow:
      0 0 12px rgba(255, 59, 48, 0.75),
      0 2px 0 #5a0d08,
      0 4px 10px rgba(0, 0, 0, 0.6);
  }
  @keyframes floatUp {
    0% {
      opacity: 0;
      transform: translate(-50%, 12px) scale(0.7);
    }
    14% {
      opacity: 1;
      transform: translate(-50%, 0) scale(1.14);
    }
    28% {
      transform: translate(-50%, -6px) scale(1);
    }
    75% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -52px) scale(1);
    }
  }

  /* ——— Game over ——— */
  .end {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: grid;
    place-items: center;
    pointer-events: none;
    animation: endIn 0.55s ease-out both;
  }
  .end.bust {
    background:
      radial-gradient(ellipse 60% 55% at 50% 50%, rgba(150, 0, 0, 0.32), rgba(25, 0, 0, 0.84) 80%),
      rgba(0, 0, 0, 0.3);
  }
  .end.cap {
    background: radial-gradient(ellipse 65% 60% at 50% 50%, rgba(0, 0, 0, 0.28), rgba(0, 0, 0, 0.66) 85%);
  }
  @keyframes endIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  .cracks {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .cracks path {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    animation: crack 0.5s cubic-bezier(0.3, 0.7, 0.2, 1) 0.05s forwards;
  }
  .cracks .c-sh {
    stroke: rgba(0, 0, 0, 0.55);
    stroke-width: 4;
  }
  .cracks .c-main {
    stroke: rgba(255, 235, 230, 0.78);
    stroke-width: 1.4;
  }
  .cracks .c-fine {
    stroke: rgba(255, 225, 220, 0.45);
    stroke-width: 0.9;
    animation-delay: 0.25s;
  }
  @keyframes crack {
    to {
      stroke-dashoffset: 0;
    }
  }
  .end-card {
    position: relative;
    max-width: 92%;
    padding: 14px 26px 16px;
    text-align: center;
  }
  .eyebrow {
    font-family: var(--font-display, serif);
    font-size: clamp(10px, calc(var(--W) * 0.016px), 15px);
    font-weight: 700;
    letter-spacing: 0.32em;
    text-indent: 0.32em;
    text-transform: none;
    color: rgba(255, 236, 200, 0.75);
  }
  .title {
    margin-top: 2px;
    font-family: var(--font-display, serif);
    font-weight: 900;
    line-height: 1;
    letter-spacing: 0.08em;
    text-indent: 0.08em;
    white-space: nowrap;
  }
  .bust .title {
    font-size: clamp(44px, calc(var(--W) * 0.15px), 136px);
    color: #ff4a3d;
    text-shadow:
      0 0 24px rgba(255, 40, 30, 0.85),
      0 0 70px rgba(255, 0, 0, 0.5),
      0 4px 0 #4a0505,
      0 8px 24px rgba(0, 0, 0, 0.8);
    animation: slam 0.6s cubic-bezier(0.2, 0.9, 0.25, 1.2) both;
  }
  .cap .title {
    font-size: clamp(26px, calc(var(--W) * 0.072px), 70px);
    background: linear-gradient(180deg, #fff3c4 0%, #f2cf73 40%, #b8862b 75%, #f6d98c 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    filter: drop-shadow(0 3px 0 rgba(70, 45, 8, 0.9)) drop-shadow(0 0 18px rgba(246, 201, 90, 0.45));
    animation: rise 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  @keyframes slam {
    0% {
      opacity: 0;
      transform: scale(2.4);
      filter: blur(8px);
    }
    55% {
      opacity: 1;
      transform: scale(0.94);
      filter: blur(0);
    }
    100% {
      transform: scale(1);
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(14px) scale(0.96);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  .rule {
    width: min(70%, 320px);
    height: 1px;
    margin: 12px auto 10px;
    background: linear-gradient(90deg, transparent, rgba(246, 217, 140, 0.8), transparent);
  }
  .bust .rule {
    background: linear-gradient(90deg, transparent, rgba(255, 120, 100, 0.85), transparent);
  }
  .line {
    font-family: var(--font-num, sans-serif);
    font-variant-numeric: tabular-nums;
    font-size: clamp(12px, calc(var(--W) * 0.019px), 17px);
    letter-spacing: 0.02em;
    color: #fff3df;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
  }
  .line.dim {
    margin-top: 3px;
    font-size: clamp(11px, calc(var(--W) * 0.016px), 14px);
    color: rgba(255, 236, 210, 0.66);
  }

  /* Turbo: plain, no animation */
  .turbo .tile.first {
    transform: none;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .felt.shake {
      animation: none;
    }
    .float {
      animation-name: floatFade;
    }
    .cracks path {
      animation-duration: 0.01s;
    }
    .bust .title,
    .cap .title {
      animation: endIn 0.3s ease-out both;
    }
    @keyframes floatFade {
      0%,
      100% {
        opacity: 0;
      }
      20%,
      70% {
        opacity: 1;
      }
    }
  }
</style>
