<script lang="ts">
	/**
	 * Passo «Modello e ruoli» del setup (SET-012, SET-042).
	 *
	 * La proposta la calcola `setup_propose_roles` nel backend: resolver
	 * deterministico sul catalogo vero, nessuna chiamata al modello. Questo passo
	 * la mostra come card-agenti e lascia cambiare il modello di ognuna con il
	 * selettore del composer, limitato ai provider collegati.
	 *
	 * Due scelte di sostanza:
	 * - il selettore elenca solo i provider collegati: proporre un modello che
	 *   l'utente non può ancora usare sarebbe un vicolo cieco;
	 * - se un ruolo ha già un modello, la card lo mostra come scelto e la
	 *   proposta resta un suggerimento. `saveRoles` scriverà solo ciò che è
	 *   cambiato o ciò che era vuoto.
	 */
	import { invoke } from '@tauri-apps/api/core';
	import { m } from '#lib/paraglide/messages.js';
	import { modelSettingsStore } from '#lib/stores/modelSettings.svelte.ts';
	import RoleCard from './RoleCard.svelte';
	import {
		CARD_ROLES,
		EMPTY_PROPOSAL,
		effectiveSelector,
		type RoleId,
		type RolePicks,
		type RoleProposal,
		type RoleProposalResponse
	} from './setupRoles.ts';

	let {
		connected = [],
		/** Scelte dell'utente: `selector[:thinking]`. Il guscio le legge su «Continua». */
		picks = $bindable<RolePicks>({}),
		/** «Personalizza»: di default apre l'editor dei ruoli che Studio ha già. */
		onCustomize
	} = $props<{
		connected?: string[];
		picks?: RolePicks;
		onCustomize?: () => void;
	}>();

	let proposal = $state<RoleProposalResponse>(EMPTY_PROPOSAL);
	let loading = $state(true);
	let failure = $state<string | null>(null);
	/** Chiave dell'ultima richiesta andata a buon fine: cambiando provider la
	 *  proposta va rifatta. Non è reattiva apposta — la sola cosa che deve
	 *  rieseguire l'effetto è `$state` qui sotto. */
	let requestedFor = '';
	/** Aumenta a ogni «Riprova»: è l'unico modo di rieseguire l'effetto senza
	 *  dipendere da un valore che scriviamo noi dentro l'effetto stesso. */
	let retryTick = $state(0);

	const connectedKey = $derived([...connected].sort().join(','));

	$effect(() => {
		void retryTick;
		const key = connectedKey;
		if (key === requestedFor) return;
		requestedFor = key;
		loading = true;
		failure = null;
		void (async () => {
			try {
				await modelSettingsStore.ensureLoaded();
				const response = await invoke<RoleProposalResponse>('setup_propose_roles');
				// Una risposta arrivata dopo un cambio di provider è vecchia: la
				// richiesta più recente è quella con cui la UI deve restare.
				if (key !== requestedFor) return;
				proposal = response;
			} catch (error) {
				if (key !== requestedFor) return;
				failure = error instanceof Error ? error.message : String(error);
				proposal = EMPTY_PROPOSAL;
			} finally {
				if (key === requestedFor) loading = false;
			}
		})();
	});

	/** Catalogo del selettore: i modelli dei soli provider collegati. */
	const catalog = $derived.by(() => {
		const allowed = new Set(connected);
		const source = modelSettingsStore.assignableCatalog;
		if (allowed.size === 0) return source;
		// Gli alias di login (`openai-codex-device`, `zai-coding-plan`) condividono
		// il provider del modello: si allargano le maglie, non si filtra troppo.
		return source.filter((model) => allowed.has(model.provider));
	});

	const proposalFor = (role: RoleId): RoleProposal | null =>
		proposal.roles.find((entry) => entry.role === role) ?? null;

	function pick(role: RoleId, selector: string) {
		picks = { ...picks, [role]: selector };
	}

	function customize() {
		if (onCustomize) {
			onCustomize();
			return;
		}
		// L'editor completo dei ruoli esiste già ed è la via più breve: si apre
		// sulla sezione Modelli, tab Ruoli, senza costruirne un secondo.
		modelSettingsStore.openModal('roles');
	}
</script>

<div class="roles-step">
	{#if failure}
		<div class="roles-notice">
			<span class="roles-notice-dot" aria-hidden="true"></span>
			<span>{m.setup2_roles_proposal_failed({ error: failure })}</span>
			<button
				type="button"
				class="ui-button ui-button-secondary ui-button-sm"
				onclick={() => {
					// Sentinel e non stringa vuota: con zero provider collegati la
					// chiave sarebbe già '', e «Riprova» non rieseguirebbe nulla.
					requestedFor = '\u0000retry';
					retryTick += 1;
				}}
			>
				{m.setup2_roles_retry()}
			</button>
		</div>
	{/if}

	<div class="roles-grid" aria-busy={loading}>
		{#each CARD_ROLES as role (role)}
			{@const entry = proposalFor(role)}
			{@const value = effectiveSelector(role, picks, entry)}
			<RoleCard
				{role}
				{value}
				proposal={entry}
				catalog={catalog}
				onSelect={(selector) => pick(role, selector)}
			/>
		{/each}
	</div>

	<div class="roles-foot">
		<button type="button" class="roles-customize" onclick={customize}>
			{m.setup2_roles_customize()}
		</button>
		<span class="roles-foot-hint">{m.setup2_roles_customize_hint()}</span>
	</div>
</div>

<style>
	.roles-step {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.roles-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
		align-items: start;
	}

	.roles-notice {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 26px;
		font-size: var(--text-trace);
		color: var(--ink-muted);
	}

	.roles-notice-dot {
		width: 9px;
		height: 9px;
		flex: none;
		border-radius: var(--radius-full);
		background: var(--danger);
	}

	.roles-foot {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.roles-customize {
		border: none;
		background: none;
		padding: 0;
		font-size: var(--text-label);
		color: var(--ink-muted);
		cursor: pointer;
	}

	.roles-customize:hover {
		color: var(--ink);
	}

	.roles-foot-hint {
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}
</style>
