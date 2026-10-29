<script lang="ts">
	import { automationsStore } from '#lib/automations/store.svelte.ts';
	import { t } from '#lib/automations/i18n.ts';
	import { IconCopy, IconCheck, IconRefresh, IconWarning } from '#lib/icons.ts';

	interface Props {
		executionId: string;
		outputTruncated?: boolean;
		isRunning?: boolean;
	}

	let { executionId, outputTruncated = false, isRunning = false }: Props = $props();

	let fullText = $state('');
	let currentOffset = $state(0);
	let serverTruncated = $state(false);
	const isTruncated = $derived(outputTruncated || serverTruncated);
	let isEnd = $state(false);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let copied = $state(false);
	let autoRefreshTimer = $state<ReturnType<typeof setInterval> | null>(null);

	async function loadChunk(reset = false) {
		if (loading) return;
		loading = true;
		error = null;
		try {
			const offset = reset ? 0 : currentOffset;
			const res = await automationsStore.getOutput(executionId, offset, 64 * 1024);
			if (reset) {
				fullText = res.text;
			} else {
				fullText += res.text;
			}
			currentOffset = res.nextOffset;
			if (res.truncated) serverTruncated = true;
			isEnd = res.end;
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		// When executionId changes, reload from start
		if (executionId) {
			fullText = '';
			currentOffset = 0;
			serverTruncated = false;
			isEnd = false;
			void loadChunk(true);
		}
	});

	$effect(() => {
		if (isRunning && !isEnd) {
			const timer = setInterval(() => {
				void loadChunk(false);
			}, 2500);
			return () => clearInterval(timer);
		}
	});

	async function copyOutput() {
		if (!fullText) return;
		try {
			await navigator.clipboard.writeText(fullText);
			copied = true;
			setTimeout(() => {
				copied = false;
			}, 2000);
		} catch {
			// Fallback if clipboard api fails
		}
	}
</script>

<div class="output-viewer">
	<div class="output-toolbar">
		<span class="output-title font-mono">{t('occ_output_heading')}</span>
		<div class="toolbar-actions">
			{#if loading}
				<span class="loading-indicator">{t('titles_backfill_running')}</span>
			{/if}
			{#if !isEnd && !loading}
				<button
					type="button"
					class="ui-button ui-button-secondary text-xs"
					onclick={() => void loadChunk(false)}
				>
					<IconRefresh />
					<span>{t('occ_output_load_more')}</span>
				</button>
			{/if}
			<button
				type="button"
				class="ui-button ui-button-secondary text-xs"
				onclick={copyOutput}
				disabled={!fullText}
			>
				{#if copied}
					<IconCheck />
					<span>{t('occ_btn_copied')}</span>
				{:else}
					<IconCopy />
					<span>{t('occ_output_copy')}</span>
				{/if}
			</button>
		</div>
	</div>

	{#if isTruncated}
		<div class="truncated-banner" role="status">
			<IconWarning />
			<span>{t('occ_output_truncated', { bytes: '10 MiB' })}</span>
		</div>
	{/if}

	{#if error}
		<div class="error-banner" role="alert">
			<IconWarning />
			<span>{error}</span>
		</div>
	{/if}

	<div class="output-terminal font-mono">
		{#if fullText}
			<pre>{fullText}</pre>
		{:else if loading}
			<div class="placeholder">{t('titles_backfill_running')}</div>
		{:else}
			<div class="placeholder">{t('occ_output_empty')}</div>
		{/if}
	</div>
</div>

<style>
	.output-viewer {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-base);
		overflow: hidden;
		margin-top: 12px;
	}

	.output-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		background: var(--bg-sunken);
		border-bottom: 1px solid var(--line);
	}

	.output-title {
		font-size: 11px;
		font-weight: 600;
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.toolbar-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.loading-indicator {
		font-size: 11px;
		color: var(--ink-muted);
	}

	.truncated-banner {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 12px;
		font-size: 12px;
		background: color-mix(in srgb, var(--warn) 12%, transparent);
		color: var(--warn);
		border-bottom: 1px solid color-mix(in srgb, var(--warn) 25%, transparent);
	}

	.error-banner {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 12px;
		font-size: 12px;
		background: color-mix(in srgb, var(--danger) 12%, transparent);
		color: var(--danger);
		border-bottom: 1px solid color-mix(in srgb, var(--danger) 25%, transparent);
	}

	.output-terminal {
		padding: 12px;
		max-height: 380px;
		overflow-y: auto;
		font-size: 12px;
		line-height: 1.5;
		background: var(--bg-sunken);
		color: var(--ink);
		user-select: text;
	}

	.output-terminal pre {
		margin: 0;
		white-space: pre-wrap;
		word-break: break-all;
		font-family: inherit;
	}

	.placeholder {
		color: var(--ink-faint);
		font-style: italic;
		padding: 16px 0;
		text-align: center;
	}
</style>
