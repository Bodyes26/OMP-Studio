<!--
  AttachButton.svelte — Pulsante graffetta con file input integrato per il composer remoto.
-->
<script lang="ts">
	import { IconAttach } from '../../icons.ts';

	let {
		onFiles,
		disabled = false,
		title = 'Allega file o immagini'
	}: {
		onFiles: (files: FileList) => void;
		disabled?: boolean;
		title?: string;
	} = $props();

	let fileInputEl = $state<HTMLInputElement | null>(null);

	function handleClick(): void {
		if (disabled || !fileInputEl) return;
		fileInputEl.value = '';
		fileInputEl.click();
	}

	function handleChange(e: Event): void {
		const target = e.target as HTMLInputElement;
		if (target?.files && target.files.length > 0) {
			onFiles(target.files);
		}
	}
</script>

<input
	bind:this={fileInputEl}
	type="file"
	multiple
	style="display: none;"
	onchange={handleChange}
	tabindex={-1}
	aria-hidden="true"
/>

<button
	type="button"
	class="attach-btn"
	onclick={handleClick}
	{disabled}
	{title}
	aria-label={title}
>
	<IconAttach aria-hidden="true" />
</button>

<style>
	.attach-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		background: transparent;
		color: var(--ink-muted);
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease;
		--icon-size: 16px;
	}

	.attach-btn:hover:not(:disabled) {
		background: var(--bg-raised);
		color: var(--ink);
	}

	.attach-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
