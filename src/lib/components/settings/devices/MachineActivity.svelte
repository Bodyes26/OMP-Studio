<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { invoke, LOCAL_MACHINE } from '#lib/backend/ipc.ts';
	import { i18n } from '#lib/i18n/i18n.svelte.ts';
	import type { LinkedMachine } from '#lib/backend/link.svelte.ts';

	/** Voce del registro delle azioni remote (R-MI-39), come la scrive `link/audit.rs`. */
	interface AuditEntry {
		at: number;
		machineId: string;
		machineName: string;
		action: string;
		projectId?: string;
		projectName?: string;
	}

	let { peer }: { peer: LinkedMachine } = $props();

	// «here»: cosa ha fatto `peer` su questa macchina (registro locale);
	// «there»: cosa e' stato fatto su `peer`, letto dal suo registro.
	let side = $state<'here' | 'there'>('here');
	let entries = $state<AuditEntry[]>([]);
	let project = $state('');
	let loading = $state(false);
	let error = $state('');

	const projects = $derived.by(() => {
		const seen = new Map<string, string>();
		for (const entry of entries) if (entry.projectId) seen.set(entry.projectId, entry.projectName ?? entry.projectId);
		return [...seen].sort((a, b) => a[1].localeCompare(b[1]));
	});
	const visible = $derived(project ? entries.filter((entry) => entry.projectId === project) : entries);

	async function load(): Promise<void> {
		loading = true;
		error = '';
		try {
			entries = side === 'here'
				? await invoke<AuditEntry[]>('link_audit', { machineId: peer.id }, { machine: LOCAL_MACHINE })
				: await invoke<AuditEntry[]>('link_audit', {}, { machine: peer.id });
			if (project && !entries.some((entry) => entry.projectId === project)) project = '';
		} catch (reason) {
			entries = [];
			error = reason instanceof Error ? reason.message : String(reason);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void side;
		void peer.online;
		void load();
	});

	function when(at: number): string {
		return i18n.formatDate(at, { dateStyle: 'short', timeStyle: 'short' });
	}
</script>

<div class="activity">
	<div class="controls">
		<div class="sides" role="radiogroup" aria-label={m.instances_activity()}>
			<label><input type="radio" name="activity-side-{peer.id}" value="here" bind:group={side} />{m.instances_activity_here({ name: peer.name })}</label>
			<label><input type="radio" name="activity-side-{peer.id}" value="there" bind:group={side} disabled={!peer.online} />{m.instances_activity_there({ name: peer.name })}</label>
		</div>
		<label class="filter">
			<span>{m.instances_activity_project_filter()}</span>
			<select class="ui-input" bind:value={project}>
				<option value="">{m.instances_activity_all_projects()}</option>
				{#each projects as [id, name] (id)}<option value={id}>{name}</option>{/each}
			</select>
		</label>
		<button type="button" class="ui-button ui-button-ghost" disabled={loading} onclick={() => void load()}>{m.instances_activity_refresh()}</button>
	</div>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{:else if loading && entries.length === 0}
		<p>{m.instances_activity_loading()}</p>
	{:else if visible.length === 0}
		<p>{m.instances_activity_empty()}</p>
	{:else}
		<ol>
			{#each visible as entry, index (index)}
				<li>
					<time datetime={new Date(entry.at).toISOString()}>{when(entry.at)}</time>
					<code>{entry.action}</code>
					{#if entry.projectName ?? entry.projectId}<span class="project">{entry.projectName ?? entry.projectId}</span>{/if}
					{#if side === 'there'}<span class="from">{m.instances_activity_from({ name: entry.machineName })}</span>{/if}
				</li>
			{/each}
		</ol>
	{/if}
</div>

<style>
	.activity { display: flex; flex-direction: column; gap: 8px; }
	.controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
	.sides { display: flex; flex-wrap: wrap; gap: 4px 12px; }
	.sides label, .filter { display: inline-flex; align-items: center; gap: 6px; color: var(--ink-muted); font-size: 12px; }
	.filter select { max-width: 220px; }
	p { margin: 0; color: var(--ink-muted); font-size: 12px; }
	ol { list-style: none; margin: 0; padding: 0; max-height: 280px; overflow: auto; display: flex; flex-direction: column; gap: 2px; }
	li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; padding: 2px 0; font-size: 12px; color: var(--ink); }
	time, .from { color: var(--ink-faint); font-variant-numeric: tabular-nums; }
	code { font-family: var(--font-mono); font-size: 11px; }
	.project { color: var(--ink-muted); }
	.error { color: var(--danger); overflow-wrap: anywhere; }
</style>
