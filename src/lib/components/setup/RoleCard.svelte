<script lang="ts">
	/**
	 * Card di un ruolo nel passo «Modello e ruoli» (SET-012).
	 *
	 * Ogni ruolo è un piccolo agente: icona nella tinta d'identità, nome e id,
	 * il selettore del modello (quello del composer, non una tendina nativa) e
	 * una riga che spiega a cosa serve. La riga del perché invece dice perché
	 * *quel* modello: arriva dai codici di `RoleProposal`, quindi cambia con i
	 * provider collegati senza che la grafica sappia nulla della policy.
	 *
	 * Stato «attuale» e «consigliato» sono distinti: se il ruolo ha già un
	 * modello configurato, la card lo mostra come scelto e la proposta resta un
	 * suggerimento («Consigliato: …»). Solo quando sono lo stesso modello la
	 * card dice «Consigliato» come stato della scelta.
	 */
	import { m } from '#lib/paraglide/messages.js';
	import {
		IconRoleDefault,
		IconRolePlan,
		IconRoleSmol,
		IconRoleVision,
		IconRoleTask,
		IconSparkles
	} from '#lib/icons.ts';
	import Tooltip from '#lib/ui/Tooltip.svelte';
	import ModelField from '#lib/components/models/ModelField.svelte';
	import { ROLE_HUES } from '#lib/agent/roleHues.ts';
	import type { ModelDto } from '#lib/stores/modelSettings.svelte.ts';
	import {
		noteText,
		reasonText,
		type NoteCode,
		type RoleId,
		type RoleProposal
	} from './setupRoles.ts';

	let {
		role,
		/** Selettore mostrato: pick utente, poi attuale, poi proposta. */
		value,
		proposal,
		catalog,
		onSelect
	} = $props<{
		role: RoleId;
		value: string | null;
		proposal: RoleProposal | null;
		catalog: ModelDto[];
		onSelect: (selector: string) => void;
	}>();

	const meta = $derived.by(() => {
		switch (role) {
			case 'plan':
				return { icon: IconRolePlan, hue: ROLE_HUES.plan, label: m.setup2_roles_role_plan(), desc: m.setup2_roles_desc_plan() };
			case 'smol':
				return { icon: IconRoleSmol, hue: ROLE_HUES.smol, label: m.setup2_roles_role_smol(), desc: m.setup2_roles_desc_smol() };
			case 'vision':
				return { icon: IconRoleVision, hue: ROLE_HUES.vision, label: m.setup2_roles_role_vision(), desc: m.setup2_roles_desc_vision() };
			case 'task':
				return { icon: IconRoleTask, hue: ROLE_HUES.task, label: m.setup2_roles_role_task(), desc: m.setup2_roles_desc_task() };
			default:
				return { icon: IconRoleDefault, hue: null, label: m.setup2_roles_role_default(), desc: m.setup2_roles_desc_default() };
		}
	});
	const Icon = $derived(meta.icon);
	const tint = $derived(meta.hue === null ? 'var(--brand-ink)' : `oklch(var(--proj-l-ink) var(--proj-c-ink) ${meta.hue})`);

	/** Il valore scelto coincide con la proposta: la card lo dice. */
	const isProposed = $derived(!!value && !!proposal?.selector && value === proposal.selector);
	/** C'è un modello attuale diverso dalla proposta: si mostra come suggerimento. */
	const suggestsOther = $derived(
		!!proposal?.selector && !!value && value !== proposal.selector
	);
	const notes = $derived(
		proposal
			? proposal.notes
					.map((note: NoteCode) => noteText(note, proposal as RoleProposal))
					.filter((text: string) => text !== '')
			: []
	);
	const explanation = $derived(proposal ? reasonText(proposal) : '');
	const recommendedLabel = $derived(
		proposal?.modelName
			? m.setup2_roles_recommended_model({ model: proposal.modelName })
			: m.setup2_roles_recommended()
	);
</script>

<div class="role-card" class:is-wide={role === 'default'}>
	<div class="role-head">
		<span
			class="role-icon"
			style:--role-tint={tint}
			aria-hidden="true"
		>
			<Icon />
		</span>
		<span class="role-titles">
			<span class="role-label">{meta.label}</span>
			<span class="role-id">{role}</span>
		</span>
		{#if isProposed}
			<span class="role-badge">{m.setup2_roles_recommended()}</span>
		{:else if suggestsOther}
			<Tooltip text={proposal ? reasonText(proposal) : ''}>
				<button type="button" class="role-suggest" onclick={() => proposal?.selector && onSelect(proposal.selector)}>
					<IconSparkles />
					{recommendedLabel}
				</button>
			</Tooltip>
		{/if}
	</div>

	<ModelField
		{catalog}
		value={value ?? ''}
		placeholder={m.setup2_roles_pick_model()}
		ariaLabel={m.setup2_roles_pick_model_for({ role: meta.label })}
		onSelect={(selector) => onSelect(selector)}
	/>

	<p class="role-desc">{meta.desc}</p>

	{#if explanation}
		<p class="role-why" class:is-muted={proposal?.confidence === 'heuristic'}>
			{explanation}
			{#if notes.length > 0}
				<Tooltip text={notes.join(' · ')}>
					<span class="role-notes" role="note" aria-label={notes.join('. ')}>i</span>
				</Tooltip>
			{/if}
		</p>
	{/if}
</div>

<style>
	.role-card {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
	}

	/* Il predefinito è l'agente con cui si parla: sta su due colonne. */
	.role-card.is-wide {
		grid-column: span 2;
	}

	.role-head {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.role-icon {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		flex: none;
		border-radius: var(--radius-md);
		color: var(--role-tint);
		background: color-mix(in oklab, var(--role-tint) 14%, transparent);
	}

	.role-titles {
		display: flex;
		align-items: baseline;
		gap: 6px;
		min-width: 0;
		flex: 1;
	}

	.role-label {
		font-size: 13px;
		font-weight: 550;
		color: var(--ink);
	}

	.role-id {
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--ink-faint);
	}

	.role-badge {
		flex: none;
		padding: 2px 8px;
		border-radius: var(--radius-full);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink-muted);
	}

	.role-suggest {
		display: flex;
		align-items: center;
		gap: 5px;
		flex: none;
		max-width: 60%;
		padding: 0;
		border: none;
		background: none;
		font-size: var(--text-caption);
		color: var(--ink-muted);
		cursor: pointer;
	}

	.role-suggest:hover {
		color: var(--ink);
	}

	.role-desc {
		margin: 0;
		font-size: var(--text-label);
		color: var(--ink-muted);
		line-height: 1.45;
	}

	.role-why {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	/* Un'euristica non è un consiglio: la riga non deve sembrare una certezza. */
	.role-why.is-muted {
		color: var(--ink-faint);
	}

	.role-notes {
		display: grid;
		place-items: center;
		width: 14px;
		height: 14px;
		flex: none;
		border-radius: var(--radius-full);
		border: 1px solid var(--line-strong);
		font-size: 9px;
		font-style: italic;
		color: var(--ink-faint);
		cursor: help;
	}
</style>
