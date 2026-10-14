<script lang="ts">
	import type { CreateCodeResponse } from '../../../src/protocol.ts';
	import { formatPairingCode } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';

	let {
		codeData,
		onClose
	} = $props<{
		codeData: CreateCodeResponse;
		onClose: () => void;
	}>();

	let copiedCode = $state(false);
	let copiedUrl = $state(false);

	let now = $state(Date.now());
	$effect(() => {
		const timer = setInterval(() => {
			now = Date.now();
		}, 1000);
		return () => clearInterval(timer);
	});

	const remainingSecs = $derived(
		Math.max(0, Math.floor((codeData.expiresAt - now) / 1000))
	);

	const formattedTime = $derived.by(() => {
		const m = Math.floor(remainingSecs / 60);
		const s = remainingSecs % 60;
		return `${m}:${String(s).padStart(2, '0')}`;
	});

	const formattedCode = $derived(formatPairingCode(codeData.code));
	const relayOrigin = $derived(typeof location !== 'undefined' ? location.origin : '');

	async function copyToClipboard(text: string, isUrl: boolean): Promise<void> {
		try {
			await navigator.clipboard.writeText(text);
			if (isUrl) {
				copiedUrl = true;
				setTimeout(() => (copiedUrl = false), 2000);
			} else {
				copiedCode = true;
				setTimeout(() => (copiedCode = false), 2000);
			}
		} catch {
			// ignora errori di permessi appunti
		}
	}
</script>

<div
	class="modal-backdrop"
	onclick={onClose}
	onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
	role="presentation"
>
	<div
		class="modal-sheet"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div class="modal-header">
			<h3 class="title">
				{codeData.kind === 'device' ? t('deviceCodeTitle') : t('hostCodeTitle')}
			</h3>
			<p class="desc">
				{codeData.kind === 'device' ? t('deviceCodeDesc') : t('hostCodeDesc')}
			</p>
		</div>

		{#if codeData.kind === 'host'}
			<div class="relay-url-box">
				<span class="url-text">{relayOrigin}</span>
				<button
					class="btn btn-secondary copy-btn"
					onclick={() => copyToClipboard(relayOrigin, true)}
				>
					{copiedUrl ? t('copied') : t('copyUrl')}
				</button>
			</div>
			<p class="desc step2">{t('hostCodeStep2')}</p>
		{/if}

		<div class="code-display">
			<span class="code-text">{formattedCode}</span>
			<button
				class="btn btn-primary copy-code-btn"
				onclick={() => copyToClipboard(formattedCode, false)}
			>
				{copiedCode ? t('copied') : t('copyCode')}
			</button>
		</div>

		<div class="countdown">
			{t('codeExpiresIn', { time: formattedTime })}
		</div>

		<div class="modal-footer">
			<button class="btn btn-secondary close-btn" onclick={onClose}>
				{t('close')}
			</button>
		</div>
	</div>
</div>

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: oklch(0 0 0 / 0.65);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
		z-index: 210;
	}

	.modal-sheet {
		width: 100%;
		max-width: 440px;
		background: var(--bg-base);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		text-align: center;
		box-shadow: 0 8px 32px oklch(0 0 0 / 0.6);
	}

	.modal-header {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.title {
		font-size: 17px;
		font-weight: 700;
		color: var(--ink);
	}

	.desc {
		font-size: 13px;
		color: var(--ink-muted);
		line-height: 1.4;
	}
	.desc.step2 {
		margin-top: 4px;
	}

	.relay-url-box {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 8px 12px;
	}

	.url-text {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.copy-btn {
		min-height: 32px;
		padding: 4px 10px;
		font-size: 11px;
		flex-shrink: 0;
	}

	.code-display {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 16px;
	}

	.code-text {
		font-family: var(--font-mono);
		font-size: 28px;
		font-weight: 700;
		letter-spacing: 3px;
		color: var(--brand);
	}

	.copy-code-btn {
		width: 100%;
		max-width: 200px;
	}

	.countdown {
		font-size: 12px;
		color: var(--ink-faint);
		font-family: var(--font-mono);
	}

	.modal-footer {
		display: flex;
		justify-content: center;
		margin-top: 4px;
	}

	.close-btn {
		width: 100%;
	}
</style>
