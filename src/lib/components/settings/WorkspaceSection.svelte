<script lang="ts">
	import {
		settingsStore,
		EDITOR_FONT_SIZE_RANGE,
		TERMINAL_FONT_SIZE_RANGE,
		SCROLLBACK_RANGE,
		TAB_SIZE_RANGE
	} from '$lib/stores/settings.svelte';
	import { projectStore } from '$lib/stores/projects.svelte';

	const activeProject = $derived(projectStore.projects.find((p) => p.id === projectStore.activeId) ?? null);

	// L'input numero permette di digitare fuori range mentre si scrive: il
	// valore va riportato dentro i limiti solo al commit, non a ogni tasto.
	function clamp(value: number, min: number, max: number, fallback: number): number {
		if (!Number.isFinite(value)) return fallback;
		return Math.min(max, Math.max(min, Math.round(value)));
	}
</script>

<div class="settings-section">
	<div class="section-header">
		<h4>Editor & Terminale</h4>
		<button type="button" class="btn btn-secondary" onclick={() => settingsStore.reset('workspace')}>Ripristina</button>
	</div>

	<div class="section-block">
		<span class="block-title">Editor</span>
		<div class="section-group">
			<div class="form-row">
				<div class="form-row-copy">
					<span class="form-row-label">Dimensione carattere</span>
					<span class="form-row-desc">In punti, da {EDITOR_FONT_SIZE_RANGE.min} a {EDITOR_FONT_SIZE_RANGE.max}.</span>
				</div>
				<div class="form-row-control">
					<input
						type="number"
						min={EDITOR_FONT_SIZE_RANGE.min}
						max={EDITOR_FONT_SIZE_RANGE.max}
						value={settingsStore.editor.fontSize}
						onchange={(e) => settingsStore.patchEditor({ fontSize: clamp(Number((e.currentTarget as HTMLInputElement).value), EDITOR_FONT_SIZE_RANGE.min, EDITOR_FONT_SIZE_RANGE.max, settingsStore.editor.fontSize) })}
					/>
				</div>
			</div>

			<div class="form-row">
				<div class="form-row-copy">
					<span class="form-row-label">Famiglia carattere</span>
					<span class="form-row-desc">Va in testa allo stack predefinito, che resta come riserva per le glifi Nerd Font.</span>
				</div>
				<div class="form-row-control">
					<input
						type="text"
						placeholder="Predefinito (Nerd Font)"
						value={settingsStore.editor.fontFamily}
						onchange={(e) => settingsStore.patchEditor({ fontFamily: (e.currentTarget as HTMLInputElement).value })}
					/>
				</div>
			</div>

			<div class="form-row">
				<div class="form-row-copy">
					<span class="form-row-label">Minimappa</span>
					<span class="form-row-desc">Mostra la mappa in miniatura del file sul lato destro dell'editor.</span>
				</div>
				<div class="form-row-control">
					<label class="switch">
						<input
							type="checkbox"
							checked={settingsStore.editor.minimap}
							onchange={(e) => settingsStore.patchEditor({ minimap: (e.currentTarget as HTMLInputElement).checked })}
						/>
						<span class="slider"></span>
					</label>
				</div>
			</div>

			<div class="form-row">
				<div class="form-row-copy">
					<span class="form-row-label">A capo automatico</span>
					<span class="form-row-desc">Le righe troppo lunghe vanno a capo invece di scorrere in orizzontale.</span>
				</div>
				<div class="form-row-control">
					<label class="switch">
						<input
							type="checkbox"
							checked={settingsStore.editor.wordWrap}
							onchange={(e) => settingsStore.patchEditor({ wordWrap: (e.currentTarget as HTMLInputElement).checked })}
						/>
						<span class="slider"></span>
					</label>
				</div>
			</div>

			<div class="form-row">
				<div class="form-row-copy">
					<span class="form-row-label">Larghezza tab</span>
					<span class="form-row-desc">Spazi equivalenti a un tab, da {TAB_SIZE_RANGE.min} a {TAB_SIZE_RANGE.max}.</span>
				</div>
				<div class="form-row-control">
					<input
						type="number"
						min={TAB_SIZE_RANGE.min}
						max={TAB_SIZE_RANGE.max}
						value={settingsStore.editor.tabSize}
						onchange={(e) => settingsStore.patchEditor({ tabSize: clamp(Number((e.currentTarget as HTMLInputElement).value), TAB_SIZE_RANGE.min, TAB_SIZE_RANGE.max, settingsStore.editor.tabSize) })}
					/>
				</div>
			</div>

			<div class="form-row">
				<div class="form-row-copy">
					<span class="form-row-label">Numeri di riga</span>
					<span class="form-row-desc">Mostra la numerazione delle righe sul bordo sinistro.</span>
				</div>
				<div class="form-row-control">
					<label class="switch">
						<input
							type="checkbox"
							checked={settingsStore.editor.lineNumbers}
							onchange={(e) => settingsStore.patchEditor({ lineNumbers: (e.currentTarget as HTMLInputElement).checked })}
						/>
						<span class="slider"></span>
					</label>
				</div>
			</div>
		</div>
	</div>

	<div class="section-block">
		<span class="block-title">Terminale</span>
		<div class="section-group">
			<div class="form-row">
				<div class="form-row-copy">
					<span class="form-row-label">Dimensione carattere</span>
					<span class="form-row-desc">In punti, da {TERMINAL_FONT_SIZE_RANGE.min} a {TERMINAL_FONT_SIZE_RANGE.max}.</span>
				</div>
				<div class="form-row-control">
					<input
						type="number"
						min={TERMINAL_FONT_SIZE_RANGE.min}
						max={TERMINAL_FONT_SIZE_RANGE.max}
						value={settingsStore.terminal.fontSize}
						onchange={(e) => settingsStore.patchTerminal({ fontSize: clamp(Number((e.currentTarget as HTMLInputElement).value), TERMINAL_FONT_SIZE_RANGE.min, TERMINAL_FONT_SIZE_RANGE.max, settingsStore.terminal.fontSize) })}
					/>
				</div>
			</div>

			<div class="form-row">
				<div class="form-row-copy">
					<span class="form-row-label">Famiglia carattere</span>
					<span class="form-row-desc">Va in testa allo stack predefinito, che resta come riserva per le glifi Nerd Font.</span>
				</div>
				<div class="form-row-control">
					<input
						type="text"
						placeholder="Predefinito (Nerd Font)"
						value={settingsStore.terminal.fontFamily}
						onchange={(e) => settingsStore.patchTerminal({ fontFamily: (e.currentTarget as HTMLInputElement).value })}
					/>
				</div>
			</div>

			<div class="form-row">
				<div class="form-row-copy">
					<span class="form-row-label">Scrollback</span>
					<span class="form-row-desc">Righe di cronologia tenute in memoria, da {SCROLLBACK_RANGE.min.toLocaleString('it-IT')} a {SCROLLBACK_RANGE.max.toLocaleString('it-IT')}.</span>
				</div>
				<div class="form-row-control">
					<input
						type="number"
						min={SCROLLBACK_RANGE.min}
						max={SCROLLBACK_RANGE.max}
						step="1000"
						value={settingsStore.terminal.scrollback}
						onchange={(e) => settingsStore.patchTerminal({ scrollback: clamp(Number((e.currentTarget as HTMLInputElement).value), SCROLLBACK_RANGE.min, SCROLLBACK_RANGE.max, settingsStore.terminal.scrollback) })}
					/>
				</div>
			</div>

			<div class="form-row">
				<div class="form-row-copy">
					<span class="form-row-label">Campanello</span>
					<span class="form-row-desc">Fa suonare il campanello sonoro quando `omp` lo emette.</span>
				</div>
				<div class="form-row-control">
					<label class="switch">
						<input
							type="checkbox"
							checked={settingsStore.terminal.bell}
							onchange={(e) => settingsStore.patchTerminal({ bell: (e.currentTarget as HTMLInputElement).checked })}
						/>
						<span class="slider"></span>
					</label>
				</div>
			</div>

			<div class="form-row">
				<div class="form-row-copy">
					<span class="form-row-label">Cursore lampeggiante</span>
					<span class="form-row-desc">Il cursore del terminale lampeggia invece di restare fisso.</span>
				</div>
				<div class="form-row-control">
					<label class="switch">
						<input
							type="checkbox"
							checked={settingsStore.terminal.cursorBlink}
							onchange={(e) => settingsStore.patchTerminal({ cursorBlink: (e.currentTarget as HTMLInputElement).checked })}
						/>
						<span class="slider"></span>
					</label>
				</div>
			</div>
		</div>
	</div>

	<!-- Origini Browser autorizzate (S43) -->
	<div class="section-block">
		<span class="block-title">Origini Browser autorizzate</span>
		<div class="section-group">
			{#if activeProject}
				{@const allowedOrigins = projectStore.getBrowserAllowedOrigins(activeProject.id)}
				{#if allowedOrigins.length === 0}
					<div class="form-row">
						<div class="form-row-copy">
							<span class="form-row-label">Nessuna origine remota autorizzata</span>
							<span class="form-row-desc">
								Le origini locali (<code>localhost</code>, <code>127.0.0.1</code>) sono consentite automaticamente. Le origini remote richiedono consenso preventivo.
							</span>
						</div>
					</div>
				{:else}
					{#each allowedOrigins as origin}
						<div class="form-row">
							<div class="form-row-copy">
								<span class="form-row-label"><code>{origin}</code></span>
								<span class="form-row-desc">Origine remota autorizzata per il progetto {activeProject.name}.</span>
							</div>
							<div class="form-row-control">
								<button
									type="button"
									class="btn-revoke-origin"
									onclick={() => projectStore.revokeBrowserOrigin(activeProject.id, origin)}
									title="Revoca immediatamente l'accesso a questa origine"
								>
									Revoca
								</button>
							</div>
						</div>
					{/each}
				{/if}
			{:else}
				<div class="form-row">
					<div class="form-row-copy">
						<span class="form-row-label">Nessun progetto attivo</span>
						<span class="form-row-desc">Seleziona un progetto per visualizzare e gestire le origini browser autorizzate.</span>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.settings-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.section-header h4 {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.section-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.block-title {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink-faint);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.section-group {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
		overflow: hidden;
	}

	.form-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-3);
		border-bottom: 1px solid var(--line);
	}

	.form-row:last-child {
		border-bottom: none;
	}

	.form-row-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.form-row-label {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink);
	}

	.form-row-desc {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.form-row-control {
		flex-shrink: 0;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 6px 14px;
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: 500;
		font-family: var(--font-ui);
		cursor: pointer;
		border: 1px solid transparent;
		transition: background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast);
	}

	.btn-secondary {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line);
	}

	.btn-secondary:hover {
		background: var(--bg-active);
		border-color: var(--line-strong);
	}

	input[type='number'],
	input[type='text'] {
		height: 30px;
		padding: 0 var(--space-2);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		outline: none;
		transition: border-color var(--dur-fast);
	}

	input[type='number'] {
		width: 90px;
	}

	input[type='text'] {
		width: 240px;
	}

	input[type='number']:focus,
	input[type='text']:focus {
		border-color: var(--brand);
	}

	.switch {
		position: relative;
		display: inline-block;
		width: 32px;
		height: 18px;
		cursor: pointer;
	}

	.switch input {
		opacity: 0;
		width: 0;
		height: 0;
	}

	.slider {
		position: absolute;
		inset: 0;
		background: var(--bg-hover);
		border: 1px solid var(--line);
		border-radius: var(--radius-full);
		transition: background var(--dur-fast), border-color var(--dur-fast);
	}

	.slider::before {
		position: absolute;
		content: '';
		height: 12px;
		width: 12px;
		left: 2px;
		bottom: 2px;
		background: var(--ink-muted);
		border-radius: 50%;
		transition: transform var(--dur-fast), background var(--dur-fast);
	}

	input:checked + .slider {
		background: var(--brand);
		border-color: var(--brand);
	}

	input:checked + .slider::before {
		transform: translateX(14px);
		background: var(--bg-sunken);
	}

	input:focus-visible + .slider {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}

	.btn-revoke-origin {
		height: 24px;
		padding: 0 var(--space-2);
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--danger, #dc2626);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		cursor: pointer;
		transition: all var(--dur-fast);
	}

	.btn-revoke-origin:hover {
		background: var(--danger-dim, rgba(239, 68, 68, 0.1));
		border-color: rgba(239, 68, 68, 0.4);
	}
</style>
