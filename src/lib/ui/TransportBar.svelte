<script lang="ts">
  import { SPEEDS, type SimController } from '../sim/controller.svelte';

  let { sim }: { sim: SimController } = $props();

  const playLabel = $derived(
    sim.phase === 'running' ? 'Pause' : sim.phase === 'paused' ? 'Resume' : sim.phase === 'finished' ? 'Replay' : 'Start',
  );

  function onKey(e: KeyboardEvent) {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!sim.configError) sim.toggle();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      void sim.stepOnce();
    } else if (/^[1-8]$/.test(e.key)) {
      sim.setSpeed(Number(e.key) - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      sim.setSpeed(sim.speedIdx + 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      sim.setSpeed(sim.speedIdx - 1);
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="transport">
  <div class="buttons">
    <button
      class="btn btn-primary play"
      disabled={!!sim.configError && sim.phase === 'setup'}
      onclick={() => sim.toggle()}
      title="Space"
    >
      {#if sim.phase === 'running'}
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
      {:else}
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M7 4l13 8-13 8z" /></svg>
      {/if}
      {playLabel}
    </button>
    <button class="btn" disabled={sim.phase === 'running' || !!sim.configError} onclick={() => sim.stepOnce()} title="Right arrow">
      Step
    </button>
    <button
      class="btn"
      disabled={sim.phase === 'finished' || sim.skipping || !!sim.configError}
      onclick={() => sim.skipToEnd()}
      title="Run to the end without animation"
    >
      {sim.skipping ? 'Calculating…' : 'Skip to end ⏭'}
    </button>
  </div>

  <div class="speeds" role="radiogroup" aria-label="Speed">
    <span class="lbl">Speed</span>
    {#each SPEEDS as s, i (s.id)}
      <button
        class="btn btn-sm"
        class:is-active={sim.speedIdx === i}
        class:turbo={s.kind === 'turbo'}
        role="radio"
        aria-checked={sim.speedIdx === i}
        title={`${s.hint} (key ${i + 1})`}
        onclick={() => sim.setSpeed(i)}
      >
        {s.label}
      </button>
    {/each}
  </div>
</div>

<style>
  .transport {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px 16px;
    padding: 10px 12px;
    border-radius: var(--radius, 14px);
    background: var(--panel, rgba(10, 20, 15, 0.85));
    border: 1px solid var(--panel-border, rgba(212, 175, 55, 0.25));
  }
  .buttons,
  .speeds {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .play {
    min-width: 132px;
  }
  .lbl {
    font-size: 0.72rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-dim, #bfb59c);
    margin-right: 4px;
  }
  .turbo:not(.is-active) {
    color: var(--gold, #d4af37);
  }
</style>
