<script lang="ts">
  import { RTP_PRESETS, type SimController } from '../sim/controller.svelte';
  import { money, percent, plainNum } from '../engine/format';

  let { sim }: { sim: SimController } = $props();

  const locked = $derived(sim.phase === 'running' || sim.phase === 'paused');
  const BALANCES = [100, 1000, 10_000, 100_000];
  const BETS = [0.1, 1, 5, 10, 50];
</script>

<section class="panel setup">
  <h2 class="panel-title">Table setup</h2>

  <div class="field">
    <label for="balance">Starting balance</label>
    <div class="input-wrap">
      <span class="prefix">$</span>
      <input id="balance" class="input" type="number" min="0.01" step="any" bind:value={sim.inputs.balance} disabled={locked} />
    </div>
    <div class="chips">
      {#each BALANCES as b (b)}
        <button class="btn btn-sm" class:is-active={sim.inputs.balance === b} disabled={locked} onclick={() => (sim.inputs.balance = b)}>
          {plainNum(b)}
        </button>
      {/each}
    </div>
  </div>

  <div class="field">
    <label for="bet">Base bet <span class="hint">reset to this after a win</span></label>
    <div class="input-wrap">
      <span class="prefix">$</span>
      <input id="bet" class="input" type="number" min="0.01" step="any" bind:value={sim.inputs.baseBet} disabled={locked} />
    </div>
    <div class="chips">
      {#each BETS as b (b)}
        <button class="btn btn-sm" class:is-active={sim.inputs.baseBet === b} disabled={locked} onclick={() => (sim.inputs.baseBet = b)}>
          {plainNum(b)}
        </button>
      {/each}
    </div>
  </div>

  <div class="field">
    <label for="rtp">
      RTP
      <span class="gold-text num">{percent(Number(sim.inputs.rtp) / 100)}%</span>
    </label>
    <input
      id="rtp-range"
      type="range"
      min="80"
      max="100"
      step="0.01"
      bind:value={sim.inputs.rtp}
      disabled={locked}
      aria-label="RTP slider"
    />
    <div class="rtp-row">
      <div class="input-wrap">
        <input id="rtp" class="input" type="number" min="1" max="150" step="0.01" bind:value={sim.inputs.rtp} disabled={locked} />
        <span class="suffix">%</span>
      </div>
      <div class="chips">
        {#each RTP_PRESETS as p (p.rtp)}
          <button
            class="btn btn-sm"
            class:is-active={Number(sim.inputs.rtp) === p.rtp}
            disabled={locked}
            onclick={() => (sim.inputs.rtp = p.rtp)}
            title={`${p.label} wheel · RTP ${p.rtp}%`}
          >
            {p.label}
          </button>
        {/each}
      </div>
    </div>
    {#if sim.theory}
      <p class="hint">
        Even-money bet on red (pays 2×). Win chance = RTP / 2 =
        <b class="num">{percent(sim.theory.winProb)}%</b>
        {#if sim.theory.houseEdge > 0}
          · house edge <b class="num">{percent(sim.theory.houseEdge)}%</b>
        {:else if sim.theory.houseEdge < 0}
          · player edge
        {/if}
      </p>
    {/if}
  </div>

  <details class="adv">
    <summary>Advanced</summary>
    <div class="field">
      <label for="seed">Seed <span class="hint">same seed = same game</span></label>
      <div class="seed-row">
        <input id="seed" class="input" type="number" min="0" step="1" bind:value={sim.inputs.seed} disabled={locked} />
        <button class="btn" title="Random seed" aria-label="Random seed" disabled={locked} onclick={() => sim.rerollSeed()}>🎲</button>
      </div>
    </div>
    <div class="field">
      <label for="cap">Round limit</label>
      <input id="cap" class="input" type="number" min="1" step="1" bind:value={sim.inputs.maxRounds} disabled={locked} />
      <p class="hint">With RTP ≥ 100% a game may never bust; it stops at this limit.</p>
    </div>
  </details>

  {#if sim.configError}
    <p class="error">{sim.configError}</p>
  {:else if sim.error}
    <p class="error">{sim.error}</p>
  {/if}

  {#if locked}
    <button class="btn btn-danger wide" onclick={() => sim.reset()}>End game · change settings</button>
  {:else}
    <button class="btn btn-primary wide start" disabled={!!sim.configError} onclick={() => sim.start()}>
      {sim.phase === 'finished' ? 'Play again' : 'Start game'}
    </button>
    {#if !sim.configError}
      <p class="hint center">
        {money(sim.config.startBalance)} bankroll · starting at {money(sim.config.baseBet)}
      </p>
    {/if}
  {/if}
</section>

<style>
  .rtp-row {
    display: grid;
    gap: 8px;
  }
  .seed-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
  }
  .adv {
    margin: 4px 0 14px;
    border-top: 1px dashed var(--panel-border, rgba(212, 175, 55, 0.25));
    padding-top: 10px;
  }
  .adv summary {
    cursor: pointer;
    font-size: 0.8rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-dim, #bfb59c);
    margin-bottom: 10px;
  }
  .wide {
    width: 100%;
  }
  .start {
    padding: 14px;
    font-size: 1.05rem;
  }
  .center {
    text-align: center;
    margin: 8px 0 0;
  }
  .error {
    color: var(--loss, #ff4d4d);
    font-size: 0.85rem;
    margin: 0 0 10px;
  }
  .hint {
    margin: 2px 0 0;
  }
</style>
