<script lang="ts">
  import { untrack } from 'svelte';
  import { SimController } from './lib/sim/controller.svelte';
  import GameStage from './lib/stage/GameStage.svelte';
  import BalanceChart from './lib/chart/BalanceChart.svelte';
  import SetupPanel from './lib/ui/SetupPanel.svelte';
  import AnalysisPanel from './lib/ui/AnalysisPanel.svelte';
  import StatsHud from './lib/ui/StatsHud.svelte';
  import TransportBar from './lib/ui/TransportBar.svelte';
  import HistoryPanel from './lib/ui/HistoryPanel.svelte';
  import SummaryModal from './lib/ui/SummaryModal.svelte';
  import type { StageApi } from './lib/stage/types';
  import { percent } from './lib/engine/format';

  const sim = new SimController();

  let stage = $state<StageApi>();
  $effect(() => {
    sim.stage = stage ?? null;
  });

  // Re-run the Monte Carlo analysis when settings change (seed excluded)
  $effect(() => {
    const c = sim.config;
    void [c.rtp, c.startBalance, c.baseBet, c.maxRounds];
    untrack(() => sim.scheduleMonteCarlo());
  });

  const startUsd = $derived((sim.stats?.startBalance ?? sim.config.startBalance) / 100);
  const peak = $derived(
    sim.stats && sim.stats.peakRound > 0 ? { round: sim.stats.peakRound, value: sim.stats.peakBalance / 100 } : null,
  );
  const end = $derived(
    sim.stats?.ended ? { round: sim.stats.round, value: sim.stats.balance / 100, reason: sim.stats.ended } : null,
  );
</script>

<div class="shell">
  <header class="topbar">
    <div class="brand">
      <span class="logo" aria-hidden="true"></span>
      <div>
        <h1>Martingale Table</h1>
        <p>Double after a loss · reset after a win · when do you go bust?</p>
      </div>
    </div>
    <div class="badges">
      <span class="badge">RTP <b class="num">{percent(sim.config.rtp / 100)}%</b></span>
      <span class="badge">Bet <b>RED</b> · 2×</span>
      <span class="badge">Seed <b class="num">{sim.config.seed}</b></span>
    </div>
  </header>

  <main class="layout">
    <aside class="left">
      <SetupPanel {sim} />
      <AnalysisPanel {sim} />
    </aside>

    <section class="center">
      <StatsHud {sim} />
      <div class="stage-wrap">
        <GameStage bind:this={stage} nextBet={sim.nextBet} />
      </div>
      <TransportBar {sim} />
      <div class="panel chart-panel">
        <h2 class="panel-title">Balance over time</h2>
        <BalanceChart series={sim.series} version={sim.seriesVersion} startBalance={startUsd} {peak} {end} />
      </div>
    </section>

    <aside class="right">
      <HistoryPanel {sim} />
    </aside>
  </main>

  <footer class="foot">
    Educational simulation — no real money involved. No betting system can beat the house edge of a negative-expectation game.
  </footer>
</div>

{#if sim.showSummary && sim.stats}
  <SummaryModal {sim} />
{/if}

<style>
  .shell {
    max-width: 1680px;
    margin: 0 auto;
    padding: 14px 18px 24px;
  }
  .topbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .logo {
    width: 42px;
    height: 42px;
    border-radius: 50%;
    background:
      radial-gradient(circle at 50% 50%, var(--gold-bright, #f5d76e) 0 18%, transparent 19%),
      repeating-conic-gradient(#c8102e 0 10deg, #151515 10deg 20deg);
    border: 3px solid var(--gold, #d4af37);
    box-shadow: 0 0 18px rgba(212, 175, 55, 0.35);
  }
  h1 {
    margin: 0;
    font-family: var(--font-display, serif);
    font-size: 1.6rem;
    letter-spacing: 0.04em;
    color: var(--gold-bright, #f5d76e);
  }
  .brand p {
    margin: 2px 0 0;
    font-size: 0.85rem;
    color: var(--text-dim, #bfb59c);
  }
  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .badge {
    font-size: 0.78rem;
    padding: 5px 10px;
    border-radius: 999px;
    border: 1px solid var(--panel-border, rgba(212, 175, 55, 0.3));
    background: rgba(0, 0, 0, 0.3);
    color: var(--text-dim, #bfb59c);
  }
  .badge b {
    color: var(--text, #f3ead7);
  }
  .layout {
    display: grid;
    grid-template-columns: 300px minmax(0, 1fr) 340px;
    gap: 14px;
    align-items: start;
  }
  .left,
  .center {
    display: grid;
    gap: 14px;
    min-width: 0;
  }
  .right {
    position: sticky;
    top: 14px;
    height: calc(100vh - 28px);
    min-height: 420px;
    display: flex;
  }
  .right :global(.history) {
    flex: 1;
  }
  .stage-wrap {
    min-width: 0;
  }
  .chart-panel {
    padding-bottom: 12px;
  }
  .foot {
    margin-top: 18px;
    text-align: center;
    font-size: 0.75rem;
    color: var(--text-faint, #8a8270);
  }
  @media (max-width: 1280px) {
    .layout {
      grid-template-columns: 280px minmax(0, 1fr);
    }
    .right {
      grid-column: 1 / -1;
      position: static;
      height: 420px;
    }
  }
  @media (max-width: 860px) {
    .shell {
      padding: 10px 12px 20px;
    }
    .layout {
      grid-template-columns: 1fr;
    }
    .center {
      order: -1;
    }
  }
</style>
