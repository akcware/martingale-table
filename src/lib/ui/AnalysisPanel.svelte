<script lang="ts">
  import type { SimController } from '../sim/controller.svelte';
  import { money, num, oneIn, ordinal, percent } from '../engine/format';

  let { sim }: { sim: SimController } = $props();
  const t = $derived(sim.theory);
  const mc = $derived(sim.mc);
</script>

<section class="panel analysis">
  <h2 class="panel-title">The math</h2>

  {#if !t}
    <p class="hint">Enter valid settings.</p>
  {:else}
    <div class="big">
      <span class="label">Straight losses to bust</span>
      <span class="value num">{t.maxLossStreak}</span>
    </div>
    <dl class="rows">
      <dt>Largest stake you can cover</dt>
      <dd class="num">{money(t.maxStake)}</dd>
      <dt>{ordinal(t.maxLossStreak + 1)} stake (can't cover)</dt>
      <dd class="num loss-text">{money(t.firstUncoveredStake)}</dd>
      <dt>Bust risk per cycle</dt>
      <dd class="num">{oneIn(t.cycleBustProb)}</dd>
      <dt>Profit per winning cycle</dt>
      <dd class="num win-text">+{money(sim.config.baseBet)}</dd>
      <dt>Rough formula (fixed limit)</dt>
      <dd class="num">≈ {Number.isFinite(t.expectedBustRoundApprox) ? num(t.expectedBustRoundApprox) : '∞'} rounds</dd>
    </dl>

    <h3 class="sub">
      Monte Carlo
      {#if sim.mcBusy}<span class="spinner" aria-label="calculating"></span>{/if}
    </h3>
    {#if mc}
      <div class="mc" class:stale={sim.mcBusy}>
        <div class="big">
          <span class="label">Median bust round</span>
          <span class="value num">{mc.busted ? num(mc.median) : '—'}</span>
        </div>
        <dl class="rows">
          <dt>Mean</dt>
          <dd class="num">{mc.busted ? num(mc.mean) : '—'}</dd>
          <dt>10th – 90th percentile</dt>
          <dd class="num">{mc.busted ? `${num(mc.p10)} – ${num(mc.p90)}` : '—'}</dd>
          <dt>Shortest / longest</dt>
          <dd class="num">{mc.busted ? `${num(mc.min)} / ${num(mc.max)}` : '—'}</dd>
          <dt>Average peak profit</dt>
          <dd class="num win-text">+{money(Math.round(mc.meanPeakProfit))}</dd>
          <dt>Busted without ever profiting</dt>
          <dd class="num">{percent(mc.neverProfitRatio)}%</dd>
          {#if mc.capped > 0}
            <dt>Survived to the round limit</dt>
            <dd class="num">{num(mc.capped)} / {num(mc.sims)}</dd>
          {/if}
        </dl>
        <p class="hint">
          {num(mc.sims)} independent games{mc.truncated ? ' (time-limited)' : ''} · up to {num(mc.perSimCap)} rounds each
        </p>
      </div>
    {:else if sim.mcBusy}
      <p class="hint">Simulating…</p>
    {/if}
  {/if}
</section>

<style>
  .big {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--panel-border, rgba(212, 175, 55, 0.2));
    margin-bottom: 10px;
  }
  .big .label {
    font-size: 0.78rem;
    color: var(--text-dim, #bfb59c);
  }
  .big .value {
    font-size: 1.6rem;
    font-weight: 700;
    color: var(--gold-bright, #f5d76e);
  }
  .rows {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 6px 12px;
    margin: 0 0 6px;
    font-size: 0.86rem;
  }
  dt {
    color: var(--text-dim, #bfb59c);
  }
  dd {
    margin: 0;
    text-align: right;
  }
  .sub {
    margin: 16px 0 10px;
    font-size: 0.78rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--gold, #d4af37);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .mc.stale {
    opacity: 0.5;
  }
  .spinner {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid var(--gold, #d4af37);
    border-right-color: transparent;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .hint {
    margin: 6px 0 0;
  }
</style>
