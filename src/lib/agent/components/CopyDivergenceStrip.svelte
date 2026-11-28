<!--
  Avviso sopra il composer quando le copie del progetto divergono (R-MI-22).

  Approvato in anteprima (F23, variante B): una striscia agganciata al
  composer come la riga di attenzione del vassoio, perché è lì che si lavora
  e lì il rischio di scrivere sulla copia sbagliata si vede. «Confronta» apre
  la colonna Git; «Più tardi» la toglie finché lo stato delle copie non cambia.

  Con un conflitto vero l'unione non si fa da sola: la striscia nomina i file
  e offre «Risolvi», che affida il lavoro a un agente su questa macchina con il
  compito già scritto (R-MI-61). Quando il giro automatico non basta per più
  di una copia (conflitti su più branch, copie in attesa della cartella libera,
  modifiche non committate altrove) l'azione diventa «Allinea tutto» (R-MI-74):
  committa le modifiche in sospeso di ogni copia, le scambia e solo se serve
  passa all'agente. La fase del giro si legge accanto ai pulsanti.
-->
<script module lang="ts">
	/** Impronta ignorata per progetto: sopravvive al cambio di scheda, non al riavvio. */
	const dismissed = $state<Record<string, string>>({});
	/**
	 * Ultima rilettura git per progetto: la striscia e' montata per ogni chat,
	 * e senza questa mappa ognuna rilanciava lo stesso `git_upstream_status`
	 * delle stesse copie (S5-07).
	 */
	const refreshedAt = new Map<string, number>();
	const REFRESH_MS = 60_000;
</script>

<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { projectStore } from '#lib/stores/projects.svelte.ts';
	import { copyDivergence, copyPending, dirtyCopiesElsewhere, divergenceSummary, pendingReasonText, provenance, refreshCopiesGit, machineName } from '#lib/stores/projectMachines.svelte.ts';
	import { requestCopyConflictResolution } from '#lib/stores/copyConflictTask.ts';
	import { copyStripAction, alignPhaseText, alignWaitingText } from '#lib/stores/copyAlign.svelte.ts';
	import { copyAlign } from '#lib/stores/copyAlignLive.svelte.ts';
	import MachineGlyph from '#lib/ui/MachineGlyph.svelte';

	let { projectId, visible = true }: { projectId: string; visible?: boolean } = $props();

	const project = $derived(projectStore.projects.find((p) => p.id === projectId));
	const divergence = $derived(project ? copyDivergence(project) : null);
	const marks = $derived(project ? provenance(project).marks : []);
	/** Il primo conflitto vero: e' quello che «Risolvi» consegna all'agente. */
	const conflict = $derived(divergence?.conflicts.find((entry) => entry.files.length > 0) ?? null);
	/**
	 * «Allinea tutto» (R-MI-74) si offre quando il giro automatico non basta:
	 * un conflitto vero, copie che aspettano la cartella libera (un commit in
	 * arrivo bloccato da modifiche non committate), oppure modifiche non
	 * committate su un'altra copia. Con un solo conflitto e nient'altro da
	 * committare resta il pulsante stretto «Risolvi» (R-MI-61), che unisce una
	 * gemella sola.
	 */
	const pending = $derived(project ? copyPending(project) : []);
	const dirtyElsewhere = $derived(project ? dirtyCopiesElsewhere(project) : []);
	const otherCopiesDirty = $derived(dirtyElsewhere.length > 0);
	/**
	 * Cosa offre la striscia: «Risolvi» per un conflitto solo (R-MI-61),
	 * «Allinea tutto» quando il giro automatico non basta per piu' copie
	 * (R-MI-74). La scelta sta in `copyAlign.svelte.ts`, provata senza finestra.
	 */
	const action = $derived(copyStripAction({
		// Conta il conflitto solo se ha file da unire: senza, «Risolvi» non ha
		// un compito da consegnare e l'azione resta l'allineamento.
		conflicts: conflict ? (divergence?.conflicts.length ?? 0) : 0,
		pending: pending.map((branch) => branch.name),
		otherCopiesDirty
	}));
	// Le copie possono essere ferme senza essere divergenti (S3-link-front-04) o
	// avere modifiche non committate solo su un'altra macchina (R-MI-74): la
	// striscia compare lo stesso, perche' e' li' che si offre l'allineamento.
	const stripVisible = $derived(divergence !== null || pending.length > 0 || otherCopiesDirty);
	const signature = $derived(divergence?.signature ?? [
		`align`,
		...pending.map((branch) => `${branch.name}@${branch.behind}`).sort(),
		...dirtyElsewhere.map((entry) => `${entry.name}:${entry.count}`).sort()
	].join('|'));
	const shown = $derived(stripVisible && dismissed[projectId] !== signature);
	/**
	 * Righe che raccontano perche' la striscia c'e': la divergenza, e le copie
	 * ferme che aspettano la cartella libera (R-MI-27).
	 */
	const detail = $derived([
		...(divergence ? divergenceSummary(divergence) : []),
		...pending.map((branch) => pendingReasonText(branch)),
		// Senza divergenza le righe dei file sporchi altrove non ci sono: le
		// aggiunge qui chi spiega perche' «Allinea tutto» serve (R-MI-74).
		...(divergence ? [] : dirtyElsewhere.map((entry) => m.copies_diverged_uncommitted({ machine: entry.name, count: entry.count })))
	]);
	/** Fase del giro solo mentre serve: in corso qui, o l'esito se andato male. */
	const alignPhase = $derived.by(() => {
		if (copyAlign.running || copyAlign.phase === 'error') {
			// Il giro appartiene a una tessera: la striscia di un'altra non lo racconta.
			if (copyAlign.projectId !== null && copyAlign.projectId !== projectId) return null;
			return alignPhaseText(copyAlign);
		}
		return null;
	});
	const alignWaiting = $derived(copyAlign.running ? alignWaitingText(copyAlign.waiting) : null);

	// La barra rilegge git solo per la tessera attiva: qui servono tutte le
	// copie, altrimenti l'avviso resterebbe fermo su uno stato vecchio. Una
	// sola lettura per progetto anche con piu' chat montate (S5-07), e da
	// finestra nascosta il giro rallenta come gli altri poller (S7-05).
	$effect(() => {
		const target = project;
		if (!target || !visible || provenance(target).kind !== 'copies') return;
		const read = (force: boolean) => {
			const now = Date.now();
			const last = refreshedAt.get(target.id) ?? 0;
			if (!force && now - last < REFRESH_MS / 6) return;
			refreshedAt.set(target.id, now);
			refreshCopiesGit(target, force);
		};
		read(false);
		const tick = () => {
			if (document.visibilityState === 'hidden') return;
			read(false);
		};
		const timer = setInterval(tick, REFRESH_MS);
		return () => clearInterval(timer);
	});

	let resolving = $state(false);

	function compare(): void {
		window.dispatchEvent(new CustomEvent('studio-show-git'));
	}
	function later(): void {
		dismissed[projectId] = signature;
		// «Più tardi» chiude anche l'esito dell'ultimo giro: alla prossima
		// comparsa la striscia riparte pulita (R-MI-74).
		copyAlign.reset();
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

	/** «Allinea tutto» (R-MI-74): committa, scambia e, se serve, passa all'agente. */
	async function alignAll(): Promise<void> {
		if (!project || copyAlign.running) return;
		await copyAlign.allinea(project);
	}
</script>

{#if shown}
	<div class="divergence-strip" role="status">
		<span class="glyph">
			<MachineGlyph kind="copies" copies={marks} diverge={divergence !== null} pending={pending.length > 0} />
		</span>
		<span class="text">
			<strong>
				{divergence ? m.copies_diverged_title() : pending.length > 0 ? m.copies_pending_title() : m.copies_align_title()}
			</strong>
			{#if detail.length > 0}<span class="detail">· {detail.join(' · ')}</span>{/if}
		</span>
		{#if action === 'resolve' && conflict}
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
		{#if action === 'align'}
			<button
				type="button"
				class="action"
				disabled={copyAlign.running}
				title={m.copies_align_all_hint()}
				onclick={() => void alignAll()}
			>
				{m.copies_align_all()}
			</button>
		{/if}
		{#if alignPhase}
			<span class="phase" role={copyAlign.phase === 'error' ? 'alert' : 'status'}>{alignPhase}{#if alignWaiting} · {alignWaiting}{/if}</span>
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
	/* Fase di «Allinea tutto» (R-MI-74): una riga breve accanto ai pulsanti. */
	.phase {
		flex: none;
		color: var(--ink-muted);
		font: 400 var(--text-caption)/1.2 var(--font-ui);
		white-space: nowrap;
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
