<script lang="ts">
	/**
	 * Orologio del task (Gate R3X-coda-reset): programma l'avvio «al reset
	 * della quota», «non prima delle HH:MM» o a un orario scelto. Lo stesso
	 * componente sta sulla riga della coda e nella barra del TaskEditor.
	 *
	 * La programmazione e' l'azione esplicita: il task parte da solo anche con
	 * l'auto-avvio del progetto spento. «Avvia» resta sempre li' e la scavalca.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { taskStore, type StudioTask } from '$lib/stores/tasks.svelte';
	import { scheduleStore } from '$lib/stores/schedule.svelte';
	import {
		buildAtSchedule,
		isOtherDay,
		nextOccurrence,
		parseClockTime,
		schedulePresets
	} from '$lib/quota/scheduleTarget';
	import { IconClose, IconSchedule } from '$lib/icons';
	import MenuButton from '$lib/ui/MenuButton.svelte';

	let {
		task,
		align = 'right',
		size = 'row'
	}: {
		task: StudioTask;
		align?: 'left' | 'right';
		/** `row`: icona della riga di coda; `toolbar`: barra del TaskEditor. */
		size?: 'row' | 'toolbar';
	} = $props();

	let open = $state(false);
	let customOpen = $state(false);
	let customValue = $state('');
	let customError = $state(false);

	const scheduled = $derived(Boolean(task.schedule));
	const label = $derived(scheduleStore.labelFor(task));
	const triggerTitle = $derived(
		label ? m.schedule_button_title_active({ label: label.text }) : m.schedule_button_title()
	);
	// Letti all'apertura: il menu mostra orari e reset di questo momento.
	const resetDetail = $derived(open ? scheduleStore.resetMenuDetail(task) : null);
	const presets = $derived(open ? schedulePresets(scheduleStore.now) : []);

	function presetLabel(at: number): string {
		const time = scheduleStore.formatWhen(at, at);
		return m.schedule_menu_at({ time });
	}

	function presetDay(at: number): string {
		return isOtherDay(at, scheduleStore.now) ? m.schedule_menu_tomorrow() : m.schedule_menu_today();
	}

	function close() {
		open = false;
		customOpen = false;
		customError = false;
	}

	function chooseReset() {
		const schedule = scheduleStore.buildReset(task, 'user');
		if (!schedule) return;
		taskStore.setSchedule(task.id, schedule);
		close();
	}

	function chooseAt(at: number) {
		taskStore.setSchedule(task.id, buildAtSchedule(at, Date.now()));
		close();
	}

	function openCustom() {
		customOpen = true;
		customError = false;
		const base = task.schedule?.kind === 'at' && task.schedule.notBefore ? task.schedule.notBefore : Date.now() + 3_600_000;
		const date = new Date(base);
		customValue = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
	}

	function confirmCustom(event: SubmitEvent) {
		event.preventDefault();
		const parsed = parseClockTime(customValue);
		if (!parsed) {
			customError = true;
			return;
		}
		chooseAt(nextOccurrence(parsed.hours, parsed.minutes, Date.now()));
	}

	function removeSchedule() {
		taskStore.setSchedule(task.id, undefined);
		close();
	}
</script>

<MenuButton
	{open}
	title={triggerTitle}
	ariaLabel={triggerTitle}
	hasPopup="menu"
	{align}
	width="270px"
	className="schedule-trigger {size} {scheduled ? 'is-scheduled' : ''}"
	onToggle={() => (open ? close() : (open = true))}
	onClose={close}
>
	{#snippet trigger()}
		<IconSchedule />
	{/snippet}
	{#snippet children()}
		<div class="schedule-menu">
			<div class="group-title">{m.schedule_menu_title()}</div>
			<button
				type="button"
				role="menuitem"
				class="option"
				disabled={!resetDetail?.available}
				onclick={chooseReset}
			>
				<span class="option-icon"><IconSchedule /></span>
				<span class="option-text">{m.schedule_menu_reset()}</span>
				<span class="option-detail">{resetDetail?.detail ?? ''}</span>
			</button>
			{#each presets as at (at)}
				<button type="button" role="menuitem" class="option" onclick={() => chooseAt(at)}>
					<span class="option-icon"><IconSchedule /></span>
					<span class="option-text">{presetLabel(at)}</span>
					<span class="option-detail">{presetDay(at)}</span>
				</button>
			{/each}
			{#if customOpen}
				<form class="custom" onsubmit={confirmCustom}>
					<label class="custom-label">
						<span>{m.schedule_menu_custom_label()}</span>
						<!-- svelte-ignore a11y_autofocus -->
						<input
							type="time"
							class="custom-input"
							bind:value={customValue}
							aria-invalid={customError}
							autofocus
						/>
					</label>
					<button type="submit" class="ui-button ui-button-primary custom-ok">
						{m.schedule_menu_custom_confirm()}
					</button>
				</form>
			{:else}
				<button type="button" role="menuitem" class="option" onclick={openCustom}>
					<span class="option-icon"><IconSchedule /></span>
					<span class="option-text">{m.schedule_menu_custom()}</span>
				</button>
			{/if}
			{#if scheduled}
				<div class="separator" role="separator"></div>
				<button type="button" role="menuitem" class="option" onclick={removeSchedule}>
					<span class="option-icon"><IconClose /></span>
					<span class="option-text">{m.schedule_menu_remove()}</span>
				</button>
			{/if}
			<p class="note">{m.schedule_menu_note()}</p>
		</div>
	{/snippet}
</MenuButton>

<style>
	:global(.menu-button.schedule-trigger.row) {
		width: 24px;
		height: 22px;
		padding: 0;
		justify-content: center;
		color: var(--ink-faint);
		--icon-size: 13px;
	}

	:global(.menu-button.schedule-trigger.toolbar) {
		width: 28px;
		padding: 0;
		justify-content: center;
		--icon-size: 15px;
	}

	/* Programmato: il segno resta a vista anche senza puntatore, in inchiostro
	   pieno e non in colore (lo stato non e' un allarme). */
	:global(.menu-button.schedule-trigger.is-scheduled) {
		color: var(--ink);
	}

	.schedule-menu {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-1);
	}

	.group-title {
		padding: 4px 8px 2px;
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.option {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 6px 8px;
		border: none;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--ink);
		text-align: left;
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}

	.option:hover:not(:disabled),
	.option:focus-visible {
		background: var(--bg-hover);
		outline: none;
	}

	.option:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.option-icon {
		display: inline-flex;
		color: var(--ink-muted);
		--icon-size: 13px;
	}

	.option-text {
		flex: 1;
		min-width: 0;
	}

	.option-detail {
		color: var(--ink-faint);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.custom {
		display: flex;
		align-items: flex-end;
		gap: var(--space-2);
		padding: 6px 8px;
	}

	.custom-label {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.custom-input {
		height: 28px;
		padding: 0 6px;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		background: var(--bg-base);
		color: var(--ink);
		font: inherit;
		font-variant-numeric: tabular-nums;
	}

	.custom-input[aria-invalid='true'] {
		border-color: var(--danger);
	}

	.separator {
		height: 1px;
		margin: 2px 4px;
		background: var(--line);
	}

	.note {
		margin: 2px 8px 4px;
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}
</style>
