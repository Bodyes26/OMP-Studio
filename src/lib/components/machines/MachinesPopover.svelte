<!--
  Popover del chip «Macchine» (R-MI-49).

  Una riga per macchina abbinata: stato e motivo, via e latenza, ultima
  sincronizzazione, copie da aggiornare o divergenti con il motivo, job in
  corso, aggiornamento di Studio. Il clic porta al dettaglio della macchina in
  Impostazioni › Dispositivi: e' il difetto che si chiude qui (il chip apriva
  Studio Remote). Nessuna card colorata: il colore resta nei punti e nei segni
  di stato, come negli altri chip.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { linkStore, type LinkedMachine } from '#lib/backend/link.svelte.ts';
	import { remoteJobs, jobActive } from '#lib/backend/remoteJobs.svelte.ts';
	import { peerUpdate, needsUpdate, type WaitReason } from '#lib/backend/peerUpdate.svelte.ts';
	import { studioUpdaterStore } from '#lib/stores/studioUpdater.svelte.ts';
	import { copySyncStore, type BranchSync } from '#lib/stores/copySync.svelte.ts';
	import { machineFeedback } from '#lib/stores/machineFeedback.svelte.ts';
	import { projectStore, type Project } from '#lib/stores/projects.svelte.ts';
	import { pendingReasonText } from '#lib/stores/projectMachines.svelte.ts';
	import { agoParts, machineResponse, machineState, type MachineDotState, type MachineResponse } from '#lib/stores/machineStatus.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { i18n } from '#lib/i18n/i18n.svelte.ts';
	import MachineGlyph from '#lib/ui/MachineGlyph.svelte';
	import { anchoredPopover } from '#lib/anchoredPopover.ts';

	let {
		open = false,
		anchor = null,
		onClose
	}: { open?: boolean; anchor?: HTMLElement | null; onClose?: () => void } = $props();

	let panelEl = $state<HTMLDivElement | null>(null);

	// Il tempo relativo avanza da solo: «sincronizzata 2 min fa» invecchia
	// mentre il popover resta aperto.
	let now = $state(Date.now());
	$effect(() => {
		if (!open) return;
		remoteJobs.start();
		const timer = window.setInterval(() => { now = Date.now(); }, 30_000);
		return () => window.clearInterval(timer);
	});

	function agoText(sinceMs: number): string {
		const { value, unit } = agoParts(sinceMs);
		if (unit === 'minute' && value === 0) return m.machines_ago_now();
		return i18n.formatRelativeTime(-value, unit);
	}

	function stateLabel(state: MachineDotState): string {
		switch (state) {
			case 'online': return m.machines_state_online();
			case 'relay': return m.machines_state_relay();
			case 'incompatible': return m.machines_state_incompatible();
			default: return m.machines_state_offline();
		}
	}

	function routeText(peer: LinkedMachine): string {
		if (!peer.route) return m.machines_route_unknown();
		const latency = peer.latencyMs ?? 0;
		return peer.route === 'direct'
			? m.machines_route_direct({ latency })
			: m.machines_route_relay({ latency });
	}

	/** Copie indietro o divergenti di questa macchina, con il motivo. */
	function copyLines(peer: LinkedMachine): string[] {
		const lines: string[] = [];
		const suffix = `|${peer.id}`;
		for (const [key, report] of Object.entries(copySyncStore.reports)) {
			if (!key.endsWith(suffix)) continue;
			const localId = key.slice(0, key.length - suffix.length);
			const project = projectStore.projects.find((candidate: Project) => candidate.id === localId);
			const name = project?.name ?? localId;
			for (const branch of report.branches) {
				if (branch.state === 'pending') lines.push(`${name} — ${pendingReasonText(branch)}`);
			}
			if (report.branches.some((branch: BranchSync) => branch.state === 'diverged')) {
				lines.push(`${name} — ${m.machines_copies_diverged()}`);
			}
		}
		return lines;
	}

	function lastSyncText(peer: LinkedMachine): string {
		const suffix = `|${peer.id}`;
		let latest: number | null = null;
		for (const [key, at] of Object.entries(copySyncStore.lastSyncAt)) {
			if (!key.endsWith(suffix)) continue;
			if (latest === null || at > latest) latest = at;
		}
		if (latest === null) return m.machines_sync_never();
		return m.machines_sync_ago({ ago: agoText(now - latest) });
	}

	function jobsText(peer: LinkedMachine): string | null {
		const active = remoteJobs.forMachine(peer.id).filter(jobActive);
		return active.length > 0 ? m.machines_jobs({ count: active.length }) : null;
	}

	const WAIT_LABEL: Record<WaitReason, () => string> = {
		agents: () => m.peer_update_reason_agents(),
		questions: () => m.peer_update_reason_questions(),
		jobs: () => m.peer_update_reason_jobs(),
		unsaved: () => m.peer_update_reason_unsaved()
	};

	function updateText(peer: LinkedMachine): string | null {
		const status = peerUpdate.statusFor(peer.id);
		if (status) {
			switch (status.phase) {
				case 'starting':
				case 'downloading': return m.peer_update_downloading({ name: peer.name });
				case 'waiting': return m.peer_update_waiting({
					name: peer.name,
					reasons: status.waitingFor.map((reason) => WAIT_LABEL[reason]()).join(', ')
				});
				case 'installing': return m.peer_update_installing({ name: peer.name });
				case 'failed': return m.peer_update_failed({ name: peer.name, error: status.error ?? '' });
			}
		}
		return needsUpdate(peer, studioUpdaterStore.currentVersion) ? m.peer_update_needed({
			name: peer.name,
			version: peer.version ?? ''
		}) : null;
	}

	/**
	 * Come risponde la macchina, non solo se il canale e' aperto (IMP-005):
	 * una macchina lenta con una richiesta in volo e' «in attesa», non spenta.
	 */
	function responseOf(peer: LinkedMachine): MachineResponse {
		return machineResponse({
			online: peer.online,
			compatible: peer.compatible,
			requested: machineFeedback.activeFor(peer.id).length > 0,
			responded: Object.keys(copySyncStore.lastSyncAt).some((key) => key.endsWith(`|${peer.id}`))
		});
	}

	function responseLabel(state: MachineResponse): string {
		switch (state) {
			case 'responding': return m.machines_response_responding();
			case 'waiting': return m.machines_response_waiting();
			case 'incompatible': return m.machines_response_incompatible();
			default: return m.machines_response_unreachable();
		}
	}

	/**
	 * Conferma o attesa della destinazione; un messaggio locale non basta
	 * (IMP-006). `failed` distingue l'errore, che non scade come una conferma.
	 */
	function feedbackOf(peer: LinkedMachine): { text: string; failed: boolean } | null {
		const op = machineFeedback.latestFor(peer.id);
		if (!op) return null;
		if (op.phase === 'failed') {
			return { text: m.machines_feedback_failed({ error: op.detail ?? '' }), failed: true };
		}
		const name = { name: peer.name };
		const waiting = op.phase === 'waiting';
		switch (op.kind) {
			case 'prompt':
				return { text: waiting ? m.machines_feedback_prompt_waiting(name) : m.machines_feedback_prompt_confirmed(name), failed: false };
			case 'files':
				return { text: waiting ? m.machines_feedback_files_waiting(name) : m.machines_feedback_files_confirmed(name), failed: false };
			case 'session':
				return { text: waiting ? m.machines_feedback_session_waiting(name) : m.machines_feedback_session_confirmed(name), failed: false };
			case 'queue':
				return { text: waiting ? m.machines_feedback_queue_waiting(name) : m.machines_feedback_queue_confirmed(name), failed: false };
			case 'git':
				return { text: waiting ? m.machines_feedback_git_waiting(name) : m.machines_feedback_git_confirmed(name), failed: false };
		}
	}

	function openDevice(peer: LinkedMachine): void {
		onClose?.();
		settingsStore.openDevice('computer', peer.id);
	}

	function openMap(): void {
		onClose?.();
		settingsStore.openConnectionMap();
	}

	$effect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (!target) return;
			if (panelEl?.contains(target) || anchor?.contains(target)) return;
			onClose?.();
		};
		const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose?.(); };
		document.addEventListener('pointerdown', onPointerDown, true);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('keydown', onKey);
		};
	});
</script>

{#if open}
	<div
		bind:this={panelEl}
		class="machines-popover"
		popover="manual"
		role="dialog"
		aria-label={m.machines_popover_title()}
		use:anchoredPopover={{ anchor, placement: 'top-start', offset: 8, constrainHeight: true, motion: false }}
	>
		<div class="head">
			<span class="title">{m.machines_popover_title()}</span>
			<span class="hint">{m.machines_popover_hint()}</span>
		</div>
		<div class="rows">
			{#each linkStore.status.peers as peer (peer.id)}
				{@const state = machineState({
					online: peer.online,
					compatible: peer.compatible,
					offlineReason: linkStore.offlineReason(peer.id)
				})}
				{@const lines = copyLines(peer)}
				{@const job = jobsText(peer)}
				{@const update = updateText(peer)}
				{@const response = responseOf(peer)}
				{@const feedback = feedbackOf(peer)}
				{@const pendingQueue = machineFeedback.activeFor(peer.id).filter((op) => op.kind === 'queue').length}
				<button
					type="button"
					class="row"
					class:offline={state === 'offline' || state === 'relay'}
					onclick={() => openDevice(peer)}
				>
					<span class="row-head">
						<MachineGlyph kind={state === 'online' ? 'remote' : 'offline'} size={12} />
						<span class="name">{peer.name}</span>
						<span class="state" class:ok={state === 'online'} class:warn={state === 'incompatible'}>
							<span class="dot" class:online={state === 'online'} class:warn={state === 'incompatible'} class:relay={state === 'relay'} aria-hidden="true"></span>
							{stateLabel(state)}
						</span>
					</span>
					<span class="meta">{routeText(peer)} · {lastSyncText(peer)}</span>
					{#if response === 'waiting'}<span class="line waiting">{responseLabel(response)}</span>{/if}
					{#each lines as line (line)}<span class="line">{line}</span>{/each}
					{#if feedback}<span class="line" class:update={feedback.failed} class:waiting={!feedback.failed}>{feedback.text}</span>{/if}
					{#if pendingQueue > 0}<span class="line">{m.machines_queue_pending({ count: pendingQueue })}</span>{/if}
					{#if job}<span class="line">{job}</span>{/if}
					{#if update}<span class="line update">{update}</span>{/if}
				</button>
			{/each}
		</div>
		<div class="foot">
			<button type="button" class="foot-action" onclick={openMap}>{m.machines_popover_map()}</button>
		</div>
	</div>
{/if}

<style>
	.machines-popover {
		width: 320px;
		max-width: calc(100vw - 16px);
		max-height: min(70vh, var(--anchored-space, 70vh));
		overflow: auto;
		margin: 0;
		padding: 0;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		color: var(--ink);
		font: 450 var(--text-body, 13px)/1.45 var(--font-ui);
		z-index: var(--z-overlay);
	}
	.head { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px 8px; border-bottom: 1px solid var(--line); }
	.title { font-size: var(--text-label); font-weight: 550; }
	.hint { font-size: var(--text-caption); color: var(--ink-faint); }
	.rows { display: flex; flex-direction: column; padding: 4px; }
	.row {
		display: flex;
		flex-direction: column;
		gap: 3px;
		width: 100%;
		padding: 8px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: inherit;
		text-align: left;
		cursor: pointer;
		font: inherit;
	}
	.row:hover { background: var(--bg-hover); border-color: var(--line); }
	/* Spenta o relay giù: il nome resta leggibile, il resto si attenua. */
	.row.offline .name { color: var(--ink-muted); }
	.row:focus-visible { outline: none; border-color: var(--brand); box-shadow: 0 0 0 1px var(--brand); }
	.row-head { display: flex; align-items: center; gap: 6px; }
	.name { font-weight: 550; overflow-wrap: anywhere; }
	.state { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; font-size: var(--text-caption); color: var(--ink-muted); }
	.dot { width: 6px; height: 6px; border-radius: var(--radius-full); background: var(--ink-faint); }
	.dot.online { background: var(--success); }
	.dot.warn { background: var(--warn); }
	.dot.relay { background: var(--warn); }
	.meta { font-size: var(--text-caption); color: var(--ink-faint); }
	.line { font-size: var(--text-caption); color: var(--ink-muted); overflow-wrap: anywhere; }
	.line.update { color: var(--warn); }
	/* In attesa: presente ma non allarmante; una macchina lenta non è spenta. */
	.line.waiting { color: var(--ink-muted); }
	.foot { padding: 4px; border-top: 1px solid var(--line); }
	.foot-action {
		width: 100%;
		padding: 7px 8px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		text-align: left;
		cursor: pointer;
		font: 500 var(--text-caption)/1.2 var(--font-ui);
	}
	.foot-action:hover { background: var(--bg-hover); border-color: var(--line); color: var(--ink); }
	.foot-action:focus-visible { outline: none; border-color: var(--brand); box-shadow: 0 0 0 1px var(--brand); }
</style>
