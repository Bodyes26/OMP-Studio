<script lang="ts">
	/**
	 * Menu a tendina per l'aggiunta di allegati nel composer.
	 */
	import { IconAttach } from '$lib/icons';
	import { m } from '$lib/paraglide/messages.js';

	let {
		onPickFiles
	} = $props<{
		onPickFiles: () => void;
	}>();
</script>

<div class="attach-menu">
	<button type="button" class="menu-action-btn" onclick={onPickFiles}>
		<span class="action-icon"><IconAttach size={14} /></span>
		<span>{m.chat_v2_composer_attach_pick()}</span>
	</button>

	<div class="attach-hint">
		{m.chat_v2_composer_attach_hint()}
	</div>
</div>

<style>
	.attach-menu {
		display: flex;
		flex-direction: column;
		width: 260px;
		padding: var(--space-1);
	}

	.menu-action-btn {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: 7px var(--space-2);
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		text-align: left;
		cursor: pointer;
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.menu-action-btn:hover {
		background: var(--bg-hover);
	}

	.action-icon {
		color: var(--ink-muted);
		display: inline-flex;
		align-items: center;
	}

	.attach-hint {
		padding: 6px var(--space-2) 4px;
		font-size: 11px;
		line-height: 1.35;
		color: var(--ink-faint);
		border-top: 1px solid var(--line);
		margin-top: 4px;
	}
</style>
