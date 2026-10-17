<!--
  CodeModal.svelte — Mostra il codice di abbinamento generato per host o dispositivo.
  Linguaggio Studio: superficie bg-overlay, ombra overlay, codice in JetBrains Mono
  a spaziatura allargata, controlli .ui-* e icone Lucide.
-->
<script lang="ts">
	import type { CreateCodeResponse } from '../../../src/protocol.ts';
	import { formatPairingCode } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import { IconCopy, IconCheck, IconClose } from '../icons.ts';

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
	class="sheet-backdrop"
	onclick={onClose}
	onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
	role="presentation"
>
	<div
		class="sheet-surface rv-lift"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } else { e.stopPropagation(); } }}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div class="sheet-header">
			<div class="header-main">
				<h3 class="sheet-title">
					{codeData.kind === 'device' ? t('deviceCodeTitle') : t('hostCodeTitle')}
				</h3>
				<p class="sheet-desc">
					{codeData.kind === 'device' ? t('deviceCodeDesc') : t('hostCodeDesc')}
				</p>
			</div>
			<button
				type="button"
				class="ui-button ui-button-ghost close-icon-btn"
				onclick={onClose}
				aria-label={t('close')}
			>
				<IconClose />
			</button>
		</div>

		<div class="sheet-body">
			{#if codeData.kind === 'host'}
				<div class="relay-url-box">
					<span class="url-text">{relayOrigin}</span>
					<button
						type="button"
						class="ui-button ui-button-secondary copy-btn"
						onclick={() => copyToClipboard(relayOrigin, true)}
					>
						{#if copiedUrl}
							<IconCheck />
							<span>{t('copied')}</span>
						{:else}
							<IconCopy />
							<span>{t('copyUrl')}</span>
						{/if}
					</button>
				</div>
				<p class="step2-desc">{t('hostCodeStep2')}</p>
			{/if}

			<div class="code-box">
				<span class="code-text">{formattedCode}</span>
				<button
					type="button"
					class="ui-button ui-button-primary copy-code-btn"
					onclick={() => copyToClipboard(formattedCode, false)}
				>
					{#if copiedCode}
						<IconCheck />
						<span>{t('copied')}</span>
					{:else}
						<IconCopy />
						<span>{t('copyCode')}</span>
					{/if}
				</button>
			</div>

			<div class="countdown">
				{t('codeExpiresIn', { time: formattedTime })}
			</div>
		</div>

		<div class="sheet-footer">
			<button
				type="button"
				class="ui-button ui-button-secondary"
				onclick={onClose}
			>
				{t('close')}
			</button>
		</div>
	</div>
</div>

<style>
	.sheet-backdrop {
		position: fixed;
		inset: 0;
		background: var(--backdrop);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		z-index: 210;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-4);
	}

	.sheet-surface {
		width: 100%;
		max-width: 440px;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		box-shadow: var(--shadow-overlay);
		border-radius: var(--radius-xl);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.sheet-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: var(--space-4);
		border-bottom: 1px solid var(--line);
		gap: var(--space-2);
	}

	.header-main {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}

	.sheet-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
		margin: 0;
		letter-spacing: -0.01em;
	}

	.sheet-desc {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		margin: 0;
		line-height: 1.45;
	}

	.close-icon-btn {
		width: 32px;
		height: 32px;
		--icon-size: 16px;
		flex-shrink: 0;
	}

	.sheet-body {
		padding: var(--space-5) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		align-items: center;
		text-align: center;
	}

	.relay-url-box {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 10px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		gap: 8px;
		box-sizing: border-box;
	}

	.url-text {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.copy-btn {
		height: 28px;
		padding: 0 8px;
		font-size: var(--text-meta);
		gap: 4px;
		--icon-size: 12px;
		flex-shrink: 0;
	}

	.step2-desc {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		margin: 0;
	}

	.code-box {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-5) var(--space-4);
		background: var(--bg-sunken);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-sizing: border-box;
	}

	.code-text {
		font-family: var(--font-mono);
		font-size: 26px;
		font-weight: 700;
		letter-spacing: 4px;
		color: var(--ink);
		user-select: all;
	}

	.copy-code-btn {
		height: 34px;
		padding: 0 var(--space-4);
		font-size: var(--text-caption);
		gap: 6px;
		--icon-size: 14px;
	}

	.countdown {
		font-size: var(--text-meta);
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}

	.sheet-footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		padding: var(--space-3) var(--space-4);
		border-top: 1px solid var(--line);
		background: var(--bg-base);
	}
</style>
