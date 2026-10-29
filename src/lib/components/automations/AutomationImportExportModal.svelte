<script lang="ts">
	import { automationsStore } from '#lib/automations/store.svelte.ts';
	import { t } from '#lib/automations/i18n.ts';
	import Dialog from '#lib/ui/Dialog.svelte';
	import {
		IconDownload,
		IconArrowUp,
		IconCopy,
		IconCheck,
		IconWarning,
		IconFileCode
	} from '#lib/icons.ts';

	interface Props {
		open: boolean;
		onClose: () => void;
	}

	let { open = false, onClose }: Props = $props();

	let activeTab = $state<'export' | 'import'>('export');
	let exportedJson = $state('');
	let isExporting = $state(false);
	let copied = $state(false);

	let importJson = $state('');
	let isImporting = $state(false);
	let importResultMsg = $state<string | null>(null);
	let importError = $state<string | null>(null);

	const definitions = $derived(automationsStore.snapshot?.definitions || []);
	let selectedIds = $state<string[]>([]);

	$effect(() => {
		if (definitions.length > 0 && selectedIds.length === 0) {
			selectedIds = definitions.map((d) => d.id);
		}
	});

	async function handleExport() {
		isExporting = true;
		try {
			const res = await automationsStore.exportDefinitions(selectedIds);
			exportedJson = res;
		} catch (err) {
			console.error('Export failed:', err);
		} finally {
			isExporting = false;
		}
	}

	async function copyExported() {
		if (!exportedJson) return;
		try {
			await navigator.clipboard.writeText(exportedJson);
			copied = true;
			setTimeout(() => {
				copied = false;
			}, 2000);
		} catch {
			// ignore clipboard error
		}
	}

	function downloadJson() {
		if (!exportedJson) return;
		const blob = new Blob([exportedJson], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `automations-export-${new Date().toISOString().slice(0, 10)}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function handleImport() {
		if (!importJson.trim()) return;
		isImporting = true;
		importError = null;
		importResultMsg = null;
		try {
			const res = await automationsStore.importDefinitions(importJson);
			const count = Array.isArray(res) ? res.length : (typeof res === 'number' ? res : 1);
			importResultMsg = t('io_import_success', { count });
			importJson = '';
		} catch (err) {
			importError = err instanceof Error ? err.message : String(err);
		} finally {
			isImporting = false;
		}
	}

	function handleFileSelected(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			importJson = String(reader.result || '');
		};
		reader.readAsText(file);
	}
</script>

{#if open}
	<Dialog
		title={t('io_modal_title')}
		onClose={onClose}
	>
		<div class="io-modal-container">
			<p class="io-desc text-xs" style="margin: -6px 0 6px;">Condivisione sicura di definizioni senza esportazione di segreti o storico</p>
			<!-- Sub-tab navigazione -->
			<div class="io-tabs">
				<button
					type="button"
					class="io-tab-btn"
					class:active={activeTab === 'export'}
					onclick={() => { activeTab = 'export'; }}
				>
					<IconDownload />
					<span>Esporta</span>
				</button>
				<button
					type="button"
					class="io-tab-btn"
					class:active={activeTab === 'import'}
					onclick={() => { activeTab = 'import'; }}
				>
					<IconArrowUp />
					<span>Importa</span>
				</button>
			</div>

			<!-- Tab Esporta -->
			{#if activeTab === 'export'}
				<div class="tab-panel">
					<p class="io-desc text-xs">{t('io_export_desc')}</p>

					<div class="definitions-selection">
						<span class="selection-label text-xs font-semibold">Seleziona definizioni ({selectedIds.length}/{definitions.length}):</span>
						<div class="checkboxes-list">
							{#each definitions as def}
								<label class="def-checkbox text-xs">
									<input
										type="checkbox"
										value={def.id}
										checked={selectedIds.includes(def.id)}
										onchange={(e) => {
											const target = e.target as HTMLInputElement;
											if (target.checked) {
												selectedIds = [...selectedIds, def.id];
											} else {
												selectedIds = selectedIds.filter(id => id !== def.id);
											}
										}}
									/>
									<span class="def-name">{def.name || def.id}</span>
								</label>
							{/each}
						</div>
					</div>

					<div class="export-actions">
						<button
							type="button"
							class="ui-button ui-button-secondary text-xs"
							onclick={handleExport}
							disabled={isExporting || selectedIds.length === 0}
						>
							<IconFileCode />
							<span>{t('io_export_btn')}</span>
						</button>
					</div>

					{#if exportedJson}
						<div class="exported-preview-box">
							<div class="preview-toolbar">
								<span class="preview-title text-xs font-mono">JSON GENERATO</span>
								<div class="toolbar-btns">
									<button
										type="button"
										class="ui-button ui-button-secondary text-xs"
										onclick={copyExported}
									>
										{#if copied}
											<IconCheck />
											<span>Copiato</span>
										{:else}
											<IconCopy />
											<span>Copia</span>
										{/if}
									</button>
									<button
										type="button"
										class="ui-button ui-button-secondary text-xs"
										onclick={downloadJson}
									>
										<IconDownload />
										<span>Scarica file</span>
									</button>
								</div>
							</div>
							<textarea class="json-textarea font-mono text-xs" readonly>{exportedJson}</textarea>
						</div>
					{/if}
				</div>
			{:else}
				<!-- Tab Importa -->
				<div class="tab-panel">
					<p class="io-desc text-xs">{t('io_import_desc')}</p>

					<div class="file-picker-row">
						<label class="file-upload-label ui-button ui-button-secondary text-xs">
							<IconFileCode />
							<span>Carica file JSON</span>
							<input type="file" accept=".json" onchange={handleFileSelected} class="hidden-input" />
						</label>
						<span class="text-xs text-muted">oppure incolla il JSON qui sotto:</span>
					</div>

					<textarea
						class="json-textarea editable font-mono text-xs"
						placeholder={t('io_import_placeholder')}
						bind:value={importJson}
					></textarea>

					{#if importError}
						<div class="status-banner error text-xs">
							<IconWarning />
							<span>{importError}</span>
						</div>
					{/if}

					{#if importResultMsg}
						<div class="status-banner success text-xs">
							<IconCheck />
							<span>{importResultMsg}</span>
						</div>
					{/if}

					<div class="import-actions">
						<button
							type="button"
							class="ui-button ui-button-primary text-xs"
							onclick={handleImport}
							disabled={isImporting || !importJson.trim()}
						>
							<IconArrowUp />
							<span>{t('io_import_btn')}</span>
						</button>
					</div>
				</div>
			{/if}

			<div class="modal-footer">
				<button type="button" class="ui-button ui-button-secondary text-xs" onclick={onClose}>
					{t('btn_close')}
				</button>
			</div>
		</div>
	</Dialog>
{/if}

<style>
	.io-modal-container {
		display: flex;
		flex-direction: column;
		gap: 14px;
		min-width: 480px;
		max-width: 600px;
	}

	.io-tabs {
		display: flex;
		gap: 4px;
		border-bottom: 1px solid var(--line);
	}

	.io-tab-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 14px;
		font-size: 13px;
		font-weight: 500;
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--ink-muted);
		cursor: pointer;
		transition: all var(--dur-fast, 120ms) ease;
	}

	.io-tab-btn:hover {
		color: var(--ink);
	}

	.io-tab-btn.active {
		color: var(--brand-ink);
		border-bottom-color: var(--brand);
	}

	.tab-panel {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.io-desc {
		margin: 0;
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.definitions-selection {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px 12px;
		background: var(--bg-raised);
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
	}

	.checkboxes-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: 140px;
		overflow-y: auto;
	}

	.def-checkbox {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
		color: var(--ink);
	}

	.export-actions,
	.import-actions {
		display: flex;
		justify-content: flex-end;
	}

	.exported-preview-box {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.preview-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 10px;
		background: var(--bg-sunken);
		border-bottom: 1px solid var(--line);
	}

	.toolbar-btns {
		display: flex;
		gap: 6px;
	}

	.json-textarea {
		width: 100%;
		height: 160px;
		padding: 8px 10px;
		background: var(--bg-sunken);
		color: var(--ink);
		border: none;
		resize: vertical;
		outline: none;
		box-sizing: border-box;
	}

	.json-textarea.editable {
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-base);
	}

	.file-picker-row {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.file-upload-label {
		position: relative;
		cursor: pointer;
	}

	.hidden-input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
		pointer-events: none;
	}

	.status-banner {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border-radius: var(--radius-sm);
	}

	.status-banner.success {
		background: color-mix(in srgb, var(--success) 12%, transparent);
		color: var(--success);
	}

	.status-banner.error {
		background: color-mix(in srgb, var(--danger) 12%, transparent);
		color: var(--danger);
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		padding-top: 10px;
		border-top: 1px solid var(--line);
	}

	.text-muted {
		color: var(--ink-muted);
	}
</style>
