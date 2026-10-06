<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import {
		settingsStore,
		EDITOR_FONT_SIZE_RANGE,
		TERMINAL_FONT_SIZE_RANGE,
		SCROLLBACK_RANGE,
		TAB_SIZE_RANGE
	} from '$lib/stores/settings.svelte';
	import { projectStore } from '$lib/stores/projects.svelte';
	import { i18n } from '$lib/i18n/i18n.svelte';
	import Switch from '$lib/ui/Switch.svelte';

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
		<h4>{m.ui_settingsmodal_editor_terminale_8f5d()}</h4>
		<button type="button" class="ui-button ui-button-secondary" onclick={() => settingsStore.reset('workspace')}>{m.settings_section_reset()}</button>
	</div>

	<div class="section-block">
		<span class="block-title">{m.settings_workspace_editor_title()}</span>
		<div class="section-group">
			<div class="form-row">
				<div class="form-row-copy">
					<label for="settings-editor-fontsize" id="settings-editor-fontsize-label" class="form-row-label">{m.settings_workspace_font_size()}</label>
					<span id="settings-editor-fontsize-desc" class="form-row-desc">{m.settings_workspace_font_size_desc({ min: EDITOR_FONT_SIZE_RANGE.min, max: EDITOR_FONT_SIZE_RANGE.max })}</span>
				</div>
				<div class="form-row-control">
					<input
						id="settings-editor-fontsize"
						type="number"
						class="ui-input input-number"
						min={EDITOR_FONT_SIZE_RANGE.min}
						max={EDITOR_FONT_SIZE_RANGE.max}
						value={settingsStore.editor.fontSize}
						aria-labelledby="settings-editor-fontsize-label"
						aria-describedby="settings-editor-fontsize-desc"
						onchange={(e) => settingsStore.patchEditor({ fontSize: clamp(Number((e.currentTarget as HTMLInputElement).value), EDITOR_FONT_SIZE_RANGE.min, EDITOR_FONT_SIZE_RANGE.max, settingsStore.editor.fontSize) })}
					/>
				</div>
			</div>
			<div class="form-row">
				<div class="form-row-copy">
					<label for="settings-editor-fontfamily" id="settings-editor-fontfamily-label" class="form-row-label">{m.settings_workspace_font_family()}</label>
					<span id="settings-editor-fontfamily-desc" class="form-row-desc">{m.settings_workspace_font_family_desc()}</span>
				</div>
				<div class="form-row-control">
					<input
						id="settings-editor-fontfamily"
						type="text"
						class="ui-input input-text"
						placeholder={m.settings_workspace_font_family_placeholder()}
						value={settingsStore.editor.fontFamily}
						aria-labelledby="settings-editor-fontfamily-label"
						aria-describedby="settings-editor-fontfamily-desc"
						onchange={(e) => settingsStore.patchEditor({ fontFamily: (e.currentTarget as HTMLInputElement).value })}
					/>
				</div>
			</div>
			<div class="form-row">
				<div class="form-row-copy">
					<span id="settings-editor-minimap-label" class="form-row-label">{m.settings_workspace_minimap()}</span>
					<span id="settings-editor-minimap-desc" class="form-row-desc">{m.ui_workspacesection_mostra_la_mappa_in_miniatura_del_file_256f()}</span>
				</div>
				<div class="form-row-control">
					<Switch
						id="settings-editor-minimap"
						checked={settingsStore.editor.minimap}
						ariaLabelledBy="settings-editor-minimap-label"
						ariaDescribedBy="settings-editor-minimap-desc"
						onChange={(checked) => settingsStore.patchEditor({ minimap: checked })}
					/>
				</div>
			</div>
			<div class="form-row">
				<div class="form-row-copy">
					<span id="settings-editor-wordwrap-label" class="form-row-label">{m.settings_workspace_word_wrap()}</span>
					<span id="settings-editor-wordwrap-desc" class="form-row-desc">{m.settings_workspace_word_wrap_desc()}</span>
				</div>
				<div class="form-row-control">
					<Switch
						id="settings-editor-wordwrap"
						checked={settingsStore.editor.wordWrap}
						ariaLabelledBy="settings-editor-wordwrap-label"
						ariaDescribedBy="settings-editor-wordwrap-desc"
						onChange={(checked) => settingsStore.patchEditor({ wordWrap: checked })}
					/>
				</div>
			</div>
			<div class="form-row">
				<div class="form-row-copy">
					<label for="settings-editor-tabsize" id="settings-editor-tabsize-label" class="form-row-label">{m.settings_workspace_tab_size()}</label>
					<span id="settings-editor-tabsize-desc" class="form-row-desc">{m.settings_workspace_tab_size_desc({ min: TAB_SIZE_RANGE.min, max: TAB_SIZE_RANGE.max })}</span>
				</div>
				<div class="form-row-control">
					<input
						id="settings-editor-tabsize"
						type="number"
						class="ui-input input-number"
						min={TAB_SIZE_RANGE.min}
						max={TAB_SIZE_RANGE.max}
						value={settingsStore.editor.tabSize}
						aria-labelledby="settings-editor-tabsize-label"
						aria-describedby="settings-editor-tabsize-desc"
						onchange={(e) => settingsStore.patchEditor({ tabSize: clamp(Number((e.currentTarget as HTMLInputElement).value), TAB_SIZE_RANGE.min, TAB_SIZE_RANGE.max, settingsStore.editor.tabSize) })}
					/>
				</div>
			</div>
			<div class="form-row">
				<div class="form-row-copy">
					<span id="settings-editor-linenumbers-label" class="form-row-label">{m.settings_workspace_line_numbers()}</span>
					<span id="settings-editor-linenumbers-desc" class="form-row-desc">{m.ui_workspacesection_mostra_la_numerazione_delle_righe_sul_bordo_7bb2()}</span>
				</div>
				<div class="form-row-control">
					<Switch
						id="settings-editor-linenumbers"
						checked={settingsStore.editor.lineNumbers}
						ariaLabelledBy="settings-editor-linenumbers-label"
						ariaDescribedBy="settings-editor-linenumbers-desc"
						onChange={(checked) => settingsStore.patchEditor({ lineNumbers: checked })}
					/>
				</div>
			</div>
		</div>
	</div>

	<div class="section-block">
		<span class="block-title">{m.settings_general_terminal()}</span>
		<div class="section-group">
			<div class="form-row">
				<div class="form-row-copy">
					<label for="settings-terminal-fontsize" id="settings-terminal-fontsize-label" class="form-row-label">{m.settings_workspace_font_size()}</label>
					<span id="settings-terminal-fontsize-desc" class="form-row-desc">{m.settings_workspace_font_size_desc({ min: TERMINAL_FONT_SIZE_RANGE.min, max: TERMINAL_FONT_SIZE_RANGE.max })}</span>
				</div>
				<div class="form-row-control">
					<input
						id="settings-terminal-fontsize"
						type="number"
						class="ui-input input-number"
						min={TERMINAL_FONT_SIZE_RANGE.min}
						max={TERMINAL_FONT_SIZE_RANGE.max}
						value={settingsStore.terminal.fontSize}
						aria-labelledby="settings-terminal-fontsize-label"
						aria-describedby="settings-terminal-fontsize-desc"
						onchange={(e) => settingsStore.patchTerminal({ fontSize: clamp(Number((e.currentTarget as HTMLInputElement).value), TERMINAL_FONT_SIZE_RANGE.min, TERMINAL_FONT_SIZE_RANGE.max, settingsStore.terminal.fontSize) })}
					/>
				</div>
			</div>
			<div class="form-row">
				<div class="form-row-copy">
					<label for="settings-terminal-fontfamily" id="settings-terminal-fontfamily-label" class="form-row-label">{m.settings_workspace_font_family()}</label>
					<span id="settings-terminal-fontfamily-desc" class="form-row-desc">{m.settings_workspace_font_family_desc()}</span>
				</div>
				<div class="form-row-control">
					<input
						id="settings-terminal-fontfamily"
						type="text"
						class="ui-input input-text"
						placeholder={m.settings_workspace_font_family_placeholder()}
						value={settingsStore.terminal.fontFamily}
						aria-labelledby="settings-terminal-fontfamily-label"
						aria-describedby="settings-terminal-fontfamily-desc"
						onchange={(e) => settingsStore.patchTerminal({ fontFamily: (e.currentTarget as HTMLInputElement).value })}
					/>
				</div>
			</div>
			<div class="form-row">
				<div class="form-row-copy">
					<label for="settings-terminal-scrollback" id="settings-terminal-scrollback-label" class="form-row-label">{m.settings_workspace_scrollback()}</label>
					<span id="settings-terminal-scrollback-desc" class="form-row-desc">{m.settings_workspace_scrollback_desc({ min: i18n.formatNumber(SCROLLBACK_RANGE.min), max: i18n.formatNumber(SCROLLBACK_RANGE.max) })}</span>
				</div>
				<div class="form-row-control">
					<input
						id="settings-terminal-scrollback"
						type="number"
						class="ui-input input-number"
						min={SCROLLBACK_RANGE.min}
						max={SCROLLBACK_RANGE.max}
						step="1000"
						value={settingsStore.terminal.scrollback}
						aria-labelledby="settings-terminal-scrollback-label"
						aria-describedby="settings-terminal-scrollback-desc"
						onchange={(e) => settingsStore.patchTerminal({ scrollback: clamp(Number((e.currentTarget as HTMLInputElement).value), SCROLLBACK_RANGE.min, SCROLLBACK_RANGE.max, settingsStore.terminal.scrollback) })}
					/>
				</div>
			</div>
			<div class="form-row">
				<div class="form-row-copy">
					<span id="settings-terminal-bell-label" class="form-row-label">{m.settings_workspace_bell()}</span>
					<span id="settings-terminal-bell-desc" class="form-row-desc">{m.settings_workspace_bell_desc()}</span>
				</div>
				<div class="form-row-control">
					<Switch
						id="settings-terminal-bell"
						checked={settingsStore.terminal.bell}
						ariaLabelledBy="settings-terminal-bell-label"
						ariaDescribedBy="settings-terminal-bell-desc"
						onChange={(checked) => settingsStore.patchTerminal({ bell: checked })}
					/>
				</div>
			</div>
			<div class="form-row">
				<div class="form-row-copy">
					<span id="settings-terminal-cursorblink-label" class="form-row-label">{m.settings_workspace_cursor_blink()}</span>
					<span id="settings-terminal-cursorblink-desc" class="form-row-desc">{m.ui_workspacesection_il_cursore_del_terminale_lampeggia_invece_di_0335()}</span>
				</div>
				<div class="form-row-control">
					<Switch
						id="settings-terminal-cursorblink"
						checked={settingsStore.terminal.cursorBlink}
						ariaLabelledBy="settings-terminal-cursorblink-label"
						ariaDescribedBy="settings-terminal-cursorblink-desc"
						onChange={(checked) => settingsStore.patchTerminal({ cursorBlink: checked })}
					/>
				</div>
			</div>
		</div>
	</div>

	<!-- Origini Browser autorizzate (S43) -->
	<div class="section-block">
		<span class="block-title">{m.settings_workspace_origins_title()}</span>
		<div class="section-group">
			{#if activeProject}
				{@const allowedOrigins = projectStore.getBrowserAllowedOrigins(activeProject.id)}
				{#if allowedOrigins.length === 0}
					<div class="form-row">
						<div class="form-row-copy">
							<span class="form-row-label">{m.settings_workspace_origins_none()}</span>
							<span class="form-row-desc">
								{m.settings_workspace_origins_local_before()}<code>localhost</code>, <code>127.0.0.1</code>{m.settings_workspace_origins_local_after()}
							</span>
						</div>
					</div>
				{:else}
					{#each allowedOrigins as origin}
						<div class="form-row">
							<div class="form-row-copy">
								<span class="form-row-label"><code>{origin}</code></span>
								<span class="form-row-desc">{m.settings_workspace_origin_allowed_for({ name: activeProject.name })}</span>
							</div>
							<div class="form-row-control">
								<button
									type="button"
									class="ui-button ui-button-ghost btn-revoke-origin"
									onclick={() => projectStore.revokeBrowserOrigin(activeProject.id, origin)}
								>
									{m.settings_workspace_origin_revoke()}
								</button>
							</div>
						</div>
					{/each}
				{/if}
			{:else}
				<div class="form-row">
					<div class="form-row-copy">
						<span class="form-row-label">{m.settings_workspace_no_active_project()}</span>
						<span class="form-row-desc">{m.ui_workspacesection_seleziona_un_progetto_per_visualizzare_e_gestire_6b13()}</span>
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
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
		text-transform: none;
		letter-spacing: normal;
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
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink);
	}

	.form-row-desc {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.form-row-control {
		flex-shrink: 0;
	}

	.input-number {
		width: 90px;
		font-variant-numeric: tabular-nums;
	}

	.input-text {
		width: 240px;
	}

	.btn-revoke-origin:hover:not(:disabled) {
		color: var(--danger);
		background: color-mix(in oklab, var(--danger) 10%, transparent);
	}
</style>
