<!--
  CommandDetail.svelte — Pannello di dettaglio per un comando selezionato nel catalogo:
  mostra titolo, slash, sintassi argomenti, summary, vantaggi, esempi, whenToUse,
  badge origine e controlli di posizionamento/fissaggio nel composer.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { CommandManifestEntry, CommandPlacement, ComposerLayout, ComposerZone, ComposerForm } from '$lib/agent/commandCatalog/types';
	import { resolveCommandText } from '$lib/agent/commandCatalog/text';
	import CommandIcon from './CommandIcon.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import {
		IconLock,
		IconCopy,
		IconCheck,
		IconInfo,
		IconSparkles
	} from '$lib/icons';

	let {
		entry,
		newCommand = null,
		layout,
		onTogglePin,
		onChangePlacement
	}: {
		entry: CommandManifestEntry | null;
		newCommand?: { name: string; description?: string } | null;
		layout: ComposerLayout;
		onTogglePin: (id: string, pin: boolean) => void;
		onChangePlacement: (id: string, placement: CommandPlacement) => void;
	} = $props();

	const text = $derived(entry ? resolveCommandText(entry) : null);

	const pinnedItem = $derived(
		entry ? layout.pinned.find((p) => p.id === entry.id) : null
	);

	const isPinned = $derived(!!pinnedItem);
	const isLocked = $derived(entry?.locked ?? false);

	const activePlacementKey = $derived.by(() => {
		if (pinnedItem) {
			return `${pinnedItem.zone}:${pinnedItem.form}`;
		}
		if (entry?.defaultPlacement) {
			return `${entry.defaultPlacement.zone}:${entry.defaultPlacement.form}`;
		}
		if (entry?.supported[0]) {
			return `${entry.supported[0].zone}:${entry.supported[0].form}`;
		}
		return '';
	});

	function placementLabel(p: CommandPlacement): string {
		if (p.zone === 'toolbar' && p.form === 'icon') return m.settings_commands_placement_toolbar_icon();
		if (p.zone === 'toolbar' && p.form === 'chip') return m.settings_commands_placement_toolbar_chip();
		if (p.zone === 'statusLine' && p.form === 'icon') return m.settings_commands_placement_status_icon();
		return m.settings_commands_placement_status_chip();
	}

	const placementOptions = $derived(
		entry ? entry.supported.map((p) => ({
			value: `${p.zone}:${p.form}`,
			label: placementLabel(p)
		})) : []
	);

	function handlePlacementChange(value: string) {
		if (!entry) return;
		const [zone, form] = value.split(':') as [ComposerZone, ComposerForm];
		if (!zone || !form) return;
		onChangePlacement(entry.id, { zone, form });
	}

	let copiedSlash = $state(false);
	function copySlashCommand(cmd: string) {
		void navigator.clipboard.writeText(cmd);
		copiedSlash = true;
		setTimeout(() => {
			copiedSlash = false;
		}, 1800);
	}
</script>

<div class="command-detail-panel">
	{#if entry && text}
		<!-- Intestazione del comando -->
		<div class="detail-header">
			<div class="title-row">
				<div class="icon-avatar">
					<CommandIcon icon={entry.icon} class="header-icon" />
				</div>
				<div class="title-col">
					<div class="title-with-badges">
						<h3 class="detail-title">{text.title}</h3>
						<div class="badges-row">
							<span class="origin-badge origin-{entry.origin}">
								{#if entry.origin === 'omp'}
									{m.settings_commands_badge_origin_omp()}
								{:else if entry.origin === 'studio'}
									{m.settings_commands_badge_origin_studio()}
								{:else}
									{m.settings_commands_badge_origin_control()}
								{/if}
							</span>
							{#if isLocked}
								<span class="locked-badge">
									<IconLock />
									<span>{m.settings_commands_locked_badge()}</span>
								</span>
							{/if}
						</div>
					</div>

					{#if entry.origin !== 'control'}
						{@const slashCmd = `/${entry.id}${entry.argsHint ? ' ' + entry.argsHint : ''}`}
						<div class="slash-box">
							<code class="slash-code">{slashCmd}</code>
							<button
								type="button"
								class="btn-copy-slash"
								aria-label="Copia comando slash"
								onclick={() => copySlashCommand(`/${entry.id}`)}
							>
								{#if copiedSlash}
									<IconCheck />
								{:else}
									<IconCopy />
								{/if}
							</button>
						</div>
					{/if}
				</div>
			</div>

			<p class="summary-text">{text.summary}</p>
		</div>

		<!-- Controllo posizionamento nel composer -->
		<div class="detail-section placement-card">
			<h4 class="section-title">{m.settings_commands_placement_label()}</h4>

			{#if entry.supported.length === 0}
				<p class="placement-unsupported-note">
					Questo comando è utilizzabile tramite comando slash o dal menu catalogo; non dispone di un controllo dedicato nel composer.
				</p>
			{:else}
				<div class="placement-controls">
					<div class="pin-toggle-row">
						{#if isLocked}
							<div class="locked-notice">
								<IconLock />
								<span>{m.settings_commands_pin_switch_locked_desc()}</span>
							</div>
						{:else}
							<Switch
								checked={isPinned}
								label={m.settings_commands_pin_switch()}
								onChange={(checked) => onTogglePin(entry.id, checked)}
							/>
						{/if}
					</div>

					{#if isPinned || isLocked}
						{#if placementOptions.length > 1}
							<div class="placement-picker">
								<Segmented
									options={placementOptions}
									value={activePlacementKey}
									onChange={handlePlacementChange}
									ariaLabel={m.settings_commands_placement_label()}
								/>
							</div>
						{:else if placementOptions.length === 1}
							<div class="placement-fixed-badge">
								<span class="placement-tag">{placementOptions[0].label}</span>
							</div>
						{/if}
					{/if}
				</div>
			{/if}
		</div>

		<!-- Quando conviene usarlo -->
		{#if text.whenToUse}
			<div class="detail-section when-card">
				<h4 class="section-title">{m.settings_commands_when_to_use_title()}</h4>
				<p class="when-text">{text.whenToUse}</p>
			</div>
		{/if}

		<!-- Vantaggi -->
		{#if text.benefits && text.benefits.length > 0}
			<div class="detail-section">
				<h4 class="section-title">{m.settings_commands_benefits_title()}</h4>
				<ul class="benefits-list">
					{#each text.benefits as benefit}
						<li class="benefit-item">
							<span class="benefit-check" aria-hidden="true">
								<IconCheck />
							</span>
							<span>{benefit}</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<!-- Esempi d'uso -->
		{#if text.examples && text.examples.length > 0}
			<div class="detail-section">
				<h4 class="section-title">{m.settings_commands_examples_title()}</h4>
				<div class="examples-list">
					{#each text.examples as ex}
						<div class="example-item">
							<code class="example-code">{ex.command}</code>
							{#if ex.note}
								<span class="example-note">{ex.note}</span>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}

	{:else if newCommand}
		<!-- Dettaglio comando non ancora a manifesto -->
		<div class="detail-header">
			<div class="title-row">
				<div class="icon-avatar">
					<IconSparkles />
				</div>
				<div class="title-col">
					<div class="title-with-badges">
						<h3 class="detail-title">{newCommand.name}</h3>
						<span class="origin-badge origin-new">{m.settings_commands_section_new()}</span>
					</div>
					<div class="slash-box">
						<code class="slash-code">/{newCommand.name}</code>
					</div>
				</div>
			</div>

			<p class="summary-text">
				{newCommand.description || 'Nessuna descrizione fornita dal runtime di omp.'}
			</p>
		</div>

		<div class="detail-section when-card">
			<div class="new-command-notice">
				<IconInfo />
				<p class="notice-text">
					{m.settings_commands_section_new_desc()} Questo comando è utilizzabile digitando <code>/{newCommand.name}</code> nel composer, ma non supporta ancora il fissaggio visivo come pulsante rapido.
				</p>
			</div>
		</div>

	{:else}
		<div class="empty-selection-placeholder">
			<IconInfo />
			<p>{m.settings_commands_select_prompt()}</p>
		</div>
	{/if}
</div>

<style>
	.command-detail-panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
		min-width: 0;
	}

	.detail-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding-bottom: var(--space-3);
		border-bottom: 1px solid var(--line);
	}

	.title-row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
	}

	.icon-avatar {
		width: 36px;
		height: 36px;
		border-radius: var(--radius-md);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--ink);
		flex-shrink: 0;
	}

	.title-col {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
		flex: 1;
	}

	.title-with-badges {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.detail-title {
		margin: 0;
		font-size: var(--text-title);
		font-weight: 600;
		color: var(--ink);
	}

	.badges-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.origin-badge {
		font-size: 11px;
		padding: 2px 7px;
		border-radius: var(--radius-full);
		font-weight: 500;
		letter-spacing: 0.02em;
	}

	.origin-omp {
		background: color-mix(in oklch, var(--brand) 15%, transparent);
		color: var(--brand-ink);
		border: 1px solid color-mix(in oklch, var(--brand) 30%, transparent);
	}

	.origin-studio {
		background: color-mix(in oklch, var(--success) 15%, transparent);
		color: var(--success);
		border: 1px solid color-mix(in oklch, var(--success) 30%, transparent);
	}

	.origin-control {
		background: var(--bg-overlay);
		color: var(--ink-muted);
		border: 1px solid var(--line);
	}

	.origin-new {
		background: color-mix(in oklch, var(--warn) 15%, transparent);
		color: var(--warn);
		border: 1px solid color-mix(in oklch, var(--warn) 30%, transparent);
	}

	.locked-badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 11px;
		padding: 2px 7px;
		border-radius: var(--radius-full);
		background: var(--bg-sunken);
		color: var(--ink-muted);
		border: 1px solid var(--line);
	}

	.slash-box {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		margin-top: 2px;
	}

	.slash-code {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		background: var(--bg-sunken);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		color: var(--ink);
		border: 1px solid var(--line);
	}

	.btn-copy-slash {
		background: transparent;
		border: none;
		color: var(--ink-faint);
		cursor: pointer;
		padding: 2px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
	}

	.btn-copy-slash:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.summary-text {
		margin: 0;
		font-size: var(--text-body);
		color: var(--ink);
		line-height: 1.45;
	}

	.detail-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.section-title {
		margin: 0;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--ink-muted);
		font-weight: 600;
	}

	.placement-card {
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-3);
	}

	.placement-controls {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.pin-toggle-row {
		display: flex;
		align-items: center;
	}

	.locked-notice {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	.placement-picker {
		margin-top: var(--space-1);
	}

	.placement-fixed-badge {
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	.placement-tag {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		padding: 3px 8px;
		border-radius: var(--radius-sm);
		font-size: var(--text-caption);
		color: var(--ink);
	}

	.placement-unsupported-note {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--ink-muted);
		font-style: italic;
	}

	.when-card {
		background: color-mix(in oklch, var(--brand) 6%, var(--bg-base));
		border: 1px solid color-mix(in oklch, var(--brand) 18%, var(--line));
		border-radius: var(--radius-md);
		padding: var(--space-3);
	}

	.when-text {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--ink);
		line-height: 1.45;
	}

	.benefits-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.benefit-item {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		font-size: var(--text-caption);
		color: var(--ink);
		line-height: 1.4;
	}

	.benefit-check {
		display: inline-flex;
		color: var(--success);
		font-size: 11px;
		align-self: center;
	}

	.examples-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.example-item {
		display: flex;
		flex-direction: column;
		gap: 2px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
	}

	.example-code {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink);
		font-weight: 500;
	}

	.example-note {
		font-size: 11.5px;
		color: var(--ink-muted);
	}

	.new-command-notice {
		display: flex;
		gap: var(--space-2);
		color: var(--ink-muted);
		font-size: var(--text-caption);
		line-height: 1.4;
	}

	.notice-text {
		margin: 0;
	}

	.empty-selection-placeholder {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		padding: var(--space-6) var(--space-4);
		color: var(--ink-muted);
		text-align: center;
		font-size: var(--text-caption);
	}
</style>
