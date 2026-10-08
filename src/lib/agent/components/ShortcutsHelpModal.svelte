<script lang="ts">
	/**
	 * ShortcutsHelpModal — Guida completa alle scorciatoie da tastiera (Design v2).
	 * Usa la primitiva Dialog accessibile con testata, ricerca rapida e top-layer.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import Dialog from '$lib/ui/Dialog.svelte';
	import { shortcutsModalStore } from '$lib/stores/shortcutsModal.svelte';
	import { IconClose, IconKeyboard, IconSearch } from '$lib/icons';
	import { IS_MAC } from '$lib/utils/platform';
	import { letterChordLabel } from '$lib/agent/composerShortcuts';

	// Scorciatoie a lettera del composer: Alt su Windows/Linux, Ctrl+Opzione su
	// Mac, dove Opzione da sola scrive caratteri (€ ç ñ).
	const L = letterChordLabel(IS_MAC);

	// Props con supporto fallback per retrocompatibilita'
	let {
		open,
		onClose
	} = $props<{
		open?: boolean;
		onClose?: () => void;
	}>();

	// Se open/onClose non sono passati, usiamo shortcutsModalStore come fonte di verita'
	const isControlled = $derived(open !== undefined);
	const isOpen = $derived(isControlled ? !!open : shortcutsModalStore.isOpen);

	function handleClose() {
		if (onClose) {
			onClose();
		} else {
			shortcutsModalStore.close();
		}
	}

	let searchQuery = $state('');

	interface ShortcutItem {
		keys: string[];
		description: string;
		note?: string;
	}

	interface ShortcutCategory {
		id: string;
		title: string;
		column: 1 | 2;
		items: ShortcutItem[];
	}

	const categories = $derived.by((): ShortcutCategory[] => [
		{
			id: 'models-roles',
			title: m.shortcuts_cat_models(),
			column: 1,
			items: [
				{ keys: ['Ctrl+P'], description: m.shortcuts_item_cycle_roles() },
				{ keys: [`${L}+R`], description: m.shortcuts_item_role_menu() },
				{ keys: [`${L}+P`], description: m.shortcuts_item_model_menu() },
				{ keys: [`${L}+M`], description: m.shortcuts_item_thinking_menu() },
				{ keys: [`${L}+T`], description: m.shortcuts_item_thinking_cycle() },
			]
		},
		{
			id: 'composer-chat',
			title: m.shortcuts_cat_composer(),
			column: 1,
			items: [
				{ keys: [IS_MAC ? '⌘B' : 'Ctrl+B'], description: m.shortcuts_item_btw() },
				{ keys: [`${L}+Shift+P`], description: m.shortcuts_item_plan() },
				{ keys: ['Invio'], description: m.ui_shortcutshelpmodal_invia_il_messaggio_o_seleziona_il_comando_af10() },
				{ keys: ['Alt+Invio'], description: m.ui_shortcutshelpmodal_invia_con_la_modalita_di_accodamento_alternativa_4022() },
				{ keys: ['Shift+Invio', 'Ctrl+Invio'], description: m.ui_shortcutshelpmodal_inserisce_una_nuova_riga_nel_campo_di_6250() },
				{ keys: ['/'], description: m.shortcuts_item_slash_palette() },
				{ keys: [`${L}+1…6`], description: m.ui_shortcutshelpmodal_precompila_il_composer_con_il_suggerimento_in_f5fb() },
				{ keys: [`${L}+E`], description: m.shortcuts_item_focus_composer() },
				{ keys: [`${L}+N`], description: m.ui_shortcutshelpmodal_apre_una_nuova_chat_nel_progetto_attivo_3acb() },
				{ keys: [`${L}+C`], description: m.ui_shortcutshelpmodal_interrompe_la_risposta_in_streaming_o_cancella_6699() },
				{ keys: ['Ctrl+C'], description: m.ui_shortcutshelpmodal_interrompe_la_risposta_in_streaming_senza_testo_37ce() },
				{ keys: ['Esc'], description: m.shortcuts_item_close_menus() },
				// Chiave unica per l'#each: Invio/Esc nel composer in ripetizione (/loop).
				{ keys: ['Invio', 'Esc'], description: m.shortcuts_item_loop() }
			]
		},
		{
			id: 'shell-window',
			title: m.shortcuts_cat_shell(),
			column: 2,
			items: [
				{ keys: ['Alt+H', 'Alt+K', 'F1'], description: m.shortcuts_item_open_guide() },
				{ keys: ['Ctrl+Alt+A'], description: m.ui_shortcutshelpmodal_passa_tra_la_superficie_gui_chat_e_0c21() },
				{ keys: ['Ctrl+Alt+N'], description: m.ui_shortcutshelpmodal_nuovo_progetto_apre_il_selettore_cartella_01ff() },
				{ keys: ['Ctrl+Alt+S'], description: m.shortcuts_item_scratchpad() },
				{ keys: ['Ctrl+Alt+P'], description: m.shortcuts_item_lab_prototype() },
				{ keys: [`${L}+I`], description: m.shortcuts_item_lab_point() },
				{ keys: ['Ctrl+Alt+U'], description: m.shortcuts_item_usage_panel() },
				{ keys: ['Ctrl+Alt+M'], description: m.ui_shortcutshelpmodal_apre_le_impostazioni_modelli_ruoli_catalogo_provider_9786() },
				{ keys: ['Ctrl+Alt+,'], description: m.ui_shortcutshelpmodal_apre_le_impostazioni_generali_di_studio_0d93() },
				{ keys: ['Ctrl+Alt+D'], description: m.shortcuts_item_doctor() },
				{ keys: ['Ctrl+Alt+T'], description: m.ui_shortcutshelpmodal_apre_la_vista_aggregata_dei_task_in_94ef() },
				{ keys: ['Ctrl+Tab', 'Ctrl+Shift+Tab'], description: m.ui_shortcutshelpmodal_passa_al_progetto_aperto_successivo_precedente_7793() },
				{ keys: ['Ctrl+Alt+→', 'Ctrl+Alt+←'], description: m.ui_shortcutshelpmodal_passa_al_progetto_aperto_successivo_precedente_7793() },
				{ keys: ['Ctrl+Alt+Shift+→/←'], description: m.ui_shortcutshelpmodal_sposta_la_posizione_della_tessera_del_progetto_5853() }
			]
		},
		{
			id: 'editor-files',
			title: m.ui_shortcutshelpmodal_editor_file_varie_472a(),
			column: 2,
			items: [
				{ keys: ['Ctrl+S'], description: m.ui_shortcutshelpmodal_salva_il_file_corrente_nell_editor_adfb() },
				{ keys: ['Ctrl+W', 'Ctrl+F4'], description: m.ui_shortcutshelpmodal_chiude_la_scheda_del_file_corrente_2d67() },
				{ keys: ['Ctrl+Shift+W'], description: m.shortcuts_item_close_all_tabs() },
				{ keys: ['Ctrl+Shift+V'], description: m.ui_shortcutshelpmodal_cicla_la_vista_dei_file_con_anteprima_d587() },
				{ keys: [m.shortcuts_key_middle_click()], description: m.shortcuts_item_middle_click_close() },
				{ keys: ['Ctrl+0'], description: m.shortcuts_item_fit_diagram() },
				{ keys: [m.shortcuts_key_right_click(), 'Shift+F10'], description: m.shortcuts_item_context_menu() }
			]
		}
	]);

	// Conteggio totale scorciatoie
	const totalShortcutsCount = $derived(categories.reduce((sum, cat) => sum + cat.items.length, 0));

	// Filtraggio in base alla query
	const filteredCategories = $derived.by((): ShortcutCategory[] => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return categories;

		return categories
			.map((cat) => {
				const matchingItems = cat.items.filter((item) => {
					const inKeys = item.keys.some((k) => k.toLowerCase().includes(q));
					const inDesc = item.description.toLowerCase().includes(q);
					const inNote = item.note ? item.note.toLowerCase().includes(q) : false;
					return inKeys || inDesc || inNote;
				});
				return {
					...cat,
					items: matchingItems
				};
			})
			.filter((cat) => cat.items.length > 0);
	});

	const column1Categories = $derived(filteredCategories.filter((c) => c.column === 1));
	const column2Categories = $derived(filteredCategories.filter((c) => c.column === 2));
	const hasResults = $derived(filteredCategories.length > 0);

	const dialogTitle = $derived(m.shortcuts_dialog_title());
</script>

<Dialog
	open={isOpen}
	title={dialogTitle}
	onClose={handleClose}
	size="wide"
	initialFocus=".search-input"
>
	{#snippet icon()}
		<IconKeyboard />
	{/snippet}

	{#snippet actions()}
		<div class="search-box">
			<span class="search-icon" aria-hidden="true">
				<IconSearch />
			</span>
			<input
				type="text"
				class="ui-input search-input"
				placeholder={m.ui_shortcutshelpmodal_filtra_scorciatoie_o_comandi_es_modelli_ctrl_618e()}
				bind:value={searchQuery}
				aria-label={m.shortcuts_filter_placeholder()}
			/>
			{#if searchQuery}
				<button
					type="button"
					class="clear-search-btn"
					onclick={() => (searchQuery = '')}
					aria-label={m.settings_appearance_clear_filter()}
				>
					<IconClose />
				</button>
			{/if}
		</div>
	{/snippet}

	{#if !hasResults}
		<div class="empty-results">
			<span class="empty-icon"><IconSearch /></span>
			<p class="empty-text">
				{m.ui_shortcutshelpmodal_nessuna_scorciatoia_trovata_per_84cd()}"<strong>{searchQuery}</strong>"
			</p>
			<button
				type="button"
				class="ui-button ui-button-secondary reset-search-btn"
				onclick={() => (searchQuery = '')}
			>
				{m.ui_shortcutshelpmodal_mostra_tutte_le_scorciatoie_d3d2()}
			</button>
		</div>
	{:else}
		<div class="columns-grid">
			<!-- Colonna 1: Modelli & Ruoli, Composer & Scrittura -->
			<div class="shortcuts-column">
				{#each column1Categories as cat (cat.id)}
					<section class="category-section" aria-labelledby="cat-{cat.id}">
						<h3 id="cat-{cat.id}" class="category-title">{cat.title}</h3>
						<div class="shortcuts-list">
							{#each cat.items as item (item.keys.join('|'))}
								<div class="shortcut-row">
									<div class="desc-wrap">
										<span class="desc-text">{item.description}</span>
										{#if item.note}
											<span class="desc-note">{item.note}</span>
										{/if}
									</div>
									<div class="keys-wrap">
										{#each item.keys as key, ki (key)}
											{#if ki > 0}
												<span class="keys-or">{m.shortcuts_footer_hint_or()}</span>
											{/if}
											<span class="key-combo">
												{#each key.split('+') as part, pi (part)}
													{#if pi > 0}
														<span class="key-plus">+</span>
													{/if}
													<kbd class="ui-kbd">{part}</kbd>
												{/each}
											</span>
										{/each}
									</div>
								</div>
							{/each}
						</div>
					</section>
				{/each}
			</div>

			<!-- Colonna 2: Guscio & Finestra, Editor & File -->
			<div class="shortcuts-column">
				{#each column2Categories as cat (cat.id)}
					<section class="category-section" aria-labelledby="cat-{cat.id}">
						<h3 id="cat-{cat.id}" class="category-title">{cat.title}</h3>
						<div class="shortcuts-list">
							{#each cat.items as item (item.keys.join('|'))}
								<div class="shortcut-row">
									<div class="desc-wrap">
										<span class="desc-text">{item.description}</span>
										{#if item.note}
											<span class="desc-note">{item.note}</span>
										{/if}
									</div>
									<div class="keys-wrap">
										{#each item.keys as key, ki (key)}
											{#if ki > 0}
												<span class="keys-or">{m.shortcuts_footer_hint_or()}</span>
											{/if}
											<span class="key-combo">
												{#each key.split('+') as part, pi (part)}
													{#if pi > 0}
														<span class="key-plus">+</span>
													{/if}
													<kbd class="ui-kbd">{part}</kbd>
												{/each}
											</span>
										{/each}
									</div>
								</div>
							{/each}
						</div>
					</section>
				{/each}
			</div>
		</div>
	{/if}

	{#snippet footer()}
		<div class="shortcuts-footer-content">
			<div class="footer-hint">
				<span>{m.shortcuts_footer_hint_lead()}</span>
				<kbd class="ui-kbd">Esc</kbd>
				<span>{m.shortcuts_footer_hint_or()}</span>
				<kbd class="ui-kbd">Alt+H</kbd>
				<span>{m.shortcuts_footer_hint_close()}</span>
			</div>
			<div class="footer-stats">
				<span class="ui-count">{totalShortcutsCount}</span>
				<span class="footer-stats-text">
					{m.shortcuts_footer_count({ count: totalShortcutsCount })}
				</span>
			</div>
			<div class="footer-actions">
				<button type="button" class="ui-button ui-button-secondary" onclick={handleClose}>
					{m.shortcuts_footer_dismiss()}
				</button>
			</div>
		</div>
	{/snippet}
</Dialog>

<style>
	.search-box {
		position: relative;
		display: flex;
		align-items: center;
		width: 320px;
		max-width: 100%;
	}

	.search-icon {
		position: absolute;
		left: 8px;
		display: flex;
		align-items: center;
		color: var(--ink-faint);
		pointer-events: none;
		--icon-size: 14px;
	}

	.search-input {
		width: 100%;
		padding-left: 28px;
		padding-right: 26px;
	}

	.clear-search-btn {
		position: absolute;
		right: 6px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border-radius: var(--radius-full);
		border: none;
		background: var(--bg-hover);
		color: var(--ink-muted);
		--icon-size: 11px;
		cursor: pointer;
	}

	.clear-search-btn:hover {
		background: var(--bg-active);
		color: var(--ink);
	}

	.columns-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-4);
		align-items: start;
	}

	.shortcuts-column {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
	}

	.category-section {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	/* Group label ammesso: 11px/600 maiuscolo 0.05em --ink-faint */
	.category-title {
		font-size: var(--text-caption);
		font-weight: 600;
		color: var(--ink-faint);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding-bottom: 4px;
		border-bottom: 1px solid var(--line);
		margin: 0;
	}

	.shortcuts-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.shortcut-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: 5px 8px;
		border-radius: var(--radius-md);
		background: var(--bg-base);
		border: 1px solid var(--line);
		transition: background var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out);
	}

	.shortcut-row:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.desc-wrap {
		flex: 1;
		min-width: 0;
		text-align: left;
		font-size: var(--text-label);
		line-height: 1.35;
	}

	.desc-text {
		color: var(--ink);
	}

	.desc-note {
		display: block;
		font-size: var(--text-caption);
		color: var(--ink-faint);
		margin-top: 1px;
	}

	.keys-wrap {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 3px;
		flex-shrink: 0;
		justify-content: flex-end;
	}

	.key-combo {
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}

	.keys-or {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		margin: 0 2px;
		font-style: italic;
	}

	.key-plus {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		user-select: none;
		margin: 0 1px;
	}

	/* Nella guida il tasto e' il contenuto: sale a --ink-muted, solo qui. */
	.key-combo .ui-kbd {
		color: var(--ink-muted);
	}

	.empty-results {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-6) var(--space-4);
		color: var(--ink-muted);
		text-align: center;
		gap: var(--space-2);
	}

	.empty-icon {
		color: var(--ink-faint);
		transform: scale(1.5);
		margin-bottom: var(--space-2);
		--icon-size: 20px;
	}

	.empty-text {
		margin: 0;
		font-size: var(--text-body);
		color: var(--ink-muted);
	}

	.empty-text strong {
		color: var(--ink);
	}

	.shortcuts-footer-content {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		gap: var(--space-3);
	}

	.footer-hint {
		font-size: var(--text-label);
		color: var(--ink-muted);
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.footer-stats {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.footer-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	@media (max-width: 768px) {
		.columns-grid {
			grid-template-columns: 1fr;
			gap: var(--space-3);
		}

		.footer-stats {
			display: none;
		}

		.search-box {
			width: 200px;
		}
	}
</style>
