<!--
  CalloutCard.svelte — Intelligent UI: Box semantico per avvisi, note, tip e warning.
  Supporta la sintassi GitHub Flavored Markdown (> [!NOTE], > [!TIP], > [!WARNING], ecc.)
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		IconInfo,
		IconSparkles,
		IconWarning,
		IconCircleAlert,
		IconCircleCheck
	} from '../../icons';

	export type CalloutKind = 'note' | 'tip' | 'warning' | 'caution' | 'important' | 'success';

	let {
		kind = 'note',
		title,
		children
	}: {
		kind?: CalloutKind;
		title?: string;
		children?: Snippet;
	} = $props();

	const meta = $derived.by(() => {
		switch (kind) {
			case 'tip':
				return {
					label: title || 'Suggerimento',
					icon: IconSparkles,
					className: 'callout-tip'
				};
			case 'warning':
			case 'caution':
				return {
					label: title || 'Attenzione',
					icon: IconWarning,
					className: 'callout-warning'
				};
			case 'important':
				return {
					label: title || 'Importante',
					icon: IconCircleAlert,
					className: 'callout-important'
				};
			case 'success':
				return {
					label: title || 'Completato',
					icon: IconCircleCheck,
					className: 'callout-success'
				};
			case 'note':
			default:
				return {
					label: title || 'Nota',
					icon: IconInfo,
					className: 'callout-note'
				};
		}
	});

	const Icon = $derived(meta.icon);
</script>

<aside class="callout-card {meta.className}" role="note">
	<div class="callout-header">
		<span class="callout-icon" aria-hidden="true">
			<Icon />
		</span>
		<span class="callout-title">{meta.label}</span>
	</div>

	{#if children}
		<div class="callout-body">
			{@render children()}
		</div>
	{/if}
</aside>

<style>
	.callout-card {
		margin: var(--space-3) 0;
		padding: var(--space-3);
		border-radius: var(--radius-md);
		border-left: 3px solid var(--accent-color, var(--brand));
		background: var(--bg-surface, var(--bg-raised));
		border-top: 1px solid var(--line-faint, var(--line));
		border-right: 1px solid var(--line-faint, var(--line));
		border-bottom: 1px solid var(--line-faint, var(--line));
		min-width: 0;
		/* Container query per adattare margini e spezzamento testo su larghezze ridotte */
		container-type: inline-size;
	}

	.callout-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
		font-weight: 600;
		font-size: var(--text-label);
		color: var(--accent-color, var(--ink));
	}

	.callout-icon {
		display: inline-grid;
		place-items: center;
		--icon-size: 14px;
	}

	.callout-title {
		letter-spacing: 0.02em;
	}

	.callout-body {
		font-size: var(--text-body);
		line-height: 1.55;
		color: var(--ink);
		overflow-wrap: anywhere;
		word-break: break-word;
	}

	.callout-body :global(p:last-child) {
		margin-bottom: 0;
	}

	/* Varianti semantiche */
	.callout-note {
		--accent-color: var(--brand-ink, #0284c7);
		--bg-surface: var(--bg-raised);
	}

	.callout-tip {
		--accent-color: var(--success, #10b981);
		--bg-surface: var(--bg-raised);
	}

	.callout-warning {
		--accent-color: var(--warn, #f59e0b);
		--bg-surface: var(--bg-raised);
	}

	.callout-important {
		--accent-color: var(--danger, #ef4444);
		--bg-surface: var(--bg-raised);
	}

	.callout-success {
		--accent-color: var(--success, #10b981);
		--bg-surface: var(--bg-raised);
	}

	@container (max-width: 400px) {
		.callout-card {
			padding: 10px;
		}

		.callout-title {
			overflow-wrap: anywhere;
			word-break: break-word;
		}
	}
</style>
