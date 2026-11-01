<script lang="ts">
	/**
	 * Scheda del prewalk sopra il composer: dice se e' acceso e verso quale
	 * modello passera', e lascia scegliere destinazione e ripartenza.
	 * Si apre dal pulsante della riga di stato e da `/prewalk`.
	 *
	 * La destinazione scelta qui diventa anche il predefinito di `config.yml`
	 * (`prewalk.into`/`prewalk.from`): vale per le nuove chat e per il terminale,
	 * come l'impostazione equivalente della TUI di omp.
	 */
	import { m } from '#lib/paraglide/messages.js';
	import type { AgentSession } from '../session.svelte';
	import type { ModelInfo } from '../wire';
	import type { RoleAssignment } from './RoleMenu.svelte';
	import { DEFAULT_PREWALK_TARGETS, prewalkTargetRole, type PrewalkTargets } from '../prewalk';
	import { IconPrewalk, IconClose } from '#lib/icons.ts';
	import ModelPickerList from '#lib/components/models/ModelPickerList.svelte';

	let {
		session,
		models,
		roleAssignments
	}: {
		session: AgentSession;
		models: ModelInfo[];
		roleAssignments: Record<string, RoleAssignment>;
	} = $props();

	// Ruoli di chat che hanno senso come destinazione, dal piu' tipico.
	const ROLE_ORDER = ['smol', 'default', 'task', 'slow', 'plan', 'vision', 'commit', 'advisor'];
	const roles = $derived(ROLE_ORDER.filter((id) => roleAssignments[id]?.model));

	const targets = $derived<PrewalkTargets>(session.prewalkTargets ?? DEFAULT_PREWALK_TARGETS);
	const intoRole = $derived(prewalkTargetRole(targets.into));
	const fromRole = $derived(prewalkTargetRole(targets.from));
	const phase = $derived(session.prewalk.state);

	let pickerOpen = $state(false);
	let saving = $state(false);
	const busy = $derived(saving || session.prewalkBusy || !session.isReady);

	function roleModel(role: string): string {
		return roleAssignments[role]?.model ?? '';
	}

	/** Nome breve di un selettore `provider/id[:thinking]` (il provider lo dice gia' il ruolo). */
	function shortModel(selector: string): string {
		const base = selector.split(':')[0];
		return base.slice(base.indexOf('/') + 1) || base;
	}

	const stateText = $derived.by(() => {
		if (phase === 'armed') return m.prewalk_card_state_armed({ model: session.prewalk.target || targets.into });
		if (phase === 'handedOff') {
			return m.prewalk_card_state_handed_off({
				model: session.prewalk.handedOffTo || session.model?.name || session.model?.id || targets.into
			});
		}
		return m.prewalk_card_state_off();
	});

	async function choose(key: keyof PrewalkTargets, selector: string) {
		pickerOpen = false;
		if (!selector || targets[key] === selector) return;
		saving = true;
		try {
			await session.runPrewalkAction(() => session.setPrewalkTargets({ [key]: selector }, { persist: true }));
		} finally {
			saving = false;
		}
	}

	function run(action: () => Promise<unknown>) {
		void session.runPrewalkAction(action);
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		event.stopPropagation();
		if (pickerOpen) pickerOpen = false;
		else session.closePrewalkCard();
	}
</script>

{#if session.prewalkCardOpen}
	<div class="prewalk-anchor">
		<div
			class="prewalk-card"
			role="dialog"
			aria-label={m.chat_v2_composer_prewalk_title()}
			tabindex="-1"
			onkeydown={onKeydown}
		>
			<header class="card-head">
				<span class="head-icon" class:on={phase !== 'off'} aria-hidden="true"><IconPrewalk /></span>
				<span class="head-title">{m.chat_v2_composer_prewalk_title()}</span>
				<span class="head-state" class:on={phase !== 'off'} role="status">
					{#if session.prewalkBusy}{m.chat_v2_composer_prewalk_busy()}{:else}{stateText}{/if}
				</span>
				<button
					type="button"
					class="close"
					aria-label={m.common_close()}
					onclick={() => session.closePrewalkCard()}
				>
					<IconClose />
				</button>
			</header>

			<p class="help">{m.prewalk_card_help()}</p>

			<div class="field">
				<span class="field-label" id="prewalk-into-label">{m.prewalk_card_into_label()}</span>
				<div class="chips" role="group" aria-labelledby="prewalk-into-label">
					{#each roles as role (role)}
						<button
							type="button"
							class="ui-chip"
							aria-pressed={intoRole === role}
							disabled={busy}
							title={roleModel(role)}
							onclick={() => void choose('into', `@${role}`)}
						>
							@{role}<span class="chip-model">{shortModel(roleModel(role))}</span>
						</button>
					{/each}
					{#if !intoRole}
						<button type="button" class="ui-chip" aria-pressed="true" disabled={busy} title={targets.into}>
							{shortModel(targets.into)}
						</button>
					{/if}
					<button
						type="button"
						class="ui-chip"
						aria-expanded={pickerOpen}
						disabled={busy || models.length === 0}
						onclick={() => (pickerOpen = !pickerOpen)}
					>
						{m.prewalk_card_other_model()}
					</button>
				</div>
				{#if pickerOpen}
					<div class="picker">
						<ModelPickerList
							catalog={models}
							value={intoRole ? roleModel(intoRole) : targets.into}
							onSelect={(selector) => void choose('into', selector)}
							onClose={() => (pickerOpen = false)}
						/>
					</div>
				{/if}
			</div>

			<label class="field inline">
				<span class="field-label">{m.prewalk_card_from_label()}</span>
				<select
					class="ui-select"
					value={targets.from}
					disabled={busy}
					onchange={(event) => void choose('from', event.currentTarget.value)}
				>
					{#each roles as role (role)}
						<option value={`@${role}`}>@{role} · {shortModel(roleModel(role))}</option>
					{/each}
					{#if !fromRole || !roles.includes(fromRole)}
						<option value={targets.from}>{targets.from}</option>
					{/if}
				</select>
			</label>

			{#if session.prewalkError}
				<p class="error" role="alert">{session.prewalkError}</p>
			{/if}

			<footer class="card-foot">
				<span class="saved-hint">{m.prewalk_card_saved_hint()}</span>
				<div class="actions">
					{#if phase === 'off'}
						<button type="button" class="ui-button ui-button-primary" disabled={busy} onclick={() => run(() => session.armPrewalk())}>
							{m.prewalk_card_arm()}
						</button>
					{:else}
						{#if phase === 'handedOff'}
							<button type="button" class="ui-button ui-button-primary" disabled={busy} onclick={() => run(() => session.restartPrewalk())}>
								{m.chat_v2_composer_prewalk_restart()}
							</button>
						{/if}
						<button type="button" class="ui-button ui-button-ghost" disabled={busy} onclick={() => run(() => session.disarmPrewalk())}>
							{m.prewalk_card_disarm()}
						</button>
					{/if}
				</div>
			</footer>
		</div>
	</div>
{/if}

<style>
	/* Come l'etichetta degli esiti: fuori dal flusso, sul bordo superiore del composer. */
	.prewalk-anchor {
		position: absolute;
		left: 0;
		right: 0;
		bottom: calc(100% + 6px);
		display: flex;
		justify-content: flex-start;
		pointer-events: none;
		z-index: 3;
	}

	.prewalk-card {
		pointer-events: auto;
		width: min(100%, 460px);
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 10px 12px 12px;
		font-size: var(--text-caption);
		color: var(--ink);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: 12px;
		box-shadow: var(--shadow-dock);
		animation: card-in var(--dur-fast) var(--ease-out) backwards;
	}

	.card-head {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.head-icon {
		--icon-size: 14px;
		display: inline-flex;
		color: var(--ink-faint);
	}

	.head-icon.on {
		color: var(--brand-ink);
	}

	.head-title {
		font-weight: 600;
	}

	.head-state {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink-muted);
	}

	.head-state.on {
		color: var(--ink);
	}

	.close {
		--icon-size: 12px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		padding: 0;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: var(--ink-faint);
		cursor: pointer;
	}

	.close:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.help {
		margin: 0;
		color: var(--ink-muted);
		line-height: 1.45;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.field.inline {
		flex-direction: row;
		align-items: center;
		gap: 8px;
	}

	.field.inline .ui-select {
		flex: 1;
	}

	.field-label {
		color: var(--ink-muted);
		white-space: nowrap;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.chip-model {
		max-width: 160px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink-faint);
	}

	.picker {
		max-height: 280px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}

	.error {
		margin: 0;
		color: var(--danger);
		overflow-wrap: anywhere;
		user-select: text;
	}

	.card-foot {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.saved-hint {
		flex: 1;
		min-width: 0;
		color: var(--ink-faint);
	}

	.actions {
		display: flex;
		gap: 6px;
	}

	@keyframes card-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
	}
</style>
