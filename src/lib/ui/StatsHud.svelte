<script lang="ts">
  import type { SimController } from '../sim/controller.svelte';
  import { money, moneySigned, num } from '../engine/format';

  let { sim }: { sim: SimController } = $props();

  const start = $derived(sim.stats?.startBalance ?? sim.config.startBalance);
  const net = $derived(sim.displayBalance - start);
  const peakProfit = $derived(sim.stats ? sim.stats.peakBalance - sim.stats.startBalance : 0);
  const streak = $derived(sim.stats?.lossStreak ?? 0);
  const left = $derived(sim.survivableLosses);
  const total = $derived(streak + left);
  const danger = $derived(total > 0 ? streak / total : 0);
</script>

<div class="hud">
  <div class="cell main">
    <span class="k">Balance</span>
    <span class="v num">{money(sim.displayBalance)}</span>
    <span class="s num" class:win-text={net > 0} class:loss-text={net < 0}>{moneySigned(net)}</span>
  </div>
  <div class="cell">
    <span class="k">Round</span>
    <span class="v num">{num(sim.onTable?.round ?? sim.stats?.round ?? 0)}</span>
    <span class="s">{sim.phase === 'finished' ? (sim.stats?.ended === 'bust' ? 'busted' : 'limit reached') : sim.onTable ? 'ball is spinning' : ' '}</span>
  </div>
  <div class="cell">
    <span class="k">{sim.onTable ? 'Stake on table' : 'Next stake'}</span>
    <span class="v num gold-text">{money(sim.nextBet)}</span>
    <span class="s">on red · pays 2×</span>
  </div>
  <div class="cell">
    <span class="k">Peak profit</span>
    <span class="v num win-text">{peakProfit > 0 ? '+' + money(peakProfit) : '—'}</span>
    <span class="s num">{peakProfit > 0 ? `round ${num(sim.stats!.peakRound)}` : 'none yet'}</span>
  </div>
  <div class="cell streak" class:hot={danger >= 0.6} class:critical={left <= 1 && sim.stats != null && sim.phase !== 'setup'}>
    <span class="k">Loss streak</span>
    <span class="v num">{streak}<small> / {total}</small></span>
    <div class="meter" aria-hidden="true">
      {#each Array(Math.min(total, 24)) as _, i (i)}
        <span class="pip" class:on={i < streak}></span>
      {/each}
    </div>
    <span class="s">
      {#if sim.stats?.ended === 'bust'}busted
      {:else if left <= 1 && sim.stats}next loss = bust
      {:else}{left} losses to bust{/if}
    </span>
  </div>
</div>

<style>
  .hud {
    display: grid;
    grid-template-columns: 1.4fr repeat(4, 1fr);
    gap: 10px;
  }
  .cell {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
    align-content: start;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--panel, rgba(10, 20, 15, 0.85));
    border: 1px solid var(--panel-border, rgba(212, 175, 55, 0.25));
    min-width: 0;
  }
  .k {
    font-size: 0.7rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-dim, #bfb59c);
    white-space: nowrap;
  }
  .v {
    font-size: 1.15rem;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .main .v {
    font-size: 1.55rem;
    color: var(--gold-bright, #f5d76e);
  }
  .s {
    font-size: 0.75rem;
    color: var(--text-faint, #8a8270);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  small {
    font-size: 0.75rem;
    color: var(--text-faint, #8a8270);
  }
  .meter {
    display: flex;
    gap: 2px;
    margin: 3px 0 1px;
  }
  .pip {
    flex: 1;
    height: 5px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.1);
  }
  .pip.on {
    background: var(--loss, #ff4d4d);
  }
  .streak.hot .v {
    color: var(--loss, #ff4d4d);
  }
  .streak.critical {
    border-color: var(--loss, #ff4d4d);
    animation: pulse 0.9s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      box-shadow: 0 0 18px color-mix(in srgb, var(--loss, #ff4d4d) 55%, transparent);
    }
  }
  @media (max-width: 900px) {
    .hud {
      grid-template-columns: repeat(2, 1fr);
    }
    .main {
      grid-column: span 2;
    }
  }
</style>
