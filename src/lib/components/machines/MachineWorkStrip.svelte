<!--
  Riscontro del lavoro in corso su un'altra macchina (IMP-006).

  Sotto il composer, dove si sta lavorando: dice se la destinazione ha preso
  in carico il prompt, scritto i file, salvato la sessione, confermato la coda
  o completato la sync Git. «In attesa» non è una conferma: diventa
  «confermato» solo quando la risposta della macchina è arrivata. Un errore
  resta, con il motivo, finché non viene sostituito da un'altra operazione.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { machineFeedback } from '#lib/stores/machineFeedback.svelte.ts';
	import { linkStore } from '#lib/backend/link.svelte.ts';
	import { LOCAL_MACHINE } from '#lib/backend/ipc.ts';

	let { projectId, machineId }: { projectId: string; machineId: string } = $props();

	const peerName = $derived(linkStore.machineFor(machineId)?.name ?? machineId);
	const op = $derived(machineId === LOCAL_MACHINE ? null : machineFeedback.latestForWork(projectId, machineId));
	const text = $derived.by(() => {
		if (!op) return '';
		if (op.phase === 'failed') return m.machines_feedback_failed({ error: op.detail ?? '' });
		const name = { name: peerName };
		const waiting = op.phase === 'waiting';
		switch (op.kind) {
			case 'prompt':
				return waiting ? m.machines_feedback_prompt_waiting(name) : m.machines_feedback_prompt_confirmed(name);
			case 'files':
				return waiting ? m.machines_feedback_files_waiting(name) : m.machines_feedback_files_confirmed(name);
			case 'session':
				return waiting ? m.machines_feedback_session_waiting(name) : m.machines_feedback_session_confirmed(name);
			case 'queue':
				return waiting ? m.machines_feedback_queue_waiting(name) : m.machines_feedback_queue_confirmed(name);
			case 'git':
				return waiting ? m.machines_feedback_git_waiting(name) : m.machines_feedback_git_confirmed(name);
		}
	});
</script>

{#if op && text}
	<div class="machine-work-strip" class:failed={op.phase === 'failed'} class:waiting={op.phase === 'waiting'} role="status">
		<span class="dot" aria-hidden="true"></span>
		<span class="text">{text}</span>
	</div>
{/if}

<style>
	.machine-work-strip {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0 var(--space-3);
		padding: 5px 10px;
		border: 1px solid var(--line);
		border-bottom: 0;
		border-radius: var(--radius-xl) var(--radius-xl) 0 0;
		background: var(--bg-raised);
		font: 400 var(--text-trace)/1.4 var(--font-ui);
		color: var(--ink-muted);
	}
	.machine-work-strip.failed {
		background: color-mix(in oklch, var(--danger) 12%, var(--bg-raised));
		color: var(--ink);
	}
	.dot {
		flex: none;
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--ink-faint);
	}
	.waiting .dot { background: var(--warn); }
	.failed .dot { background: var(--danger); }
	.text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
