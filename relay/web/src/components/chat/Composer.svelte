<!--
  Composer.svelte — Campo di scrittura della chat, pensato per il telefono (Gate R48, R-REM-06).

  A riposo occupa una riga sola (allegati, campo, invio): sopra resta tutto lo
  spazio per leggere. Mentre scrivi compare la riga degli strumenti con i chip
  ruolo e modello condivisi (`ConfigChips`) e, se l'agente lavora, la scelta
  «In coda | Reindirizza», con In coda predefinito.
-->
<script lang="ts">
	import type { RemoteComposerCatalog, RemoteSlashCommand } from '../../../../src/protocol.ts';
	import type { RemoteAttachmentTransport } from '../../chat/remoteAttachments.svelte.ts';
	import { t } from '../../i18n.ts';
	import { IconArrowUp, IconStop } from '../../icons.ts';
	import {
		commandSuggestions,
		suggestKeyAction,
		type CommandSuggestionItem
	} from '../../chat/suggest.ts';
	import {
		createRemoteAttachmentManager,
		type RemoteComposerAttachment
	} from '../../chat/remoteAttachments.svelte.ts';
	import SuggestTray from './SuggestTray.svelte';
	import ComposerAttachments from './ComposerAttachments.svelte';
	import AttachButton from './AttachButton.svelte';
	import ConfigChips from '../work/ConfigChips.svelte';
	import ComposerEditor from '#lib/agent/components/ComposerEditor.svelte';
	import { createCommandBadgeElement, type ComposerTrigger } from '#lib/agent/composerDoc.ts';

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
		catalog = null,
		hostId = '',
		projectId = '',
		laneId = null,
		connection = null,
		onNotice,
		onOpenImage,
		onSend,
		onStop,
		onSetRole,
		onSetModel,
		onSetThinking
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
		catalog?: RemoteComposerCatalog | null;
		hostId?: string;
		projectId?: string;
		laneId?: string | null;
		connection?: RemoteAttachmentTransport | null;
		onNotice?: (variant: 'info' | 'warning' | 'error', message: string) => void;
		onOpenImage?: (url: string, mimeType?: string) => void;
		onSend: (text: string, whileBusy: 'steer' | 'follow_up', attachments?: RemoteComposerAttachment[]) => Promise<void>;
		onStop: () => Promise<void>;
		onSetRole?: (roleId: string) => Promise<void>;
		onSetModel?: (provider: string, modelId: string) => Promise<void>;
		onSetThinking?: (level: string) => Promise<void>;
	} = $props();

	let inputText = $state('');
	// Mentre l'agente lavora il messaggio parte a fine turno: reindirizzare
	// interrompe il lavoro, quindi va scelto apposta (R-REM-06).
	let whileBusy = $state<'steer' | 'follow_up'>('follow_up');
	let isSending = $state(false);
	let isStopping = $state(false);
	let hasFocus = $state(false);
	let editorRef = $state<ReturnType<typeof ComposerEditor> | null>(null);
	const submitWithModifier = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
	let isDragOver = $state(false);

	const attachmentMgr = createRemoteAttachmentManager({
		getHostId: () => hostId,
		getProjectId: () => projectId,
		getLaneId: () => laneId,
		getConnection: () => connection,
		onNotice: (variant, message) => onNotice?.(variant, message)
	});

	let slashToken = $state<ComposerTrigger | null>(null);
	let suggestIndex = $state(0);

	const currentRole = $derived(role || 'default');
	const canSendWhileBusy = $derived(isWorking && canSessionControl);

	// La riga degli strumenti serve solo mentre si compone: a riposo lascia lo
	// spazio alla conversazione.
	const toolsOpen = $derived(
		!disabled && (hasFocus || inputText.trim().length > 0 || attachmentMgr.hasAttachments)
	);

	const placeholder = $derived.by(() => {
		if (disabled) return disabledReason ?? t('composerDisabled');
		if (isWorking) return whileBusy === 'follow_up' ? t('composerPlaceholderQueued') : t('composerPlaceholderSteer');
		return t('chatInputPlaceholder');
	});

	const availableCommands = $derived<RemoteSlashCommand[]>(catalog?.commands ?? []);

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
		if (!canSubmit) return;

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

	function handleFocusOut(e: FocusEvent): void {
		const shell = e.currentTarget as HTMLElement;
		const next = e.relatedTarget as Node | null;
		// I popover dei chip vivono nel top layer ma restano nel sottoalbero del
		// composer: il fuoco che ci entra non deve richiudere la riga strumenti.
		if (next && shell.contains(next)) return;
		hasFocus = false;
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
		onfocusin={() => (hasFocus = true)}
		onfocusout={handleFocusOut}
		role="region"
		aria-label={t('composerRegion')}
	>
		{#if attachmentMgr.hasAttachments}
			<ComposerAttachments
				attachments={attachmentMgr.attachments}
				onRemove={(id) => attachmentMgr.removeAttachment(id)}
				{onOpenImage}
			/>
		{/if}

		<div class="field-row">
			<AttachButton
				onFiles={(files) => void attachmentMgr.addFiles(files)}
				disabled={disabled || !canSessionControl || isSending}
				title={t('attachFile')}
			/>

			<div class="editor-wrap">
				<ComposerEditor
					bind:this={editorRef}
					disabled={disabled || !canSessionControl || isSending}
					{placeholder}
					ariaLabel={placeholder}
					{submitWithModifier}
					triggers={['/']}
					onSend={() => void handleSubmit()}
					onFilesPaste={(files) => { if (!disabled && canSessionControl && !isSending) void attachmentMgr.addFiles(files); }}
					onInput={() => { inputText = editorRef?.getWireText((name) => availableCommands.some((command) => command.name === name && command.kind === 'skill')) ?? ''; }}
					onTriggerChange={(trigger) => { slashToken = trigger; suggestIndex = 0; }}
					onKeydownFilter={handleKeydown}
				/>
			</div>

			{#if canSendWhileBusy}
				<button
					type="button"
					class="round-btn stop-btn"
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
				class="round-btn send-btn"
				disabled={!canSubmit}
				onclick={handleSubmit}
				title={t('send')}
				aria-label={t('send')}
			>
				<IconArrowUp />
			</button>
		</div>

		{#if toolsOpen && (hasLaneConfig || canSendWhileBusy)}
			<div class="tools-row">
				{#if hasLaneConfig}
					<ConfigChips
						layout="inline"
						{catalog}
						role={currentRole}
						{provider}
						{modelId}
						{modelLabel}
						thinking={thinkingLevel}
						disabled={isWorking}
						onRole={(roleId) => void onSetRole?.(roleId)}
						onModel={(p, id) => void onSetModel?.(p, id)}
						onThinking={(level) => void onSetThinking?.(level)}
					/>
				{/if}

				{#if canSendWhileBusy}
					<div class="seg" role="radiogroup" aria-label={t('composerWhileBusy')}>
						<button
							type="button"
							role="radio"
							aria-checked={whileBusy === 'follow_up'}
							class:on={whileBusy === 'follow_up'}
							onclick={() => (whileBusy = 'follow_up')}
						>
							{t('composerQueue')}
						</button>
						<button
							type="button"
							role="radio"
							aria-checked={whileBusy === 'steer'}
							class:on={whileBusy === 'steer'}
							onclick={() => (whileBusy = 'steer')}
						>
							{t('composerSteer')}
						</button>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
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
		border-radius: 22px;
		display: flex;
		flex-direction: column;
		transition: border-color var(--dur-fast) var(--ease-out);
	}

	.composer-shell:focus-within {
		border-color: var(--line-strong);
	}

	.composer-shell.drag-over {
		border-color: var(--brand-ink);
		box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--brand-ink) 25%, transparent);
	}

	.composer-shell.disabled {
		opacity: 0.75;
		background: var(--bg-sunken);
	}

	.field-row {
		display: flex;
		align-items: flex-end;
		gap: 4px;
		padding: 4px;
		min-width: 0;
	}

	.editor-wrap {
		flex: 1;
		min-width: 0;
		align-self: center;
		/* Il campo cresce con il testo fino a un tetto, poi scorre: la chat resta leggibile. */
		max-height: 30dvh;
		overflow-y: auto;
	}

	.editor-wrap :global(.composer-editor) {
		padding: 9px 4px;
		min-height: 0;
	}

	.round-btn {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		border: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		flex-shrink: 0;
		--icon-size: 18px;
		transition:
			opacity var(--dur-fast) var(--ease-out),
			transform var(--dur-fast) var(--ease-out);
	}

	.send-btn {
		background: var(--brand-ink);
		color: var(--bg-base);
	}

	.stop-btn {
		background: var(--danger);
		color: #ffffff;
	}

	.round-btn:active:not(:disabled) {
		transform: scale(0.95);
	}

	.round-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.round-btn:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}

	.tools-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 0 8px 8px;
		min-width: 0;
	}

	.seg {
		display: inline-flex;
		flex-shrink: 0;
		margin-left: auto;
		border: 1px solid var(--line);
		border-radius: 17px;
		padding: 2px;
	}

	.seg button {
		min-height: 30px;
		padding: 0 10px;
		border: none;
		border-radius: 15px;
		background: transparent;
		color: var(--ink-muted);
		font: inherit;
		font-size: var(--text-caption);
		cursor: pointer;
	}

	.seg button.on {
		background: var(--bg-hover);
		color: var(--ink);
		font-weight: 560;
	}

	.seg button:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}

	@media (prefers-reduced-motion: reduce) {
		.round-btn,
		.composer-shell {
			transition: none;
		}
	}
</style>
