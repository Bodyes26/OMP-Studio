<script lang="ts">
	import {
		IconWarning,
		IconRefresh,
		IconCheck,
		IconClose,
		IconFile,
		IconDiff,
		IconLock,
		IconContextWindow
	} from '$lib/icons';
	import type { LabContextSnapshot, LabContextFile } from './contracts';
	import type { LabContextDriftReport, LabContextFileDrift } from './context';

	let {
		snapshot,
		driftReport,
		isLoading = false,
		onRefreshContext,
		onCheckDrift,
		onSelectFile
	}: {
		snapshot: LabContextSnapshot | null;
		driftReport?: LabContextDriftReport | null;
		isLoading?: boolean;
		onRefreshContext?: () => Promise<void> | void;
		onCheckDrift?: () => Promise<void> | void;
		onSelectFile?: (path: string) => void;
	} = $props();

	let updating = $state(false);
	let checkMessage = $state<string | null>(null);

	async function handleUpdateClick() {
		if (!onRefreshContext || updating) return;
		updating = true;
		try {
			await onRefreshContext();
			checkMessage = 'Contesto aggiornato con successo alla versione corrente del progetto.';
			setTimeout(() => {
				checkMessage = null;
			}, 4000);
		} catch (err) {
			console.error('Errore aggiornamento contesto:', err);
		} finally {
			updating = false;
		}
	}

	async function handleCheckClick() {
		if (!onCheckDrift || updating) return;
		try {
			await onCheckDrift();
		} catch (err) {
			console.error('Errore controllo drift contesto:', err);
		}
	}

	function formatDate(ts: number): string {
		return new Date(ts).toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}

	function shortFp(fp: string): string {
		return fp.replace('sha256:', '').slice(0, 10);
	}
</script>

<div class="lab-context-panel" role="region" aria-label="Contesto stabile del progetto">
	<header class="panel-header">
		<div class="title-row">
			<IconContextWindow />
			<h3>Contesto stabile del progetto</h3>
		</div>
		<div class="header-actions">
			{#if onCheckDrift}
				<button
					type="button"
					class="btn-action"
					onclick={handleCheckClick}
					disabled={isLoading || updating}
					title="Controlla se i file del progetto sono stati modificati nel working tree"
				>
					<IconRefresh />
					<span>Verifica modifiche</span>
				</button>
			{/if}
		</div>
	</header>

	{#if checkMessage}
		<div class="success-banner" role="status">
			<IconCheck />
			<span>{checkMessage}</span>
		</div>
	{/if}

	{#if !snapshot}
		<div class="empty-state">
			<p>Nessun contesto di progetto acquisito per questo prototipo.</p>
			<p class="subtext">
				Il Laboratorio puo acquisire file mirati del progetto in una versione stabile e congelata.
			</p>
		</div>
	{:else}
		<!-- 1. Scheda riassuntiva snapshot -->
		<div class="snapshot-card">
			<div class="card-meta">
				<span class="meta-item">
					<strong>ID:</strong> <code class="snapshot-id">{snapshot.id}</code>
				</span>
				<span class="meta-item">
					<strong>Acquisito alle:</strong> {formatDate(snapshot.capturedAt)}
				</span>
				<span class="meta-item">
					<strong>File:</strong> {snapshot.files.length}
				</span>
			</div>

			<div class="coherence-badge" class:coherent={snapshot.coherent} class:incoherent={!snapshot.coherent}>
				{#if snapshot.coherent}
					<IconCheck />
					<span>Fotografia coerente</span>
				{:else}
					<IconWarning />
					<span>Fotografia non atomica (modifiche concorrenti durante l'acquisizione)</span>
				{/if}
			</div>
		</div>

		<!-- 2. Avviso deriva / file cambiati nel progetto -->
		{#if driftReport && driftReport.hasChanges}
			<div class="drift-alert" role="alert">
				<div class="drift-header">
					<IconWarning />
					<div class="drift-text">
						<strong>File modificati nel progetto</strong>
						<p>
							I seguenti {driftReport.changedPaths.length} file acquisiti sono stati modificati o rimossi nel working tree del progetto:
						</p>
					</div>
				</div>

				<ul class="changed-list">
					{#each driftReport.details.filter((d) => d.status !== 'unchanged') as item (item.path)}
						<li class="changed-item">
							<code class="file-path">{item.path}</code>
							{#if item.status === 'modified'}
								<span class="status-badge modified">Modificato</span>
							{:else if item.status === 'deleted'}
								<span class="status-badge deleted">Eliminato</span>
							{/if}
						</li>
					{/each}
				</ul>

				<div class="drift-actions">
					<button
						type="button"
						class="btn-update-context"
						onclick={handleUpdateClick}
						disabled={updating}
					>
						{#if updating}
							<IconRefresh />
							<span>Aggiornamento in corso...</span>
						{:else}
							<IconRefresh />
							<span>Aggiorna contesto adesso</span>
						{/if}
					</button>
					<span class="drift-note">
						L'aggiornamento congela la nuova versione dei file del progetto. Il codice del prototipo non viene rigenerato.
					</span>
				</div>
			</div>
		{/if}

		<!-- 3. Tabella / elenco dei file acquisiti -->
		<div class="files-container">
			<div class="files-header">
				<span>File acquisiti ({snapshot.files.length})</span>
				<span class="files-sub">I tool di contesto leggono questa versione stabile</span>
			</div>

			<div class="files-list" role="list">
				{#each snapshot.files as file (file.path)}
					{@const drift = driftReport?.details.find((d) => d.path === file.path)}
					{#if onSelectFile}
						<button
							type="button"
							class="file-row clickable"
							onclick={() => onSelectFile?.(file.path)}
						>
							<div class="file-main">
								<IconFile />
								<span class="file-name" title={file.path}>{file.path}</span>
							</div>

							<div class="file-badges">
								<span class="origin-badge" title="Provenienza materiale">{file.origin}</span>
								<span class="fp-badge" title="Impronta crittografica SHA-256">
									{shortFp(file.fingerprint)}
								</span>

								{#if drift}
									{#if drift.status === 'unchanged'}
										<span class="status-badge unchanged" title="Invariato rispetto al progetto">Stabile</span>
									{:else if drift.status === 'modified'}
										<span class="status-badge modified" title="Modificato nel working tree del progetto">Modificato</span>
									{:else if drift.status === 'deleted'}
										<span class="status-badge deleted" title="Eliminato nel working tree del progetto">Rimosso</span>
									{/if}
								{/if}
							</div>
						</button>
					{:else}
						<div class="file-row" role="listitem">
							<div class="file-main">
								<IconFile />
								<span class="file-name" title={file.path}>{file.path}</span>
							</div>

							<div class="file-badges">
								<span class="origin-badge" title="Provenienza materiale">{file.origin}</span>
								<span class="fp-badge" title="Impronta crittografica SHA-256">
									{shortFp(file.fingerprint)}
								</span>

								{#if drift}
									{#if drift.status === 'unchanged'}
										<span class="status-badge unchanged" title="Invariato rispetto al progetto">Stabile</span>
									{:else if drift.status === 'modified'}
										<span class="status-badge modified" title="Modificato nel working tree del progetto">Modificato</span>
									{:else if drift.status === 'deleted'}
										<span class="status-badge deleted" title="Eliminato nel working tree del progetto">Rimosso</span>
									{/if}
								{/if}
							</div>
						</div>
					{/if}
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.lab-context-panel {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 14px;
		background: var(--bg-surface, #1e1e1e);
		border: 1px solid var(--border, #333);
		border-radius: 6px;
		color: var(--text-main, #eee);
		font-family: var(--font-sans, system-ui, sans-serif);
		font-size: 13px;
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding-bottom: 8px;
		border-bottom: 1px solid var(--border, #333);
	}

	.title-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.title-row h3 {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
	}

	.btn-action {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		background: transparent;
		border: 1px solid var(--border, #444);
		border-radius: 4px;
		color: var(--text-main, #eee);
		font-size: 12px;
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.btn-action:hover:not(:disabled) {
		background: var(--bg-inset, #2a2a2a);
	}

	.btn-action:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.success-banner {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		background: rgba(34, 197, 94, 0.15);
		border: 1px solid rgba(34, 197, 94, 0.4);
		border-radius: 4px;
		color: #4ade80;
		font-size: 12px;
	}

	.empty-state {
		padding: 24px;
		text-align: center;
		color: var(--text-muted, #888);
	}

	.empty-state p {
		margin: 4px 0;
	}

	.subtext {
		font-size: 11px;
	}

	.snapshot-card {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 10px 12px;
		background: var(--bg-inset, #141414);
		border: 1px solid var(--border, #2a2a2a);
		border-radius: 4px;
	}

	.card-meta {
		display: flex;
		gap: 16px;
		font-size: 12px;
		color: var(--text-muted, #aaa);
	}

	.snapshot-id {
		font-family: var(--font-mono, monospace);
		color: var(--text-main, #fff);
	}

	.coherence-badge {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 8px;
		border-radius: 12px;
		font-size: 11px;
		font-weight: 500;
	}

	.coherence-badge.coherent {
		background: rgba(34, 197, 94, 0.15);
		color: #4ade80;
		border: 1px solid rgba(34, 197, 94, 0.3);
	}

	.coherence-badge.incoherent {
		background: rgba(239, 68, 68, 0.15);
		color: #f87171;
		border: 1px solid rgba(239, 68, 68, 0.3);
	}

	.drift-alert {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px;
		background: rgba(245, 158, 11, 0.1);
		border: 1px solid rgba(245, 158, 11, 0.35);
		border-radius: 6px;
	}

	.drift-header {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		color: #fbbf24;
	}

	.drift-text strong {
		display: block;
		font-size: 13px;
	}

	.drift-text p {
		margin: 2px 0 0 0;
		font-size: 12px;
		color: var(--text-main, #eee);
	}

	.changed-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.changed-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 4px 8px;
		background: rgba(0, 0, 0, 0.2);
		border-radius: 4px;
	}

	.file-path {
		font-family: var(--font-mono, monospace);
		font-size: 11px;
	}

	.drift-actions {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 4px;
	}

	.btn-update-context {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 14px;
		background: var(--accent, #3b82f6);
		color: #fff;
		border: none;
		border-radius: 4px;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition: opacity 0.15s ease;
	}

	.btn-update-context:hover:not(:disabled) {
		opacity: 0.9;
	}

	.btn-update-context:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.drift-note {
		font-size: 11px;
		color: var(--text-muted, #999);
	}

	.files-container {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.files-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 12px;
		font-weight: 600;
	}

	.files-sub {
		font-size: 11px;
		font-weight: 400;
		color: var(--text-muted, #888);
	}

	.files-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-height: 320px;
		overflow-y: auto;
	}

	.file-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		width: 100%;
		padding: 6px 10px;
		background: var(--bg-inset, #181818);
		border: 1px solid var(--border, #282828);
		border-radius: 4px;
		color: inherit;
		font-family: inherit;
		font-size: inherit;
		text-align: left;
		transition: background 0.15s ease;
	}

	.file-row.clickable {
		cursor: pointer;
	}

	.file-row.clickable:hover {
		background: var(--bg-surface-hover, #242424);
	}

	.file-main {
		display: flex;
		align-items: center;
		gap: 8px;
		overflow: hidden;
	}

	.file-name {
		font-family: var(--font-mono, monospace);
		font-size: 12px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.file-badges {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	.origin-badge {
		padding: 2px 6px;
		background: rgba(255, 255, 255, 0.08);
		border-radius: 10px;
		font-size: 10px;
		color: var(--text-muted, #aaa);
	}

	.fp-badge {
		font-family: var(--font-mono, monospace);
		font-size: 10px;
		color: var(--text-muted, #777);
	}

	.status-badge {
		padding: 2px 6px;
		border-radius: 10px;
		font-size: 10px;
		font-weight: 500;
	}

	.status-badge.unchanged {
		background: rgba(34, 197, 94, 0.15);
		color: #4ade80;
	}

	.status-badge.modified {
		background: rgba(245, 158, 11, 0.15);
		color: #fbbf24;
	}

	.status-badge.deleted {
		background: rgba(239, 68, 68, 0.15);
		color: #f87171;
	}
</style>
