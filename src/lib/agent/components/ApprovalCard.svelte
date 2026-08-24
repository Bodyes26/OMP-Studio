<script lang="ts">
	// Card di approvazione per chiamate a tool: mostra gli argomenti reali
	// del tool con la primitiva dedicata prima di procedere con l'esecuzione.
	// Bordo marcato con `--brand` perche' e' l'unico momento in cui l'app
	// richiede un intervento bloccante dell'utente.
	import type { AgentSession, PendingApproval } from '../session.svelte';
	import {
		countLabel,
		num,
		recordList,
		str
	} from '../tools/types';

	import CountBadge from '../tools/parts/CountBadge.svelte';
	import JsonBlock from '../tools/parts/JsonBlock.svelte';
	import KeyValue from '../tools/parts/KeyValue.svelte';
	import OutputBlock from '../tools/parts/OutputBlock.svelte';
	import PathChip from '../tools/parts/PathChip.svelte';

	let { session, pending } = $props<{ session: AgentSession; pending: PendingApproval }>();

	const tool = $derived(pending.tool || 'tool');
	const input = $derived(pending.input || {});

	// Scorciatoie tastiera: Enter per approvare, Esc per negare.
	$effect(() => {
		function onKeydown(e: KeyboardEvent) {
			if (e.key === 'Enter') {
				e.preventDefault();
				session.answerSelect('Approve');
			} else if (e.key === 'Escape') {
				e.preventDefault();
				session.answerSelect('Deny');
			}
		}
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});

	// Campi estratti per tool specifici
	const bashCommand = $derived(str(input.command));
	const bashCwd = $derived(str(input.cwd));
	const bashTimeout = $derived(num(input.timeout));

	const editPath = $derived(str(input.path) || str(input.file));
	const editInput = $derived(str(input.input) || str(input.content) || str(input.patch));

	const writePath = $derived(str(input.path) || str(input.file));
	const writeContent = $derived(str(input.content));

	const readPath = $derived(str(input.path) || str(input.file));
	const readOffset = $derived(num(input.offset));
	const readLimit = $derived(num(input.limit));

	const globPattern = $derived(str(input.pattern) || str(input.path));
	const globPath = $derived(str(input.path));

	const grepPattern = $derived(str(input.pattern));
	const grepPath = $derived(str(input.path));

	const evalLanguage = $derived(str(input.language) || 'codice');
	const evalCode = $derived(str(input.code));

	const taskList = $derived(recordList(input.tasks));
	const taskNames = $derived.by(() => {
		return taskList.map((t) => str(t.name) || str(t.agent) || 'task');
	});

	// Campi scalari e complessi per tool generici
	const scalarRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		for (const [key, val] of Object.entries(input)) {
			if (val === null || val === undefined) continue;
			if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
				rows.push({ key, value: String(val) });
			}
		}
		return rows;
	});

	const complexFields = $derived.by(() => {
		const res: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(input)) {
			if (val !== null && typeof val === 'object') {
				res[key] = val;
			}
		}
		return Object.keys(res).length > 0 ? res : null;
	});
</script>

<div class="approval-card" role="alertdialog" aria-modal="true" aria-labelledby="approval-title">
	<div class="header">
		<div class="title-row">
			<span class="gate-tag">Approvazione</span>
			<h3 id="approval-title" class="tool-name">{tool}</h3>
		</div>
		<p class="policy-note">
			Policy di OMP Studio — il gate è per nome di tool, non per argomenti
		</p>
	</div>

	<div class="body">
		{#if tool === 'bash'}
			{#if bashCommand}
				<div class="command-block">
					<pre>{bashCommand}</pre>
				</div>
			{/if}
			{#if bashCwd || bashTimeout !== undefined}
				<div class="meta-row">
					{#if bashCwd}
						<span class="meta-item"><span class="meta-label">cwd:</span> {bashCwd}</span>
					{/if}
					{#if bashTimeout !== undefined}
						<span class="meta-item"><span class="meta-label">timeout:</span> {bashTimeout}s</span>
					{/if}
				</div>
			{/if}
		{:else if tool === 'edit'}
			<div class="field-stack">
				{#if editPath}
					<div class="field-row">
						<span class="field-label">File:</span>
						<PathChip path={editPath} full={true} />
					</div>
				{/if}
				{#if editInput}
					<div class="mono-block">
						<OutputBlock text={editInput} maxLines={16} label="modifiche" />
					</div>
				{/if}
			</div>
		{:else if tool === 'write'}
			<div class="field-stack">
				{#if writePath}
					<div class="field-row">
						<span class="field-label">File:</span>
						<PathChip path={writePath} full={true} />
					</div>
				{/if}
				{#if writeContent !== undefined}
					<div class="mono-block">
						<OutputBlock text={writeContent} maxLines={16} label="contenuto" />
					</div>
				{/if}
			</div>
		{:else if tool === 'read'}
			<div class="field-stack">
				{#if readPath}
					<div class="field-row">
						<span class="field-label">File:</span>
						<PathChip path={readPath} full={true} />
					</div>
				{/if}
				{#if readOffset !== undefined || readLimit !== undefined}
					<div class="meta-row">
						{#if readOffset !== undefined}
							<span class="meta-item"><span class="meta-label">offset:</span> {readOffset}</span>
						{/if}
						{#if readLimit !== undefined}
							<span class="meta-item"><span class="meta-label">limite:</span> {readLimit}</span>
						{/if}
					</div>
				{/if}
			</div>
		{:else if tool === 'glob'}
			<div class="field-stack">
				{#if globPattern}
					<div class="field-row">
						<span class="field-label">Pattern:</span>
						<code class="pattern">{globPattern}</code>
					</div>
				{/if}
				{#if globPath && globPath !== globPattern}
					<div class="field-row">
						<span class="field-label">Percorso:</span>
						<PathChip path={globPath} />
					</div>
				{/if}
			</div>
		{:else if tool === 'grep'}
			<div class="field-stack">
				{#if grepPattern}
					<div class="field-row">
						<span class="field-label">Pattern:</span>
						<code class="pattern">{grepPattern}</code>
					</div>
				{/if}
				{#if grepPath}
					<div class="field-row">
						<span class="field-label">Percorso:</span>
						<PathChip path={grepPath} />
					</div>
				{/if}
			</div>
		{:else if tool === 'eval'}
			<div class="field-stack">
				<div class="field-row">
					<span class="field-label">Linguaggio:</span>
					<CountBadge text={evalLanguage} />
				</div>
				{#if evalCode}
					<div class="mono-block">
						<OutputBlock text={evalCode} maxLines={16} label="codice" />
					</div>
				{/if}
			</div>
		{:else if tool === 'task'}
			<div class="field-stack">
				<div class="field-row">
					<span class="field-label">Subagent:</span>
					<CountBadge text={countLabel(taskList.length, 'subagent', 'subagent')} />
				</div>
				{#if taskNames.length > 0}
					<div class="task-list">
						{#each taskNames as name}
							<span class="task-chip">{name}</span>
						{/each}
					</div>
				{/if}
			</div>
		{:else}
			{#if scalarRows.length > 0}
				<KeyValue rows={scalarRows} />
			{/if}
			{#if complexFields}
				<JsonBlock value={complexFields} label="argomenti" />
			{/if}
		{/if}
	</div>

	<div class="actions">
		<button
			type="button"
			class="btn-deny"
			onclick={() => session.answerSelect('Deny')}
			title="Nega l'operazione (Esc)"
		>
			Nega <span class="kbd">Esc</span>
		</button>
		<button
			type="button"
			class="btn-approve"
			onclick={() => session.answerSelect('Approve')}
			title="Approva l'operazione (Enter)"
		>
			Approva <span class="kbd">↵</span>
		</button>
	</div>
</div>

<style>
	.approval-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		background: var(--bg-raised);
		border: 1px solid var(--brand);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		min-width: 0;
	}

	.header {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.title-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.gate-tag {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--brand-ink);
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.tool-name {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--ink);
	}

	.policy-note {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.command-block {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
		min-width: 0;
	}

	.command-block pre {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--ink);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		user-select: text;
	}

	.field-stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.field-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		min-width: 0;
	}

	.field-label {
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.pattern {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--ink);
		overflow-wrap: anywhere;
		user-select: text;
	}

	.meta-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.meta-item {
		font-family: var(--font-mono);
	}

	.meta-label {
		color: var(--ink-faint);
		font-family: var(--font-ui);
		margin-right: 2px;
	}

	.mono-block {
		min-width: 0;
	}

	.task-list {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}

	.task-chip {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 2px 6px;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-1);
	}

	button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border-radius: var(--radius-sm);
		padding: 6px var(--space-3);
		font-size: var(--text-sm);
		cursor: pointer;
		transition: background var(--dur-fast), border-color var(--dur-fast);
	}

	.btn-deny {
		background: var(--bg-hover);
		border: 1px solid var(--line);
		color: var(--ink-muted);
	}

	.btn-deny:hover {
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.btn-approve {
		background: var(--brand);
		border: 1px solid var(--brand);
		color: var(--on-brand);
		font-weight: 600;
	}

	.btn-approve:hover {
		filter: brightness(1.08);
	}

	.kbd {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		opacity: 0.75;
	}
</style>
