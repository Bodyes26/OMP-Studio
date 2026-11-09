<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import type { SessionJob } from '../jobActivity';

	let { jobs }: { jobs: readonly SessionJob[] } = $props();
	const labels = $derived(jobs
		.filter((job) => ['running', 'pending', 'in_progress'].includes(job.status))
		.map((job) => job.label.split('\n')[0].trim().slice(0, 120))
		.filter(Boolean));
</script>

<div class="background-wait" role="status" aria-live="polite">
	<span class="background-dot" aria-hidden="true"></span>
	<span class="background-text">
		<span>{labels.length > 0
			? m.chat_background_wait_jobs({ jobs: labels.join(' · ') })
			: m.chat_background_wait_generic()}</span>
		<span class="background-hint">{m.chat_background_wait_hint()}</span>
	</span>
</div>

<style>
	.background-wait {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: fit-content;
		max-width: 100%;
		margin-top: var(--space-3);
		padding: var(--space-1) var(--space-2);
		font-size: 13.5px;
		color: var(--ink-muted);
	}
	.background-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.background-hint {
		font-size: 12.5px;
		color: var(--ink-faint);
	}
	.background-dot {
		width: 6px;
		height: 6px;
		flex-shrink: 0;
		border-radius: var(--radius-full);
		background: var(--ink-muted);
		animation: background-breathe 1.6s ease-in-out infinite;
	}
	@keyframes background-breathe {
		50% { opacity: 0.3; }
	}
	@media (prefers-reduced-motion: reduce) {
		.background-dot { animation: none; }
	}
</style>
