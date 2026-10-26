<script lang="ts">
	import type { RemoteContextSnapshot } from '../../../../src/protocol.ts';
	import ContextPanel from '#lib/agent/components/ContextPanel.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import { categoryTokenSum, resolveContextWindow } from '#lib/agent/contextReport.ts';
	import { formatTokens } from '#lib/utils/format.ts';
	import { m } from '#lib/paraglide/messages.js';

	let { context, draftTokens = 0, disabled = false, onRefresh, onCompact }: {
		context: RemoteContextSnapshot;
		draftTokens?: number;
		disabled?: boolean;
		onRefresh?: (force?: boolean) => Promise<void>;
		onCompact?: () => Promise<void>;
	} = $props();

	let open = $state(false);
	// Il pannello condiviso legge lo snapshot vivo; solo le azioni attraversano il relay.
	const session = $derived({
		...context,
		isReady: context.isReady && !disabled,
		refreshContextReport: async (force = false) => { await onRefresh?.(force); }
	});
	const max = $derived(resolveContextWindow(context.contextUsage ?? context.currentContextReport, context.model?.contextWindow));
	const used = $derived((context.contextUsage?.tokens ?? (context.currentContextReport ? categoryTokenSum(context.currentContextReport) : 0)) + draftTokens);
	const pct = $derived(Math.min(1, used / max));
	const circumference = 2 * Math.PI * 7;
</script>

<MenuButton
	{open}
	title={m.chat_v2_composer_context_title()}
	hasPopup="dialog"
	contentRole="dialog"
	align="right"
	width="320px"
	onToggle={() => (open = !open)}
	onClose={() => (open = false)}
>
	{#snippet trigger()}
		<svg viewBox="0 0 18 18" class="context-ring" aria-hidden="true">
			<circle cx="9" cy="9" r="7" fill="none" stroke="var(--line)" stroke-width="2.2" />
			<circle cx="9" cy="9" r="7" fill="none"
				stroke={pct > 0.85 ? 'var(--danger)' : pct > 0.6 ? 'var(--warn)' : 'var(--ink)'}
				stroke-width="2.2" stroke-linecap="round"
				stroke-dasharray={circumference} stroke-dashoffset={circumference * (1 - pct)} />
		</svg>
		<span class="context-numbers">{formatTokens(used)}<span class="context-max">/{formatTokens(max)}</span></span>
	{/snippet}
	{#snippet children()}
		<ContextPanel {session} {draftTokens} cacheWarmingMode={context.cacheWarmingMode}
			onCompact={() => { open = false; void onCompact?.(); }} />
	{/snippet}
</MenuButton>

<style>
	.context-ring { width: 18px; height: 18px; flex-shrink: 0; }
	.context-numbers { font-family: var(--font-mono); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
	.context-max { color: var(--ink-faint); }
</style>
