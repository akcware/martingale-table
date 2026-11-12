<script lang="ts">
  import { fly } from 'svelte/transition';
  import type { SimController } from '../sim/controller.svelte';
  import { money, moneySigned, num } from '../engine/format';
  import { colorOf, pocketFor } from '../stage/types';

  let { sim }: { sim: SimController } = $props();
  const animate = $derived(sim.speed.kind === 'anim' && !sim.skipping);
</script>

<section class="panel history">
  <h2 class="panel-title">Round history</h2>
  <div class="head row">
    <span>Round</span><span>Result</span><span class="r">Stake</span><span class="r">Net</span><span class="r">Balance</span>
  </div>
  <div class="list">
    {#if sim.history.length === 0}
      <p class="hint empty">No rounds played yet.</p>
    {/if}
    {#each sim.history as r (r.round)}
      {@const n = pocketFor(r)}
      <div
        class="row"
        class:win={r.win}
        class:peak={r.isNewPeak}
        class:end={r.ended}
        in:fly={{ y: -10, duration: animate ? 220 : 0 }}
      >
        <span class="num dim">{num(r.round)}</span>
        <span class="res">
          <span class="ball {colorOf(n)}">{n}</span>
          <span class="tag">{r.win ? 'W' : 'L'}</span>
          {#if r.isNewPeak}<span class="star" title="New peak">★</span>{/if}
        </span>
        <span class="num r">{money(r.bet)}</span>
        <span class="num r" class:win-text={r.win} class:loss-text={!r.win}>{moneySigned(r.net)}</span>
        <span class="num r">{money(r.balanceAfter)}</span>
      </div>
    {/each}
  </div>
</section>

<style>
  .history {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .list {
    overflow-y: auto;
    overflow-x: hidden;
    flex: 1;
    min-height: 0;
    margin: 0 -6px;
    padding: 0 6px;
  }
  .row {
    display: grid;
    grid-template-columns: 0.8fr 1fr 1.1fr 1.1fr 1.3fr;
    gap: 6px;
    align-items: center;
    padding: 5px 4px;
    font-size: 0.8rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }
  .head {
    font-size: 0.66rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-faint, #8a8270);
    border-bottom: 1px solid var(--panel-border, rgba(212, 175, 55, 0.25));
  }
  .r {
    text-align: right;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dim {
    color: var(--text-faint, #8a8270);
  }
  .res {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .ball {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    font-size: 0.68rem;
    font-weight: 700;
    color: #fff;
    box-shadow: inset 0 -2px 3px rgba(0, 0, 0, 0.4);
  }
  .ball.red {
    background: #c8102e;
  }
  .ball.black {
    background: #151515;
    border: 1px solid rgba(255, 255, 255, 0.2);
  }
  .ball.green {
    background: var(--zero, #0a8f3c);
  }
  .tag {
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--text-faint, #8a8270);
  }
  .win .tag {
    color: var(--win, #3ddc84);
  }
  .star {
    color: var(--gold-bright, #f5d76e);
  }
  .row.peak {
    background: linear-gradient(90deg, rgba(212, 175, 55, 0.12), transparent);
  }
  .row.end {
    background: linear-gradient(90deg, rgba(255, 60, 60, 0.18), transparent);
  }
  .empty {
    padding: 12px 4px;
  }
</style>
