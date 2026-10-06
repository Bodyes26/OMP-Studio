<script lang="ts">
	/**
	 * Miniatura di un allegato (immagine, video o file generico) nella barra del composer.
	 */
	import { IconClose, IconPlay } from '$lib/icons';
	import { formatTokens } from '$lib/utils/format';
	import { m } from '$lib/paraglide/messages.js';

	export interface ComposerAttachment {
		id: string | number;
		kind: 'image' | 'video' | 'file';
		name: string;
		size: number;
		url?: string;
		path?: string;
		mimeType?: string;
		base64?: string;
		duration?: number;
		tokens: number;
	}

	let {
		attachment,
		onRemove,
		onOpen
	} = $props<{
		attachment: ComposerAttachment;
		onRemove?: () => void;
		/** Apre l'allegato a dimensione piena (solo immagini). */
		onOpen?: () => void;
	}>();

	// La durata misurata dal video vince su quella dichiarata dall'allegato.
	let measuredDuration = $state<number | undefined>(undefined);
	const videoDuration = $derived(measuredDuration ?? attachment.duration);
	function formatDuration(sec?: number): string {
		if (sec === undefined || !Number.isFinite(sec)) return '';
		const m = Math.floor(sec / 60);
		const s = Math.round(sec % 60);
		return `${m}:${String(s).padStart(2, '0')}`;
	}

	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	const fileExtension = $derived.by(() => {
		const dotIdx = attachment.name.lastIndexOf('.');
		if (dotIdx === -1) return 'FILE';
		return attachment.name.slice(dotIdx + 1).toUpperCase().slice(0, 4);
	});
</script>

<div class="attachment-thumb group" title="{attachment.name} · {formatFileSize(attachment.size)}">
	{#if attachment.kind === 'image' && onOpen}
		<button
			type="button"
			class="thumb-open"
			onclick={onOpen}
			aria-label={m.attachment_thumb_open({ name: attachment.name })}
		>
			<img src={attachment.url} alt="" class="thumb-img" />
		</button>
	{:else if attachment.kind === 'image'}
		<img
			src={attachment.url}
			alt={attachment.name}
			class="thumb-img"
		/>
	{:else if attachment.kind === 'video'}
		<div class="thumb-video">
			{#if attachment.url}
				<video
					src={attachment.url}
					muted
					preload="metadata"
					class="video-element"
					onloadedmetadata={(e) => {
						measuredDuration = e.currentTarget.duration;
					}}
				>
					<track kind="captions" />
				</video>
			{/if}
			<span class="video-overlay" aria-hidden="true">
				<span class="play-bubble"><IconPlay /></span>
			</span>
			{#if videoDuration !== undefined && Number.isFinite(videoDuration)}
				<span class="duration-badge font-mono">{formatDuration(videoDuration)}</span>
			{/if}
		</div>
	{:else}
		<div class="thumb-file">
			<span class="ext-badge font-mono">{fileExtension}</span>
			<div class="file-text">
				<span class="file-name">{attachment.name}</span>
				<span class="file-meta">
					{formatFileSize(attachment.size)} · ~{formatTokens(attachment.tokens)} tok
				</span>
			</div>
		</div>
	{/if}

	{#if onRemove}
		<button
			type="button"
			class="remove-btn"
			onclick={onRemove}
			aria-label={m.chat_v2_composer_remove_attachment({ name: attachment.name })}
		>
			<IconClose />
		</button>
	{/if}
</div>

<style>
	.attachment-thumb {
		position: relative;
		display: inline-flex;
		flex-shrink: 0;
	}

	.thumb-img {
		width: 56px;
		height: 56px;
		border-radius: var(--radius-md);
		object-fit: cover;
		border: 1px solid var(--line);
		background: var(--bg-sunken);
	}

	.thumb-open {
		display: inline-flex;
		padding: 0;
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		cursor: zoom-in;
	}

	.thumb-open .thumb-img {
		transition: border-color var(--dur-fast) var(--ease-out);
	}

	.thumb-open:hover .thumb-img {
		border-color: var(--line-strong);
	}

	.thumb-video {
		position: relative;
		width: 56px;
		height: 56px;
		border-radius: var(--radius-md);
		overflow: hidden;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
	}

	.video-element {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.video-overlay {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		pointer-events: none;
	}

	.play-bubble {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: var(--radius-full);
		background: color-mix(in oklch, var(--bg-base) 85%, transparent);
		color: var(--ink);
		--icon-size: 12px;
	}

	.duration-badge {
		position: absolute;
		bottom: 2px;
		right: 2px;
		padding: 0 3px;
		background: color-mix(in oklch, var(--bg-sunken) 75%, transparent);
		color: var(--ink);
		border-radius: var(--radius-sm);
		font-size: var(--text-caption);
		line-height: 13px;
	}
	.thumb-file {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		height: 56px;
		width: 190px;
		padding: 0 10px;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}

	.ext-badge {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border-radius: var(--radius-sm);
		background: color-mix(in oklch, var(--brand) 15%, transparent);
		color: var(--brand-ink);
		font-size: var(--text-caption);
		font-weight: 700;
		flex-shrink: 0;
	}

	.file-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}

	.file-name {
		font-size: var(--text-xs);
		font-weight: 500;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.file-meta {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.remove-btn {
		position: absolute;
		top: -6px;
		right: -6px;
		display: grid;
		place-items: center;
		width: 18px;
		height: 18px;
		border-radius: var(--radius-full);
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		color: var(--ink);
		cursor: pointer;
		opacity: 0;
		--icon-size: 12px;
		transition: opacity var(--dur-fast) var(--ease-out),
			background-color var(--dur-fast) var(--ease-out);
	}

	.attachment-thumb:hover .remove-btn,
	.remove-btn:focus-visible {
		opacity: 1;
	}

	.remove-btn:hover {
		background: var(--bg-hover);
		color: var(--danger);
	}
</style>
