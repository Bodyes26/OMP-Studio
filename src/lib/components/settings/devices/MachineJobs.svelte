<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { remoteJobs, jobActive, type RemoteJob } from '#lib/backend/remoteJobs.svelte.ts';
	import { i18n } from '#lib/i18n/i18n.svelte.ts';
	import type { LinkedMachine } from '#lib/backend/link.svelte.ts';

	let { peer }: { peer: LinkedMachine } = $props();

	const jobs = $derived(remoteJobs.forMachine(peer.id));
	let openId = $state<string | null>(null);
	let log = $state('');
	let error = $state('');

	$effect(() => { remoteJobs.start(); });

	// Log in diretta del job aperto (R-MI-37: il log dell'altra macchina anche
	// in un pannello di Studio). Si segue finche' il job e' vivo.
	$effect(() => {
		const id = openId;
		if (!id) return;
		let offset = 0;
		let stopped = false;
		log = '';
		const tick = async () => {
			try {
				const page = await remoteJobs.log(id, offset);
				if (page.logStart > offset) log = '';
				log = (log + page.log).slice(-200_000);
				offset = page.next;
			} catch (reason) {
				error = reason instanceof Error ? reason.message : String(reason);
			}
			const job = remoteJobs.jobs.find((candidate) => candidate.id === id);
			if (!stopped && job && jobActive(job)) timer = window.setTimeout(tick, 1000);
		};
		let timer = window.setTimeout(tick, 0);
		return () => { stopped = true; window.clearTimeout(timer); };
	});

	function stateLabel(job: RemoteJob): string {
		switch (job.state) {
			case 'queued': return m.instances_jobs_queued();
			case 'preparing': return m.instances_jobs_preparing();
			case 'running': return m.instances_jobs_running();
			case 'exited': return m.instances_jobs_exited({ code: job.code });
			case 'failed': return m.instances_jobs_failed({ error: job.error });
			case 'cancelled': return m.instances_jobs_cancelled();
		}
	}

	async function cancel(job: RemoteJob): Promise<void> {
		error = '';
		try { await remoteJobs.cancel(job.id); }
		catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
	}
</script>

{#if jobs.length > 0}
	<div class="jobs">
		<h5>{m.instances_jobs()}</h5>
		<ul>
			{#each jobs as job (job.id)}
				<li>
					<div class="row">
						<button type="button" class="ui-button ui-button-ghost toggle" aria-expanded={openId === job.id} onclick={() => { openId = openId === job.id ? null : job.id; }}>
							<code>{job.command}</code>
						</button>
						<span class="meta">
							{job.direction === 'incoming' ? m.instances_jobs_incoming({ name: peer.name }) : m.instances_jobs_outgoing({ name: peer.name })}
							· {job.project} · {i18n.formatDate(job.startedAt, { timeStyle: 'short' })}
						</span>
						<span class="state" class:failed={job.state === 'failed' || (job.state === 'exited' && job.code !== 0)}>{stateLabel(job)}</span>
						{#if jobActive(job)}
							<button type="button" class="ui-button ui-button-ghost" onclick={() => void cancel(job)}>{m.instances_jobs_cancel()}</button>
						{/if}
					</div>
					{#if openId === job.id}
						<pre class="log" aria-live="polite">{log}</pre>
					{/if}
				</li>
			{/each}
		</ul>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</div>
{/if}

<style>
	.jobs { display: flex; flex-direction: column; gap: 6px; }
	h5 { margin: 0; font-size: 12px; font-weight: 600; color: var(--ink-muted); }
	ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
	li { display: flex; flex-direction: column; gap: 6px; }
	.row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; font-size: 12px; }
	.toggle code { font-family: var(--font-mono); font-size: 11px; color: var(--ink); }
	.meta { color: var(--ink-faint); }
	.state { color: var(--ink-muted); }
	.state.failed { color: var(--danger); }
	.log { margin: 0; max-height: 260px; overflow: auto; padding: 8px; background: var(--bg-sunken, var(--bg-hover)); border: 1px solid var(--line); border-radius: var(--radius-md); font-family: var(--font-mono); font-size: 11px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
	.error { margin: 0; color: var(--danger); font-size: 12px; overflow-wrap: anywhere; }
</style>
