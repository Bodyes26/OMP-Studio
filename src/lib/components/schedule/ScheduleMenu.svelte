<script lang="ts">
	/**
	 * Orologio del task (Gate R35): programma l'avvio «al reset
	 * della quota», «non prima delle HH:MM» o a un orario scelto. Lo stesso
	 * componente sta sulla riga della coda e nella barra del TaskEditor.
	 *
	 * La programmazione e' l'azione esplicita: il task parte da solo anche con
	 * l'auto-avvio del progetto spento. «Avvia» resta sempre li' e la scavalca.
	 */
	import { m } from '#lib/paraglide/messages.js';
	import { taskStore, type StudioTask } from '#lib/stores/tasks.svelte.ts';
	import { scheduleStore } from '#lib/stores/schedule.svelte.ts';
	import {
		buildAtSchedule,
		isOtherDay,
		nextOccurrence,
		parseClockTime,
		schedulePresets
	} from '#lib/quota/scheduleTarget.ts';
	import { IconClose, IconSchedule } from '#lib/icons.ts';
	import MenuButton from '#lib/ui/MenuButton.svelte';

	let {
		task,
		align = 'right',
		size = 'row',
		label
	}: {
		task: StudioTask;
		align?: 'left' | 'right';
		/** `row`: icona della riga di coda; `toolbar`: barra del TaskEditor. */
		size?: 'row' | 'toolbar';
		/**
		 * Testo visibile accanto all'icona. Senza, il trigger resta la sola icona
		 * da 24 px di sempre; con, il trigger parte da 28 px e mostra il testo
		 * all'hover o al focus, cosi' l'azione puo' stare in una fila di icone
		 * che si espandono.
		 */
		label?: string;
	} = $props();

	let open = $state(false);
	let customOpen = $state(false);
	let customValue = $state('');
	let customError = $state(false);
	let customInputEl = $state<HTMLInputElement | null>(null);
	$effect(() => {
		if (customOpen && customInputEl) customInputEl.focus({ preventScroll: true });
	});

	const scheduled = $derived(Boolean(task.schedule));
	const scheduleLabel = $derived(scheduleStore.labelFor(task));
	const triggerTitle = $derived(
		scheduleLabel
			? m.schedule_button_title_active({ label: scheduleLabel.text })
			: m.schedule_button_title()
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

	function openCustom(event: MouseEvent) {
		// La voce cliccata sparisce: prima il focus passa al menu stabile,
		// altrimenti focusout chiude il popover durante la sostituzione.
		if (event.currentTarget instanceof HTMLElement) {
			event.currentTarget.closest<HTMLElement>('[role="menu"]')?.focus({ preventScroll: true });
		}
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
	className="schedule-trigger {size} {label ? 'labeled' : ''} {scheduled ? 'is-scheduled' : ''}"
	onToggle={() => (open ? close() : (open = true))}
	onClose={close}
>
	{#snippet trigger()}
		<IconSchedule />
		{#if label}<span class="trigger-label" aria-hidden="true">{label}</span>{/if}
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
						<input
							bind:this={customInputEl}
							type="time"
							class="custom-input"
							bind:value={customValue}
							aria-invalid={customError}
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

	/* Trigger etichettato: parte da icona e rivela il testo quando e' sotto il
	   puntatore o ha il fuoco. La misura cresce a destra, le altre azioni della
	   fila restano dove sono. */
	:global(.menu-button.schedule-trigger.labeled) {
		width: auto;
		min-width: 30px;
		height: 28px;
		padding: 0 5px;
		gap: 0;
		justify-content: center;
		color: var(--ink-muted);
		--icon-size: 14px;
	}

	/* Programmato vince sulla tinta di riposo: dopo `.labeled`, non prima. */
	:global(.menu-button.schedule-trigger.labeled.is-scheduled) {
		color: var(--ink);
	}

	:global(.menu-button.schedule-trigger.labeled) .trigger-label {
		max-width: 0;
		opacity: 0;
		overflow: hidden;
		white-space: nowrap;
		font-size: var(--text-caption);
		transition:
			max-width var(--dur-base) var(--ease-out),
			opacity var(--dur-fast) var(--ease-out),
			margin-left var(--dur-base) var(--ease-out);
	}

	:global(.menu-button.schedule-trigger.labeled:hover:not(:disabled)),
	:global(.menu-button.schedule-trigger.labeled:focus-visible) {
		color: var(--ink);
	}

	/* Stesso tetto delle altre azioni: due etichette aperte insieme non devono
	   sfondare la larghezza della card. */
	:global(.menu-button.schedule-trigger.labeled:hover:not(:disabled)) .trigger-label,
	:global(.menu-button.schedule-trigger.labeled:focus-visible) .trigger-label {
		max-width: 68px;
		opacity: 1;
		margin-left: 6px;
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.menu-button.schedule-trigger.labeled) .trigger-label {
			transition: none;
		}
	}

	:global(:root[data-animations='false']) .trigger-label {
		transition: none;
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

</style>
