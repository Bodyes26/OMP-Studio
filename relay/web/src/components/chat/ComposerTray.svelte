<!--
  ComposerTray.svelte — Vassoio sopra il composer con lo stato vivo dei todo.
  Anello circolare SVG di avanzamento, titolo task attivo ed elenco espandibile.
  Fedele a src/lib/agent/components/ComposerTray.svelte di Studio.
-->
<script lang="ts">
	import { t } from '../../i18n.ts';
	import type { RemoteTodoItem } from '../../../../src/protocol.ts';
	import StatusMark from '../StatusMark.svelte';
	import { IconChevronUp } from '../../icons.ts';

	let { todos = [] }: { todos?: RemoteTodoItem[] } = $props();

	let open = $state(false);

	const totalCount = $derived(todos.length);
	const completedCount = $derived(todos.filter((t) => t.status === 'completed').length);
	const ringValue = $derived(totalCount > 0 ? completedCount / totalCount : 0);
	const circumference = 2 * Math.PI * 7;

	const currentTodo = $derived.by(() => {
		const active = todos.find((t) => t.status === 'in_progress');
		if (active) return active.text;
		if (totalCount === 0) return t('chatTodoReady');
		if (completedCount === totalCount && totalCount > 0) return t('chatTodoAllDone');
		return t('chatTodoReady');
	});
</script>

{#if totalCount > 0}
	<div class="composer-tray rv-lift">
		<button
			type="button"
			class="tray-header"
			aria-expanded={open}
			onclick={() => (open = !open)}
		>
			<svg viewBox="0 0 18 18" class="ring" aria-hidden="true">
				<circle cx="9" cy="9" r="7" fill="none" class="ring-bg" />
				<circle
					cx="9"
					cy="9"
					r="7"
					fill="none"
					class="ring-fg"
					stroke-dasharray={circumference}
					stroke-dashoffset={circumference * (1 - ringValue)}
				/>
			</svg>
			<span class="tray-title">{t('chatTodoTitle')}</span>
			<span class="tray-count font-mono">{completedCount}/{totalCount}</span>
			{#if !open}
				<span class="tray-current">{currentTodo}</span>
			{/if}
			<span class="tray-chevron" class:open aria-hidden="true">
				<IconChevronUp />
			</span>
		</button>

		{#if open}
			<div class="tray-body">
				{#each todos as item, idx (idx)}
					<div
						class="todo-row"
						class:done={item.status === 'completed'}
						class:active={item.status === 'in_progress'}
					>
						<span class="todo-mark" aria-hidden="true">
							<StatusMark
								status={item.status === 'completed'
									? 'completed'
									: item.status === 'in_progress'
										? 'running'
										: item.status === 'abandoned'
											? 'failed'
											: 'pending'}
							/>
						</span>
						<span class="todo-text">{item.text}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.composer-tray {
		margin: 0 var(--space-3);
		border: 1px solid var(--line);
		border-bottom: 0;
		border-radius: var(--radius-xl) var(--radius-xl) 0 0;
		background: color-mix(in oklch, var(--bg-raised) 92%, transparent);
		backdrop-filter: blur(8px);
		overflow: hidden;
		transition: border-color var(--dur-fast) var(--ease-out);
	}

	.tray-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: 0;
		cursor: pointer;
		text-align: left;
		color: var(--ink);
		font-family: var(--font-ui);
		user-select: none;
	}

	.tray-header:hover {
		background: var(--bg-hover);
	}

	.ring {
		width: 18px;
		height: 18px;
		transform: rotate(-90deg);
		flex-shrink: 0;
	}

	.ring-bg {
		stroke: var(--line-strong);
		stroke-width: 2.2;
	}

	.ring-fg {
		stroke: var(--ink);
		stroke-width: 2.2;
		stroke-linecap: round;
		transition: stroke-dashoffset 500ms var(--ease-out);
	}

	.tray-title {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.tray-count {
		font-size: var(--text-meta);
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}

	.tray-current {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-trace);
		color: var(--ink-muted);
	}

	.tray-chevron {
		display: inline-flex;
		align-items: center;
		--icon-size: 14px;
		color: var(--ink-faint);
		margin-left: auto;
		transition: transform var(--dur-fast) var(--ease-out);
	}

	.tray-chevron.open {
		transform: rotate(180deg);
	}

	.tray-body {
		padding: 0 var(--space-3) var(--space-3);
		display: flex;
		flex-direction: column;
		gap: 6px;
		border-top: 1px solid var(--line);
		padding-top: var(--space-2);
	}

	.todo-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--ink-muted);
	}

	.todo-row.done {
		color: var(--ink-faint);
		text-decoration: line-through;
	}

	.todo-row.active {
		color: var(--ink);
		font-weight: 500;
	}

	.todo-mark {
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	.todo-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
