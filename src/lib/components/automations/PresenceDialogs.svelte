<!--
  PresenceDialogs.svelte — Finestre modali per la presenza desktop nativa:
  1. Scelta alla prima chiusura: permanenza in area di notifica / menu bar vs uscita, con preferenza memorizzabile (AUT-054).
  2. Conferma uscita con lavori attivi: avvisa l'utente che l'uscita interrompera' automazioni o sessioni interattive in corso;
     l'annullamento non interrompe ne' termina alcun processo (AUT-045, AUT-054, AUT-055).
  Allineato a Design v2: usa la primitiva Dialog nativa con isolamento top-layer, token semantici, controlli .ui-choice e .ui-checkbox.
-->
<script lang="ts">
	import Dialog from '#lib/ui/Dialog.svelte';
	import StatusMark from '#lib/ui/StatusMark.svelte';
	import { IconJobs, IconWarning, IconCircleAlert } from '#lib/icons.ts';
	import { presenceStore } from '#lib/automations/presence.svelte.ts';
	import { getLocale } from '#lib/automations/i18n.ts';
	import { automationsStore } from '#lib/automations/store.svelte.ts';
	import { backgroundJobs } from '#lib/stores/backgroundJobs.svelte.ts';
	import { projectStore } from '#lib/stores/projects.svelte.ts';
	import { getAutomationAssistantActiveCount } from '#lib/automations/assistant.svelte.ts';
	import { IS_MAC } from '#lib/utils/platform.ts';

	const locale = $derived(getLocale());
	const isIt = $derived(locale === 'it');
	// Rilevamento piattaforma per distinguere "barra dei menu" (macOS) da "area di notifica" (Windows/Linux)
	const isMac = $derived(IS_MAC || presenceStore.state.platform === 'macos');

	// Stato locale per il dialogo di prima chiusura
	let selectedAction = $state<'hide' | 'quit'>('hide');
	let rememberChoice = $state<boolean>(false);

	// All'apertura della modale di chiusura, impostiamo la scelta iniziale in base alla tray
	$effect(() => {
		if (presenceStore.showCloseDialog) {
			if (presenceStore.state.trayAvailable) {
				selectedAction = 'hide';
			} else {
				selectedAction = 'quit';
			}
			rememberChoice = presenceStore.state.rememberCloseAction;
		}
	});

	function handleConfirmClose() {
		void presenceStore.confirmCloseChoice(selectedAction, rememberChoice);
	}

	function handleCancelClose() {
		void presenceStore.cancelCloseChoice();
	}

	function handleConfirmExit() {
		void presenceStore.confirmExit();
	}

	function handleCancelExit() {
		void presenceStore.cancelExit();
	}

	interface ActiveJobDetail {
		id: string;
		kind: 'automation' | 'interactive' | 'background' | 'assistant';
		title: string;
		subtitle: string;
		status: 'running' | 'needsInput';
	}

	const activeJobDetails = $derived.by<ActiveJobDetail[]>(() => {
		const items: ActiveJobDetail[] = [];

		// 1. Automazioni attive o con richiesta di input da automationsStore
		const runs = automationsStore.snapshot?.runs ?? [];
		for (const run of runs) {
			const activeExecs = run.executions.filter(
				(e) => e.state === 'running' || e.state === 'needsInput'
			);
			if (activeExecs.length > 0) {
				const hasInput = activeExecs.some((e) => e.state === 'needsInput');
				const targetsText =
					run.targets.length > 0
						? run.targets.length === 1
							? (run.targets[0].name || run.targets[0].path)
							: `${run.targets.length} ${isIt ? 'destinatari' : 'targets'}`
						: '';

				items.push({
					id: `automation-${run.id}`,
					kind: 'automation',
					title: run.name || (isIt ? 'Automazione' : 'Automation'),
					subtitle: targetsText
						? `${isIt ? 'Destinatari' : 'Targets'}: ${targetsText}`
						: (isIt ? 'Esecuzione attiva' : 'Active execution'),
					status: hasInput ? 'needsInput' : 'running'
				});
			}
		}

		// 2. Generazione titoli AI in background
		if (backgroundJobs.running) {
			const jId = backgroundJobs.running.id;
			if (jId === 'taskTitles' || jId === 'sessionTitles') {
				items.push({
					id: `bg-job-${jId}`,
					kind: 'background',
					title: isIt
						? (jId === 'taskTitles' ? 'Generazione titoli task (AI)' : 'Generazione titoli sessioni (AI)')
						: (jId === 'taskTitles' ? 'AI Task Title Generation' : 'AI Session Title Generation'),
					subtitle: isIt ? 'Manutenzione AI in background' : 'AI background maintenance',
					status: 'running'
				});
			}
		}

		// 3. Chat / corsie interattive al lavoro
		for (const p of projectStore.projects) {
			if (p.lane?.agentState === 'working') {
				items.push({
					id: `project-${p.id}`,
					kind: 'interactive',
					title: p.label?.trim() || p.name || (isIt ? 'Progetto' : 'Project'),
					subtitle: isIt ? 'Sessione agente attiva al lavoro' : 'Active agent session working',
					status: 'running'
				});
			}
		}

		// 4. Assistente creazione automazioni
		const assistantCount = getAutomationAssistantActiveCount();
		if (assistantCount > 0) {
			items.push({
				id: 'assistant-active-session',
				kind: 'assistant',
				title: isIt ? 'Assistente Creazione Automazioni' : 'Automation Creator Assistant',
				subtitle: isIt
					? `${assistantCount} sessione/i in elaborazione`
					: `${assistantCount} active session(s)`,
				status: 'running'
			});
		}

		return items;
	});

	const backendTotalExecutions = $derived(
		presenceStore.pendingExitJobs?.totalJobs ?? activeJobDetails.length
	);

	const unlistedCount = $derived(
		Math.max(0, backendTotalExecutions - activeJobDetails.length)
	);
</script>

<!-- ===================================================================== -->
<!-- 1. Dialogo Scelta Prima Chiusura (Nascondi vs Esci, AUT-054)          -->
<!-- ===================================================================== -->
<Dialog
	open={presenceStore.showCloseDialog}
	title={isIt ? 'Cosa vuoi fare alla chiusura di Studio?' : 'What should happen when closing Studio?'}
	onClose={handleCancelClose}
	initialFocus="button.ui-button-primary"
	ariaDescribedBy="presence-close-desc"
>
	{#snippet icon()}
		<span class="dialog-icon-wrap">
			<IconJobs />
		</span>
	{/snippet}

	{#snippet body()}
		<p id="presence-close-desc" class="dialog-intro">
			{isIt
				? (isMac
					? 'Puoi continuare a eseguire in background automazioni e compiti nella barra dei menu oppure chiudere completamente l’applicazione.'
					: 'Puoi continuare a eseguire in background automazioni e compiti nell’area di notifica oppure chiudere completamente l’applicazione.')
				: (isMac
					? 'You can keep automations and tasks running in the menu bar, or exit the application completely.'
					: 'You can keep automations and tasks running in the system tray, or exit the application completely.')}
		</p>

		<fieldset class="options-group">
			<legend class="sr-only">
				{isIt ? 'Opzioni di chiusura' : 'Close options'}
			</legend>

			<!-- Opzione 1: Riduci nell'area di sistema -->
			<label
				class="ui-choice choice-card"
				class:disabled={!presenceStore.state.trayAvailable}
			>
				<input
					type="radio"
					name="closeAction"
					value="hide"
					checked={selectedAction === 'hide'}
					disabled={!presenceStore.state.trayAvailable}
					onchange={() => (selectedAction = 'hide')}
				/>
				<div class="choice-content">
					<span class="choice-title">
						{isIt
							? (isMac ? 'Riduci nella barra dei menu' : 'Riduci nell’area di notifica (system tray)')
							: (isMac ? 'Keep running in menu bar' : 'Keep running in system tray')}
					</span>
					<p class="choice-desc">
						{isIt
							? (isMac
								? 'Studio resta attivo nella barra dei menu. Automazioni pianificate, osservatori Git/file e compiti continuano normalmente.'
								: 'Studio resta attivo nell’area di notifica. Automazioni pianificate, osservatori Git/file e compiti continuano normalmente.')
							: (isMac
								? 'Studio stays active in the menu bar. Scheduled automations, Git/file watchers, and background tasks continue normally.'
								: 'Studio stays active in the system tray. Scheduled automations, Git/file watchers, and background tasks continue normally.')}
					</p>
					{#if !presenceStore.state.trayAvailable}
						<span class="choice-warning">
							{isIt
								? (isMac ? 'Barra dei menu non disponibile su questa piattaforma o ambiente.' : 'Area di notifica non disponibile su questa piattaforma o ambiente.')
								: (isMac ? 'Menu bar is not available on this platform or environment.' : 'System tray is not available on this platform or environment.')}
						</span>
					{/if}
				</div>
			</label>

			<!-- Opzione 2: Esci dall'applicazione -->
			<label class="ui-choice choice-card">
				<input
					type="radio"
					name="closeAction"
					value="quit"
					checked={selectedAction === 'quit'}
					onchange={() => (selectedAction = 'quit')}
				/>
				<div class="choice-content">
					<span class="choice-title">
						{isIt ? 'Esci dall’applicazione' : 'Exit application'}
					</span>
					<p class="choice-desc">
						{isIt
							? 'Chiude tutte le finestre, interrompe le esecuzioni e rilascia le risorse.'
							: 'Closes all windows, halts ongoing executions, and frees system resources.'}
					</p>
				</div>
			</label>
		</fieldset>

		<label class="remember-row">
			<input
				type="checkbox"
				class="ui-checkbox"
				bind:checked={rememberChoice}
			/>
			<span class="remember-text">
				{isIt
					? 'Ricorda la mia scelta (modificabile nelle Impostazioni)'
					: 'Remember my choice (can be changed in Settings)'}
			</span>
		</label>
	{/snippet}

	{#snippet footer()}
		<button
			type="button"
			class="ui-button ui-button-ghost"
			onclick={handleCancelClose}
		>
			{isIt ? 'Annulla' : 'Cancel'}
		</button>
		<button
			type="button"
			class="ui-button ui-button-primary"
			onclick={handleConfirmClose}
		>
			{isIt ? 'Conferma' : 'Confirm'}
		</button>
	{/snippet}
</Dialog>

<!-- ===================================================================== -->
<!-- 2. Dialogo Conferma Uscita con Lavori in Corso (AUT-045, AUT-054)     -->
<!-- ===================================================================== -->
<Dialog
	open={presenceStore.showExitDialog}
	title={isIt ? 'Lavori in corso: confermi l’uscita?' : 'Active jobs running: confirm exit?'}
	onClose={handleCancelExit}
	initialFocus="button.ui-button-secondary"
	ariaDescribedBy="presence-exit-desc"
>
	{#snippet icon()}
		<span class="dialog-icon-wrap warn">
			<IconWarning />
		</span>
	{/snippet}

	{#snippet body()}
		<p id="presence-exit-desc" class="dialog-intro">
			{isIt
				? 'Ci sono processi in esecuzione che verrebbero interrotti se esci adesso.'
				: 'There are active processes that will be interrupted if you exit now.'}
		</p>

		{#if presenceStore.error}
			<div class="dialog-error-row" role="alert">
				<span class="dialog-error-mark">
					<IconCircleAlert />
				</span>
				<span class="dialog-error-text">
					{presenceStore.error}
				</span>
			</div>
		{/if}

		<div class="jobs-box">
			<div class="jobs-box-header">
				<StatusMark status="running" active={true} />
				<span class="jobs-count">
					{isIt
						? `${backendTotalExecutions} ${backendTotalExecutions === 1 ? 'esecuzione attiva' : 'esecuzioni attive'}`
						: `${backendTotalExecutions} active ${backendTotalExecutions === 1 ? 'execution' : 'executions'}`}
				</span>
				<span class="jobs-meta">
					{isIt ? 'in corso' : 'in progress'}
				</span>
			</div>

			{#if activeJobDetails.length > 0}
				<div class="jobs-list" role="list">
					{#each activeJobDetails as job (job.id)}
						<div class="job-row" role="listitem">
							<div class="job-mark">
								<StatusMark
									status={job.status === 'needsInput' ? 'attention' : 'running'}
									active={job.status === 'running'}
								/>
							</div>
							<div class="job-details">
								<span class="job-title">{job.title}</span>
								{#if job.subtitle}
									<span class="job-sub">{job.subtitle}</span>
								{/if}
							</div>
							{#if job.status === 'needsInput'}
								<span class="job-badge">
									{isIt ? 'Chiede risposta' : 'Needs input'}
								</span>
							{/if}
						</div>
					{/each}

					{#if unlistedCount > 0}
						<div class="unlisted-row">
							{isIt
								? `Ulteriori ${unlistedCount} esecuzioni attive in background nativo`
								: `Additional ${unlistedCount} active executions in native background`}
						</div>
					{/if}
				</div>
			{:else}
				<p class="jobs-empty-text">
					{isIt
						? 'Processi di background o sessioni interattive attive nel motore nativo.'
						: 'Background processes or active interactive sessions in native engine.'}
				</p>
			{/if}
		</div>

		<p class="safe-notice">
			{isIt
				? 'Se annulli l’uscita, nessun processo verrà terminato e tutte le attività proseguiranno normalmente.'
				: 'If you cancel, no processes will be terminated and all activities will continue normally.'}
		</p>
	{/snippet}

	{#snippet footer()}
		<button
			type="button"
			class="ui-button ui-button-secondary"
			onclick={handleCancelExit}
		>
			{isIt ? 'Continua a lavorare' : 'Keep running'}
		</button>
		<button
			type="button"
			class="ui-button ui-button-danger"
			onclick={handleConfirmExit}
		>
			{isIt ? 'Interrompi ed esci' : 'Interrupt and exit'}
		</button>
	{/snippet}
</Dialog>

<style>
	/* Icone nelle testate dei dialoghi */
	.dialog-icon-wrap {
		display: flex;
		align-items: center;
		justify-content: center;
		--icon-size: 16px;
		color: var(--ink-muted);
	}

	.dialog-icon-wrap.warn {
		color: var(--warn);
	}

	/* Testo introduttivo comune */
	.dialog-intro {
		margin: 0;
		font-size: var(--text-body);
		line-height: 1.45;
		color: var(--ink-muted);
	}

	/* Gruppo opzioni radio a card (.ui-choice dal design system) */
	.options-group {
		border: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.choice-card {
		flex-direction: row;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-3);
	}

	.choice-card input[type='radio'] {
		margin-top: 2px;
		accent-color: var(--brand);
		flex-shrink: 0;
		cursor: inherit;
	}

	.choice-card.disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.choice-content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.choice-title {
		font-size: var(--text-body);
		font-weight: 550;
		color: var(--ink);
		line-height: 1.35;
	}

	.choice-desc {
		margin: 0;
		font-size: var(--text-label);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.choice-warning {
		font-size: var(--text-caption);
		color: var(--warn);
		line-height: 1.35;
		margin-top: 2px;
	}

	/* Riga di memorizzazione preferenza */
	.remember-row {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		cursor: pointer;
		user-select: none;
		margin-top: 2px;
		width: fit-content;
	}

	.remember-text {
		font-size: var(--text-label);
		color: var(--ink);
		line-height: 1.4;
	}

	/* Errore eventuale di presenza */
	.dialog-error-row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid color-mix(in oklch, var(--danger) 35%, var(--line));
		border-radius: var(--radius-md);
		background: color-mix(in oklab, var(--danger) 8%, var(--bg-sunken));
		font-size: var(--text-label);
		line-height: 1.4;
		color: var(--ink);
	}

	.dialog-error-mark {
		color: var(--danger);
		flex-shrink: 0;
		margin-top: 1px;
		--icon-size: 14px;
	}

	.dialog-error-text {
		flex: 1;
		min-width: 0;
	}

	/* Riquadro compatto dei lavori attivi */
	.jobs-box {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
		overflow: hidden;
	}

	.jobs-box-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--line);
		background: color-mix(in oklab, var(--bg-hover) 40%, transparent);
		font-size: var(--text-label);
		font-weight: 550;
		color: var(--ink);
	}

	.jobs-count {
		font-variant-numeric: tabular-nums;
	}

	.jobs-meta {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		font-weight: 400;
		margin-left: auto;
	}

	.jobs-list {
		display: flex;
		flex-direction: column;
		max-height: 220px;
		overflow-y: auto;
		padding: 2px 0;
	}

	.job-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 6px var(--space-3);
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.job-row:not(:last-child) {
		border-bottom: 1px solid var(--line);
	}

	.job-row:hover {
		background: var(--bg-hover);
	}

	.job-mark {
		flex-shrink: 0;
		display: flex;
		align-items: center;
	}

	.job-details {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.job-title {
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.job-sub {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.job-badge {
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--warn);
		flex-shrink: 0;
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		border: 1px solid color-mix(in oklch, var(--warn) 35%, var(--line));
		background: color-mix(in oklab, var(--warn) 10%, transparent);
		white-space: nowrap;
	}

	.unlisted-row {
		padding: var(--space-2) var(--space-3);
		font-size: var(--text-caption);
		color: var(--ink-faint);
		line-height: 1.35;
		border-top: 1px dashed var(--line);
	}

	.jobs-empty-text {
		margin: 0;
		padding: var(--space-3);
		font-size: var(--text-label);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.safe-notice {
		margin: 0;
		font-size: var(--text-label);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	/* Accessibilità: etichetta solo per screen reader */
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>

