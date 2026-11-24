<!--
  Avviso prima di avviare un lavoro (IMP-007).

  Elenca le copie del progetto indietro rispetto a origin — non solo quella
  che eseguirà il lavoro, perché la scelta è esplicita: «su tutte». Due uscite:
  aggiornare prima (pull fast-forward su ogni macchina) o partire comunque.
  Nessuna decisione presa al posto dell'utente e nessun avvio silenzioso.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import ConfirmDialog from '#lib/ui/ConfirmDialog.svelte';
	import type { OriginCheck } from '#lib/stores/gitPreflight.svelte.ts';

	let {
		open,
		check,
		busy = false,
		errors = [],
		onUpdate,
		onForce,
		onCancel
	}: {
		open: boolean;
		check: OriginCheck | null;
		busy?: boolean;
		/** Aggiornamenti falliti: dicono cosa blocca, senza nascondere il resto. */
		errors?: string[];
		onUpdate: () => void;
		onForce: () => void;
		onCancel: () => void;
	} = $props();
</script>

<ConfirmDialog
	{open}
	title={m.git_preflight_title()}
	message={m.git_preflight_intro()}
	confirmLabel={m.git_preflight_force()}
	cancelLabel={m.common_cancel()}
	secondaryLabel={m.git_preflight_update()}
	confirmDisabled={busy}
	onConfirm={onForce}
	onSecondary={onUpdate}
	onCancel={onCancel}
>
	{#if check}
		<ul class="preflight-list">
			{#each check.behind as copy (copy.machineId + copy.project.id)}
				<li>
					{m.git_preflight_line({
						machine: copy.machine,
						branch: copy.branch,
						count: copy.behind,
						upstream: copy.upstream ?? 'origin'
					})}
				</li>
			{/each}
			{#each check.unchecked as copy (copy.machineId + copy.project.id)}
				<li class="muted">{m.git_preflight_unchecked({ machine: copy.machine })}</li>
			{/each}
		</ul>
	{/if}
	{#if errors.length > 0}
		<ul class="preflight-list" role="alert">
			{#each errors as line (line)}<li class="failed">{line}</li>{/each}
		</ul>
	{/if}
</ConfirmDialog>

<style>
	.preflight-list {
		margin: 8px 0 0;
		padding-left: 18px;
		font-size: var(--text-caption);
		color: var(--ink);
		line-height: 1.5;
	}
	.preflight-list li + li { margin-top: 4px; }
	.muted { color: var(--ink-muted); }
	.failed { color: var(--danger); }
</style>
