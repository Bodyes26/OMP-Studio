<!--
  ArtifactCard.svelte — Card interattiva nel transcript per anteprime di tool
  (diagrammi Mermaid, grafica SVG, prototipi HTML).
  Tap target >= 44px, icona per tipo, badge, dimensione in byte, apertura della superficie.
-->
<script lang="ts">
	import { t } from '../../i18n.ts';
	import type { RemoteArtifact } from '../../../../src/protocol.ts';
	import { formatArtifactBytes, getPreviewContext, type PreviewStore } from '../../preview.svelte.ts';
	import {
		IconWorkflow,
		IconImage,
		IconViewPreview,
		IconChevronRight
	} from '../../icons.ts';

	let {
		artifact,
		messageId,
		toolName = null,
		hostId = '',
		projectId = '',
		laneId = null,
		isHistory = false,
		previewStore: customStore,
		onOpen
	}: {
		artifact: RemoteArtifact;
		messageId: string;
		toolName?: string | null;
		hostId?: string;
		projectId?: string;
		laneId?: string | null;
		isHistory?: boolean;
		previewStore?: PreviewStore;
		onOpen?: () => void;
	} = $props();

	const contextStore = getPreviewContext();
	const store = $derived(customStore ?? contextStore);

	const kindLabel = $derived.by(() => {
		switch (artifact.kind) {
			case 'mermaid':
				return t('artifactKindDiagram');
			case 'svg':
				return t('artifactKindSvg');
			case 'html':
				return t('artifactKindHtml');
			default:
				return t('artifactKindUnknown');
		}
	});

	const formattedSize = $derived(formatArtifactBytes(artifact.bytes));

	function handleTap(): void {
		if (onOpen) {
			onOpen();
			return;
		}
		if (store) {
			void store.open({
				kind: artifact.kind,
				title: artifact.title,
				content: artifact.content,
				bytes: artifact.bytes,
				messageId,
				hostId,
				projectId,
				laneId,
				isHistory
			});
		}
	}
</script>

<button
	type="button"
	class="artifact-card"
	class:kind-mermaid={artifact.kind === 'mermaid'}
	class:kind-svg={artifact.kind === 'svg'}
	class:kind-html={artifact.kind === 'html'}
	onclick={handleTap}
	title="{t('artifactOpen')}: {artifact.title}"
	aria-label="{t('artifactOpen')}: {artifact.title}"
>
	<div class="artifact-icon-box" aria-hidden="true">
		{#if artifact.kind === 'mermaid'}
			<IconWorkflow />
		{:else if artifact.kind === 'svg'}
			<IconImage />
		{:else}
			<IconViewPreview />
		{/if}
	</div>

	<div class="artifact-info">
		<div class="artifact-meta">
			<span class="artifact-badge">{kindLabel}</span>
			{#if formattedSize}
				<span class="artifact-size font-mono tabular-nums">{formattedSize}</span>
			{/if}
		</div>
		<div class="artifact-title" title={artifact.title}>
			{artifact.title}
		</div>
	</div>

	<div class="artifact-action" aria-hidden="true">
		<span class="action-text">{t('artifactOpen')}</span>
		<span class="action-chevron"><IconChevronRight /></span>
	</div>
</button>

<style>
	.artifact-card {
		display: flex;
		align-items: center;
		gap: var(--space-3, 12px);
		min-height: 48px;
		width: 100%;
		box-sizing: border-box;
		padding: var(--space-2, 8px) var(--space-3, 12px);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-md, 8px);
		color: var(--ink);
		cursor: pointer;
		text-align: left;
		transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
		outline: none;
		user-select: none;
		-webkit-tap-highlight-color: transparent;
	}

	.artifact-card:hover {
		border-color: var(--focus-ring, var(--line-strong, #888));
		background: var(--bg-hover, rgba(255, 255, 255, 0.04));
	}

	.artifact-card:active {
		transform: scale(0.995);
	}

	.artifact-card:focus-visible {
		border-color: var(--focus);
		box-shadow: var(--focus-inset);
	}

	.artifact-icon-box {
		width: 36px;
		height: 36px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm, 6px);
		background: var(--bg-sunken, rgba(0, 0, 0, 0.15));
		border: 1px solid var(--line);
		color: var(--ink-muted);
	}

	.kind-mermaid .artifact-icon-box {
		color: var(--brand);
		background: color-mix(in oklch, var(--brand) 12%, transparent);
	}

	.kind-svg .artifact-icon-box {
		color: #10b981;
		background: color-mix(in srgb, #10b981 12%, transparent);
	}

	.kind-html .artifact-icon-box {
		color: #f59e0b;
		background: color-mix(in srgb, #f59e0b 12%, transparent);
	}

	.artifact-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.artifact-meta {
		display: flex;
		align-items: center;
		gap: var(--space-2, 8px);
	}

	.artifact-badge {
		font-size: var(--text-xs, 11px);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--ink-muted);
	}

	.kind-mermaid .artifact-badge {
		color: var(--brand);
	}

	.kind-svg .artifact-badge {
		color: #10b981;
	}

	.kind-html .artifact-badge {
		color: #f59e0b;
	}

	.artifact-size {
		font-size: var(--text-xs, 11px);
		color: var(--ink-faint);
	}

	.artifact-title {
		font-size: var(--text-sm, 13px);
		font-weight: 500;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.artifact-action {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
		color: var(--ink-muted);
		font-size: var(--text-xs, 12px);
		transition: color 0.15s ease, transform 0.15s ease;
	}

	.artifact-card:hover .artifact-action {
		color: var(--ink);
	}

	.action-text {
		display: none;
	}

	@media (min-width: 480px) {
		.action-text {
			display: inline;
		}
	}

	.action-chevron {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
	}
</style>
