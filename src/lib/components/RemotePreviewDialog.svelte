<script lang="ts">
	import Dialog from '#lib/ui/Dialog.svelte';
	import { m } from '#lib/paraglide/messages.js';
	import { loopbackUrl, openPreview, remotePreview } from '#lib/backend/remotePreview.svelte.ts';

	let input = $state('');
	const request = $derived(remotePreview.request);
	$effect(() => { input = request?.input ?? ''; });
	const valid = $derived(Boolean(loopbackUrl(/^\d{1,5}$/.test(input.trim()) ? `localhost:${input.trim()}` : input)));
	const close = () => { remotePreview.request = null; };
</script>

{#if request}
	<Dialog open title={m.remote_preview_title()} onClose={close} initialFocus={request.input ? 'button.remote-preview-studio' : '#remote-preview-port'}>
		{#snippet body()}
			<label for="remote-preview-port">{m.remote_preview_address()}</label>
			<input class="ui-input" id="remote-preview-port" bind:value={input} placeholder="localhost:5173" disabled={remotePreview.busy} />
			{#if remotePreview.error}<p role="alert">{remotePreview.error}</p>{/if}
		{/snippet}
		{#snippet footer()}
			<button type="button" class="ui-button ui-button-ghost" onclick={close}>{m.common_cancel()}</button>
			<button type="button" class="ui-button ui-button-secondary" disabled={!valid || remotePreview.busy} onclick={() => void openPreview(input, true)}>{m.remote_preview_system()}</button>
			<button type="button" class="ui-button ui-button-primary remote-preview-studio" disabled={!valid || remotePreview.busy} onclick={() => void openPreview(input, false)}>{m.remote_preview_studio()}</button>
		{/snippet}
	</Dialog>
{/if}
