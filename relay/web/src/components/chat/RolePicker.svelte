<!--
  RolePicker.svelte — Menu di selezione del ruolo attivo per l'agente della corsia.
  Portato da src/lib/agent/components/RoleMenu.svelte di Studio.
-->
<script lang="ts">
	import type { RemoteRoleOption } from '../../../../src/protocol.ts';
	import { IconCheck } from '../../icons.ts';
	import { t } from '../../i18n.ts';
	import { ROLE_HUES } from '../../chat/roleHues.ts';

	let {
		roles = [],
		activeRole = 'default',
		onSelect
	}: {
		roles: RemoteRoleOption[];
		activeRole: string;
		onSelect: (roleId: string) => void;
	} = $props();

	function getRoleDescription(id: string): string {
		switch (id) {
			case 'default': return t('roleDescDefault');
			case 'plan': return t('roleDescPlan');
			case 'smol': return t('roleDescSmol');
			case 'slow': return t('roleDescSlow');
			case 'vision': return t('roleDescVision');
			case 'task': return t('roleDescTask');
			case 'commit': return t('roleDescCommit');
			case 'advisor': return t('roleDescAdvisor');
			default: return '';
		}
	}
</script>

<div class="role-picker-container">
	<div class="role-list" role="listbox">
		{#each roles as role (role.id)}
			{@const active = role.id === activeRole}
			{@const hue = ROLE_HUES[role.id]}
			{@const hasModel = role.model !== null}
			{@const modelName = role.modelLabel || role.model || (role.id === 'default' ? 'default' : null)}
			{@const thinking = role.thinking || 'auto'}
			{@const isUnassigned = !hasModel && role.id !== 'default'}
			{@const desc = getRoleDescription(role.id)}

			<button
				type="button"
				role="option"
				aria-selected={active}
				disabled={isUnassigned}
				class="role-row"
				class:active
				class:unassigned={isUnassigned}
				onclick={() => {
					if (!isUnassigned) onSelect(role.id);
				}}
			>
				<span
					class="role-dot"
					class:has-hue={hue !== undefined}
					style={hue !== undefined ? `--role-h: ${hue}` : undefined}
				></span>

				<div class="role-content">
					<div class="role-top">
						<span class="role-name font-mono">{role.id}</span>
						<span class="role-meta">
							{#if isUnassigned}
								{t('roleUnassigned')}
							{:else}
								{modelName} · {thinking}
							{/if}
						</span>
					</div>
					{#if desc}
						<span class="role-desc">{desc}</span>
					{/if}
				</div>

				{#if active}
					<span class="check-icon" aria-hidden="true">
						<IconCheck />
					</span>
				{/if}
			</button>
		{/each}
	</div>

	<div class="picker-footer">
		<span>{t('rolePickerFooter')}</span>
	</div>
</div>

<style>
	.role-picker-container {
		display: flex;
		flex-direction: column;
		width: 100%;
	}

	.role-list {
		padding: var(--space-1);
		max-height: 340px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.role-row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: 8px 10px;
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--ink);
		font-family: var(--font-ui);
		text-align: left;
		cursor: pointer;
		width: 100%;
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.role-row:hover:not(:disabled),
	.role-row.active {
		background: var(--bg-hover);
	}

	.role-row:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.role-dot {
		width: 8px;
		height: 8px;
		border-radius: var(--radius-full);
		background: var(--brand-ink);
		flex-shrink: 0;
		margin-top: 5px;
	}

	.role-dot.has-hue {
		background: oklch(var(--proj-l-ink) var(--proj-c-ink) var(--role-h, 260));
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
		font-size: var(--text-sm);
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
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.35;
	}

	.check-icon {
		display: grid;
		place-items: center;
		color: var(--brand-ink);
		--icon-size: 16px;
		flex-shrink: 0;
		margin-top: 3px;
	}

	.picker-footer {
		padding: 8px 12px;
		border-top: 1px solid var(--line);
		font-size: var(--text-caption);
		color: var(--ink-faint);
		background: var(--bg-sunken);
	}
</style>
