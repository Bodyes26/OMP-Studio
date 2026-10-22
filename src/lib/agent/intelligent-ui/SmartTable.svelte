<!--
  SmartTable.svelte — Intelligent UI: Tabella dati dinamica.
  Supporta:
  - Ricerca full-text rapida
  - Ordinamento per colonna (alfabetico e numerico)
  - Paginazione automatica per tabelle lunghe
  - Esportazione istantanea in CSV e Markdown
-->
<script lang="ts">
	import { m } from '../../paraglide/messages.js';
	import type { Token } from '../markdown';
	import MarkdownInline from '../components/MarkdownInline.svelte';
	import Tooltip from '../../ui/Tooltip.svelte';
	import {
		IconSearch,
		IconArrowUp,
		IconArrowDown,
		IconCopy,
		IconCheck,
		IconDownload,
		IconChevronLeft,
		IconChevronRight
	} from '../../icons';

	export interface TableCellItem {
		text: string;
		tokens?: Token[];
		align?: 'left' | 'center' | 'right' | null;
	}

	let {
		header = [],
		rows = [],
		onOpenFile
	}: {
		header: TableCellItem[];
		rows: TableCellItem[][];
		onOpenFile?: (path: string) => void;
	} = $props();

	let searchQuery = $state('');
	let sortCol = $state<number | null>(null);
	let sortAsc = $state(true);
	let currentPage = $state(0);
	const PAGE_SIZE = 10;

	let copiedFormat = $state<'csv' | 'md' | null>(null);

	// Filtro di ricerca su tutte le celle della riga
	const filteredRows = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return rows;
		return rows.filter((row) =>
			row.some((cell) => cell.text.toLowerCase().includes(q))
		);
	});

	// Ordinamento
	const sortedRows = $derived.by(() => {
		if (sortCol === null) return filteredRows;
		const col = sortCol;
		const asc = sortAsc;

		return [...filteredRows].sort((a, b) => {
			const textA = a[col]?.text?.trim() ?? '';
			const textB = b[col]?.text?.trim() ?? '';

			// Verifica se entrambi sono numerici
			const numA = Number(textA.replace(/[^0-9.-]+/g, ''));
			const numB = Number(textB.replace(/[^0-9.-]+/g, ''));
			const isNum = !isNaN(numA) && !isNaN(numB) && textA !== '' && textB !== '';

			if (isNum) {
				return asc ? numA - numB : numB - numA;
			}
			return asc ? textA.localeCompare(textB) : textB.localeCompare(textA);
		});
	});

	// Paginazione
	const totalPages = $derived(Math.ceil(sortedRows.length / PAGE_SIZE) || 1);
	const paginatedRows = $derived.by(() => {
		if (sortedRows.length <= PAGE_SIZE) return sortedRows;
		const start = currentPage * PAGE_SIZE;
		return sortedRows.slice(start, start + PAGE_SIZE);
	});

	function handleSort(colIdx: number) {
		if (sortCol === colIdx) {
			if (sortAsc) {
				sortAsc = false;
			} else {
				sortCol = null;
				sortAsc = true;
			}
		} else {
			sortCol = colIdx;
			sortAsc = true;
		}
		currentPage = 0;
	}

	function buildCsv(): string {
		const escape = (str: string) => `"${str.replace(/"/g, '""')}"`;
		const lines: string[] = [];
		lines.push(header.map((h) => escape(h.text)).join(','));
		for (const r of sortedRows) {
			lines.push(r.map((c) => escape(c.text)).join(','));
		}
		return lines.join('\n');
	}

	function buildMarkdown(): string {
		const lines: string[] = [];
		lines.push(`| ${header.map((h) => h.text).join(' | ')} |`);
		lines.push(`| ${header.map(() => '---').join(' | ')} |`);
		for (const r of sortedRows) {
			lines.push(`| ${r.map((c) => c.text).join(' | ')} |`);
		}
		return lines.join('\n');
	}

	async function copyCsv() {
		try {
			await navigator.clipboard.writeText(buildCsv());
			copiedFormat = 'csv';
			setTimeout(() => (copiedFormat = null), 2000);
		} catch {
			// Clipboard non disponibile
		}
	}

	async function copyMd() {
		try {
			await navigator.clipboard.writeText(buildMarkdown());
			copiedFormat = 'md';
			setTimeout(() => (copiedFormat = null), 2000);
		} catch {
			// Clipboard non disponibile
		}
	}

	function downloadCsv() {
		const csv = buildCsv();
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `table-export-${Date.now()}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<div class="smart-table-card">
	<!-- Barra superiore: ricerca e strumenti -->
	<div class="table-toolbar">
		<div class="search-box">
			<span class="search-icon"><IconSearch /></span>
			<input
				type="search"
				bind:value={searchQuery}
				placeholder={m.smart_table_search_placeholder()}
				class="search-input"
			/>
		</div>

		<div class="toolbar-stats">
			<span class="rows-badge">{m.smart_table_rows_count({ count: sortedRows.length })}</span>
		</div>

		<div class="toolbar-actions">
			<Tooltip text={copiedFormat === 'csv' ? m.diagram_copied() : m.smart_table_copy_csv()} placement="top">
				<button type="button" class="tool-btn" onclick={copyCsv} aria-label={m.smart_table_copy_csv()}>
					{#if copiedFormat === 'csv'}
						<IconCheck />
					{:else}
						<IconCopy />
					{/if}
					<span class="btn-text">CSV</span>
				</button>
			</Tooltip>

			<Tooltip text={copiedFormat === 'md' ? m.diagram_copied() : m.smart_table_copy_md()} placement="top">
				<button type="button" class="tool-btn" onclick={copyMd} aria-label={m.smart_table_copy_md()}>
					{#if copiedFormat === 'md'}
						<IconCheck />
					{:else}
						<IconCopy />
					{/if}
					<span class="btn-text">MD</span>
				</button>
			</Tooltip>

			<Tooltip text={m.smart_table_download_csv()} placement="top">
				<button type="button" class="tool-btn" onclick={downloadCsv} aria-label={m.smart_table_download_csv()}>
					<IconDownload />
				</button>
			</Tooltip>
		</div>
	</div>

	<!-- Griglia tabellare -->
	<div class="table-scroll-container">
		<table class="data-table">
			<thead>
				<tr>
					{#each header as cell, ci}
						<th
							style={cell.align ? `text-align: ${cell.align}` : undefined}
							class="th-sortable"
							onclick={() => handleSort(ci)}
						>
							<div class="th-content" class:center={cell.align === 'center'} class:right={cell.align === 'right'}>
								<span class="th-text">
									{#if cell.tokens}
										<MarkdownInline tokens={cell.tokens} {onOpenFile} />
									{:else}
										{cell.text}
									{/if}
								</span>
								<span class="sort-indicator">
									{#if sortCol === ci}
										{#if sortAsc}
											<IconArrowUp />
										{:else}
											<IconArrowDown />
										{/if}
									{/if}
								</span>
							</div>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#if paginatedRows.length === 0}
					<tr>
						<td colspan={header.length || 1} class="empty-cell">
							Nessun dato corrispondente ai criteri
						</td>
					</tr>
				{:else}
					{#each paginatedRows as row, ri}
						<tr class:striped={ri % 2 === 1}>
							{#each row as cell, ci}
								<td style={cell.align ? `text-align: ${cell.align}` : undefined}>
									{#if cell.tokens}
										<MarkdownInline tokens={cell.tokens} {onOpenFile} />
									{:else}
										{cell.text}
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	<!-- Paginatore (visibile se necessario) -->
	{#if totalPages > 1}
		<div class="table-pagination">
			<span class="page-info">
				{m.smart_table_page_info({ current: currentPage + 1, total: totalPages })}
			</span>
			<div class="pagination-buttons">
				<button
					type="button"
					class="page-nav-btn"
					disabled={currentPage === 0}
					onclick={() => currentPage = Math.max(0, currentPage - 1)}
					aria-label="Pagina precedente"
				>
					<IconChevronLeft />
				</button>
				<button
					type="button"
					class="page-nav-btn"
					disabled={currentPage >= totalPages - 1}
					onclick={() => currentPage = Math.min(totalPages - 1, currentPage + 1)}
					aria-label="Pagina successiva"
				>
					<IconChevronRight />
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.smart-table-card {
		margin: var(--space-3) 0;
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		background: var(--bg-base);
		overflow: hidden;
		transition: border-color var(--dur-fast) var(--ease-out);
		/* Abilita container queries per adattare controlli e prima colonna fissa alla larghezza reale della chat */
		container-type: inline-size;
	}

	.smart-table-card:hover {
		border-color: var(--line-strong);
	}

	.table-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: 6px 10px;
		background: var(--bg-raised);
		border-bottom: 1px solid var(--line);
	}

	.search-box {
		display: flex;
		align-items: center;
		gap: 6px;
		background: var(--bg-overlay);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 2px 8px;
		width: min(220px, 45%);
	}

	.search-icon {
		color: var(--ink-faint);
		--icon-size: 13px;
		display: inline-grid;
		place-items: center;
	}

	.search-input {
		border: none;
		background: transparent;
		color: var(--ink);
		font-size: var(--text-xs);
		outline: none;
		width: 100%;
	}

	.search-input::placeholder {
		color: var(--ink-faint);
	}

	.toolbar-stats {
		flex: 1;
		display: flex;
		align-items: center;
	}

	.rows-badge {
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--ink-muted);
		background: var(--bg-overlay);
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line-faint, var(--line));
	}

	.toolbar-actions {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.tool-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 24px;
		padding: 0 6px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-size: 11px;
		font-family: var(--font-mono);
		cursor: pointer;
		--icon-size: 12px;
		transition: all var(--dur-fast) var(--ease-out);
	}

	.tool-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line);
	}

	.btn-text {
		font-size: 10px;
		font-weight: 600;
	}

	.table-scroll-container {
		max-height: 480px;
		overflow: auto;
		background: var(--bg-sunken);
		-webkit-overflow-scrolling: touch;
		scrollbar-width: thin;
	}

	.data-table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-body);
		text-align: left;
	}

	.data-table thead {
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--bg-raised);
	}

	.data-table th {
		padding: 8px 12px;
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
		border-bottom: 1px solid var(--line-strong);
		white-space: nowrap;
		user-select: none;
	}

	.th-sortable {
		cursor: pointer;
	}

	.th-sortable:hover {
		background: var(--bg-hover);
	}

	.th-content {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.th-content.center {
		justify-content: center;
		width: 100%;
	}

	.th-content.right {
		justify-content: flex-end;
		width: 100%;
	}

	.sort-indicator {
		display: inline-grid;
		place-items: center;
		--icon-size: 12px;
		color: var(--brand-ink);
		min-width: 12px;
	}

	.data-table td {
		padding: 7px 12px;
		border-bottom: 1px solid var(--line);
		color: var(--ink);
		font-size: var(--text-body);
		line-height: 1.45;
	}

	.data-table tr.striped {
		background: var(--bg-surface-alt, rgba(0, 0, 0, 0.015));
	}

	.data-table tr:hover {
		background: var(--bg-hover);
	}

	.empty-cell {
		text-align: center;
		color: var(--ink-faint);
		padding: var(--space-4);
		font-style: italic;
	}

	.table-pagination {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 12px;
		background: var(--bg-raised);
		border-top: 1px solid var(--line);
	}

	.page-info {
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--ink-muted);
	}

	.pagination-buttons {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.page-nav-btn {
		width: 24px;
		height: 24px;
		display: inline-grid;
		place-items: center;
		padding: 0;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		cursor: pointer;
		--icon-size: 14px;
	}

	.page-nav-btn:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line);
	}

	.page-nav-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	/* Adattamenti mobile: container query per chat stretta e media query per puntatori touch */
	@container (max-width: 520px) {
		.table-toolbar {
			flex-wrap: wrap;
			gap: 8px;
			padding: 8px 10px;
		}

		.search-box {
			width: 100%;
			min-height: 40px;
			padding: 0 10px;
		}

		.search-input {
			/* 16px impedisce a iOS Safari lo zoom indesiderato al focus dell'input */
			font-size: 16px;
		}

		.toolbar-actions {
			gap: 6px;
		}

		.tool-btn {
			min-height: 40px;
			min-width: 40px;
			padding: 0 8px;
			border-radius: var(--radius-md);
		}

		.th-sortable {
			padding: 10px 12px;
		}

		.table-pagination {
			min-height: 48px;
			padding: 8px 12px;
		}

		.page-nav-btn {
			width: 40px;
			height: 40px;
			min-width: 40px;
			min-height: 40px;
			border-radius: var(--radius-md);
		}

		/* Prima colonna fissa con ombra di stacco per mantenere il contesto durante lo scorrimento */
		.data-table th:first-child,
		.data-table td:first-child {
			position: sticky;
			left: 0;
			z-index: 2;
			background: var(--bg-raised);
			box-shadow: 2px 0 6px -2px rgba(0, 0, 0, 0.15);
		}

		.data-table td:first-child {
			background: var(--bg-base);
		}

		.data-table tr.striped td:first-child {
			background: var(--bg-surface-alt, var(--bg-base));
		}

		.data-table tr:hover td:first-child {
			background: var(--bg-hover);
		}

		.data-table th:first-child {
			z-index: 3;
		}
	}

	/* Per dispositivi touch indipendentemente dalla larghezza del contenitore */
	@media (pointer: coarse) {
		.search-input {
			font-size: 16px;
		}

		.tool-btn {
			min-height: 40px;
			min-width: 40px;
		}

		.page-nav-btn {
			min-width: 40px;
			min-height: 40px;
		}

		.th-sortable {
			min-height: 40px;
			padding: 10px 12px;
		}
	}
</style>
