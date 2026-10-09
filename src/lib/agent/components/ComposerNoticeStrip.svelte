<script lang="ts">
	/**
	 * Esito dell'ultimo comando (di Studio o di omp), sovrapposto al bordo superiore del
	 * composer. Sta fuori dal flusso: comparire e sparire non sposta il transcript
	 * e non toglie l'hero di una chat vuota.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import type { AgentSession, ComposerNotice } from '../session.svelte';
	import { Lingering, ROW_EXIT_MS } from '../motionState.svelte';
	import { IconInfo, IconWarning, IconStatusFailed, IconClose } from '$lib/icons';

	let { session }: { session: AgentSession } = $props();

	// L'errore non scade: deve restare finche' l'utente non lo ha letto.
	const LIFETIME_MS: Record<Exclude<ComposerNotice['level'], 'error'>, number> = {
		info: 4000,
		warning: 8000
	};

	const linger = new Lingering<ComposerNotice>(ROW_EXIT_MS);
	// Pausa legata al singolo esito: un nodo rimosso sotto il puntatore non
	// emette pointerleave, e un booleano lascerebbe in pausa l'esito successivo.
	let hoveredId = $state<number | null>(null);

	$effect(() => {
		linger.update(session.composerNotice ?? undefined);
	});
	$effect(() => () => linger.dispose());

	// Col puntatore sopra il conto si ferma; all'uscita riparte da capo, cosi'
	// chi stava leggendo ha di nuovo tutto il tempo.
	$effect(() => {
		const notice = session.composerNotice;
		if (!notice || notice.level === 'error' || hoveredId === notice.id) return;
		const timer = window.setTimeout(() => session.dismissComposerNotice(notice.id), LIFETIME_MS[notice.level]);
		return () => clearTimeout(timer);
	});
</script>

<div class="composer-notice-anchor" role="status" aria-live="polite">
	{#if linger.shown}
		{@const notice = linger.shown}
		{#key notice.id}
			<div
				class="composer-notice"
				role="group"
				class:leaving={linger.leaving}
				class:error={notice.level === 'error'}
				class:warning={notice.level === 'warning'}
				onpointerenter={() => (hoveredId = notice.id)}
				onpointerleave={() => (hoveredId = null)}
			>
				<span class="level-icon" aria-hidden="true">
					{#if notice.level === 'error'}
						<IconStatusFailed />
					{:else if notice.level === 'warning'}
						<IconWarning />
					{:else}
						<IconInfo />
					{/if}
				</span>
				<span class="message">{notice.message}</span>
				<button
					type="button"
					class="dismiss"
					aria-label={m.common_close()}
					onclick={() => session.dismissComposerNotice(notice.id)}
				>
					<IconClose />
				</button>
			</div>
		{/key}
	{/if}
</div>

<style>
	.composer-notice-anchor {
		position: absolute;
		left: 0;
		right: 0;
		bottom: calc(100% + 6px);
		display: flex;
		justify-content: center;
		pointer-events: none;
		z-index: 2;
	}

	.composer-notice {
		pointer-events: auto;
		max-width: min(100%, 640px);
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 4px 3px 10px;
		font-size: var(--text-meta);
		line-height: 1.4;
		color: var(--ink-muted);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: 12px;
		box-shadow: var(--shadow-dock);
		animation: notice-in var(--dur-fast) var(--ease-out) backwards;
	}

	.composer-notice.leaving {
		animation: notice-out 210ms var(--ease-out) forwards;
	}

	.level-icon {
		--icon-size: 13px;
		display: inline-flex;
		flex-shrink: 0;
		color: var(--ink-faint);
	}

	.composer-notice.warning .level-icon,
	.composer-notice.warning .message {
		color: var(--warn);
	}

	.composer-notice.error .level-icon,
	.composer-notice.error .message {
		color: var(--danger);
	}

	.message {
		min-width: 0;
		overflow: hidden;
		overflow-wrap: anywhere;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		user-select: text;
	}

	.dismiss {
		--icon-size: 12px;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		padding: 0;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: var(--ink-faint);
		cursor: pointer;
		transition: background-color var(--dur-fast), color var(--dur-fast);
	}

	.dismiss:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	@keyframes notice-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
	}

	@keyframes notice-out {
		to {
			opacity: 0;
			transform: translateY(4px);
		}
	}
</style>
