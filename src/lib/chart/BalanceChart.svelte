<script lang="ts">
  /**
   * Balance chart — Canvas2D (devicePixelRatio aware).
   * Redrawn at most once per animation frame whenever `version` (or any other prop)
   * changes. The min/max band becomes visible once buckets span many rounds.
   */
  import { onMount } from 'svelte';
  import type { SeriesBuffer } from '../engine/series';
  import type { ChartMarker, ChartEndMarker } from './types';
  import { moneyShort, num } from '../engine/format';
  import { ticks, nearestIndex } from './scale';

  interface Props {
    series: SeriesBuffer;
    /** Increments whenever the data changes — redraw trigger */
    version: number;
    /** Major currency units (e.g. dollars) */
    startBalance: number;
    /** Highest balance point (max win) */
    peak: ChartMarker | null;
    /** Point where the game ended */
    end: ChartEndMarker | null;
  }
  let { series, version, startBalance, peak, end }: Props = $props();

  // Theme colours (same tones as the CSS variables; kept constant for the canvas)
  const C = {
    grid: 'rgba(244, 236, 216, 0.055)',
    axis: 'rgba(244, 236, 216, 0.16)',
    tick: '#9a8f77',
    base: 'rgba(244, 236, 216, 0.55)',
    baseText: 'rgba(244, 236, 216, 0.62)',
    profit: '#f0cb6c',
    profitFillTop: 'rgba(214, 170, 74, 0.40)',
    profitFillBot: 'rgba(214, 170, 74, 0.03)',
    loss: '#ff6a5c',
    lossFillTop: 'rgba(255, 91, 91, 0.03)',
    lossFillBot: 'rgba(255, 91, 91, 0.34)',
    band: 'rgba(246, 217, 140, 0.17)',
    bandEdge: 'rgba(246, 217, 140, 0.30)',
    gold: '#f6d98c',
    goldDeep: '#b8882e',
    red: '#ff5b5b',
    neutral: '#c3b79c',
    pillBg: 'rgba(9, 15, 12, 0.94)',
    text: '#f4ecd8',
    dim: '#8a8170',
  };
  const F_TICK = "500 12px 'Barlow Condensed', 'Roboto Condensed', 'Arial Narrow', sans-serif";
  const F_LABEL = '700 11.5px Manrope, system-ui, -apple-system, sans-serif';
  const F_EMPTY = '500 13px Manrope, system-ui, -apple-system, sans-serif';

  let root: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let cw = 0;
  let ch = 0;
  let dpr = 1;
  let raf = 0;
  let disposed = false;
  let hoverX: number | null = null;
  let lastAria = 0;

  // Geometry of the last draw (for pointer inspection)
  let geo = { L: 0, T: 0, W: 0, H: 0, xMax: 1, lo: 0, hi: 1 };

  function schedule() {
    if (raf || disposed) return;
    raf = requestAnimationFrame(draw);
  }

  // Redraw when data / markers change (at most once per frame)
  $effect(() => {
    void version;
    void startBalance;
    void peak;
    void end;
    void series;
    schedule();
  });

  onMount(() => {
    ctx = canvas.getContext('2d');
    const ro = new ResizeObserver(() => resize());
    ro.observe(root);
    resize();
    const fonts = document.fonts;
    const onFonts = () => schedule();
    fonts?.ready.then(onFonts).catch(() => {});
    fonts?.addEventListener?.('loadingdone', onFonts);
    const onWin = () => resize();
    window.addEventListener('resize', onWin);
    return () => {
      disposed = true;
      ro.disconnect();
      fonts?.removeEventListener?.('loadingdone', onFonts);
      window.removeEventListener('resize', onWin);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
  });

  function resize() {
    if (!root || !canvas) return;
    const r = root.getBoundingClientRect();
    const w = Math.max(0, Math.round(r.width));
    const h = Math.max(0, Math.round(r.height));
    const d = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    if (w === cw && h === ch && d === dpr) return;
    cw = w;
    ch = h;
    dpr = d;
    canvas.width = Math.max(1, Math.round(w * d));
    canvas.height = Math.max(1, Math.round(h * d));
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    draw();
  }

  /** Major-unit value → axis label (moneyShort takes minor units). Whole values drop ".00". */
  function moneyTick(major: number, dropCents: boolean): string {
    const s = moneyShort(Math.round(major * 100));
    // Locale-agnostic: removes a trailing ".00" or ",00" decimal part only
    return dropCents ? s.replace(/[.,]00(?=\D*$)/, '') : s;
  }

  function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    const k = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + k, y);
    c.arcTo(x + w, y, x + w, y + h, k);
    c.arcTo(x + w, y + h, x, y + h, k);
    c.arcTo(x, y + h, x, y, k);
    c.arcTo(x, y, x + w, y, k);
    c.closePath();
  }

  interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
  }
  const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  function draw() {
    raf = 0;
    const c = ctx;
    if (!c || cw < 20 || ch < 20) return;
    const v = series.view();
    const s0 = Number.isFinite(startBalance) ? startBalance : 0;

    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, cw, ch);

    // ——— Domain / scale ———
    let lo = s0;
    let hi = s0;
    for (let i = 0; i < v.n; i++) {
      const a = v.min[i];
      const b = v.max[i];
      if (a < lo) lo = a;
      if (b > hi) hi = b;
    }
    if (peak && Number.isFinite(peak.value)) {
      lo = Math.min(lo, peak.value);
      hi = Math.max(hi, peak.value);
    }
    if (end && Number.isFinite(end.value)) {
      lo = Math.min(lo, end.value);
      hi = Math.max(hi, end.value);
    }
    let span = hi - lo;
    if (!(span > 1e-9)) {
      const p = Math.max(Math.abs(s0) * 0.05, 1);
      lo -= p;
      hi += p;
    } else {
      lo -= span * 0.08;
      hi += span * 0.16; // headroom for the peak label
    }
    span = hi - lo;

    let xMax = Math.max(v.lastRound, 10);
    if (peak) xMax = Math.max(xMax, peak.round);
    if (end) xMax = Math.max(xMax, end.round);

    const T = 12;
    const B = 24;
    const R = 14;
    const plotH = Math.max(10, ch - T - B);

    const yTicks = ticks(lo, hi, Math.max(3, Math.min(7, Math.floor(plotH / 46))));
    const allInt = yTicks.every((t) => Math.abs(t - Math.round(t)) < 1e-9);
    const yLabels = yTicks.map((t) => moneyTick(t, allInt));
    c.font = F_TICK;
    let lw = 0;
    for (const s of yLabels) lw = Math.max(lw, c.measureText(s).width);
    const L = Math.ceil(lw) + 16;
    const plotW = Math.max(10, cw - L - R);

    const xOf = (r: number) => L + (r / xMax) * plotW;
    const yOf = (val: number) => T + ((hi - val) / span) * plotH;
    geo = { L, T, W: plotW, H: plotH, xMax, lo, hi };

    // ——— Grid + axis labels ———
    c.lineWidth = 1;
    c.strokeStyle = C.grid;
    c.fillStyle = C.tick;
    c.textAlign = 'right';
    c.textBaseline = 'middle';
    for (let i = 0; i < yTicks.length; i++) {
      const y = Math.round(yOf(yTicks[i])) + 0.5;
      c.beginPath();
      c.moveTo(L, y);
      c.lineTo(L + plotW, y);
      c.stroke();
      c.fillText(yLabels[i], L - 8, y);
    }
    const xTicks = ticks(0, xMax, Math.max(2, Math.min(9, Math.floor(plotW / 92))), true);
    c.textBaseline = 'top';
    for (const t of xTicks) {
      const x = Math.round(xOf(t)) + 0.5;
      c.strokeStyle = C.grid;
      c.beginPath();
      c.moveTo(x, T);
      c.lineTo(x, T + plotH);
      c.stroke();
      const s = num(t);
      const w = c.measureText(s).width;
      const tx = Math.min(Math.max(x, L + w / 2), L + plotW - w / 2);
      c.textAlign = 'center';
      c.fillText(s, tx, T + plotH + 7);
    }
    // bottom axis line
    c.strokeStyle = C.axis;
    c.beginPath();
    c.moveTo(L, Math.round(T + plotH) + 0.5);
    c.lineTo(L + plotW, Math.round(T + plotH) + 0.5);
    c.stroke();

    const baseY = Math.min(T + plotH, Math.max(T, yOf(s0)));

    if (v.n >= 2) {
      // ——— min/max band ———
      let banded = v.bucketSize > 1;
      if (!banded) {
        for (let i = 0; i < v.n; i++) {
          if (v.max[i] - v.min[i] > 1e-9) {
            banded = true;
            break;
          }
        }
      }
      if (banded) {
        const band = new Path2D();
        band.moveTo(xOf(v.x[0]), yOf(v.max[0]));
        for (let i = 1; i < v.n; i++) band.lineTo(xOf(v.x[i]), yOf(v.max[i]));
        for (let i = v.n - 1; i >= 0; i--) band.lineTo(xOf(v.x[i]), yOf(v.min[i]));
        band.closePath();
        c.fillStyle = C.band;
        c.fill(band);
      }

      // ——— last-value line + profit/loss area ———
      const line = new Path2D();
      line.moveTo(xOf(v.x[0]), yOf(v.last[0]));
      for (let i = 1; i < v.n; i++) line.lineTo(xOf(v.x[i]), yOf(v.last[i]));
      const area = new Path2D();
      area.moveTo(xOf(v.x[0]), baseY);
      for (let i = 0; i < v.n; i++) area.lineTo(xOf(v.x[i]), yOf(v.last[i]));
      area.lineTo(xOf(v.x[v.n - 1]), baseY);
      area.closePath();

      // Above the start line (profit)
      c.save();
      c.beginPath();
      c.rect(L, T - 4, plotW, baseY - T + 4);
      c.clip();
      let g = c.createLinearGradient(0, T, 0, baseY);
      g.addColorStop(0, C.profitFillTop);
      g.addColorStop(1, C.profitFillBot);
      c.fillStyle = g;
      c.fill(area);
      c.strokeStyle = C.profit;
      c.lineWidth = 1.75;
      c.lineJoin = 'round';
      c.lineCap = 'round';
      c.stroke(line);
      c.restore();

      // Below the start line (loss)
      c.save();
      c.beginPath();
      c.rect(L, baseY, plotW, T + plotH - baseY + 4);
      c.clip();
      g = c.createLinearGradient(0, baseY, 0, T + plotH);
      g.addColorStop(0, C.lossFillTop);
      g.addColorStop(1, C.lossFillBot);
      c.fillStyle = g;
      c.fill(area);
      c.strokeStyle = C.loss;
      c.lineWidth = 1.75;
      c.lineJoin = 'round';
      c.lineCap = 'round';
      c.stroke(line);
      c.restore();
    }

    // ——— Start balance line (dashed) ———
    c.save();
    c.setLineDash([5, 5]);
    c.strokeStyle = C.base;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(L, Math.round(baseY) + 0.5);
    c.lineTo(L + plotW, Math.round(baseY) + 0.5);
    c.stroke();
    c.restore();
    c.font = F_TICK;
    c.fillStyle = C.baseText;
    c.textAlign = 'left';
    const baseLabel = 'Start ' + moneyShort(Math.round(s0 * 100));
    const blY = baseY - 6 < T + 12 ? baseY + 5 : baseY - 6;
    c.textBaseline = baseY - 6 < T + 12 ? 'top' : 'bottom';
    c.fillText(baseLabel, L + 6, blY);

    // ——— Latest point ———
    if (v.n >= 2) {
      const lx = xOf(v.x[v.n - 1]);
      const lvy = v.last[v.n - 1];
      const ly = yOf(lvy);
      const col = lvy >= s0 ? C.profit : C.loss;
      c.beginPath();
      c.arc(lx, ly, 6, 0, Math.PI * 2);
      c.fillStyle = lvy >= s0 ? 'rgba(240,203,108,0.18)' : 'rgba(255,106,92,0.18)';
      c.fill();
      c.beginPath();
      c.arc(lx, ly, 3, 0, Math.PI * 2);
      c.fillStyle = col;
      c.fill();
    }

    // ——— Markers ———
    const placed: Rect[] = [];

    const pill = (text: string, ax: number, ay: number, prefer: 'up' | 'down', align: 'center' | 'left', stroke: string, color: string): Rect => {
      c.font = F_LABEL;
      const w = Math.ceil(c.measureText(text).width) + 16;
      const h = 21;
      let x = align === 'center' ? ax - w / 2 : ax - w + 10;
      x = Math.min(Math.max(x, L + 2), L + plotW - w - 2);
      const up = ay - 11 - h;
      const down = ay + 11;
      const fits = (y: number) => y >= 1 && y + h <= T + plotH - 1;
      let y = prefer === 'up' ? up : down;
      if (!fits(y)) y = prefer === 'up' ? down : up;
      let r: Rect = { x, y, w, h };
      if (placed.some((p) => hit(p, r))) {
        const alt = { x, y: y === up ? down : up, w, h };
        if (fits(alt.y) && !placed.some((p) => hit(p, alt))) r = alt;
        else {
          // still overlapping: shift down
          for (const p of placed) if (hit(p, r)) r = { ...r, y: p.y + p.h + 4 };
        }
      }
      r.y = Math.min(Math.max(r.y, 1), ch - h - 1);
      // leader line
      c.strokeStyle = stroke;
      c.globalAlpha = 0.55;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(ax, ay);
      c.lineTo(Math.min(Math.max(ax, r.x + 6), r.x + r.w - 6), r.y + (r.y > ay ? 0 : r.h));
      c.stroke();
      c.globalAlpha = 1;
      rr(c, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 10);
      c.fillStyle = C.pillBg;
      c.fill();
      c.strokeStyle = stroke;
      c.stroke();
      c.fillStyle = color;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(text, r.x + r.w / 2, r.y + r.h / 2 + 0.5);
      placed.push(r);
      return r;
    };

    // End line first (so labels stay on top)
    let endPt: { x: number; y: number } | null = null;
    if (end && Number.isFinite(end.value)) {
      const ex = xOf(end.round);
      const ey = yOf(end.value);
      endPt = { x: ex, y: ey };
      c.save();
      c.setLineDash([3, 4]);
      c.strokeStyle = end.reason === 'bust' ? 'rgba(255,91,91,0.55)' : 'rgba(195,183,156,0.45)';
      c.beginPath();
      c.moveTo(Math.round(ex) + 0.5, T);
      c.lineTo(Math.round(ex) + 0.5, T + plotH);
      c.stroke();
      c.restore();
    }

    if (peak && peak.value > s0 + 1e-9) {
      const px = xOf(peak.round);
      const py = yOf(peak.value);
      c.beginPath();
      c.arc(px, py, 8, 0, Math.PI * 2);
      c.fillStyle = 'rgba(246,217,140,0.18)';
      c.fill();
      c.beginPath();
      c.arc(px, py, 4.5, 0, Math.PI * 2);
      c.fillStyle = C.gold;
      c.fill();
      c.lineWidth = 1.5;
      c.strokeStyle = C.goldDeep;
      c.stroke();
      const gain = Math.round((peak.value - s0) * 100);
      pill(`Max win: +${moneyShort(gain)} · round ${num(peak.round)}`, px, py, 'up', 'center', C.goldDeep, C.gold);
    }

    if (end && endPt) {
      const { x: ex, y: ey } = endPt;
      const bust = end.reason === 'bust';
      const col = bust ? C.red : C.neutral;
      c.beginPath();
      c.arc(ex, ey, 8, 0, Math.PI * 2);
      c.fillStyle = bust ? 'rgba(255,91,91,0.2)' : 'rgba(195,183,156,0.16)';
      c.fill();
      c.beginPath();
      c.arc(ex, ey, 4.5, 0, Math.PI * 2);
      c.fillStyle = bust ? C.red : '#0d1511';
      c.fill();
      c.lineWidth = 1.5;
      c.strokeStyle = bust ? '#ffd2cc' : C.neutral;
      c.stroke();
      if (bust) {
        c.strokeStyle = '#2a0707';
        c.lineWidth = 1.4;
        c.beginPath();
        c.moveTo(ex - 2.2, ey - 2.2);
        c.lineTo(ex + 2.2, ey + 2.2);
        c.moveTo(ex + 2.2, ey - 2.2);
        c.lineTo(ex - 2.2, ey + 2.2);
        c.stroke();
      }
      const text = `${bust ? 'Bust' : 'Limit'} · round ${num(end.round)}`;
      pill(text, ex, ey, ey > T + plotH * 0.5 ? 'up' : 'down', 'left', bust ? 'rgba(255,91,91,0.75)' : 'rgba(195,183,156,0.6)', col);
    }

    // ——— Empty state ———
    if (v.n <= 1 && !end) {
      c.font = F_EMPTY;
      c.fillStyle = C.dim;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('The balance curve appears here once the game starts', L + plotW / 2, T + plotH * 0.3);
    }

    // ——— Pointer inspection ———
    if (hoverX !== null && v.n >= 2) {
      const r = ((hoverX - L) / plotW) * xMax;
      const i = nearestIndex(v.x, r);
      if (i >= 0) {
        const hx = xOf(v.x[i]);
        const hy = yOf(v.last[i]);
        c.strokeStyle = 'rgba(244,236,216,0.28)';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(Math.round(hx) + 0.5, T);
        c.lineTo(Math.round(hx) + 0.5, T + plotH);
        c.stroke();
        c.beginPath();
        c.arc(hx, hy, 3.5, 0, Math.PI * 2);
        c.fillStyle = C.text;
        c.fill();
        let txt = `Round ${num(v.x[i])} · ${moneyShort(Math.round(v.last[i] * 100))}`;
        if (v.bucketSize > 1 && v.max[i] - v.min[i] > 1e-9) {
          txt += `  (${moneyShort(Math.round(v.min[i] * 100))} – ${moneyShort(Math.round(v.max[i] * 100))})`;
        }
        c.font = F_LABEL;
        const w = Math.ceil(c.measureText(txt).width) + 16;
        const x = Math.min(Math.max(hx - w / 2, L + 2), L + plotW - w - 2);
        const y = T + 2;
        rr(c, x + 0.5, y + 0.5, w - 1, 20, 10);
        c.fillStyle = C.pillBg;
        c.fill();
        c.strokeStyle = 'rgba(244,236,216,0.25)';
        c.stroke();
        c.fillStyle = C.text;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(txt, x + w / 2, y + 10.5);
      }
    }

    // Screen-reader summary (updated sparingly)
    const now = performance.now();
    if (now - lastAria > 600 || end) {
      lastAria = now;
      const lastVal = v.n ? v.last[v.n - 1] : s0;
      root.setAttribute(
        'aria-label',
        `Balance chart: ${num(v.lastRound)} rounds, current balance ${moneyShort(Math.round(lastVal * 100))}, start ${moneyShort(Math.round(s0 * 100))}` +
          (end ? `, ${end.reason === 'bust' ? 'bust' : 'round limit'} at round ${num(end.round)}` : ''),
      );
    }
  }

  function onMove(e: PointerEvent) {
    const r = root.getBoundingClientRect();
    const x = e.clientX - r.left;
    hoverX = x >= geo.L && x <= geo.L + geo.W ? x : null;
    schedule();
  }
  function onLeave() {
    hoverX = null;
    schedule();
  }
</script>

<div class="chart-box">
  <div class="chart" bind:this={root} onpointermove={onMove} onpointerleave={onLeave} role="img" aria-label="Balance chart">
    <canvas bind:this={canvas} aria-hidden="true"></canvas>
  </div>
</div>

<style>
  /* inline-size containment: content cannot widen the parent column; height follows width */
  .chart-box {
    container-type: inline-size;
    width: 100%;
    min-width: 0;
  }
  .chart {
    position: relative;
    box-sizing: border-box;
    width: 100%;
    height: clamp(220px, 30cqw, 280px);
    line-height: 1;
    text-align: left;
    touch-action: pan-y;
  }
  canvas {
    position: absolute;
    inset: 0;
    display: block;
  }
</style>
