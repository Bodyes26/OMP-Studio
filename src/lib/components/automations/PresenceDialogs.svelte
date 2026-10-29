<!--
  PresenceDialogs.svelte — Finestre modali per la presenza desktop nativa:
  1. Scelta alla prima chiusura: permanenza in area di notifica (system tray) vs uscita, con preferenza memorizzabile (AUT-054).
  2. Conferma uscita con lavori attivi: avvisa l'utente che l'uscita interrompera' automazioni o sessioni interattive in corso;
     l'annullamento non interrompe ne' killa alcun processo (AUT-045, AUT-054, AUT-055).
-->
<script lang="ts">
	import Dialog from '#lib/ui/Dialog.svelte';
	import StatusMark from '#lib/ui/StatusMark.svelte';
	import { IconClose, IconWarning, IconJobs } from '#lib/icons.ts';
	import { presenceStore } from '#lib/automations/presence.svelte.ts';
	import { getLocale } from '#lib/automations/i18n.ts';
	import { automationsStore } from '#lib/automations/store.svelte.ts';
	import { backgroundJobs } from '#lib/stores/backgroundJobs.svelte.ts';
	import { projectStore } from '#lib/stores/projects.svelte.ts';
	import { getAutomationAssistantActiveCount } from '#lib/automations/assistant.svelte.ts';
	const locale = $derived(getLocale());
	const isIt = $derived(locale === 'it');

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

	function handleKeyDownClose(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			handleCancelClose();
		} else if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleConfirmClose();
		}
	}

	function handleKeyDownExit(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			handleCancelExit();
		}
	}
</script>

<!-- ===================================================================== -->
<!-- 1. Dialogo Scelta Prima Chiusura (Nascondi vs Esci)                   -->
<!-- ===================================================================== -->
{#if presenceStore.showCloseDialog}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		role="region"
		aria-label="close-dialog-wrapper"
		onkeydown={handleKeyDownClose}
	>
		<Dialog
			open={presenceStore.showCloseDialog}
			onClose={handleCancelClose}
			initialFocus="button.ui-button-primary"
			ariaLabelledBy="presence-close-title"
			ariaDescribedBy="presence-close-desc"
		>
			{#snippet header()}
				<div class="dialog-header">
					<div class="header-icon info">
						<IconJobs />
					</div>
					<div class="header-text">
						<h3 id="presence-close-title" class="dialog-title">
							{isIt
								? 'Cosa vuoi fare alla chiusura di Studio?'
								: 'What should happen when closing Studio?'}
						</h3>
						<p id="presence-close-desc" class="dialog-subtitle">
							{isIt
								? 'Puoi continuare a eseguire in background automazioni e compiti nell’area di notifica oppure chiudere completamente l’applicazione.'
								: 'You can keep automations and tasks running in the system tray, or exit the application completely.'}
						</p>
					</div>
					<button
						type="button"
						class="btn-close"
						onclick={handleCancelClose}
						aria-label={isIt ? 'Annulla e chiudi' : 'Cancel and close'}
					>
						<IconClose />
					</button>
				</div>
			{/snippet}

			{#snippet body()}
				<div class="dialog-body-content">
					<fieldset class="options-fieldset">
						<legend class="sr-only">
							{isIt ? 'Opzioni di chiusura' : 'Close options'}
						</legend>

						<!-- Opzione 1: Riduci nell'area di notifica -->
						<label
							class="option-card"
							class:selected={selectedAction === 'hide'}
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
							<div class="option-details">
								<div class="option-title">
									{isIt
										? 'Riduci nell’area di notifica (system tray)'
										: 'Keep running in system tray'}
								</div>
								<div class="option-desc">
									{isIt
										? 'Studio resta attivo nella barra di sistema. Automazioni pianificate, osservatori Git/file e compiti continuano normalmente.'
										: 'Studio stays active in the system tray. Scheduled automations, Git/file watchers, and background tasks continue normally.'}
								</div>
								{#if !presenceStore.state.trayAvailable}
									<div class="option-warning">
										{isIt
											? 'Area di notifica non disponibile su questa piattaforma o ambiente.'
											: 'System tray is not available on this platform or environment.'}
									</div>
								{/if}
							</div>
						</label>

						<!-- Opzione 2: Esci dall'applicazione -->
						<label
							class="option-card"
							class:selected={selectedAction === 'quit'}
						>
							<input
								type="radio"
								name="closeAction"
								value="quit"
								checked={selectedAction === 'quit'}
								onchange={() => (selectedAction = 'quit')}
							/>
							<div class="option-details">
								<div class="option-title">
									{isIt
										? 'Esci dall’applicazione'
										: 'Exit application'}
								</div>
								<div class="option-desc">
									{isIt
										? 'Chiude tutte le finestre, interrompe le esecuzioni e rilascia le risorse.'
										: 'Closes all windows, halts ongoing executions, and frees system resources.'}
								</div>
							</div>
						</label>
					</fieldset>

					<div class="remember-row">
						<label class="remember-label">
							<input
								type="checkbox"
								bind:checked={rememberChoice}
							/>
							<span>
								{isIt
									? 'Ricorda la mia scelta (modificabile nelle Impostazioni)'
									: 'Remember my choice (can be changed in Settings)'}
							</span>
						</label>
					</div>
				</div>
			{/snippet}

			{#snippet footer()}
				<div class="dialog-footer">
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
				</div>
			{/snippet}
		</Dialog>
	</div>
{/if}

<!-- ===================================================================== -->
<!-- 2. Dialogo Conferma Uscita con Lavori in Corso                        -->
<!-- ===================================================================== -->
{#if presenceStore.showExitDialog}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		role="region"
		aria-label="exit-dialog-wrapper"
		onkeydown={handleKeyDownExit}
	>
		<Dialog
			open={presenceStore.showExitDialog}
			onClose={handleCancelExit}
			initialFocus="button.ui-button-primary"
			ariaLabelledBy="presence-exit-title"
			ariaDescribedBy="presence-exit-desc"
		>
			{#snippet header()}
				<div class="dialog-header">
					<div class="header-icon warning">
						<IconWarning />
					</div>
					<div class="header-text">
						<h3 id="presence-exit-title" class="dialog-title warning-text">
							{isIt
								? 'Lavori in corso: confermi l’uscita?'
								: 'Active jobs running: confirm exit?'}
						</h3>
						<p id="presence-exit-desc" class="dialog-subtitle">
							{isIt
								? 'Ci sono processi in esecuzione che verrebbero interrotti se esci adesso.'
								: 'There are active processes that will be interrupted if you exit now.'}
						</p>
					</div>
					<button
						type="button"
						class="btn-close"
						onclick={handleCancelExit}
						aria-label={isIt ? 'Annulla e chiudi' : 'Cancel and close'}
					>
						<IconClose />
					</button>
				</div>
			{/snippet}

			{#snippet body()}
				<div class="dialog-body-content">
					{#if presenceStore.error}
						<div class="error-notice-box" role="alert">
							<div class="error-icon">
								<IconWarning />
							</div>
							<div class="error-text">
								{presenceStore.error}
							</div>
						</div>
					{/if}
					<div class="jobs-summary-box">
						<div class="jobs-lead">
							<StatusMark status="running" active={true} />
							<span class="jobs-count-text">
								{isIt
									? `${backendTotalExecutions} esecuzioni attive in corso`
									: `${backendTotalExecutions} active executions in progress`}
							</span>
						</div>

						{#if activeJobDetails.length > 0}
							<div class="jobs-items-list" role="list">
								{#each activeJobDetails as job (job.id)}
									<div class="job-item-row" role="listitem">
										<div class="job-item-mark">
											<StatusMark status={job.status === 'needsInput' ? 'attention' : 'running'} active={job.status === 'running'} />
										</div>
										<div class="job-item-text">
											<div class="job-item-title">{job.title}</div>
											{#if job.subtitle}
												<div class="job-item-sub">{job.subtitle}</div>
											{/if}
										</div>
										{#if job.status === 'needsInput'}
											<span class="job-badge warn">
												{isIt ? 'Chiede risposta' : 'Needs input'}
											</span>
										{/if}
									</div>
								{/each}

								{#if unlistedCount > 0}
									<div class="job-item-row unlisted-notice">
										<div class="job-item-text">
											<div class="job-item-sub">
												{isIt
													? `Ulteriori ${unlistedCount} esecuzioni attive in background nativo (dettagli in sincronizzazione)`
													: `Additional ${unlistedCount} active executions in native background (details syncing)`}
											</div>
										</div>
									</div>
								{/if}
							</div>
						{:else}
							<p class="job-item-sub unlisted-solo">
								{isIt
									? 'Processi di background o sessioni interattive attive nel motore nativo (nomi specifici non ancora sincronizzati).'
									: 'Background processes or active interactive sessions in native engine (specific names not yet synchronized).'}
							</p>
						{/if}
					</div>

					<p class="safe-notice">
						{isIt
							? 'Se annulli l’uscita, nessun processo verrà terminato e tutte le attività proseguiranno normalmente.'
							: 'If you cancel, no processes will be terminated and all activities will continue normally.'}
					</p>
				</div>
			{/snippet}

			{#snippet footer()}
				<div class="dialog-footer">
					<button
						type="button"
						class="ui-button ui-button-primary"
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
				</div>
			{/snippet}
		</Dialog>
	</div>
{/if}

<style>
	.dialog-header {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 16px 20px;
		border-bottom: 1px solid var(--line-subtle, rgba(255, 255, 255, 0.08));
	}

	.header-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: var(--radius-md, 8px);
		flex-shrink: 0;
	}

	.header-icon.info {
		background: rgba(99, 102, 241, 0.12);
		color: var(--color-primary, #6366f1);
	}

	.header-icon.warning {
		background: rgba(245, 158, 11, 0.12);
		color: var(--color-warn, #f59e0b);
	}

	.header-text {
		flex: 1;
		min-width: 0;
	}

	.dialog-title {
		font-size: 15px;
		font-weight: 600;
		color: var(--text-title, #f8fafc);
		margin: 0 0 4px 0;
		text-wrap: balance;
	}

	.dialog-title.warning-text {
		color: var(--color-warn, #f59e0b);
	}

	.dialog-subtitle {
		font-size: 13px;
		color: var(--text-muted, #94a3b8);
		margin: 0;
		line-height: 1.4;
	}

	.btn-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: var(--radius-sm, 6px);
		border: none;
		background: transparent;
		color: var(--text-muted, #94a3b8);
		cursor: pointer;
		transition: background 0.15s ease, color 0.15s ease;
	}

	.btn-close:hover {
		background: rgba(255, 255, 255, 0.08);
		color: var(--text-title, #f8fafc);
	}

	.dialog-body-content {
		padding: 16px 20px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.options-fieldset {
		border: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.option-card {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 12px 14px;
		border-radius: var(--radius-md, 8px);
		border: 1px solid var(--line-subtle, rgba(255, 255, 255, 0.1));
		background: var(--bg-card, rgba(255, 255, 255, 0.03));
		cursor: pointer;
		transition: border-color 0.15s ease, background 0.15s ease;
	}

	.option-card:hover:not(.disabled) {
		border-color: var(--line-strong, rgba(255, 255, 255, 0.2));
		background: rgba(255, 255, 255, 0.05);
	}

	.option-card.selected {
		border-color: var(--color-primary, #6366f1);
		background: rgba(99, 102, 241, 0.06);
	}

	.option-card.disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.option-card input[type='radio'] {
		margin-top: 3px;
		accent-color: var(--color-primary, #6366f1);
		cursor: inherit;
	}

	.option-details {
		flex: 1;
	}

	.option-title {
		font-size: 13.5px;
		font-weight: 550;
		color: var(--text-title, #f8fafc);
		margin-bottom: 2px;
	}

	.option-desc {
		font-size: 12px;
		color: var(--text-muted, #94a3b8);
		line-height: 1.4;
	}

	.option-warning {
		font-size: 11.5px;
		color: var(--color-warn, #f59e0b);
		margin-top: 4px;
	}

	.remember-row {
		display: flex;
		align-items: center;
		padding-top: 4px;
	}

	.remember-label {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 12.5px;
		color: var(--text-main, #e2e8f0);
		cursor: pointer;
		user-select: none;
	}

	.remember-label input[type='checkbox'] {
		accent-color: var(--color-primary, #6366f1);
		width: 14px;
		height: 14px;
	}

	.jobs-summary-box {
		padding: 12px 14px;
		border-radius: var(--radius-md, 8px);
		border: 1px solid rgba(245, 158, 11, 0.25);
		background: rgba(245, 158, 11, 0.06);
	}

	.jobs-lead {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13.5px;
		font-weight: 600;
		color: var(--text-title, #f8fafc);
		margin-bottom: 8px;
	}

	.jobs-list {
		margin: 0;
		padding-left: 20px;
		font-size: 12.5px;
		color: var(--text-muted, #94a3b8);
		line-height: 1.5;
	}

	.safe-notice {
		font-size: 12.5px;
		color: var(--text-muted, #94a3b8);
		margin: 0;
		line-height: 1.4;
	}

	.dialog-footer {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		padding: 14px 20px;
		border-top: 1px solid var(--line-subtle, rgba(255, 255, 255, 0.08));
	}

	.ui-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 6px 14px;
		font-size: 13px;
		font-weight: 500;
		border-radius: var(--radius-sm, 6px);
		border: 1px solid transparent;
		cursor: pointer;
		transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
	}

	.ui-button-ghost {
		background: transparent;
		color: var(--text-muted, #94a3b8);
		border-color: var(--line-subtle, rgba(255, 255, 255, 0.1));
	}

	.ui-button-ghost:hover {
		background: rgba(255, 255, 255, 0.05);
		color: var(--text-title, #f8fafc);
	}

	.ui-button-primary {
		background: var(--color-primary, #6366f1);
		color: #ffffff;
	}

	.ui-button-primary:hover {
		filter: brightness(1.1);
	}

	.ui-button-danger {
		background: var(--color-danger, #ef4444);
		color: #ffffff;
	}

	.ui-button-danger:hover {
		filter: brightness(1.1);
	}

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
	.error-notice-box {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 10px 14px;
		border-radius: var(--radius-md, 8px);
		border: 1px solid rgba(239, 68, 68, 0.35);
		background: rgba(239, 68, 68, 0.08);
		color: var(--color-danger, #ef4444);
		font-size: 12.5px;
		line-height: 1.4;
	}

	.error-icon {
		flex-shrink: 0;
		margin-top: 1px;
	}

	.error-text {
		flex: 1;
	}

	.jobs-items-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 10px;
		max-height: 220px;
		overflow-y: auto;
		padding-right: 4px;
	}

	.job-item-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 7px 10px;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid var(--line-subtle, rgba(255, 255, 255, 0.08));
		border-radius: var(--radius-sm, 6px);
	}

	.job-item-mark {
		flex-shrink: 0;
		display: flex;
		align-items: center;
	}

	.job-item-text {
		flex: 1;
		min-width: 0;
	}

	.job-item-title {
		font-size: 13px;
		font-weight: 550;
		color: var(--text-title, #f8fafc);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.job-item-sub {
		font-size: 11.5px;
		color: var(--text-muted, #94a3b8);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		margin-top: 1px;
	}

	.job-badge {
		font-size: 11px;
		font-weight: 500;
		padding: 2px 6px;
		border-radius: 4px;
		flex-shrink: 0;
	}

	.job-badge.warn {
		background: rgba(245, 158, 11, 0.15);
		color: var(--color-warn, #f59e0b);
		border: 1px solid rgba(245, 158, 11, 0.3);
	}

	.unlisted-notice {
		background: transparent;
		border-style: dashed;
	}

	.unlisted-solo {
		margin: 6px 0 0 0;
		font-size: 12px;
		color: var(--text-muted, #94a3b8);
	}

</style>
