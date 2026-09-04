<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { fade, slide } from 'svelte/transition';
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import { companionStore, type AttentionRequest, type QuickTaskAiParsed, type QuotaWarning } from '$lib/stores/companion.svelte';
	import { projectStore } from '$lib/stores/projects.svelte';
	import { quotaStore, providersMatch } from '$lib/stores/quota.svelte';
	import { modelSettingsStore } from '$lib/stores/modelSettings.svelte';
	import UsagePopover from '$lib/components/UsagePopover.svelte';
	import {
		IconCheck,
		IconClose,
		IconPin,
		IconPinned,
		IconQueue,
		IconStatusPending,
		IconStatusRunning,
		IconWarning,
		IconSparkles,
		IconArrowRight,
		IconPlus
	} from '$lib/icons';

	let inputEl = $state<HTMLTextAreaElement | null>(null);
	let taskInput = $state('');
	let parsedTask = $state<QuickTaskAiParsed | null>(null);
	let quotaWarning = $state<QuotaWarning | null>(null);
	let isSaving = $state(false);
	let successNotice = $state<string | null>(null);
	let expandedHistory = $state<Record<string, boolean>>({});
	let usageOpen = $state(false);
	let usageAnchorEl = $state<HTMLElement | null>(null);

	let parseDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	let unlistenSummon: UnlistenFn | null = null;

	const attentionList = $derived(companionStore.attentionRequests);
	const activeProjects = $derived(
		(companionStore.projects.length > 0 ? companionStore.projects : projectStore.projects).filter((p) => p.path)
	);

	// Quota minima tra tutti i provider per il badge compatto
	const overallQuota = $derived.by(() => {
		const windows = quotaStore.reports.flatMap((r) =>
			(r.limits ?? []).flatMap((l) => {
				const rem = l.amount?.remainingFraction ??
					(l.amount?.usedFraction === undefined ? undefined : 1 - l.amount.usedFraction);
				if (rem === undefined) return [];
				return [Math.round(Math.max(0, Math.min(1, rem)) * 100)];
			})
		);
		if (windows.length === 0) return null;
		return Math.min(...windows);
	});

	onMount(() => {
		void companionStore.init();
		void quotaStore.init();
		void modelSettingsStore.loadAll();

		// Focus automatico del campo input
		void tick().then(() => inputEl?.focus());

		// Ascolta l'evento di summon globale da Rust
		void listen('companion-summon', () => {
			void tick().then(() => inputEl?.focus());
		}).then((fn) => {
			unlistenSummon = fn;
		});

		// Auto-chiusura su blur solo se non pinnato
		const handleBlur = () => {
			if (!companionStore.isPinned && !usageOpen) {
				void companionStore.hideCompanion();
			}
		};

		window.addEventListener('blur', handleBlur);

		return () => {
			window.removeEventListener('blur', handleBlur);
			unlistenSummon?.();
			if (parseDebounceTimer) clearTimeout(parseDebounceTimer);
		};
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			if (usageOpen) {
				usageOpen = false;
				return;
			}
			void companionStore.hideCompanion();
		} else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			void handleSaveTask();
		}
	}

	function handleInputChange() {
		if (parseDebounceTimer) clearTimeout(parseDebounceTimer);
		const text = taskInput.trim();
		if (!text) {
			parsedTask = null;
			quotaWarning = null;
			return;
		}

		// Debounce parsing NL di 400ms per non spammare chiamate effimere durante la digitazione veloce
		parseDebounceTimer = setTimeout(async () => {
			const res = await companionStore.parseQuickTask(text);
			if (res) {
				parsedTask = res;
				quotaWarning = companionStore.checkQuota(res.role || res.modelSelector);
			}
		}, 450);
	}

	async function handleSaveTask() {
		const text = taskInput.trim();
		if (!text || isSaving) return;

		isSaving = true;
		try {
			// Se il parsing non e' ancora avvenuto, esegui subito
			let taskToSave = parsedTask;
			if (!taskToSave) {
				taskToSave = await companionStore.parseQuickTask(text);
				parsedTask = taskToSave;
			}

			if (!taskToSave) {
				return;
			}

			if (!taskToSave.projectPath) {
				return;
			}

			const ok = await companionStore.saveTask(taskToSave);
			if (ok) {
				successNotice = `Task aggiunto a ${taskToSave.projectName || 'progetto'}!`;
				taskInput = '';
				parsedTask = null;
				quotaWarning = null;
				setTimeout(() => {
					successNotice = null;
					if (!companionStore.isPinned) {
						void companionStore.hideCompanion();
					}
				}, 1200);
			}
		} finally {
			isSaving = false;
		}
	}

	async function handleQuickReplySelect(projectId: string, value: string) {
		await companionStore.respondUi(projectId, { action: 'select', value });
	}

	async function handleQuickReplyConfirm(projectId: string, confirmed: boolean) {
		await companionStore.respondUi(projectId, { action: 'confirm', confirmed });
	}

	async function handleQuickReplyCancel(projectId: string) {
		await companionStore.respondUi(projectId, { action: 'cancel' });
	}

	function toggleHistory(projectId: string) {
		expandedHistory[projectId] = !expandedHistory[projectId];
	}

	function togglePinned() {
		void companionStore.setPinned(!companionStore.isPinned);
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="companion-shell" class:pinned={companionStore.isPinned}>
	<!-- Header con drag region, status, quota e pin -->
	<header class="companion-header" data-tauri-drag-region>
		<div class="header-left" data-tauri-drag-region>
			<span class="app-logo">OMP</span>
			<span class="companion-badge">{companionStore.isPinned ? 'Widget' : 'Spotlight'}</span>
		</div>

		<div class="header-right">
			{#if overallQuota !== null}
				<button
					type="button"
					class="quota-pill"
					class:low={overallQuota <= 20}
					class:exhausted={overallQuota <= 0}
					bind:this={usageAnchorEl}
					onclick={() => (usageOpen = !usageOpen)}
					title="Quota minima rimanente tra i modelli attivi"
				>
					<span>Quota {overallQuota}%</span>
				</button>
			{/if}

			<button
				type="button"
				class="icon-btn"
				class:active={companionStore.isPinned}
				onclick={togglePinned}
				title={companionStore.isPinned ? 'Sblocca finestra (modalità Spotlight)' : 'Fissa su questo monitor (modalità Widget persistente)'}
				aria-label={companionStore.isPinned ? 'Sblocca finestra' : 'Fissa finestra'}
			>
				{#if companionStore.isPinned}
					<IconPinned />
				{:else}
					<IconPin />
				{/if}
			</button>

			<button
				type="button"
				class="icon-btn close-btn"
				onclick={() => void companionStore.hideCompanion()}
				title="Chiudi (Esc)"
				aria-label="Chiudi finestra"
			>
				<IconClose />
			</button>
		</div>
	</header>

	<!-- Popover quota ancorato al badge -->
	{#if usageOpen}
		<UsagePopover open={usageOpen} onClose={() => (usageOpen = false)} />
	{/if}

	<main class="companion-body">
		<!-- Sezione Richieste di Attenzione Prioritarie (Quick Reply) -->
		{#if attentionList.length > 0}
			<section class="attention-section">
				<div class="section-title">
					<IconWarning />
					<span>Richieste di intervento ({attentionList.length})</span>
				</div>

				{#each attentionList as req (req.projectId)}
					<div class="attention-card" style="--proj-hue: {req.projectHue}">
						<div class="card-header">
							<span class="project-pill">{req.projectName}</span>
							{#if req.modelName}
								<span class="model-badge">{req.modelName}</span>
							{/if}
						</div>

						<!-- Contesto Chat (ultimi messaggi) -->
						{#if req.recentMessages && req.recentMessages.length > 0}
							{@const messagesToShow = expandedHistory[req.projectId]
								? req.recentMessages
								: req.recentMessages.slice(-2)}
							<div class="chat-context">
								{#each messagesToShow as msg, i (i)}
									<div class="context-bubble {msg.role}">
										<span class="role-tag">{msg.role === 'user' ? 'Tu' : 'Agente'}:</span>
										<span class="bubble-text">{msg.text}</span>
									</div>
								{/each}

								{#if req.recentMessages.length > 2}
									<button
										type="button"
										class="history-toggle-btn"
										onclick={() => toggleHistory(req.projectId)}
									>
										{expandedHistory[req.projectId] ? 'Mostra meno contesto' : `Mostra altri ${req.recentMessages.length - 2} messaggi`}
									</button>
								{/if}
							</div>
						{/if}

						<!-- Domanda / Richiesta interattiva -->
						<div class="ask-box">
							<p class="ask-question">{req.pendingUi.message || req.pendingUi.title || 'Seleziona un’opzione:'}</p>

							<!-- Opzioni Select -->
							{#if req.pendingUi.options && req.pendingUi.options.length > 0}
								<div class="options-grid">
									{#each req.pendingUi.options as opt, idx (opt)}
										<button
											type="button"
											class="option-btn"
											onclick={() => void handleQuickReplySelect(req.projectId, opt)}
										>
											<span class="opt-num">{idx + 1}</span>
											<span class="opt-label">{opt}</span>
										</button>
									{/each}
								</div>
							{:else if req.pendingUi.method === 'confirm'}
								<div class="confirm-actions">
									<button
										type="button"
										class="action-btn confirm"
										onclick={() => void handleQuickReplyConfirm(req.projectId, true)}
									>
										<IconCheck /> <span>Sì, procedi</span>
									</button>
									<button
										type="button"
										class="action-btn cancel"
										onclick={() => void handleQuickReplyConfirm(req.projectId, false)}
									>
										<IconClose /> <span>No, annulla</span>
									</button>
								</div>
							{:else}
								<div class="generic-actions">
									<button
										type="button"
										class="action-btn cancel"
										onclick={() => void handleQuickReplyCancel(req.projectId)}
									>
										Ignora / Chiudi
									</button>
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</section>
		{/if}

		<!-- Sezione Inserimento Rapido Task in Linguaggio Naturale -->
		<section class="quick-task-section">
			<div class="task-input-box">
				<textarea
					bind:this={inputEl}
					bind:value={taskInput}
					oninput={handleInputChange}
					rows="3"
					placeholder="Descrivi il task in linguaggio naturale... es: 'contratti affitto cambiare colore pulsante nuovo contratto agente smol ponytail'"
					aria-label="Testo del task in linguaggio naturale"
				></textarea>

				<div class="input-actions">
					<span class="kbd-hint">Ctrl+Invio per salvare</span>
					<button
						type="button"
						class="save-task-btn"
						disabled={!taskInput.trim() || isSaving || companionStore.isParsingTask}
						onclick={handleSaveTask}
					>
						{#if isSaving || companionStore.isParsingTask}
							<span class="spinner"></span>
							<span>Elaborazione...</span>
						{:else}
							<IconPlus />
							<span>Salva task</span>
						{/if}
					</button>
				</div>
			</div>

			<!-- Notifica di successo -->
			{#if successNotice}
				<div class="notice success" transition:slide={{ duration: 180 }}>
					<IconCheck />
					<span>{successNotice}</span>
				</div>
			{/if}

			<!-- Avvisi di parsing o ambiguita' -->
			{#if companionStore.parseError}
				<div class="notice error" transition:slide={{ duration: 180 }}>
					<IconWarning />
					<span>{companionStore.parseError}</span>
				</div>
			{/if}

			<!-- Anteprima Task Interpretato -->
			{#if parsedTask}
				<div class="parsed-preview" transition:slide={{ duration: 180 }}>
					<div class="parsed-header">
						<span class="badge-title"><IconSparkles /> Interpretazione AI:</span>
						<div class="parsed-tags">
							{#if parsedTask.projectName}
								<span class="parsed-tag project">{parsedTask.projectName}</span>
							{:else}
								<span class="parsed-tag missing">Progetto mancante</span>
							{/if}

							{#if parsedTask.role}
								<span class="parsed-tag role">Ruolo: {parsedTask.role}</span>
							{/if}

							{#if parsedTask.modelSelector}
								<span class="parsed-tag model">Modello: {parsedTask.modelSelector}</span>
							{/if}

							{#each parsedTask.directiveIds as dId (dId)}
								<span class="parsed-tag directive">+{dId}</span>
							{/each}
						</div>
					</div>

					<div class="parsed-prompt">
						<span class="prompt-label">Prompt:</span>
						<p>{parsedTask.taskPrompt}</p>
					</div>

					<!-- Errori di ambiguita' individuati dal modello -->
					{#if parsedTask.ambiguities && parsedTask.ambiguities.length > 0}
						<div class="ambiguities-box">
							{#each parsedTask.ambiguities as amb, idx (idx)}
								<p class="ambiguity-item"><IconWarning /> {amb}</p>
							{/each}
						</div>
					{/if}

					<!-- Allerta Quota Modello/Ruolo esaurita -->
					{#if quotaWarning && quotaWarning.isExhausted}
						<div class="quota-exhausted-alert">
							<IconWarning />
							<div>
								<strong>Quota esaurita per {quotaWarning.roleOrModel} ({quotaWarning.provider})</strong>
								<p>Il modello selezionato ha esaurito la quota disponibile. Puoi comunque salvare il task o indicare un altro modello nel testo (es. 'usa gpt 5.6 sol').</p>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</section>

		<!-- Live Monitor Agenti dei progetti aperti (visibile soprattutto quando pinnato) -->
		{#if companionStore.isPinned && activeProjects.length > 0}
			<section class="live-monitor-section">
				<div class="section-title">
					<IconStatusRunning />
					<span>Progetti attivi ({activeProjects.length})</span>
				</div>

				<div class="projects-list">
					{#each activeProjects as p (p.id)}
						<div class="project-row" style="--proj-hue: {p.hue}">
							<span class="p-dot"></span>
							<span class="p-name">{p.name}</span>
							<span class="p-state state-{p.agentState}">
								{#if p.agentState === 'working'}
									<IconStatusRunning /> In esecuzione
								{:else if p.agentState === 'attention'}
									<IconWarning /> Richiede risposta
								{:else if p.agentState === 'finished'}
									<IconCheck /> Completato
								{:else}
									<IconStatusPending /> In attesa
								{/if}
							</span>
						</div>
					{/each}
				</div>
			</section>
		{/if}
	</main>
</div>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		background: transparent !important;
		user-select: none;
	}

	.companion-shell {
		display: flex;
		flex-direction: column;
		width: 100vw;
		height: 100vh;
		background: var(--bg-base);
		color: var(--ink);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4), 0 0 0 1px var(--line);
		overflow: hidden;
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		box-sizing: border-box;
	}

	.companion-shell.pinned {
		border-color: var(--brand);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3), 0 0 0 1px var(--brand-line);
	}

	.companion-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		background: var(--bg-sunken);
		border-bottom: 1px solid var(--line);
		cursor: grab;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.app-logo {
		font-family: var(--font-mono);
		font-weight: 700;
		font-size: var(--text-xs);
		color: var(--brand);
		letter-spacing: 0.05em;
	}

	.companion-badge {
		font-size: var(--text-xs);
		padding: 2px 6px;
		background: var(--bg-hover);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.quota-pill {
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		padding: 2px 8px;
		background: var(--bg-hover);
		border: 1px solid var(--line);
		border-radius: 999px;
		color: var(--ink-muted);
		cursor: pointer;
		transition: background var(--dur-fast), border-color var(--dur-fast);
	}

	.quota-pill:hover {
		background: var(--bg-base);
		color: var(--ink);
	}

	.quota-pill.low {
		border-color: var(--warning);
		color: var(--warning);
	}

	.quota-pill.exhausted {
		border-color: var(--danger);
		color: var(--danger);
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		cursor: pointer;
	}

	.icon-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.icon-btn.active {
		color: var(--brand);
		background: var(--brand-tint);
		border-color: var(--brand-line);
	}

	.close-btn:hover {
		color: var(--danger);
		background: var(--danger-tint);
	}

	.companion-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);
		overflow-y: auto;
	}

	.section-title {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: var(--space-2);
	}

	/* Card Richiesta di Attenzione */
	.attention-card {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-left: 4px solid hsl(var(--proj-hue, 220), 80%, 55%);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}

	.card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.project-pill {
		font-weight: 600;
		font-size: var(--text-sm);
		color: var(--ink);
	}

	.model-badge {
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		padding: 1px 6px;
		background: var(--bg-hover);
		border-radius: var(--radius-sm);
		color: var(--ink-faint);
	}

	.chat-context {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		background: var(--bg-base);
		padding: var(--space-2);
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		max-height: 160px;
		overflow-y: auto;
	}

	.context-bubble {
		display: flex;
		gap: var(--space-2);
		font-size: var(--text-xs);
		line-height: 1.4;
	}

	.context-bubble.user .role-tag {
		color: var(--brand);
		font-weight: 600;
	}

	.context-bubble.assistant .role-tag {
		color: var(--ink-muted);
		font-weight: 600;
	}

	.bubble-text {
		color: var(--ink-muted);
		white-space: pre-wrap;
		word-break: break-word;
	}

	.history-toggle-btn {
		align-self: flex-start;
		background: none;
		border: none;
		color: var(--brand);
		font-size: var(--text-xs);
		padding: 2px 0;
		cursor: pointer;
	}

	.ask-box {
		margin-top: var(--space-1);
	}

	.ask-question {
		font-weight: 500;
		font-size: var(--text-sm);
		margin: 0 0 var(--space-2) 0;
		color: var(--ink);
	}

	.options-grid {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.option-btn {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		text-align: left;
		cursor: pointer;
		font-size: var(--text-sm);
		transition: background var(--dur-fast), border-color var(--dur-fast);
	}

	.option-btn:hover {
		background: var(--bg-hover);
		border-color: var(--brand);
	}

	.opt-num {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.confirm-actions {
		display: flex;
		gap: var(--space-2);
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		border: 1px solid var(--line);
	}

	.action-btn.confirm {
		background: var(--brand);
		color: var(--brand-contrast);
		border-color: var(--brand);
	}

	.action-btn.cancel {
		background: var(--bg-hover);
		color: var(--ink-muted);
	}

	/* Sezione Input Rapido Task */
	.quick-task-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.task-input-box {
		display: flex;
		flex-direction: column;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-2);
		transition: border-color var(--dur-fast);
	}

	.task-input-box:focus-within {
		border-color: var(--brand);
		box-shadow: 0 0 0 1px var(--brand-line);
	}

	.task-input-box textarea {
		width: 100%;
		border: none;
		background: transparent;
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		resize: none;
		outline: none;
		box-sizing: border-box;
	}

	.input-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: var(--space-2);
		padding-top: var(--space-2);
		border-top: 1px solid var(--line);
	}

	.kbd-hint {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		font-family: var(--font-mono);
	}

	.save-task-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-3);
		background: var(--brand);
		color: var(--brand-contrast);
		border: none;
		border-radius: var(--radius-sm);
		font-weight: 600;
		font-size: var(--text-xs);
		cursor: pointer;
		transition: opacity var(--dur-fast);
	}

	.save-task-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.notice {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
	}

	.notice.success {
		background: var(--success-tint);
		color: var(--success);
		border: 1px solid var(--success-line);
	}

	.notice.error {
		background: var(--danger-tint);
		color: var(--danger);
		border: 1px solid var(--danger-line);
	}

	/* Anteprima Task Interpretato */
	.parsed-preview {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.parsed-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.badge-title {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--brand);
	}

	.parsed-tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}

	.parsed-tag {
		font-size: var(--text-xs);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
	}

	.parsed-tag.project {
		background: var(--brand-tint);
		color: var(--brand);
		border: 1px solid var(--brand-line);
	}

	.parsed-tag.missing {
		background: var(--danger-tint);
		color: var(--danger);
		border: 1px solid var(--danger-line);
	}

	.parsed-tag.role {
		background: var(--bg-hover);
		color: var(--ink);
		border: 1px solid var(--line);
	}

	.parsed-tag.model {
		background: var(--bg-hover);
		color: var(--ink-muted);
		border: 1px solid var(--line);
	}

	.parsed-tag.directive {
		background: var(--bg-hover);
		color: var(--ink-muted);
		border: 1px solid var(--line);
	}

	.parsed-prompt {
		font-size: var(--text-xs);
		line-height: 1.4;
	}

	.prompt-label {
		color: var(--ink-faint);
		font-weight: 600;
		margin-right: var(--space-1);
	}

	.parsed-prompt p {
		margin: 2px 0 0 0;
		color: var(--ink);
	}

	.ambiguities-box {
		padding: var(--space-2);
		background: var(--warning-tint);
		border: 1px solid var(--warning-line);
		border-radius: var(--radius-sm);
	}

	.ambiguity-item {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--warning);
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}

	.quota-exhausted-alert {
		display: flex;
		gap: var(--space-2);
		padding: var(--space-2);
		background: var(--danger-tint);
		border: 1px solid var(--danger-line);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		color: var(--danger);
	}

	.quota-exhausted-alert p {
		margin: 2px 0 0 0;
		color: var(--ink-muted);
	}

	/* Live Monitor */
	.live-monitor-section {
		border-top: 1px solid var(--line);
		padding-top: var(--space-2);
	}

	.projects-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.project-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-1) var(--space-2);
		background: var(--bg-sunken);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
	}

	.p-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: hsl(var(--proj-hue, 220), 80%, 55%);
	}

	.p-name {
		flex: 1;
		margin-left: var(--space-2);
		font-weight: 500;
		color: var(--ink);
	}

	.p-state {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--ink-muted);
	}

	.p-state.state-working {
		color: var(--brand);
	}

	.p-state.state-attention {
		color: var(--warning);
	}

	.p-state.state-finished {
		color: var(--success);
	}

	.spinner {
		width: 12px;
		height: 12px;
		border: 2px solid var(--brand-contrast);
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
