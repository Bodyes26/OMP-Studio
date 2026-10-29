<!-- AutomationAssistant: Assistente AI dedicato alla creazione e rifinitura delle automazioni.
     Conforme a AUT-024, AUT-059, AUT-060, AUT-061, AUT-062 e AUT-099. -->
<script lang="ts">
	import { untrack } from 'svelte';
	import type { AutomationDraft, AutomationSettings } from '#lib/automations/types.ts';
	import { AutomationAssistantController } from '#lib/automations/assistant.svelte.ts';
	import { automationsStore } from '#lib/automations/store.svelte.ts';
	import { t, formatDateTime } from '#lib/automations/i18n.ts';
	import { IconSparkles, IconSend, IconCheck, IconClose } from '#lib/icons.ts';
	import AskCard from '#lib/agent/components/AskCard.svelte';

	let {
		draft,
		settings = undefined,
		manualFields = undefined,
		onSwitchToFields,
		onDraftUpdated
	} = $props<{
		draft: AutomationDraft;
		settings?: AutomationSettings;
		manualFields?: Set<string>;
		onSwitchToFields?: () => void;
		onDraftUpdated?: (draft: AutomationDraft) => void;
	}>();

	let controller = untrack(() => new AutomationAssistantController(draft, settings, manualFields));

	$effect(() => {
		controller.draft = draft;
		controller.settings = settings ?? null;
		if (manualFields) {
			controller.manualFields = new Set(manualFields);
		}
	});

	let inputText = $state('');
	let customScopeInput = $state('');
	let scrollContainer = $state<HTMLDivElement | null>(null);

	const availableProjects = $derived(automationsStore.snapshot?.projects ?? []);

	function handleSelectScope(projectPath: string) {
		controller.setScope(projectPath);
		onDraftUpdated?.(controller.draft);
	}

	// Auto-scroll all'aggiunta di nuovi messaggi
	$effect(() => {
		if (controller.conversation.length > 0 && scrollContainer) {
			queueMicrotask(() => {
				if (scrollContainer) {
					scrollContainer.scrollTop = scrollContainer.scrollHeight;
				}
			});
		}
	});

	async function handleSend() {
		const text = inputText.trim();
		if (!text || controller.isBusy || !controller.isScopeConfigured) return;
		inputText = '';
		await controller.sendMessage(text);
		onDraftUpdated?.(controller.draft);
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			handleSend();
		}
	}

	function handleApplyProposal() {
		controller.applyProposal();
		onDraftUpdated?.(controller.draft);
	}

	function handleDiscardProposal() {
		controller.discardProposal();
	}

	async function handleConfirmWriteScript() {
		try {
			const ok = await controller.confirmWriteScript();
			if (ok) {
				onDraftUpdated?.(controller.draft);
			}
		} catch (err) {
			console.warn('Errore durante scrittura script autorizzata:', err);
		}
	}

	function handleUseSuggested(text: string) {
		inputText = text;
	}
</script>

<div class="assistant-container">
	<!-- Intestazione assistente -->
	<header class="assistant-header">
		<div class="header-left">
			<div class="title-row">
				<IconSparkles class="sparkle-icon" size={20} />
				<h2>{t('assistant_title')}</h2>
			</div>
			<p class="subtitle">{t('assistant_subtitle')}</p>
			<div class="badges-row">
				<span class="badge model-badge">
					{t('assistant_model_badge', {
						model: settings?.assistantModel || 'smol',
						mode: settings?.assistantModelMode || 'role'
					})}
				</span>
				<span class="badge readonly-badge">
					{t('assistant_readonly_badge')}
				</span>
				{#if controller.isScopeConfigured}
					<span class="badge scope-badge">
						Ambito: {controller.draft.definition.targets.cwd || controller.draft.definition.targets.projectPaths[0]}
					</span>
				{/if}
			</div>
		</div>
		{#if onSwitchToFields}
			<button
				type="button"
				class="switch-btn"
				onclick={onSwitchToFields}
				aria-label={t('assistant_btn_to_wizard')}
			>
				{t('assistant_btn_to_wizard')}
			</button>
		{/if}
	</header>

	<!-- Cronologia conversazione e proposte -->
	<div class="conversation-scroll" bind:this={scrollContainer}>
		{#if !controller.isScopeConfigured}
			<!-- Picker Ambito Esplicito (AUT-024, AUT-059) -->
			<div class="scope-picker-card" role="region" aria-label={t('scope_picker_title')}>
				<div class="scope-header">
					<IconSparkles size={20} class="sparkle-icon" />
					<h3>{t('scope_picker_title')}</h3>
				</div>
				<p class="scope-desc">{t('scope_picker_desc')}</p>

				{#if availableProjects.length > 0}
					<div class="scope-projects-grid">
						{#each availableProjects as proj (proj.id)}
							<button
								type="button"
								class="scope-proj-btn"
								onclick={() => handleSelectScope(proj.path)}
							>
								<span class="proj-name"><strong>{proj.name}</strong></span>
								<span class="proj-path"><code>{proj.path}</code></span>
							</button>
						{/each}
					</div>
				{/if}

				<div class="scope-manual-row">
					<input
						type="text"
						class="text-input small mono"
						placeholder={t('targets_cwd_placeholder')}
						bind:value={customScopeInput}
					/>
					<button
						type="button"
						class="btn-confirm-scope"
						disabled={!customScopeInput.trim()}
						onclick={() => handleSelectScope(customScopeInput)}
					>
						{t('confirm_scope')}
					</button>
				</div>
			</div>
		{:else if controller.conversation.length === 0}
			<div class="empty-state">
				<IconSparkles class="empty-icon" size={32} />
				<p class="empty-text">{t('assistant_empty_conversation')}</p>
				<div class="starters">
					<span class="starters-label">{t('assistant_suggested_prompts')}</span>
					<button
						type="button"
						class="starter-chip"
						onclick={() => handleUseSuggested(t('assistant_suggest_test'))}
					>
						{t('assistant_suggest_test')}
					</button>
					<button
						type="button"
						class="starter-chip"
						onclick={() => handleUseSuggested(t('assistant_suggest_lint'))}
					>
						{t('assistant_suggest_lint')}
					</button>
					<button
						type="button"
						class="starter-chip"
						onclick={() => handleUseSuggested(t('assistant_suggest_report'))}
					>
						{t('assistant_suggest_report')}
					</button>
				</div>
			</div>
		{:else}
			{#each controller.conversation as msg (msg.id)}
				<div class="message-row {msg.role}">
					<div class="message-bubble {msg.role}">
						<div class="message-meta">
							<span class="role-tag">
								{msg.role === 'user' ? 'Tu' : 'Assistente AI'}
							</span>
							<span class="time-tag">{formatDateTime(msg.at)}</span>
						</div>
						<div class="message-text">
							{msg.text}
						</div>
					</div>
				</div>
			{/each}
		{/if}

		{#if controller.isBusy}
			<div class="message-row assistant thinking">
				<div class="message-bubble assistant">
					<div class="thinking-spinner">
						<span class="dot"></span>
						<span class="dot"></span>
						<span class="dot"></span>
					</div>
					<span class="thinking-text">{t('assistant_thinking')}</span>
				</div>
			</div>
		{/if}

		{#if controller.error}
			<div class="error-banner" role="alert">
				<strong>Errore assistente:</strong> {controller.error}
			</div>
		{/if}

		<!-- Domanda interattiva da omp (AskCard reale) -->
		{#if controller.session && controller.session.pendingUi}
			<div class="ask-card-wrapper">
				<AskCard
					session={controller.session}
					pending={controller.session.pendingUi}
					visible={true}
				/>
			</div>
		{/if}

		<!-- Card Proposta Strutturata (AUT-099) -->
		{#if controller.currentProposal}
			<div class="proposal-card" role="region" aria-label="Proposta di automazione">
				<div class="proposal-header">
					<IconSparkles size={18} class="proposal-icon" />
					<h3>{t('assistant_proposal_banner')}</h3>
				</div>
				<div class="proposal-body">
					{#if controller.currentProposal.name}
						<div class="prop-item">
							<span class="prop-key">Nome:</span>
							<span class="prop-val"><strong>{controller.currentProposal.name}</strong></span>
						</div>
					{/if}
					{#if controller.currentProposal.description}
						<div class="prop-item">
							<span class="prop-key">Descrizione:</span>
							<span class="prop-val">{controller.currentProposal.description}</span>
						</div>
					{/if}
					{#if controller.currentProposal.action}
						<div class="prop-item">
							<span class="prop-key">Azione:</span>
							<span class="prop-val">
								{#if controller.currentProposal.action.kind === 'command'}
									<code>{controller.currentProposal.action.command || 'comando shell'}</code>
								{:else}
									Prompt AI dedicato
								{/if}
							</span>
						</div>
					{/if}
					{#if controller.currentProposal.triggers && controller.currentProposal.triggers.length > 0}
						<div class="prop-item">
							<span class="prop-key">Quando:</span>
							<span class="prop-val">
								{(controller.currentProposal.triggers as Array<{ kind: string }>).map((tr: { kind: string }) => tr.kind).join(', ')}
							</span>
						</div>
					{/if}
				</div>

				<div class="proposal-notice">
					<span class="shield-badge">🛡️</span>
					<span>{t('assistant_manual_protected_notice')}</span>
				</div>

				<div class="proposal-actions">
					<button
						type="button"
						class="btn-apply"
						onclick={handleApplyProposal}
					>
						<IconCheck size={16} />
						{t('assistant_btn_apply_proposal')}
					</button>
					<button
						type="button"
						class="btn-discard"
						onclick={handleDiscardProposal}
					>
						<IconClose size={16} />
						{t('assistant_btn_discard_proposal')}
					</button>
				</div>
			</div>
		{/if}

		<!-- Card Proposta Script File con Autorizzazione Separatamente (AUT-061) -->
		{#if controller.currentScriptProposal}
			<div class="script-card" role="region" aria-label="Proposta file script">
				<div class="script-header">
					<h4>{t('assistant_file_proposal_heading')}</h4>
					<span class="script-path"><code>{controller.currentScriptProposal.path}</code></span>
				</div>
				<p class="script-desc">{t('assistant_file_proposal_desc')}</p>
				<pre class="script-preview"><code>{controller.currentScriptProposal.content}</code></pre>

				{#if controller.currentScriptProposal.written}
					<div class="script-success">
						<IconCheck size={16} />
						<span>{t('assistant_script_written_success', { path: controller.currentScriptProposal.path })}</span>
					</div>
				{:else}
					<button
						type="button"
						class="btn-confirm-script"
						onclick={handleConfirmWriteScript}
					>
						<IconCheck size={16} />
						{t('assistant_btn_confirm_write_script')}
					</button>
				{/if}
			</div>
		{/if}

		<!-- Notifica differenze applicate -->
		{#if controller.lastDiffSummary}
			<div class="diff-summary-alert">
				<span>Applicati: <strong>{controller.lastDiffSummary.appliedKeys.join(', ') || 'nessuno'}</strong></span>
				{#if controller.lastDiffSummary.preservedManualKeys.length > 0}
					<span class="preserved-tag">
						Preservati perché modificati manualmente: <strong>{controller.lastDiffSummary.preservedManualKeys.join(', ')}</strong>
					</span>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Barra input utente -->
	<footer class="assistant-footer">
		<div class="input-row">
			<textarea
				class="chat-input"
				bind:value={inputText}
				onkeydown={handleKeyDown}
				placeholder={controller.isScopeConfigured ? t('assistant_input_placeholder') : 'Seleziona prima l’ambito di lavoro sopra…'}
				rows="2"
				aria-label={t('assistant_input_placeholder')}
				disabled={controller.isBusy || !controller.isScopeConfigured}
			></textarea>
			<button
				type="button"
				class="send-btn"
				onclick={handleSend}
				disabled={controller.isBusy || !inputText.trim() || !controller.isScopeConfigured}
				aria-label={t('assistant_btn_send')}
			>
				<IconSend size={18} />
			</button>
		</div>
	</footer>
</div>

<style>
	.assistant-container {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 520px;
		background: var(--bg-primary, #1e1e24);
		color: var(--text-primary, #ffffff);
		border-radius: 8px;
		overflow: hidden;
	}

	.assistant-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		padding: 18px 24px;
		border-bottom: 1px solid var(--line, rgba(255, 255, 255, 0.1));
		background: var(--bg-secondary, #25252d);
		gap: 16px;
	}

	.title-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.title-row h2 {
		margin: 0;
		font-size: 1.15rem;
		font-weight: 600;
	}

	:global(.sparkle-icon) {
		color: var(--accent, #7c3aed);
	}

	.subtitle {
		margin: 4px 0 8px 0;
		font-size: 0.85rem;
		color: var(--text-muted, #9ca3af);
		line-height: 1.4;
	}

	.badges-row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.badge {
		font-size: 0.72rem;
		padding: 3px 8px;
		border-radius: 4px;
		font-weight: 500;
		letter-spacing: 0.02em;
	}

	.model-badge {
		background: rgba(124, 58, 237, 0.15);
		color: #c4b5fd;
		border: 1px solid rgba(124, 58, 237, 0.3);
	}

	.readonly-badge {
		background: rgba(16, 185, 129, 0.12);
		color: #6ee7b7;
		border: 1px solid rgba(16, 185, 129, 0.25);
	}

	.scope-badge {
		background: rgba(59, 130, 246, 0.12);
		color: #93c5fd;
		border: 1px solid rgba(59, 130, 246, 0.25);
	}

	.switch-btn {
		background: transparent;
		border: 1px solid var(--line, rgba(255, 255, 255, 0.15));
		color: var(--text-primary, #ffffff);
		padding: 6px 12px;
		border-radius: 6px;
		font-size: 0.82rem;
		cursor: pointer;
		white-space: nowrap;
		transition: background 0.15s, border-color 0.15s;
	}

	.switch-btn:hover {
		background: rgba(255, 255, 255, 0.06);
		border-color: var(--line-active, rgba(255, 255, 255, 0.3));
	}

	.conversation-scroll {
		flex: 1;
		overflow-y: auto;
		padding: 20px 24px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.scope-picker-card {
		background: var(--bg-secondary, #25252d);
		border: 1px solid var(--line, rgba(255, 255, 255, 0.12));
		border-radius: 8px;
		padding: 20px 24px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin: 12px 0;
	}

	.scope-header {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.scope-header h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
	}

	.scope-desc {
		margin: 0;
		font-size: 0.85rem;
		color: var(--text-muted, #9ca3af);
		line-height: 1.45;
	}

	.scope-projects-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 10px;
		max-height: 220px;
		overflow-y: auto;
	}

	.scope-proj-btn {
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid var(--line, rgba(255, 255, 255, 0.1));
		border-radius: 6px;
		padding: 10px 14px;
		text-align: left;
		color: var(--text-primary, #ffffff);
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 4px;
		transition: all 0.15s;
	}

	.scope-proj-btn:hover {
		background: rgba(124, 58, 237, 0.12);
		border-color: var(--accent, #7c3aed);
	}

	.scope-manual-row {
		display: flex;
		gap: 10px;
		align-items: center;
		margin-top: 6px;
	}

	.btn-confirm-scope {
		background: var(--accent, #7c3aed);
		color: #ffffff;
		border: none;
		border-radius: 6px;
		padding: 7px 16px;
		font-size: 0.82rem;
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
	}

	.btn-confirm-scope:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 40px 16px;
		text-align: center;
		gap: 16px;
	}

	:global(.empty-icon) {
		color: var(--text-muted, #9ca3af);
		opacity: 0.6;
	}

	.empty-text {
		max-width: 480px;
		font-size: 0.9rem;
		color: var(--text-muted, #9ca3af);
		line-height: 1.5;
		margin: 0;
	}

	.starters {
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: 100%;
		max-width: 500px;
		margin-top: 8px;
	}

	.starters-label {
		font-size: 0.75rem;
		color: var(--text-muted, #9ca3af);
		text-align: left;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.starter-chip {
		background: var(--bg-secondary, #25252d);
		border: 1px solid var(--line, rgba(255, 255, 255, 0.08));
		color: var(--text-primary, #ffffff);
		padding: 8px 12px;
		border-radius: 6px;
		font-size: 0.82rem;
		text-align: left;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
	}

	.starter-chip:hover {
		background: rgba(124, 58, 237, 0.1);
		border-color: rgba(124, 58, 237, 0.3);
	}

	.message-row {
		display: flex;
		width: 100%;
	}

	.message-row.user {
		justify-content: flex-end;
	}

	.message-row.assistant {
		justify-content: flex-start;
	}

	.message-bubble {
		max-width: 80%;
		padding: 12px 16px;
		border-radius: 8px;
		line-height: 1.45;
		font-size: 0.88rem;
	}

	.message-bubble.user {
		background: var(--accent, #7c3aed);
		color: #ffffff;
		border-bottom-right-radius: 2px;
	}

	.message-bubble.assistant {
		background: var(--bg-secondary, #25252d);
		color: var(--text-primary, #ffffff);
		border: 1px solid var(--line, rgba(255, 255, 255, 0.08));
		border-bottom-left-radius: 2px;
	}

	.message-meta {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font-size: 0.72rem;
		opacity: 0.7;
		margin-bottom: 6px;
	}

	.role-tag {
		font-weight: 600;
	}

	.message-text {
		white-space: pre-wrap;
		word-break: break-word;
	}

	.thinking-spinner {
		display: flex;
		gap: 4px;
		margin-bottom: 6px;
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent, #7c3aed);
		animation: pulse 1.4s infinite ease-in-out both;
	}

	.dot:nth-child(1) { animation-delay: -0.32s; }
	.dot:nth-child(2) { animation-delay: -0.16s; }

	@keyframes pulse {
		0%, 80%, 100% { transform: scale(0); }
		40% { transform: scale(1); }
	}

	.thinking-text {
		font-size: 0.8rem;
		color: var(--text-muted, #9ca3af);
		font-style: italic;
	}

	.error-banner {
		background: rgba(239, 68, 68, 0.15);
		color: #fca5a5;
		border: 1px solid rgba(239, 68, 68, 0.3);
		padding: 10px 14px;
		border-radius: 6px;
		font-size: 0.85rem;
	}

	.ask-card-wrapper {
		margin: 8px 0;
	}

	.proposal-card {
		background: rgba(124, 58, 237, 0.07);
		border: 1px solid rgba(124, 58, 237, 0.3);
		border-radius: 8px;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.proposal-header {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.proposal-header h3 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 600;
	}

	.proposal-body {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 0.85rem;
	}

	.prop-item {
		display: flex;
		gap: 8px;
	}

	.prop-key {
		color: var(--text-muted, #9ca3af);
		min-width: 85px;
	}

	.proposal-notice {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.78rem;
		color: var(--text-muted, #9ca3af);
		background: rgba(0, 0, 0, 0.2);
		padding: 6px 10px;
		border-radius: 4px;
	}

	.proposal-actions {
		display: flex;
		gap: 10px;
		margin-top: 4px;
	}

	.btn-apply {
		display: flex;
		align-items: center;
		gap: 6px;
		background: var(--accent, #7c3aed);
		color: #ffffff;
		border: none;
		border-radius: 6px;
		padding: 8px 14px;
		font-size: 0.84rem;
		font-weight: 500;
		cursor: pointer;
	}

	.btn-apply:hover {
		opacity: 0.9;
	}

	.btn-discard {
		display: flex;
		align-items: center;
		gap: 6px;
		background: transparent;
		border: 1px solid var(--line, rgba(255, 255, 255, 0.15));
		color: var(--text-primary, #ffffff);
		border-radius: 6px;
		padding: 8px 14px;
		font-size: 0.84rem;
		cursor: pointer;
	}

	.script-card {
		background: var(--bg-secondary, #25252d);
		border: 1px solid var(--line, rgba(255, 255, 255, 0.12));
		border-radius: 8px;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.script-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.script-header h4 {
		margin: 0;
		font-size: 0.92rem;
		font-weight: 600;
	}

	.script-desc {
		margin: 0;
		font-size: 0.82rem;
		color: var(--text-muted, #9ca3af);
	}

	.script-preview {
		background: rgba(0, 0, 0, 0.35);
		border: 1px solid var(--line, rgba(255, 255, 255, 0.08));
		padding: 10px;
		border-radius: 6px;
		font-size: 0.8rem;
		max-height: 160px;
		overflow-y: auto;
		margin: 0;
	}

	.btn-confirm-script {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		align-self: flex-start;
		background: #059669;
		color: #ffffff;
		border: none;
		border-radius: 6px;
		padding: 8px 14px;
		font-size: 0.84rem;
		font-weight: 500;
		cursor: pointer;
	}

	.script-success {
		display: flex;
		align-items: center;
		gap: 6px;
		color: #34d399;
		font-size: 0.84rem;
		font-weight: 500;
	}

	.diff-summary-alert {
		font-size: 0.8rem;
		padding: 8px 12px;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid var(--line, rgba(255, 255, 255, 0.1));
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.preserved-tag {
		color: #fbbf24;
	}

	.assistant-footer {
		padding: 14px 24px;
		border-top: 1px solid var(--line, rgba(255, 255, 255, 0.1));
		background: var(--bg-secondary, #25252d);
	}

	.input-row {
		display: flex;
		gap: 12px;
		align-items: flex-end;
	}

	.chat-input {
		flex: 1;
		background: var(--bg-primary, #1e1e24);
		border: 1px solid var(--line, rgba(255, 255, 255, 0.15));
		color: var(--text-primary, #ffffff);
		border-radius: 6px;
		padding: 10px 12px;
		font-size: 0.88rem;
		font-family: inherit;
		resize: none;
		line-height: 1.4;
	}

	.chat-input:focus {
		outline: none;
		border-color: var(--accent, #7c3aed);
	}

	.send-btn {
		background: var(--accent, #7c3aed);
		color: #ffffff;
		border: none;
		border-radius: 6px;
		width: 42px;
		height: 42px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: opacity 0.15s;
		flex-shrink: 0;
	}

	.send-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
