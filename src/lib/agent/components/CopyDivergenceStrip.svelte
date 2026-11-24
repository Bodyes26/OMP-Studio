<!--
  Avviso sopra il composer quando le copie del progetto divergono (R-MI-22).

  Approvato in anteprima (F23, variante B): una striscia agganciata al
  composer come la riga di attenzione del vassoio, perché è lì che si lavora
  e lì il rischio di scrivere sulla copia sbagliata si vede. «Confronta» apre
  la colonna Git; «Più tardi» la toglie finché lo stato delle copie non cambia.

  Con un conflitto vero l'unione non si fa da sola: la striscia nomina i file
  e offre «Risolvi», che affida il lavoro a un agente su questa macchina con il
  compito già scritto (R-MI-61).
-->
<script module lang="ts">
	/** Impronta ignorata per progetto: sopravvive al cambio di scheda, non al riavvio. */
	const dismissed = $state<Record<string, string>>({});
</script>

<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { projectStore } from '#lib/stores/projects.svelte.ts';
	import { copyDivergence, divergenceSummary, provenance, refreshCopiesGit, machineName } from '#lib/stores/projectMachines.svelte.ts';
	import { requestCopyConflictResolution } from '#lib/stores/copyConflictTask.ts';
	import MachineGlyph from '#lib/ui/MachineGlyph.svelte';

	let { projectId, visible = true }: { projectId: string; visible?: boolean } = $props();

	const project = $derived(projectStore.projects.find((p) => p.id === projectId));
	const divergence = $derived(project ? copyDivergence(project) : null);
	const marks = $derived(project ? provenance(project).marks : []);
	const shown = $derived(divergence !== null && dismissed[projectId] !== divergence.signature);
	/** Il primo conflitto vero: e' quello che «Risolvi» consegna all'agente. */
	const conflict = $derived(divergence?.conflicts.find((entry) => entry.files.length > 0) ?? null);

	// La barra rilegge git solo per la tessera attiva: qui servono tutte le
	// copie, altrimenti l'avviso resterebbe fermo su uno stato vecchio.
	$effect(() => {
		const target = project;
		if (!target || !visible || provenance(target).kind !== 'copies') return;
		refreshCopiesGit(target);
		const timer = setInterval(() => refreshCopiesGit(target), 60_000);
		return () => clearInterval(timer);
	});

	let resolving = $state(false);

	function compare(): void {
		window.dispatchEvent(new CustomEvent('studio-show-git'));
	}
	function later(): void {
		if (divergence) dismissed[projectId] = divergence.signature;
	}
	async function resolve(): Promise<void> {
		if (!project || !conflict || resolving) return;
		// L'unione la fa un agente DI QUESTA macchina: la copia e' la locale,
		// anche quando la chat aperta e' quella dell'altra (R-MI-61).
		const local = divergence?.copies.find((entry) => entry.copy.local)?.copy.project;
		if (!local) return;
		resolving = true;
		try {
			await requestCopyConflictResolution({
				project: local,
				branch: conflict.branch,
				machine: conflict.machine,
				files: conflict.files
			});
		} finally {
			resolving = false;
		}
	}
</script>

{#if shown && divergence}
	<div class="divergence-strip" role="status">
		<span class="glyph"><MachineGlyph kind="copies" copies={marks} diverge /></span>
		<span class="text">
			<strong>{m.copies_diverged_title()}</strong>
			<span class="detail">· {divergenceSummary(divergence).join(' · ')}</span>
		</span>
		{#if conflict}
			<button
				type="button"
				class="action"
				disabled={resolving}
				title={m.copies_diverged_resolve_hint({ machine: machineName(conflict.machine) })}
				onclick={() => void resolve()}
			>
				{m.copies_diverged_resolve()}
			</button>
		{/if}
		<button type="button" class="action" onclick={compare}>{m.copies_diverged_compare()}</button>
		<button type="button" class="action ghost" onclick={later}>{m.copies_diverged_later()}</button>
	</div>
{/if}

<style>
	.divergence-strip {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0 var(--space-3);
		padding: 7px 10px;
		background: color-mix(in oklch, var(--warn-glyph) 15%, var(--bg-raised));
		border: 1px solid var(--line);
		border-bottom: 0;
		border-radius: var(--radius-xl) var(--radius-xl) 0 0;
		font: 400 var(--text-trace)/1.4 var(--font-ui);
		color: var(--ink);
	}
	.glyph {
		display: inline-flex;
		color: var(--ink-muted);
		flex: none;
	}
	.text {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	strong {
		font-weight: 550;
	}
	.detail {
		color: var(--ink-muted);
	}
	.action {
		flex: none;
		padding: 5px 8px;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--ink);
		font: 500 var(--text-caption)/1 var(--font-ui);
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease-out);
	}
	.action:hover {
		background: var(--bg-hover);
	}
	.action:disabled {
		cursor: default;
		opacity: 0.6;
	}
	.action.ghost {
		border-color: transparent;
		color: var(--ink-muted);
	}
</style>
