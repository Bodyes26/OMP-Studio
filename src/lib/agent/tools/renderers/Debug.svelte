<!--
  Renderer per il tool `debug`.

  Forma attesa di `details`:
  `action` (string), `success` (boolean), `snapshot` (object), `adapter` (string),
  `breakpoints` (array), `threads` (array), `stackFrames` (array), `variables` (array),
  `evaluation` (object), `disassembly` (array), `output` (string), `sessions` (array).

  Comportamento quando `details` manca o e' incompleto:
  Mostra l'azione richiesta e il target (programma, espressione o file:linea) nel sommario.
  Nel corpo mostra la tabella KeyValue con tutti gli argomenti noti, un PathChip cliccabile
  se e' specificato un file sorgente, l'output testuale in OutputBlock e, quando presenti,
  le sezioni per stack trace, variabili e breakpoint lette da `details`.
-->
<script lang="ts">
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import PathChip from '../parts/PathChip.svelte';
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

	let { args, result, view }: ToolRenderProps = $props();

	const details = $derived(asRecord(result?.details));
	const action = $derived(str(details?.action) ?? str(args.action) ?? 'debug');
	const program = $derived(str(args.program));
	const expression = $derived(str(args.expression));
	const filePath = $derived(str(args.file));
	const line = $derived(num(args.line));
	const fn = $derived(str(args.function));
	const pid = $derived(num(args.pid));
	const port = $derived(num(args.port));
	const adapter = $derived(str(details?.adapter) ?? str(args.adapter));
	const context = $derived(str(args.context));
	const progArgs = $derived(strList(args.args));

	const targetLabel = $derived.by(() => {
		if (program) return program;
		if (expression) return expression;
		if (filePath) return line !== undefined ? `${filePath}:${line}` : filePath;
		if (fn) return `funzione ${fn}`;
		if (pid !== undefined) return `PID ${pid}`;
		if (port !== undefined) return `Porta ${port}`;
		return '';
	});

	const text = $derived(resultText(result));

	const argsRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		rows.push({ key: 'Azione', value: action });
		if (adapter) rows.push({ key: 'Adapter', value: adapter });
		if (program) rows.push({ key: 'Programma', value: program });
		if (progArgs.length > 0) rows.push({ key: 'Argomenti', value: progArgs.join(' ') });
		if (filePath) rows.push({ key: 'File', value: filePath });
		if (line !== undefined) rows.push({ key: 'Riga', value: String(line) });
		if (fn) rows.push({ key: 'Funzione', value: fn });
		if (expression) rows.push({ key: 'Espressione', value: expression });
		if (context) rows.push({ key: 'Contesto', value: context });
		if (pid !== undefined) rows.push({ key: 'PID', value: String(pid) });
		if (port !== undefined) rows.push({ key: 'Porta', value: String(port) });
		return rows;
	});

	interface FrameItem {
		id: string;
		name: string;
		path?: string;
		line?: number;
	}

	const stackFrames = $derived.by<FrameItem[]>(() => {
		return recordList(details?.stackFrames).map((frame, idx) => {
			const source = asRecord(frame.source);
			return {
				id: str(frame.id) ?? String(idx),
				name: str(frame.name) ?? `frame ${idx}`,
				path: str(source?.path) ?? str(frame.file),
				line: num(frame.line)
			};
		});
	});

	const variableRows = $derived.by(() => {
		return recordList(details?.variables).map((v) => {
			const type = str(v.type);
			const value = str(v.value) ?? '';
			return { key: str(v.name) ?? '', value: type ? `${value} (${type})` : value };
		});
	});

	interface BreakpointItem {
		id: string;
		path?: string;
		line?: number;
		verified: boolean;
		message?: string;
	}

	const breakpoints = $derived.by<BreakpointItem[]>(() => {
		return recordList(details?.breakpoints).map((bp, idx) => {
			const source = asRecord(bp.source);
			return {
				id: str(bp.id) ?? String(idx),
				path: str(source?.path) ?? str(bp.file),
				line: num(bp.line),
				verified: bool(bp.verified) ?? true,
				message: str(bp.message)
			};
		});
	});
</script>

{#if view === 'summary'}
	<div class="debug-summary">
		<span class="action-tag">{action}</span>
		{#if targetLabel}
			<span class="target-text">{targetLabel}</span>
		{/if}
	</div>
{:else}
	<div class="debug-body">
		{#if filePath}
			<div class="file-chip-row">
				<PathChip path={filePath} {line} />
			</div>
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
{/if}

<style>
	.debug-summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.action-tag {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		text-transform: uppercase;
		white-space: nowrap;
	}

	.target-text {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		user-select: text;
	}

	.debug-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.file-chip-row {
		display: flex;
		align-items: center;
		padding: 2px 0;
	}

	.debug-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.section-title {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.frame-list,
	.breakpoint-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
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
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.bp-unverified {
		font-size: var(--text-xs);
		color: var(--warn);
	}
</style>
