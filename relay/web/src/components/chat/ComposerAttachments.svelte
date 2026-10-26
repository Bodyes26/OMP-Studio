<script lang="ts">
	import AttachmentThumb from '#lib/agent/components/AttachmentThumb.svelte';
	import type { RemoteComposerAttachment } from '../../chat/remoteAttachments.svelte.ts';

	let { attachments, onRemove, onOpenImage }: {
		attachments: RemoteComposerAttachment[];
		onRemove: (id: string) => void;
		onOpenImage?: (dataUrl: string, mimeType?: string) => void;
	} = $props();
</script>

{#if attachments.length > 0}
	<div class="composer-attachments-row" role="list">
		{#each attachments as attachment (attachment.id)}
			<div class="attachment-slot" role="listitem" class:staging={attachment.status === 'staging'}>
				<AttachmentThumb {attachment}
					onRemove={() => onRemove(attachment.id)}
					onOpen={attachment.kind === 'image' && attachment.url && onOpenImage
						? () => onOpenImage?.(attachment.url!, attachment.mimeType) : undefined} />
				{#if attachment.status === 'staging'}
					<progress aria-label={attachment.name}></progress>
				{:else if attachment.status === 'error'}
					<span class="attachment-error" role="alert">{attachment.error}</span>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<style>
	.composer-attachments-row { display: flex; flex-wrap: wrap; gap: var(--space-2); padding: var(--space-2) var(--space-3) 0; max-height: 160px; overflow-y: auto; }
	.attachment-slot { display: flex; flex-direction: column; gap: var(--space-1); max-width: 240px; }
	progress { width: 100%; height: 3px; accent-color: var(--brand); }
	.attachment-error { color: var(--danger); font-size: var(--text-xs); overflow-wrap: anywhere; }
</style>
