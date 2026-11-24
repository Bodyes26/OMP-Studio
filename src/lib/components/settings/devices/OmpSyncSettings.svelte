<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { categories, ompSync } from '#lib/backend/ompSync.svelte.ts';
	import type { LinkedMachine } from '#lib/backend/link.svelte.ts';
	import { modelSettingsStore, STANDARD_ROLES } from '#lib/stores/modelSettings.svelte.ts';
	import Switch from '#lib/ui/Switch.svelte';

	let { peer }: { peer: LinkedMachine } = $props();
	let error = $state('');
	let saving = $state(false);
	const enabled = $derived(ompSync.preferences.categories[peer.id] ?? []);
	const conflicts = $derived(ompSync.conflicts.filter((c) => c.machine === peer.id));
	const labels = [m.omp_sync_roles, m.omp_sync_general, m.omp_sync_agents, m.omp_sync_skills, m.omp_sync_rules, m.omp_sync_mcp];
	const known = $derived(modelSettingsStore.knownSelectorsFor());
	const roles = $derived(modelSettingsStore.configFor()?.modelRoles ?? {});

	async function perform(action: () => Promise<void>) {
		if (saving) return;
		saving = true;
		error = '';
		try { await action(); } catch (reason) { error = String(reason); }
		finally { saving = false; }
	}
</script>

<details class="sync">
	<summary>{m.omp_sync_title()}</summary>
	<p>{m.omp_sync_explanation()}</p>
	<fieldset disabled={saving}>
		<legend>{m.omp_sync_title()}</legend>
		{#each categories as category, index (category)}
			<Switch label={labels[index]()} checked={enabled.includes(category)} onChange={(value) => void perform(() => ompSync.enable(peer.id, category, value))} />
		{/each}
	</fieldset>
	{#if enabled.includes('roles')}
		<fieldset disabled={saving}>
			<legend>{m.omp_sync_pinned()}</legend>
			{#each STANDARD_ROLES as role (role.id)}
				<Switch label={role.id} checked={ompSync.preferences.pinned.includes(role.id)} onChange={(value) => void perform(() => ompSync.pin(role.id, value))} />
				{#if roles[role.id] && known.size && !known.has(roles[role.id]) && !known.has(roles[role.id].replace(/:[^/:]+$/, ''))}
					<p class="notice">{m.omp_sync_unavailable({ model: roles[role.id] })}</p>
				{/if}
			{/each}
		</fieldset>
	{/if}
	{#each conflicts as conflict (conflict.id)}
		<section aria-label={conflict.here.key}>
			<strong>{m.omp_sync_conflict({ file: conflict.here.key })}</strong>
			<div class="versions">
				<div><span>{m.machine_this_computer()}</span><pre>{conflict.here.text ?? m.omp_sync_deleted()}</pre></div>
				<div><span>{peer.name}</span><pre>{conflict.there.text ?? m.omp_sync_deleted()}</pre></div>
			</div>
			<button type="button" class="ui-button ui-button-secondary" disabled={saving || ompSync.busy} onclick={() => void perform(() => ompSync.resolve(conflict, true))}>{m.omp_sync_keep_here()}</button>
			<button type="button" class="ui-button ui-button-secondary" disabled={saving || ompSync.busy} onclick={() => void perform(() => ompSync.resolve(conflict, false))}>{m.omp_sync_keep_there({ machine: peer.name })}</button>
		</section>
	{/each}
	<button type="button" class="ui-button ui-button-secondary" disabled={saving || ompSync.busy || !peer.online || !enabled.length} onclick={() => void perform(() => ompSync.sync(peer.id))}>{m.omp_sync_now()}</button>
	{#if error || ompSync.errors[peer.id] || ompSync.errors.local}<p role="alert">{error || ompSync.errors[peer.id] || ompSync.errors.local}</p>{/if}
</details>

<style>
	.sync summary { cursor: pointer; color: var(--ink-muted); }
	fieldset { display: flex; flex-wrap: wrap; gap: 0.75rem; border: 0; padding: 0.5rem 0; margin: 0; min-width: 0; }
	fieldset legend { padding: 0; color: var(--ink-muted); }
	.notice { color: var(--warn); }
	.versions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem; }
	pre { max-height: 12rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
