<!--
  Composer.svelte — Riquadro di immissione comandi e prompt ancorato in basso.
  Auto-growing textarea nella sagoma .composer-shell, pulsante di invio, stop di emergenza,
  selettore steer/follow-up durante il turno, barra dei chip e autocompletamento.

  Adotta i componenti reali condivisi di Studio Desktop:
  - ModelPickerList (ricerca veloce, grouping per provider, navigazione da tastiera, badge contesto e capacità)
  - ReasoningSlider (slider a gradini con livelli supportati dal modello)
  - ThinkingMeter (indicatore a barre del livello di ragionamento)
  - MenuButton (popover ancorati con top-layer e dismiss accessibile)
  - ContextControl (anello consumi finestra di contesto e ContextPanel condiviso)
  - ComposerAttachments e AttachButton (gestione allegati immagini/file)
-->
<script lang="ts">
	import type { RemoteComposerCatalog, RemoteSlashCommand, RemoteContextSnapshot } from '../../../../src/protocol.ts';
	import type { RemoteAttachmentTransport } from '../../chat/remoteAttachments.svelte.ts';
	import { t } from '../../i18n.ts';
	import { IconArrowUp, IconChevronUp, IconStop } from '../../icons.ts';
	import { ROLE_HUES } from '$lib/agent/roleHues';
	import {
		commandSuggestions,
		suggestKeyAction,
		type CommandSuggestionItem
	} from '../../chat/suggest.ts';
	import {
		createRemoteAttachmentManager,
		type RemoteComposerAttachment
	} from '../../chat/remoteAttachments.svelte.ts';
	import ComposerStatusLine from './ComposerStatusLine.svelte';
	import SuggestTray from './SuggestTray.svelte';
	import RoleMenu from '$lib/agent/components/RoleMenu.svelte';
	import ComposerAttachments from './ComposerAttachments.svelte';
	import AttachButton from './AttachButton.svelte';
	import ContextControl from './ContextControl.svelte';
	import ComposerEditor from '$lib/agent/components/ComposerEditor.svelte';
	import { createCommandBadgeElement, type ComposerTrigger } from '$lib/agent/composerDoc';
	import { THINKING_LEVEL_ITEMS } from '$lib/stores/modelSettingsHelpers';

	// Componenti GUI reali condivisi di Studio Desktop:
	import ModelPickerList from '$lib/components/models/ModelPickerList.svelte';
	import ReasoningSlider from '$lib/components/models/ReasoningSlider.svelte';
	import ThinkingMeter from '$lib/agent/components/ThinkingMeter.svelte';
	import MenuButton from '$lib/ui/MenuButton.svelte';
	import { m } from '$lib/paraglide/messages.js';

	let {
		isWorking = false,
		disabled = false,
		disabledReason = null,
		canSessionControl = true,
		hasLaneConfig = false,
		role = 'default',
		modelLabel = null,
		modelId = null,
		provider = null,
		thinkingLevel = 'off',
		machineName = '',
		catalog = null,
		hostId = '',
		projectId = '',
		laneId = null,
		connection = null,
		context = null,
		onNotice,
		onRefreshContext,
		onCompactContext,
		onOpenImage,
		onSend,
		onStop,
		onSetRole,
		onSetModel,
		onSetThinking,
		onNewSession
	}: {
		isWorking?: boolean;
		disabled?: boolean;
		disabledReason?: string | null;
		canSessionControl?: boolean;
		hasLaneConfig?: boolean;
		role?: string | null;
		modelLabel?: string | null;
		modelId?: string | null;
		provider?: string | null;
		thinkingLevel?: string | null;
		machineName?: string;
		catalog?: RemoteComposerCatalog | null;
		hostId?: string;
		projectId?: string;
		laneId?: string | null;
		connection?: RemoteAttachmentTransport | null;
		context?: RemoteContextSnapshot | null;
		onNotice?: (variant: 'info' | 'warning' | 'error', message: string) => void;
		onRefreshContext?: (force?: boolean) => Promise<void>;
		onCompactContext?: () => Promise<void>;
		onOpenImage?: (url: string, mimeType?: string) => void;
		onSend: (text: string, whileBusy: 'steer' | 'follow_up', attachments?: RemoteComposerAttachment[]) => Promise<void>;
		onStop: () => Promise<void>;
		onSetRole?: (roleId: string) => Promise<void>;
		onSetModel?: (provider: string, modelId: string) => Promise<void>;
		onSetThinking?: (level: string) => Promise<void>;
		onNewSession?: () => Promise<void>;
	} = $props();

	let inputText = $state('');
	let whileBusy = $state<'steer' | 'follow_up'>('steer');
	let isSending = $state(false);
	let isStopping = $state(false);
	let editorRef = $state<ReturnType<typeof ComposerEditor> | null>(null);
	const submitWithModifier = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
	let isDragOver = $state(false);

	// Menu popover aperto (esclusivo)
	let activeMenu = $state<'role' | 'model' | 'thinking' | null>(null);

	// Gestore allegati del composer
	const attachmentMgr = createRemoteAttachmentManager({
		getHostId: () => hostId,
		getProjectId: () => projectId,
		getLaneId: () => laneId,
		getConnection: () => connection,
		onNotice: (variant, message) => onNotice?.(variant, message)
	});

	// Token draft stimati per l'indicatore della finestra di contesto
	const draftTokenCount = $derived.by(() => {
		const textTokens = Math.round(inputText.length / 4);
		const attTokens = attachmentMgr.attachments.reduce((sum, a) => sum + (a.tokens || 0), 0);
		return textTokens + attTokens;
	});

	// Stato autocompletamento slash
	let slashToken = $state<ComposerTrigger | null>(null);
	let suggestIndex = $state(0);

	const currentRole = $derived(role || 'default');
	const currentModelLabel = $derived(modelLabel || modelId || 'Modello');

	const activeModelValue = $derived.by(() => {
		if (provider && modelId) return `${provider}/${modelId}`;
		return modelId || '';
	});

	// Livelli di ragionamento offerti dalla corsia escludendo 'auto' (riservato a ruoli/task)
	const chatThinkingLevels = $derived.by(() => {
		const raw = catalog?.thinkingLevels ?? ['off'];
		return THINKING_LEVEL_ITEMS.flatMap((level) => level.id !== 'auto' && raw.includes(level.id) ? [level.id] : []);
	});
	const currentThinking = $derived(chatThinkingLevels.find((level) => level === thinkingLevel) ?? 'off');

	const canReason = $derived.by(() => {
		const levels = chatThinkingLevels;
		return levels.length > 1 || (levels.length === 1 && levels[0] !== 'off');
	});

	// Catalogo con aggiunta del comando locale /new se lane_config e' attivo
	const availableCommands = $derived.by(() => {
		const list: RemoteSlashCommand[] = catalog?.commands ? [...catalog.commands] : [];
		if (hasLaneConfig && !list.some((c) => c.name === 'new')) {
			list.unshift({
				name: 'new',
				kind: 'command',
				description: t('newChat'),
				hint: null
			});
		}
		return list;
	});

	const suggestions = $derived.by(() => {
		if (!slashToken) return [];
		return commandSuggestions(availableCommands, slashToken.query);
	});

	const showSuggestions = $derived(slashToken !== null);


	function handleSelectSuggestion(item: CommandSuggestionItem): void {
		if (!slashToken || !editorRef) return;
		editorRef.replaceTrigger(createCommandBadgeElement(item.command.name), slashToken);
		slashToken = null;
		editorRef.focus();
	}

	const canSubmit = $derived(
		!disabled &&
		!isSending &&
		!attachmentMgr.isStaging &&
		attachmentMgr.attachments.every((attachment) => attachment.status === 'ready') &&
		canSessionControl &&
		(inputText.trim().length > 0 || attachmentMgr.hasAttachments)
	);


	async function handleSubmit(): Promise<void> {
		const text = inputText.trim();
		const currentAttachments = [...attachmentMgr.attachments];
		if (!canSubmit) {
			return;
		}

		// Intercetta /new e /clear digitati da soli per avviare una nuova chat
		if (hasLaneConfig && (text === '/new' || text === '/clear') && currentAttachments.length === 0) {
			inputText = '';
			slashToken = null;
			editorRef?.clear();
			if (onNewSession) await onNewSession();
			return;
		}

		isSending = true;
		try {
			await onSend(text, whileBusy, currentAttachments);
			inputText = '';
			slashToken = null;
			attachmentMgr.clear();
			editorRef?.clear();
		} catch (error) {
			onNotice?.('error', error instanceof Error ? error.message : String(error));
		} finally {
			isSending = false;
		}
	}

	async function handleStop(): Promise<void> {
		if (isStopping || !canSessionControl) return;
		isStopping = true;
		try {
			await onStop();
		} finally {
			isStopping = false;
		}
	}

	function handleKeydown(e: KeyboardEvent): boolean {
		if (showSuggestions && suggestions.length > 0) {
			const action = suggestKeyAction(e, suggestions.length, suggestIndex);
			if (action) {
				if (action.kind === 'move') {
					suggestIndex = action.index;
				} else if (action.kind === 'pick') {
					handleSelectSuggestion(suggestions[suggestIndex]);
				} else if (action.kind === 'dismiss') {
					slashToken = null;
				}
				return true;
			}
		}
		return false;
	}

	function handleDragOver(e: DragEvent): void {
		if (disabled || !canSessionControl || isSending) return;
		if (e.dataTransfer?.types?.includes('Files')) {
			e.preventDefault();
			isDragOver = true;
		}
	}

	function handleDragLeave(e: DragEvent): void {
		e.preventDefault();
		isDragOver = false;
	}

	function handleDrop(e: DragEvent): void {
		e.preventDefault();
		isDragOver = false;
		if (disabled || !canSessionControl || isSending) return;
		if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
			void attachmentMgr.addFiles(e.dataTransfer.files);
		}
	}
</script>

<div class="composer-root">
	{#if showSuggestions}
		<SuggestTray
			items={suggestions}
			selectedIndex={suggestIndex}
			onSelect={handleSelectSuggestion}
			onHover={(idx) => (suggestIndex = idx)}
		/>
	{/if}

	<div
		class="composer-shell"
		class:disabled
		class:drag-over={isDragOver}
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		ondrop={handleDrop}
		role="region"
		aria-label={t('appTitle')}
	>
		{#if disabled && disabledReason}
			<div class="disabled-notice" role="alert">
				<span>{disabledReason}</span>
			</div>
		{/if}

		{#if attachmentMgr.hasAttachments}
			<ComposerAttachments
				attachments={attachmentMgr.attachments}
				onRemove={(id) => attachmentMgr.removeAttachment(id)}
				{onOpenImage}
			/>
		{/if}

		<ComposerEditor
			bind:this={editorRef}
			disabled={disabled || !canSessionControl || isSending}
			placeholder={disabled ? (disabledReason ?? t('composerDisabled')) : t('chatInputPlaceholder')}
			ariaLabel={t('chatInputPlaceholder')}
			{submitWithModifier}
			triggers={['/']}
			onSend={() => void handleSubmit()}
			onFilesPaste={(files) => { if (!disabled && canSessionControl && !isSending) void attachmentMgr.addFiles(files); }}
			onInput={() => { inputText = editorRef?.getWireText((name) => availableCommands.some((command) => command.name === name && command.kind === 'skill')) ?? ''; }}
			onTriggerChange={(trigger) => { slashToken = trigger; suggestIndex = 0; }}
			onKeydownFilter={handleKeydown}
		/>

		<div class="composer-toolbar">
			<div class="toolbar-left">
				<AttachButton
					onFiles={(files) => void attachmentMgr.addFiles(files)}
					disabled={disabled || !canSessionControl || isSending}
					title={t('attachFile')}
				/>

				{#if hasLaneConfig}
					<div class="toolbar-chips">
						<!-- Selettore Ruolo via MenuButton condiviso -->
						<MenuButton
							open={activeMenu === 'role'}
							title={isWorking ? t('configDisabledBusy') : t('roleChipTitle')}
							hasPopup="listbox"
							contentRole="dialog"
							width="360px"
							disabled={isWorking}
							className="ui-chip composer-chip"
							onToggle={() => (activeMenu = activeMenu === 'role' ? null : 'role')}
							onClose={() => (activeMenu = null)}
						>
							{#snippet trigger()}
								<span
									class="role-dot"
									class:has-hue={ROLE_HUES[currentRole] !== undefined}
									style={ROLE_HUES[currentRole] !== undefined ? `--role-h: ${ROLE_HUES[currentRole]}` : undefined}
								></span>
								<span class="role-name font-mono">{currentRole}</span>
							{/snippet}
							{#snippet children()}
								<RoleMenu
									assignments={Object.fromEntries((catalog?.roles ?? []).map((role) => [role.id, { model: role.modelLabel ?? role.model ?? undefined, thinking: role.thinking ?? undefined }]))}
									activeRole={currentRole}
									onPick={(roleId) => {
										activeMenu = null;
										onSetRole?.(roleId);
									}}
								/>
							{/snippet}
						</MenuButton>

						<!-- Selettore Modello reale condiviso (ModelPickerList) via MenuButton -->
						<MenuButton
							open={activeMenu === 'model'}
							title={isWorking ? t('configDisabledBusy') : t('modelChipTitle')}
							hasPopup="dialog"
							contentRole="dialog"
							width="400px"
							disabled={isWorking}
							className="ui-chip composer-chip"
							onToggle={() => (activeMenu = activeMenu === 'model' ? null : 'model')}
							onClose={() => (activeMenu = null)}
						>
							{#snippet trigger()}
								<span class="model-name-label">{currentModelLabel}</span>
								<span class="chevron-indicator"><IconChevronUp /></span>
							{/snippet}
							{#snippet children()}
								<ModelPickerList
									catalog={catalog?.models ?? []}
									value={activeModelValue}
									placeholder={m.chat_v2_composer_model_search()}
									showFooter
									onSelect={(selector, mod) => {
										activeMenu = null;
										const targetProvider = mod.provider || (selector.includes('/') ? selector.split('/')[0] : '');
										const targetModelId = mod.id || (selector.includes('/') ? selector.split('/')[1] : selector);
										if (targetProvider && targetModelId) {
											onSetModel?.(targetProvider, targetModelId);
										}
									}}
									onClose={() => (activeMenu = null)}
								/>
							{/snippet}
						</MenuButton>

						<!-- Selettore Thinking reale condiviso (ReasoningSlider + ThinkingMeter) -->
						<MenuButton
							open={activeMenu === 'thinking'}
							title={isWorking ? t('configDisabledBusy') : t('thinkingChipTitle')}
							hasPopup="dialog"
							contentRole="dialog"
							width="320px"
							disabled={isWorking}
							className="ui-chip composer-chip"
							onToggle={() => (activeMenu = activeMenu === 'thinking' ? null : 'thinking')}
							onClose={() => (activeMenu = null)}
						>
							{#snippet trigger()}
								<ThinkingMeter level={currentThinking} />
								<span class="thinking-label font-mono">{currentThinking}</span>
							{/snippet}
							{#snippet children()}
								<div class="thinking-popover">
									{#if canReason}
										<ReasoningSlider
											value={currentThinking}
											levels={chatThinkingLevels}
											onChange={(level) => {
												onSetThinking?.(level);
											}}
										/>
									{:else}
										<p class="thinking-unsupported">
											{m.chat_v2_composer_thinking_unsupported({ model: currentModelLabel })}
										</p>
									{/if}
								</div>
							{/snippet}
						</MenuButton>

					</div>
				{/if}
			</div>

			{#if isWorking && canSessionControl}
				<div class="steer-segmented" role="radiogroup" aria-label="Modalita di invio turno">
					<button
						type="button"
						class="ui-chip segment-chip"
						class:active={whileBusy === 'steer'}
						role="radio"
						aria-checked={whileBusy === 'steer'}
						onclick={() => (whileBusy = 'steer')}
						title={t('chatSteerHint')}
					>
						{t('steerOption')}
					</button>
					<button
						type="button"
						class="ui-chip segment-chip"
						class:active={whileBusy === 'follow_up'}
						role="radio"
						aria-checked={whileBusy === 'follow_up'}
						onclick={() => (whileBusy = 'follow_up')}
						title={t('chatFollowUpHint')}
					>
						{t('followUpOption')}
					</button>
				</div>
			{/if}

			<div class="toolbar-actions">
				{#if isWorking && canSessionControl}
					<button
						type="button"
						class="composer-send-btn stop-btn"
						disabled={isStopping}
						onclick={handleStop}
						title={t('stopButton')}
						aria-label={t('stopButton')}
					>
						<IconStop />
					</button>
				{/if}

				<button
					type="button"
					class="composer-send-btn"
					disabled={!canSubmit}
					onclick={handleSubmit}
					title={t('send')}
					aria-label={t('send')}
				>
					<IconArrowUp />
				</button>
			</div>
		</div>
	</div>

	<div class="composer-status-row">
		<ComposerStatusLine modelLabel={hasLaneConfig ? null : modelLabel} {machineName} />
		{#if context}
			<ContextControl {context} draftTokens={draftTokenCount}
				disabled={disabled || isWorking}
				onRefresh={onRefreshContext} onCompact={onCompactContext} />
		{/if}
	</div>
</div>

<style>
	.composer-status-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		min-width: 0;
	}

	.composer-root {
		position: relative;
		width: 100%;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.composer-shell {
		position: relative;
		width: 100%;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-2xl);
		box-shadow: var(--shadow-dock);
		display: flex;
		flex-direction: column;
		transition:
			border-color var(--dur-fast) var(--ease-out),
			box-shadow var(--dur-fast) var(--ease-out);
		overflow: hidden;
	}

	.composer-shell:focus-within {
		border-color: var(--line-strong);
	}

	.composer-shell.drag-over {
		border-color: var(--brand-ink);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand-ink) 25%, transparent);
	}

	.composer-shell.disabled {
		opacity: 0.75;
		background: var(--bg-sunken);
	}

	.disabled-notice {
		padding: 6px 12px;
		background: color-mix(in oklch, var(--warn) 10%, transparent);
		border-bottom: 1px solid var(--line);
		font-size: var(--text-caption);
		color: var(--warn);
	}


	.composer-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 4px 10px 10px;
		gap: var(--space-2);
		min-width: 0;
	}

	.toolbar-left {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		flex: 1;
		overflow: hidden;
	}

	.toolbar-chips {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: nowrap;
		overflow-x: auto;
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
		min-width: 0;
	}

	.toolbar-chips::-webkit-scrollbar {
		display: none;
	}

	.composer-root :global(.composer-chip) {
		height: 26px;
		padding: 0 6px;
		font-size: var(--text-xs);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		flex-shrink: 0;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.composer-root :global(.composer-chip:hover:not(:disabled)) {
		background: var(--bg-hover);
		color: var(--ink);
	}

	:global(.composer-chip.active) {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line);
	}

	.role-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--ink-faint);
		flex-shrink: 0;
	}

	.role-dot.has-hue {
		background: hsl(var(--role-h) 70% 55%);
	}

	.role-name {
		font-weight: 550;
		color: var(--ink);
	}

	.model-name-label {
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink);
	}

	.chevron-indicator {
		display: inline-flex;
		align-items: center;
		color: var(--ink-faint);
		--icon-size: 12px;
	}

	.thinking-label {
		font-size: var(--text-caption);
	}

	.thinking-popover {
		padding: var(--space-3) var(--space-4) var(--space-4);
		--slider-ring: var(--bg-raised);
	}

	.thinking-unsupported {
		margin: 0;
		font-size: var(--text-label);
		line-height: 1.4;
		color: var(--ink-muted);
	}

	.steer-segmented {
		display: inline-flex;
		align-items: center;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-full);
		padding: 2px;
		gap: 2px;
		flex-shrink: 0;
	}

	.segment-chip {
		height: 22px;
		padding: 0 8px;
		font-size: var(--text-xs);
		background: transparent;
		border: none;
		border-radius: var(--radius-full);
		color: var(--ink-faint);
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.segment-chip.active {
		background: var(--bg-raised);
		color: var(--ink);
		font-weight: 550;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
	}

	.toolbar-actions {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	.composer-send-btn {
		width: 32px;
		height: 32px;
		border-radius: var(--radius-full);
		border: none;
		background: var(--brand-ink);
		color: var(--bg-base);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition:
			opacity var(--dur-fast) var(--ease-out),
			transform var(--dur-fast) var(--ease-out);
		flex-shrink: 0;
		--icon-size: 16px;
	}

	.composer-send-btn:hover:not(:disabled) {
		opacity: 0.9;
	}

	.composer-send-btn:active:not(:disabled) {
		transform: scale(0.95);
	}

	.composer-send-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.composer-send-btn.stop-btn {
		background: var(--danger);
		color: #ffffff;
	}

	@media (max-width: 480px) {
		.composer-toolbar { flex-wrap: wrap; }
		.toolbar-left { flex-basis: 100%; }
		.toolbar-chips { flex-wrap: wrap; overflow: visible; }
		.toolbar-actions { margin-left: auto; }
		.model-name-label {
			max-width: 90px;
		}
	}
</style>
