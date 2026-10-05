<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { ModelDto } from '$lib/stores/modelSettings.svelte';
	import { splitModelSelector, resolveCatalogModel } from '$lib/stores/modelSettingsHelpers';
	import { IconChevronDown } from '$lib/icons';
	import MenuButton from '$lib/ui/MenuButton.svelte';
	import ModelPickerList from './ModelPickerList.svelte';

	let {
		catalog = [],
		value = '',
		placeholder = m.ui_modelpickerdropdown_seleziona_un_modello_fc75(),
		disabled = false,
		ariaLabel,
		className = '',
		onSelect,
		onOpenChange
	} = $props<{
		catalog: ModelDto[];
		value?: string;
		placeholder?: string;
		disabled?: boolean;
		ariaLabel: string;
		className?: string;
		onSelect?: (selector: string, model: ModelDto) => void;
		onOpenChange?: (open: boolean) => void;
	}>();

	let isOpen = $state(false);
	let fieldEl = $state<HTMLDivElement | null>(null);

	function setOpen(next: boolean) {
		if (isOpen === next) return;
		isOpen = next;
		onOpenChange?.(next);
	}

	function handleToggle() {
		if (disabled) return;
		setOpen(!isOpen);
	}

	// Click esterno e Tab fuori chiudono senza rubare il fuoco al nuovo bersaglio.
	function handleClose() {
		setOpen(false);
	}

	// Esc nella ricerca e scelta di un modello: il fuoco torna al campo, come in un select.
	function closeToTrigger() {
		setOpen(false);
		queueMicrotask(() => fieldEl?.querySelector<HTMLButtonElement>('button.model-trigger')?.focus());
	}

	function handleSelect(selector: string, model: ModelDto) {
		closeToTrigger();
		onSelect?.(selector, model);
	}

	const knownSelectors = $derived(new Set((catalog as ModelDto[]).map((model) => model.selector)));

	// Estrai il selector pulito (senza suffisso :thinkingLevel)
	const cleanSelector = $derived(
		value ? splitModelSelector(value, knownSelectors).base : ''
	);

	// Risolvi il modello dal catalogo (cerca selector intero, base o id)
	const selectedModel = $derived.by(() => {
		if (!value) return null;
		return resolveCatalogModel(catalog as ModelDto[], value) ?? null;
	});
</script>

<div class="model-field {className}" bind:this={fieldEl}>
	<MenuButton
		open={isOpen}
		{ariaLabel}
		hasPopup="dialog"
		contentRole="dialog"
		width="400px"
		className="ui-select model-trigger"
		{disabled}
		onToggle={handleToggle}
		onClose={handleClose}
	>
		{#snippet trigger()}
			{#if selectedModel}
				<span class="model-name font-mono">{selectedModel.name || selectedModel.id}</span>
				<span class="model-provider">{selectedModel.provider}</span>
			{:else if cleanSelector || value}
				<span class="model-name font-mono">{cleanSelector || value}</span>
			{:else}
				<span class="model-placeholder">{placeholder}</span>
			{/if}
			<span class="model-chevron" aria-hidden="true"><IconChevronDown /></span>
		{/snippet}
		{#snippet children()}
			<ModelPickerList
				{catalog}
				value={cleanSelector || value || ''}
				placeholder={m.models_picker_search_placeholder()}
				onSelect={handleSelect}
				onClose={closeToTrigger}
			/>
		{/snippet}
	</MenuButton>
</div>

<style>
	.model-field {
		width: 100%;
	}

	/* Il campo occupa la riga: contenitore del menu e involucro del Tooltip del
	   trigger si allargano (solo figli diretti: i Tooltip dentro il popover no). */
	.model-field > :global(.menu-button-container),
	.model-field > :global(.menu-button-container) > :global(.tooltip-wrapper) {
		display: flex;
		width: 100%;
	}

	/* Trigger a sagoma .ui-select: altezza 30px, sfondo sunken, bordo line,
	   raggio 6px (--radius-md) e transizione coerente ai controlli form. */
	.model-field :global(.menu-button.model-trigger) {
		width: 100%;
		height: 30px;
		padding: 0 var(--space-2);
		gap: var(--space-2);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink);
		font-size: var(--text-body);
		font-family: var(--font-ui);
		cursor: pointer;
		text-align: left;
		display: flex;
		align-items: center;
	}

	.model-field :global(.menu-button.model-trigger:hover:not(:disabled)),
	.model-field :global(.menu-button.model-trigger.active) {
		background: var(--bg-sunken);
		border-color: var(--line-strong);
		color: var(--ink);
	}

	.model-field :global(.menu-button.model-trigger:disabled) {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.model-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: var(--text-mono);
		color: var(--ink);
	}

	.model-provider {
		flex-shrink: 0;
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.model-placeholder {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink-faint);
		font-size: var(--text-body);
	}

	.model-chevron {
		display: inline-flex;
		margin-left: auto;
		color: var(--ink-faint);
		--icon-size: 12px;
	}
</style>
