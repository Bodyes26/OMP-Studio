<!--
  Composer.svelte — Riquadro di immissione comandi e prompt ancorato in basso.
  Auto-growing textarea nella sagoma .composer-shell, pulsante di invio, stop di emergenza,
  selettore steer/follow-up durante il turno, barra dei chip (ruolo, modello, thinking) e autocompletamento.
  Fedele a src/lib/agent/components/Composer.svelte di Studio.
-->
<script lang="ts">
	import type { RemoteComposerCatalog, RemoteSlashCommand } from '../../../../src/protocol.ts';
	import { t } from '../../i18n.ts';
	import { IconArrowUp, IconChevronUp, IconStop } from '../../icons.ts';
	import { ROLE_HUES } from '../../chat/roleHues.ts';
	import {
		commandSuggestions,
		getCurrentSlashToken,
		replaceSlashToken,
		suggestKeyAction,
		type CommandSuggestionItem,
		type SlashTokenMatch
	} from '../../chat/suggest.ts';
	import ComposerStatusLine from './ComposerStatusLine.svelte';
	import ThinkingMeter from './ThinkingMeter.svelte';
	import PickerOverlay from './PickerOverlay.svelte';
	import RolePicker from './RolePicker.svelte';
	import ModelPicker from './ModelPicker.svelte';
	import ThinkingPicker from './ThinkingPicker.svelte';
	import SuggestTray from './SuggestTray.svelte';

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
		onSend: (text: string, whileBusy: 'steer' | 'follow_up') => Promise<void>;
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
	let textareaEl = $state<HTMLTextAreaElement | null>(null);

	// Selettori attivi e riferimenti DOM per l'ancoraggio
	let activePicker = $state<'role' | 'model' | 'thinking' | null>(null);
	let roleChipEl = $state<HTMLButtonElement | null>(null);
	let modelChipEl = $state<HTMLButtonElement | null>(null);
	let thinkingChipEl = $state<HTMLButtonElement | null>(null);

	// Stato autocompletamento slash
	let slashToken = $state<SlashTokenMatch | null>(null);
	let suggestIndex = $state(0);

	const currentRole = $derived(role || 'default');
	const currentModelLabel = $derived(modelLabel || modelId || 'Modello');
	const currentThinking = $derived(thinkingLevel || 'off');

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

	function updateSlashToken(): void {
		if (!textareaEl) {
			slashToken = null;
			return;
		}
		const pos = textareaEl.selectionStart;
		const match = getCurrentSlashToken(inputText, pos);
		slashToken = match;
		suggestIndex = 0;
	}

	function handleSelectSuggestion(item: CommandSuggestionItem): void {
		if (!slashToken) return;
		const { nextText, nextCaret } = replaceSlashToken(
			inputText,
			slashToken,
			item.command.name,
			item.isSkill
		);
		inputText = nextText;
		slashToken = null;
		queueMicrotask(() => {
			if (textareaEl) {
				textareaEl.focus();
				textareaEl.setSelectionRange(nextCaret, nextCaret);
				adjustHeight();
			}
		});
	}

	const canSubmit = $derived(!disabled && !isSending && inputText.trim().length > 0 && canSessionControl);

	function adjustHeight(): void {
		if (!textareaEl) return;
		textareaEl.style.height = 'auto';
		const next = Math.min(textareaEl.scrollHeight, 180);
		textareaEl.style.height = `${next}px`;
	}

	async function handleSubmit(): Promise<void> {
		const text = inputText.trim();
		if (!text || isSending || disabled || !canSessionControl) return;

		// Intercetta /new e /clear digitati da soli nel composer per avviare una nuova chat
		if (hasLaneConfig && (text === '/new' || text === '/clear')) {
			inputText = '';
			slashToken = null;
			if (textareaEl) {
				textareaEl.style.height = 'auto';
			}
			if (onNewSession) {
				await onNewSession();
			}
			return;
		}

		isSending = true;
		try {
			await onSend(text, whileBusy);
			inputText = '';
			slashToken = null;
			if (textareaEl) {
				textareaEl.style.height = 'auto';
			}
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

	function handleKeydown(e: KeyboardEvent): void {
		// Gestione della palette dei suggerimenti se aperta
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
				return;
			}
		}

		// Cmd+Enter o Ctrl+Enter inviano sempre
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			void handleSubmit();
			return;
		}

		// Su desktop (senza puntatore coarse): Invio invia, Shift+Invio va a capo
		const isCoarsePointer = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
		if (e.key === 'Enter' && !e.shiftKey && !isCoarsePointer) {
			e.preventDefault();
			void handleSubmit();
		}
	}
</script>

<div class="composer-root">
	<!-- Palette dei suggerimenti per comandi e skill ancorata subito sopra il composer -->
	{#if showSuggestions}
		<SuggestTray
			items={suggestions}
			selectedIndex={suggestIndex}
			onSelect={handleSelectSuggestion}
			onHover={(idx) => (suggestIndex = idx)}
		/>
	{/if}

	<div class="composer-shell" class:disabled>
		{#if disabled && disabledReason}
			<div class="disabled-notice" role="alert">
				<span>{disabledReason}</span>
			</div>
		{/if}

		<textarea
			bind:this={textareaEl}
			bind:value={inputText}
			oninput={() => {
				adjustHeight();
				updateSlashToken();
			}}
			onclick={updateSlashToken}
			onkeyup={(e) => {
				if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
					updateSlashToken();
				}
			}}
			onkeydown={handleKeydown}
			disabled={disabled || !canSessionControl}
			placeholder={disabled ? (disabledReason ?? t('composerDisabled')) : t('chatInputPlaceholder')}
			rows={1}
			class="composer-textarea"
			aria-label={t('chatInputPlaceholder')}
		></textarea>

		<div class="composer-toolbar">
			<!-- Chip di configurazione corsia (ruolo, modello, thinking) quando lane_config e' presente -->
			{#if hasLaneConfig}
				<div class="toolbar-chips">
					<!-- Chip Ruolo -->
					<button
						bind:this={roleChipEl}
						type="button"
						class="ui-chip composer-chip"
						disabled={isWorking}
						aria-pressed={activePicker === 'role'}
						onclick={() => (activePicker = activePicker === 'role' ? null : 'role')}
						title={isWorking ? t('configDisabledBusy') : t('roleChipTitle')}
					>
						<span
							class="role-dot"
							class:has-hue={ROLE_HUES[currentRole] !== undefined}
							style={ROLE_HUES[currentRole] !== undefined ? `--role-h: ${ROLE_HUES[currentRole]}` : undefined}
						></span>
						<span class="role-name font-mono">{currentRole}</span>
					</button>

					<!-- Chip Modello -->
					<button
						bind:this={modelChipEl}
						type="button"
						class="ui-chip composer-chip"
						disabled={isWorking}
						aria-pressed={activePicker === 'model'}
						onclick={() => (activePicker = activePicker === 'model' ? null : 'model')}
						title={isWorking ? t('configDisabledBusy') : t('modelChipTitle')}
					>
						<span class="model-name-label">{currentModelLabel}</span>
						<span class="chevron-indicator"><IconChevronUp /></span>
					</button>

					<!-- Chip Thinking -->
					<button
						bind:this={thinkingChipEl}
						type="button"
						class="ui-chip composer-chip"
						disabled={isWorking}
						aria-pressed={activePicker === 'thinking'}
						onclick={() => (activePicker = activePicker === 'thinking' ? null : 'thinking')}
						title={isWorking ? t('configDisabledBusy') : t('thinkingChipTitle')}
					>
						<ThinkingMeter level={currentThinking} />
						<span class="thinking-label font-mono">{currentThinking}</span>
					</button>
				</div>
			{/if}

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

	<!-- Selettori popup / bottom-sheet ancorati ai chip -->
	{#if hasLaneConfig}
		<PickerOverlay
			open={activePicker === 'role'}
			title={t('rolePickerTitle')}
			triggerEl={roleChipEl}
			width="380px"
			onClose={() => (activePicker = null)}
		>
			<RolePicker
				roles={catalog?.roles ?? []}
				activeRole={currentRole}
				onSelect={(roleId) => {
					activePicker = null;
					void onSetRole?.(roleId);
				}}
			/>
		</PickerOverlay>

		<PickerOverlay
			open={activePicker === 'model'}
			title={t('modelPickerTitle')}
			triggerEl={modelChipEl}
			width="380px"
			onClose={() => (activePicker = null)}
		>
			<ModelPicker
				models={catalog?.models ?? []}
				activeProvider={provider}
				activeModelId={modelId}
				onSelect={(p, m) => {
					activePicker = null;
					void onSetModel?.(p, m);
				}}
			/>
		</PickerOverlay>

		<PickerOverlay
			open={activePicker === 'thinking'}
			title={t('thinkingPickerTitle')}
			triggerEl={thinkingChipEl}
			width="340px"
			onClose={() => (activePicker = null)}
		>
			<ThinkingPicker
				levels={catalog?.thinkingLevels}
				activeLevel={currentThinking}
				onSelect={(lvl) => {
					activePicker = null;
					void onSetThinking?.(lvl);
				}}
			/>
		</PickerOverlay>
	{/if}

	<ComposerStatusLine modelLabel={hasLaneConfig ? null : modelLabel} {machineName} />
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

	.composer-textarea {
		width: 100%;
		min-height: 44px;
		max-height: 180px;
		padding: 12px 14px 6px;
		background: transparent;
		border: none;
		outline: none;
		resize: none;
		font-family: var(--font-ui);
		font-size: var(--text-chat);
		line-height: 22px;
		color: var(--ink);
		box-sizing: border-box;
	}

	.composer-textarea::placeholder {
		color: var(--ink-faint);
	}

	.composer-textarea:disabled {
		cursor: not-allowed;
	}

	.composer-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 4px 10px 10px;
		gap: var(--space-2);
		min-width: 0;
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

	.composer-chip {
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

	.composer-chip:hover:not(:disabled) {
		background: var(--bg-hover);
		border-color: var(--line-strong);
		color: var(--ink);
	}

	.composer-chip[aria-pressed='true'] {
		background: var(--bg-hover);
		border-color: var(--line);
		color: var(--ink);
	}

	.composer-chip:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.role-dot {
		width: 7px;
		height: 7px;
		border-radius: var(--radius-full);
		background: var(--brand-ink);
		flex-shrink: 0;
	}

	.role-dot.has-hue {
		background: oklch(var(--proj-l-ink) var(--proj-c-ink) var(--role-h, 260));
	}

	.role-name {
		font-weight: 500;
	}

	.model-name-label {
		max-width: 140px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: 500;
	}

	.chevron-indicator {
		display: grid;
		place-items: center;
		--icon-size: 13px;
		color: var(--ink-faint);
		margin-left: -1px;
	}

	.thinking-label {
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	.steer-segmented {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px;
		background: var(--bg-hover);
		border-radius: var(--radius-full);
		flex-shrink: 0;
	}

	.segment-chip {
		height: 24px;
		padding: 0 10px;
		border-radius: var(--radius-full);
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink-faint);
		background: transparent;
		border: none;
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.segment-chip.active {
		background: var(--bg-raised);
		color: var(--ink);
		box-shadow: var(--shadow-overlay);
	}

	.toolbar-actions {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	.stop-btn {
		background: var(--danger) !important;
		color: var(--on-danger, #ffffff) !important;
	}

	.stop-btn:hover:not(:disabled) {
		background: color-mix(in oklch, var(--danger) 85%, black) !important;
	}

	@media (pointer: coarse) {
		.composer-chip {
			min-height: 32px;
			padding: 0 10px;
		}

		.segment-chip {
			min-height: 32px;
			padding: 0 12px;
		}
	}
</style>
