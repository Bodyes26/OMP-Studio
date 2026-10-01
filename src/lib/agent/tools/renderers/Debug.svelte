<!--
  Renderer per il tool `debug`.

  Nel corpo espanso mostra la tabella KeyValue con gli argomenti noti,
  ToolFileHeader se e' specificato un file sorgente, l'output in OutputBlock e,
  quando presenti, le sezioni per stack trace, variabili e breakpoint.
-->
<script lang="ts">
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import PathChip from '../parts/PathChip.svelte';
	import ToolFileHeader from '../parts/ToolFileHeader.svelte';
	import {
		asRecord,
		bool,
		num,
		recordList,
		resultText,
		str,
		strList,
		type ToolRenderProps
	} from '../types';

	let { args, result }: ToolRenderProps = $props();

	const details = $derived(asRecord(result?.details));
	const text = $derived(resultText(result));

	const targetProgram = $derived(str(args.program) ?? str(args.file) ?? str(args.path));
	const targetExpression = $derived(str(args.expression) ?? str(args.expr));
	const targetLine = $derived(num(args.line));

	const filePath = $derived(targetProgram);
	const line = $derived(targetLine);

	const stackFrames = $derived.by<{ id: number; name: string; path?: string; line?: number }[]>(() => {
		const raw = recordList(details?.stackFrames);
		return raw.map((f, i) => ({
			id: num(f.id) ?? i,
			name: str(f.name) ?? `frame-${i}`,
			path: str(f.source) ?? str(f.path) ?? str(f.file),
			line: num(f.line)
		}));
	});

	const variableRows = $derived.by<{ key: string; value: string }[]>(() => {
		const raw = recordList(details?.variables);
		const rows: { key: string; value: string }[] = [];
		for (const v of raw) {
			const name = str(v.name);
			const val = str(v.value) ?? (v.value !== undefined ? String(v.value) : undefined);
			if (name && val !== undefined) {
				rows.push({ key: name, value: val });
			}
		}
		return rows;
	});

	const breakpoints = $derived.by<{ id: number; verified: boolean; path?: string; line?: number; message?: string }[]>(() => {
		const raw = recordList(details?.breakpoints);
		return raw.map((b, i) => ({
			id: num(b.id) ?? i,
			verified: bool(b.verified) ?? false,
			path: str(b.source) ?? str(b.path),
			line: num(b.line),
			message: str(b.message)
		}));
	});

	const argsRows = $derived.by<{ key: string; value: string }[]>(() => {
		const rows: { key: string; value: string }[] = [];
		const action = str(details?.action) ?? str(args.action) ?? 'debug';
		rows.push({ key: 'Azione', value: action });
		if (targetProgram) rows.push({ key: 'Programma', value: targetProgram });
		if (targetExpression) rows.push({ key: 'Espressione', value: targetExpression });
		if (targetLine !== undefined) rows.push({ key: 'Riga', value: String(targetLine) });
		const adapter = str(details?.adapter) ?? str(args.adapter);
		if (adapter) rows.push({ key: 'Adapter', value: adapter });
		const threads = strList(details?.threads);
		if (threads.length > 0) rows.push({ key: 'Thread', value: threads.join(', ') });
		return rows;
	});
</script>

<div class="debug-body">
	{#if filePath}
		<ToolFileHeader path={filePath} {line} />
	{/if}

	{#if argsRows.length > 0}
		<KeyValue rows={argsRows} />
	{/if}

	{#if stackFrames.length > 0}
		<div class="debug-section">
			<div class="section-title">Stack trace</div>
			<ul class="frame-list">
				{#each stackFrames as frame (frame.id)}
					<li class="frame-row">
						<span class="frame-name">{frame.name}</span>
						{#if frame.path}
							<PathChip path={frame.path} line={frame.line} />
						{:else if frame.line !== undefined}
							<span class="frame-line">riga {frame.line}</span>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if variableRows.length > 0}
		<div class="debug-section">
			<div class="section-title">Variabili</div>
			<KeyValue rows={variableRows} />
		</div>
	{/if}

	{#if breakpoints.length > 0}
		<div class="debug-section">
			<div class="section-title">Breakpoint</div>
			<ul class="breakpoint-list">
				{#each breakpoints as bp (bp.id)}
					<li class="breakpoint-row">
						{#if bp.path}
							<PathChip path={bp.path} line={bp.line} />
						{:else if bp.line !== undefined}
							<span class="frame-line">riga {bp.line}</span>
						{/if}
						{#if !bp.verified}
							<span class="bp-unverified">non verificato{bp.message ? `: ${bp.message}` : ''}</span>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if text}
		<OutputBlock {text} label="output debugger" />
	{/if}
</div>

<style>
	.debug-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.debug-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.section-title {
		font-family: var(--font-ui);
		font-size: var(--text-group-label);
		font-weight: 600;
		letter-spacing: 0.05em;
		color: var(--ink-faint);
	}

	.frame-list,
	.breakpoint-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.frame-row,
	.breakpoint-row {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}

	.frame-name {
		font-family: var(--font-mono);
		color: var(--ink);
	}

	.frame-line {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}

	.bp-unverified {
		font-size: var(--text-caption);
		color: var(--warn);
	}
</style>
