<!--
  ConfigChips.svelte — Chip ruolo e modello condivisi per Chat Composer e Nuovo lavoro (Gate R48).
  Supporta layout inline (due chip per la toolbar della chat) e row (pillola intera divisa ruolo|modello).
-->
<script lang="ts">
	import type { RemoteComposerCatalog } from '../../../../src/protocol.ts';
	import { t } from '../../i18n.ts';
	import { ROLE_HUES } from '#lib/agent/roleHues.ts';
	import RoleMenu from '#lib/agent/components/RoleMenu.svelte';
	import ModelPickerList from '#lib/components/models/ModelPickerList.svelte';
	import ReasoningSlider from '#lib/components/models/ReasoningSlider.svelte';
	import ThinkingMeter from '#lib/agent/components/ThinkingMeter.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import ProviderLogo from '#lib/components/models/ProviderLogo.svelte';
	import { m } from '#lib/paraglide/messages.js';
	import {
		THINKING_LEVEL_ITEMS,
		supportedThinkingLevels
	} from '#lib/stores/modelSettingsHelpers.ts';
	import type { ThinkingLevel } from '#lib/agent/wire.ts';

	let {
		catalog = null,
		role = 'default',
		provider = null,
		modelId = null,
		modelLabel = null,
		thinking = null,
		disabled = false,
		layout = 'inline',
		onRole,
		onModel,
		onThinking
	}: {
		catalog?: RemoteComposerCatalog | null;
		role: string;
		provider: string | null;
		modelId: string | null;
		modelLabel: string | null;
		thinking: string | null;
		disabled?: boolean;
		layout?: 'inline' | 'row';
		onRole: (roleId: string) => void;
		onModel: (provider: string, modelId: string) => void;
		onThinking: (level: string) => void;
	} = $props();

	let activeMenu = $state<'role' | 'model' | null>(null);

	const currentRole = $derived(role || 'default');
	const currentModelLabel = $derived(modelLabel || modelId || t('modelChipTitle'));

	const activeModelValue = $derived.by(() => {
		if (provider && modelId) return `${provider}/${modelId}`;
		return modelId || '';
	});

	const selectedModelOption = $derived.by(() => {
		if (!catalog?.models) return null;
		if (provider && modelId) {
			const exact = catalog.models.find((m) => m.provider === provider && m.id === modelId);
			if (exact) return exact;
		}
		if (modelId) {
			return catalog.models.find((m) => m.id === modelId || `${m.provider}/${m.id}` === modelId) ?? null;
		}
		return null;
	});

	const modelThinkingLevels = $derived.by(() => {
		if (selectedModelOption) {
			const supported = supportedThinkingLevels(selectedModelOption);
			if (supported && supported.length > 0) {
				return THINKING_LEVEL_ITEMS.flatMap((item) =>
					item.id !== 'auto' && supported.includes(item.id) ? [item.id] : []
				);
			}
		}
		const raw = catalog?.thinkingLevels ?? ['off'];
		return THINKING_LEVEL_ITEMS.flatMap((item) =>
			item.id !== 'auto' && raw.includes(item.id) ? [item.id] : []
		);
	});

	const currentThinking = $derived(
		modelThinkingLevels.find((level) => level === thinking) ?? 'off'
	);

	const canReason = $derived.by(() => {
		const levels = modelThinkingLevels;
		return levels.length > 1 || (levels.length === 1 && levels[0] !== 'off');
	});
</script>

{#snippet roleTrigger()}
	<span
		class="role-dot"
		class:has-hue={ROLE_HUES[currentRole] !== undefined}
		style={ROLE_HUES[currentRole] !== undefined ? `--role-h: ${ROLE_HUES[currentRole]}` : undefined}
	></span>
	<span class="role-name font-mono">{currentRole}</span>
{/snippet}

{#snippet rolePopoverContent()}
	<RoleMenu
		assignments={Object.fromEntries(
			(catalog?.roles ?? []).map((r) => {
				const model = r.modelLabel ?? r.model ?? undefined;
				const match = (catalog?.models ?? []).find(
					(m) => `${m.provider}/${m.id}` === r.model || m.id === r.model
				);
				const prov = match?.provider ?? (r.model?.includes('/') ? r.model.split('/')[0] : undefined);
				return [r.id, { model, provider: prov, thinking: r.thinking ?? undefined }];
			})
		)}
		activeRole={currentRole}
		onPick={(roleId) => {
			activeMenu = null;
			onRole(roleId);
		}}
	/>
{/snippet}

{#snippet modelTrigger()}
	{#if provider}
		<ProviderLogo {provider} size={13} />
	{/if}
	<span class="model-name-label">{currentModelLabel}</span>
	<ThinkingMeter level={currentThinking as ThinkingLevel} />
{/snippet}

{#snippet modelPopoverContent()}
	<div class="remote-model-picker">
		<ModelPickerList
			catalog={catalog?.models ?? []}
			value={activeModelValue}
			placeholder={m.chat_v2_composer_model_search()}
			autoFocus={typeof window !== 'undefined' && !window.matchMedia('(max-width: 480px), (pointer: coarse)').matches}
			showFooter
			onSelect={(selector, mod) => {
				if (typeof window !== 'undefined' && !window.matchMedia('(max-width: 480px)').matches) {
					activeMenu = null;
				}
				const targetProvider = mod.provider || (selector.includes('/') ? selector.split('/')[0] : '');
				const targetModelId = mod.id || (selector.includes('/') ? selector.split('/')[1] : selector);
				if (targetProvider && targetModelId) {
					onModel(targetProvider, targetModelId);
				}
			}}
			onClose={() => (activeMenu = null)}
		/>
		<div class="thinking-panel">
			<div class="thinking-popover">
				{#if canReason}
					<ReasoningSlider
						value={currentThinking}
						levels={modelThinkingLevels}
						onChange={(level) => {
							onThinking(level);
						}}
					/>
				{:else}
					<p class="thinking-unsupported">
						{m.chat_v2_composer_thinking_unsupported({ model: currentModelLabel })}
					</p>
				{/if}
			</div>
		</div>
	</div>
{/snippet}

{#if layout === 'row'}
	<div class="cfg-pill">
		<div class="pill-half r-half">
			<MenuButton
				open={activeMenu === 'role'}
				title={disabled ? t('configDisabledBusy') : t('roleChipTitle')}
				hasPopup="listbox"
				contentRole="dialog"
				width="360px"
				{disabled}
				className="cfg-pill-btn r"
				onToggle={() => (activeMenu = activeMenu === 'role' ? null : 'role')}
				onClose={() => (activeMenu = null)}
			>
				{#snippet trigger()}
					{@render roleTrigger()}
				{/snippet}
				{#snippet children()}
					{@render rolePopoverContent()}
				{/snippet}
			</MenuButton>
		</div>
		<div class="pill-half m-half">
			<MenuButton
				open={activeMenu === 'model'}
				title={disabled ? t('configDisabledBusy') : t('modelChipTitle')}
				hasPopup="dialog"
				contentRole="dialog"
				width="400px"
				{disabled}
				className="cfg-pill-btn m"
				onToggle={() => (activeMenu = activeMenu === 'model' ? null : 'model')}
				onClose={() => (activeMenu = null)}
			>
				{#snippet trigger()}
					{@render modelTrigger()}
				{/snippet}
				{#snippet children()}
					{@render modelPopoverContent()}
				{/snippet}
			</MenuButton>
		</div>
	</div>
{:else}
	<div class="config-chips inline-layout">
		<MenuButton
			open={activeMenu === 'role'}
			title={disabled ? t('configDisabledBusy') : t('roleChipTitle')}
			hasPopup="listbox"
			contentRole="dialog"
			width="360px"
			{disabled}
			className="ui-chip composer-chip role-chip"
			onToggle={() => (activeMenu = activeMenu === 'role' ? null : 'role')}
			onClose={() => (activeMenu = null)}
		>
			{#snippet trigger()}
				{@render roleTrigger()}
			{/snippet}
			{#snippet children()}
				{@render rolePopoverContent()}
			{/snippet}
		</MenuButton>

		<MenuButton
			open={activeMenu === 'model'}
			title={disabled ? t('configDisabledBusy') : t('modelChipTitle')}
			hasPopup="dialog"
			contentRole="dialog"
			width="400px"
			{disabled}
			className="ui-chip composer-chip model-chip"
			onToggle={() => (activeMenu = activeMenu === 'model' ? null : 'model')}
			onClose={() => (activeMenu = null)}
		>
			{#snippet trigger()}
				{@render modelTrigger()}
			{/snippet}
			{#snippet children()}
				{@render modelPopoverContent()}
			{/snippet}
		</MenuButton>
	</div>
{/if}

<style>
	.config-chips.inline-layout {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.cfg-pill {
		display: flex;
		width: 100%;
		min-height: 40px;
		border: 1px solid var(--line);
		border-radius: 20px;
		overflow: hidden;
		background: var(--bg-base, transparent);
	}

	.pill-half {
		display: flex;
		align-items: stretch;
	}

	.pill-half.r-half {
		flex: 0 0 auto;
	}

	.pill-half.m-half {
		flex: 1 1 auto;
		min-width: 0;
		border-left: 1px solid var(--line);
	}

	.pill-half :global(.menu-button-container) {
		width: 100%;
		height: 100%;
		display: flex;
	}

	.pill-half :global(.menu-button.cfg-pill-btn) {
		width: 100%;
		height: 100%;
		min-height: 40px;
		border: none;
		border-radius: 0;
		background: transparent;
		padding: 0 14px;
		font-size: 13.5px;
		color: var(--ink);
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.pill-half.m-half :global(.menu-button.cfg-pill-btn) {
		justify-content: center;
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

	.thinking-panel {
		border-top: 1px solid var(--line);
		flex-shrink: 0;
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

	/* Popover modello mobile e desktop */
	:global(.menu-popover:has(.remote-model-picker)) {
		overflow: hidden;
	}

	.remote-model-picker {
		display: flex;
		flex-direction: column;
		max-height: min(560px, calc(100dvh - 48px));
		min-height: 0;
	}

	@media (max-width: 480px) {
		:global(.menu-popover:has(.remote-model-picker)) {
			width: calc(100vw - 24px) !important;
			max-height: calc(100dvh - 24px);
		}
		.remote-model-picker {
			height: min(560px, calc(100dvh - 48px));
		}
		.remote-model-picker :global(.model-picker-list) {
			display: contents;
		}
		.remote-model-picker :global(.results-list) {
			order: 0;
			max-height: none;
			overscroll-behavior-y: contain;
			padding: var(--space-2);
		}
		.remote-model-picker :global(.model-option) {
			min-height: 48px;
			padding: var(--space-2) var(--space-3);
			font-size: var(--text-label);
		}
		.remote-model-picker :global(.search-box) {
			order: 2;
			border-top: 1px solid var(--line);
			border-bottom: 0;
			padding: var(--space-3);
		}
		.remote-model-picker :global(.search-input) {
			min-height: 44px;
			padding-left: 32px;
		}
		.remote-model-picker :global(.search-icon) {
			left: 24px;
			--icon-size: 16px;
		}
		.remote-model-picker :global(.clear-btn) {
			right: 16px;
			min-width: 44px;
			min-height: 44px;
			--icon-size: 16px;
		}
		.remote-model-picker :global(.menu-footer) {
			display: none;
		}
		.thinking-panel {
			order: 1;
		}
		.model-name-label {
			max-width: 120px;
		}
	}

	@media (pointer: coarse) {
		:global(.composer-chip) {
			height: 36px;
			padding: 0 var(--space-2);
		}
	}
</style>
