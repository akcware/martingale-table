<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import type { SimController } from '../sim/controller.svelte';
  import { money, moneySigned, num, ordinal, percent } from '../engine/format';
  import { percentileOf } from '../engine/analysis';

  let { sim }: { sim: SimController } = $props();

  const s = $derived(sim.stats!);
  const bust = $derived(s.ended === 'bust');
  const peakProfit = $derived(s.peakBalance - s.startBalance);
  const net = $derived(s.balance - s.startBalance);
  const realRtp = $derived(s.totalWagered > 0 ? s.totalReturned / s.totalWagered : 0);
  const pct = $derived(sim.mc && bust && sim.mc.sortedBust.length ? percentileOf(sim.mc.sortedBust, s.round) : null);

  function close() {
    sim.showSummary = false;
  }
  function again() {
    sim.rerollSeed();
    sim.start();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="backdrop" transition:fade={{ duration: 200 }} onclick={close} role="presentation"></div>
<div class="modal" role="dialog" aria-modal="true" aria-labelledby="sum-title" transition:scale={{ start: 0.9, duration: 260 }}>
  <header class:bust>
    <span class="eyebrow">{bust ? 'The strategy broke' : 'Round limit reached'}</span>
    <h2 id="sum-title">
      {#if bust}
        Busted on round <span class="num">{num(s.round)}</span>
      {:else}
        Survived <span class="num">{num(s.round)}</span> rounds
      {/if}
    </h2>
    {#if bust}
      <p>
        After <b class="num">{s.lossStreak}</b> straight losses the next stake of <b class="num">{money(s.nextBet)}</b> could
        not be covered by the remaining <b class="num">{money(s.balance)}</b>.
      </p>
    {:else}
      <p>The bankroll could still cover the next stake; the simulation stopped at the round limit.</p>
    {/if}
  </header>

  <div class="peak">
    <span class="k">Max win</span>
    {#if peakProfit > 0}
      <span class="v num">+{money(peakProfit)}</span>
      <span class="s">on round <b class="num">{num(s.peakRound)}</b> · balance {money(s.peakBalance)}</span>
    {:else}
      <span class="v num dim">—</span>
      <span class="s">The balance never rose above the starting bankroll.</span>
    {/if}
  </div>

  <dl class="grid">
    <dt>Net result</dt>
    <dd class="num" class:win-text={net > 0} class:loss-text={net < 0}>{moneySigned(net)}</dd>
    <dt>Final balance</dt>
    <dd class="num">{money(s.balance)}</dd>
    <dt>Rounds won / lost</dt>
    <dd class="num">{num(s.wins)} / {num(s.losses)}</dd>
    <dt>Realized RTP</dt>
    <dd class="num">{percent(realRtp)}% <span class="dim">(set to {percent(sim.config.rtp / 100)}%)</span></dd>
    <dt>Longest losing streak</dt>
    <dd class="num">{s.longestLossStreak} <span class="dim">(ended round {num(s.longestLossStreakEndRound)})</span></dd>
    <dt>Biggest stake</dt>
    <dd class="num">{money(s.biggestBet)} <span class="dim">(round {num(s.biggestBetRound)})</span></dd>
    <dt>Biggest single win</dt>
    <dd class="num">{s.biggestWin ? money(s.biggestWin) : '—'} {#if s.biggestWin}<span class="dim">(round {num(s.biggestWinRound)})</span>{/if}</dd>
    <dt>Total wagered</dt>
    <dd class="num">{money(s.totalWagered)}</dd>
  </dl>

  {#if pct !== null && sim.mc}
    <p class="compare">
      This game outlasted <b>{percent(pct)}%</b> of {num(sim.mc.sims)} simulated games with the same settings
      (median bust: the <b>{ordinal(sim.mc.median)}</b> round).
    </p>
  {/if}

  <footer>
    <button class="btn" onclick={close}>Inspect chart</button>
    <button class="btn" onclick={() => sim.reset()}>Change settings</button>
    <button class="btn btn-primary" onclick={again}>New game 🎲</button>
  </footer>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(3px);
    z-index: 50;
  }
  .modal {
    position: fixed;
    z-index: 51;
    left: 50%;
    top: 50%;
    translate: -50% -50%;
    width: min(560px, calc(100vw - 24px));
    max-height: calc(100vh - 24px);
    overflow-y: auto;
    background: var(--panel, #0d1a13);
    border: 1px solid var(--gold, #d4af37);
    border-radius: 18px;
    box-shadow:
      0 30px 80px rgba(0, 0, 0, 0.7),
      0 0 0 4px rgba(212, 175, 55, 0.12);
    padding: 22px;
  }
  header {
    text-align: center;
    margin-bottom: 16px;
  }
  .eyebrow {
    font-size: 0.72rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--gold, #d4af37);
  }
  header.bust .eyebrow {
    color: var(--loss, #ff4d4d);
  }
  h2 {
    margin: 6px 0 8px;
    font-family: var(--font-display, serif);
    font-size: 2rem;
    line-height: 1.1;
  }
  header.bust h2 {
    color: color-mix(in srgb, var(--loss, #ff4d4d) 70%, white);
  }
  header p {
    margin: 0;
    color: var(--text-dim, #bfb59c);
    font-size: 0.9rem;
  }
  .peak {
    display: grid;
    justify-items: center;
    gap: 2px;
    padding: 14px;
    border-radius: 14px;
    background: radial-gradient(circle at 50% 0%, rgba(245, 215, 110, 0.18), rgba(0, 0, 0, 0.25));
    border: 1px solid var(--gold-deep, #8a6d1f);
    margin-bottom: 16px;
  }
  .peak .k {
    font-size: 0.72rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--gold, #d4af37);
  }
  .peak .v {
    font-size: 2.2rem;
    font-weight: 800;
    color: var(--gold-bright, #f5d76e);
    text-shadow: 0 0 22px rgba(245, 215, 110, 0.35);
  }
  .peak .s {
    color: var(--text-dim, #bfb59c);
    font-size: 0.88rem;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 7px 14px;
    margin: 0;
    font-size: 0.9rem;
  }
  dt {
    color: var(--text-dim, #bfb59c);
  }
  dd {
    margin: 0;
    text-align: right;
  }
  .dim {
    color: var(--text-faint, #8a8270);
  }
  .compare {
    margin: 14px 0 0;
    padding: 10px 12px;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.25);
    font-size: 0.86rem;
    color: var(--text-dim, #bfb59c);
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }
</style>
