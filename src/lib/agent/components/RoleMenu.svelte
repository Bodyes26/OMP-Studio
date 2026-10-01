<script lang="ts">
	/**
	 * Menu di selezione del ruolo attivo per l'agente.
	 * Mostra per ciascun ruolo il modello e il livello di thinking associati.
	 */
	import { IconCheck } from '$lib/icons';
	import { m } from '$lib/paraglide/messages.js';

	export interface RoleDefinition {
		id: string;
		label: string;
		description: string;
		hue?: number;
	}

	export interface RoleAssignment {
		model?: string;
		thinking?: string;
	}

	let {
		activeRole = 'default',
		assignments = {},
		onPick
	} = $props<{
		activeRole?: string;
		assignments?: Record<string, RoleAssignment>;
		onPick: (roleId: string) => void;
	}>();

	const ROLES: RoleDefinition[] = [
		{ id: 'default', label: 'default', description: 'Ruolo principale per conversazione e compiti generici' },
		{ id: 'plan', label: 'plan', description: 'Pianificazione architetturale ad alto livello', hue: 230 },
		{ id: 'smol', label: 'smol', description: 'Modello veloce per risposte concise e sintetiche', hue: 140 },
		{ id: 'slow', label: 'slow', description: 'Modello di massimo ragionamento per problemi complessi', hue: 300 },
		{ id: 'vision', label: 'vision', description: 'Specializzato nell\'analisi di immagini e diagrammi', hue: 80 },
		{ id: 'task', label: 'task', description: 'Esecuzione mirata di sotto-task e automazioni', hue: 35 },
		{ id: 'commit', label: 'commit', description: 'Generazione di messaggi di commit e revisione patch', hue: 180 },
		{ id: 'advisor', label: 'advisor', description: 'Revisione del codice, sicurezza e best practice', hue: 320 }
	];
</script>

<div class="role-menu-container">
	<div class="menu-header">
		<span>{m.chat_v2_composer_role_title()}</span>
	</div>

	<div class="role-list" role="listbox">
		{#each ROLES as role}
			{@const active = role.id === activeRole}
			{@const assign = assignments[role.id]}
			{@const modelName = assign?.model || 'default'}
			{@const thinkingLevel = assign?.thinking || 'auto'}
			<button
				type="button"
				role="option"
				aria-selected={active}
				class="role-item"
				class:active
				onclick={() => onPick(role.id)}
			>
				<span
					class="role-dot"
					class:has-hue={role.hue !== undefined}
					style={role.hue !== undefined ? `--role-h: ${role.hue}` : undefined}
				></span>

				<div class="role-content">
					<div class="role-top">
						<span class="role-name">{role.id}</span>
						<span class="role-meta">
							{modelName} · {thinkingLevel}
						</span>
					</div>
					<span class="role-desc">{role.description}</span>
				</div>

				{#if active}
					<span class="check-icon"><IconCheck /></span>
				{/if}
			</button>
		{/each}
	</div>

	<div class="menu-footer">
		<span>{m.chat_v2_composer_role_footer()}</span>
	</div>
</div>

<style>
	/* La larghezza la decide MenuButton (prop width): un valore fisso qui sforava il popover. */
	.role-menu-container {
		display: flex;
		flex-direction: column;
	}

	.menu-header {
		padding: var(--space-2) var(--space-3) var(--space-1);
		font-size: var(--text-group-label);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-faint);
		border-bottom: 1px solid var(--line);
	}

	.role-list {
		padding: var(--space-1);
		max-height: 320px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.role-item {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: 7px var(--space-2);
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		text-align: left;
		cursor: pointer;
		width: 100%;
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.role-item:hover {
		background: var(--bg-hover);
	}

	.role-item.active {
		background: var(--bg-hover);
	}

	.role-dot {
		width: 8px;
		height: 8px;
		border-radius: var(--radius-full);
		margin-top: 5px;
		flex-shrink: 0;
		background-color: var(--brand-ink);
	}

	.role-dot.has-hue {
		background-color: oklch(var(--proj-l-ink) var(--proj-c-ink) var(--role-h));
	}

	.role-content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.role-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.role-name {
		font-family: var(--font-mono);
		font-weight: 600;
		color: var(--ink);
	}

	.role-meta {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.role-desc {
		font-size: var(--text-meta);
		line-height: 1.35;
		color: var(--ink-muted);
	}

	.check-icon {
		color: var(--brand-ink);
		margin-top: 4px;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		--icon-size: 14px;
	}

	.menu-footer {
		padding: var(--space-2) var(--space-3);
		border-top: 1px solid var(--line);
		background: var(--bg-base);
		font-size: var(--text-caption);
		line-height: 1.4;
		color: var(--ink-faint);
		border-bottom-left-radius: var(--radius-lg);
		border-bottom-right-radius: var(--radius-lg);
	}
</style>
