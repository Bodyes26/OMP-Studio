<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { trapFocus } from '$lib/focusTrap';
	import { shortcutsModalStore } from '$lib/stores/shortcutsModal.svelte';
	import { IconKeyboard, IconClose, IconSearch } from '$lib/icons';

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

	// Blocca lo scorrimento del corpo quando il modale e' aperto
	$effect(() => {
		if (!isOpen) return;
		const originalOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = originalOverflow;
		};
	});

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

	const categories: ShortcutCategory[] = [
		{
			id: 'models-roles',
			title: 'Modelli & Ruoli (Superficie GUI)',
			column: 1,
			items: [
				{ keys: ['Ctrl+P'], description: 'Cicla sequenzialmente tra i ruoli (default → plan → smol...)' },
				{ keys: ['Alt+R'], description: 'Apre il menu rapido di selezione del ruolo' },
				{ keys: ['Alt+P'], description: 'Apre il catalogo rapido dei modelli con ricerca e tastiera' },
				{ keys: ['Alt+M'], description: 'Apre il menu livello di thinking (ragionamento)' },
				{ keys: ['Alt+T'], description: 'Cicla direttamente il livello di thinking (off → max)' },
				{ keys: ['Alt+Q'], description: 'Apre le impostazioni della coda (steering, follow-up, interruzione)' },
				{ keys: ['Alt+S'], description: 'Alterna rapidamente la modalità steering (one-at-a-time / all)' }
			]
		},
		{
			id: 'composer-chat',
			title: 'Composer & Chat (Superficie GUI)',
			column: 1,
			items: [
				{ keys: ['Invio'], description: 'Invia il messaggio o seleziona il comando nella palette' },
				{ keys: ['Shift+Invio', 'Ctrl+Invio'], description: 'Inserisce una nuova riga nel campo di scrittura' },
				{ keys: ['/'], description: 'Apre la palette dei comandi slash disponibili' },
				{ keys: ['Alt+E'], description: 'Mette a fuoco il campo di scrittura del Composer' },
				{ keys: ['Alt+C'], description: 'Interrompe la risposta in streaming o cancella il testo' },
				{ keys: ['Ctrl+C'], description: 'Interrompe la risposta in streaming (senza testo evidenziato)' },
				{ keys: ['Esc'], description: 'Chiude menu/palette a comparsa o interrompe lo streaming' }
			]
		},
		{
			id: 'shell-window',
			title: 'Guscio & Finestra (Globale Studio)',
			column: 2,
			items: [
				{ keys: ['Alt+H', 'Alt+K', 'F1'], description: 'Apre questa guida alle scorciatoie da tastiera' },
				{ keys: ['Ctrl+Alt+A'], description: 'Passa tra la superficie GUI (Chat) e il Terminale TUI' },
				{ keys: ['Ctrl+Alt+N'], description: 'Nuovo progetto (apre il selettore cartella)' },
				{ keys: ['Ctrl+Alt+S'], description: 'Apre una chat Scratchpad temporanea (--no-session)' },
				{ keys: ['Ctrl+Alt+U'], description: 'Apre e chiude il pannello consumi e quote API' },
				{ keys: ['Ctrl+Alt+M'], description: 'Apre le impostazioni modelli (Ruoli, Catalogo, Provider)' },
				{ keys: ['Ctrl+Alt+,'], description: 'Apre le impostazioni generali di Studio' },
				{ keys: ['Ctrl+Alt+T'], description: 'Apre la vista aggregata dei task in attesa su tutti i progetti' },
				{ keys: ['Ctrl+Alt+→', 'Ctrl+Alt+←'], description: 'Passa al progetto aperto successivo / precedente' },
				{ keys: ['Ctrl+Alt+Shift+→/←'], description: 'Sposta la posizione della tessera del progetto attivo' }
			]
		},
		{
			id: 'editor-files',
			title: 'Editor, File & Varie',
			column: 2,
			items: [
				{ keys: ['Ctrl+S'], description: 'Salva il file corrente nell\'editor' },
				{ keys: ['Ctrl+W', 'Ctrl+F4'], description: 'Chiude la scheda del file corrente' },
				{ keys: ['Ctrl+Shift+W'], description: 'Chiude tutte le schede aperte nell\'editor' },
				{ keys: ['Ctrl+Shift+V'], description: 'Cicla la vista dei file con anteprima: codice, affiancata, solo anteprima' },
				{ keys: ['Clic centrale'], description: 'Chiude la scheda dell\'editor sotto il puntatore' },
				{ keys: ['Ctrl+0'], description: 'Adatta il diagramma a tutto schermo (viewer)' },
				{ keys: ['Click destro', 'Shift+F10'], description: 'Apre il menu contestuale dedicato dell\'elemento a fuoco' }
			]
		}
	];

	// Conteggio totale scorciatoie
	const totalShortcutsCount = categories.reduce((sum, cat) => sum + cat.items.length, 0);

	// Filtro in tempo reale
	const filteredCategories = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return categories;

		return categories
			.map((cat) => {
				const matchingItems = cat.items.filter((item) => {
					const inDesc = item.description.toLowerCase().includes(q);
					const inNote = item.note?.toLowerCase().includes(q) ?? false;
					const inKeys = item.keys.some((k) => k.toLowerCase().includes(q));
					return inDesc || inNote || inKeys;
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
</script>

{#if isOpen}
	<!-- Backdrop modale -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="modal-backdrop"
		onclick={handleClose}
		transition:fade={{ duration: 150 }}
	></div>

	<!-- Finestra modale centrata a due colonne -->
	<div
		class="modal-window"
		role="dialog"
		aria-modal="true"
		aria-labelledby="shortcuts-dialog-title"
		use:trapFocus={{ onEscape: handleClose, initialFocus: '.search-input' }}
		transition:fly={{ y: -12, duration: 200, easing: cubicOut }}
	>
		<!-- Header con titolo, campo di ricerca e chiusura -->
		<header class="modal-header">
			<div class="header-left">
				<span class="header-icon" aria-hidden="true">
					<IconKeyboard />
				</span>
				<h2 id="shortcuts-dialog-title" class="header-title">Scorciatoie da tastiera</h2>
			</div>

			<div class="header-center">
				<div class="search-box">
					<span class="search-icon" aria-hidden="true">
						<IconSearch />
					</span>
					<input
						type="text"
						class="search-input"
						placeholder="Filtra scorciatoie o comandi... (es. Modelli, Ctrl+Alt, Salva)"
						bind:value={searchQuery}
						aria-label="Filtra scorciatoie"
					/>
					{#if searchQuery}
						<button
							type="button"
							class="clear-search-btn"
							onclick={() => (searchQuery = '')}
							title="Cancella filtro"
							aria-label="Cancella filtro ricerca"
						>
							&times;
						</button>
					{/if}
				</div>
			</div>

			<div class="header-right">
				<button
					type="button"
					class="btn-close"
					onclick={handleClose}
					title="Chiudi (Esc)"
					aria-label="Chiudi finestra"
				>
					<IconClose />
				</button>
			</div>
		</header>

		<!-- Corpo con layout a due colonne affiancate -->
		<div class="modal-body">
			{#if !hasResults}
				<div class="empty-results">
					<span class="empty-icon"><IconSearch /></span>
					<p class="empty-text">Nessuna scorciatoia trovata per "<strong>{searchQuery}</strong>"</p>
					<button
						type="button"
						class="reset-search-btn"
						onclick={() => (searchQuery = '')}
					>
						Mostra tutte le scorciatoie
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
									{#each cat.items as item (item.description)}
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
														<span class="keys-or">o</span>
													{/if}
													<span class="key-combo">
														{#each key.split('+') as part, pi (part)}
															{#if pi > 0}
																<span class="key-plus">+</span>
															{/if}
															<kbd class="key-badge">{part}</kbd>
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
									{#each cat.items as item (item.description)}
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
														<span class="keys-or">o</span>
													{/if}
													<span class="key-combo">
														{#each key.split('+') as part, pi (part)}
															{#if pi > 0}
																<span class="key-plus">+</span>
															{/if}
															<kbd class="key-badge">{part}</kbd>
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
		</div>

		<!-- Footer con scorciatoie di chiusura e pulsante -->
		<footer class="modal-footer">
			<div class="footer-hint">
				<span>Premi <kbd class="key-badge small">Esc</kbd> o <kbd class="key-badge small">Alt+H</kbd> per chiudere</span>
			</div>
			<div class="footer-stats">
				<span class="count-badge">{totalShortcutsCount} scorciatoie documentate</span>
			</div>
			<div class="footer-actions">
				<button type="button" class="footer-btn" onclick={handleClose}>
					Ho capito
				</button>
			</div>
		</footer>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: color-mix(in srgb, var(--bg-base) 80%, black);
		opacity: 0.75;
		z-index: var(--z-backdrop);
	}

	.modal-window {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 940px;
		max-width: calc(100vw - 48px);
		max-height: min(660px, calc(100vh - 84px));
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		z-index: var(--z-dialog);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		font-family: var(--font-ui);
		color: var(--ink);
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-4);
		background: var(--bg-raised);
		border-bottom: 1px solid var(--line);
		gap: var(--space-3);
		min-height: 48px;
		flex-shrink: 0;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	.header-icon {
		display: flex;
		align-items: center;
		color: var(--ink-muted);
	}

	.header-title {
		margin: 0;
		font-size: var(--text-md);
		font-weight: 600;
		color: var(--ink);
		white-space: nowrap;
	}

	.header-center {
		flex: 1;
		max-width: 420px;
		display: flex;
		align-items: center;
	}

	.search-box {
		position: relative;
		display: flex;
		align-items: center;
		width: 100%;
	}

	.search-icon {
		position: absolute;
		left: 8px;
		display: flex;
		align-items: center;
		color: var(--ink-faint);
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		height: 28px;
		padding: 0 26px 0 28px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		outline: none;
		transition: border-color var(--dur-fast), background var(--dur-fast);
	}

	.search-input::placeholder {
		color: var(--ink-faint);
	}

	.search-input:focus {
		border-color: var(--brand);
		background: var(--bg-sunken);
	}

	.clear-search-btn {
		position: absolute;
		right: 6px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		border-radius: var(--radius-full);
		border: none;
		background: var(--bg-hover);
		color: var(--ink-muted);
		font-size: 12px;
		line-height: 1;
		cursor: pointer;
	}

	.clear-search-btn:hover {
		background: var(--bg-active);
		color: var(--ink);
	}

	.header-right {
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	.btn-close {
		width: 28px;
		height: 28px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: var(--ink-muted);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background var(--dur-fast), color var(--dur-fast);
	}

	.btn-close:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.modal-body {
		padding: var(--space-4);
		overflow-y: auto;
		flex: 1;
		min-height: 0;
		background: var(--bg-overlay);
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

	.category-title {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
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
		border-radius: var(--radius-sm);
		background: var(--bg-base);
		border: 1px solid var(--line);
		transition: background var(--dur-fast), border-color var(--dur-fast);
	}

	.shortcut-row:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.desc-wrap {
		flex: 1;
		min-width: 0;
		text-align: left;
		font-size: var(--text-xs);
		line-height: 1.35;
	}

	.desc-text {
		color: var(--ink);
	}

	.desc-note {
		display: block;
		font-size: 10px;
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
		font-size: 10px;
		color: var(--ink-faint);
		margin: 0 2px;
		font-style: italic;
	}

	.key-plus {
		font-size: 10px;
		color: var(--ink-faint);
		user-select: none;
		margin: 0 1px;
	}

	.key-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 1px 6px;
		min-width: 18px;
		background: var(--bg-sunken);
		border: 1px solid var(--line-strong);
		border-bottom-width: 2px;
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 600;
		color: var(--ink);
		line-height: 1.2;
		box-shadow: 0 1px 1px rgba(0, 0, 0, 0.25);
		white-space: nowrap;
	}

	.key-badge.small {
		padding: 0 4px;
		font-size: 10px;
		min-width: 14px;
		border-bottom-width: 1px;
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
	}

	.empty-text {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--ink-muted);
	}

	.empty-text strong {
		color: var(--ink);
	}

	.reset-search-btn {
		margin-top: var(--space-2);
		padding: 4px 10px;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--brand-ink);
		font-size: var(--text-xs);
		cursor: pointer;
		transition: background var(--dur-fast), border-color var(--dur-fast);
	}

	.reset-search-btn:hover {
		background: var(--bg-hover);
		border-color: var(--brand);
	}

	.modal-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-4);
		background: var(--bg-raised);
		border-top: 1px solid var(--line);
		flex-shrink: 0;
		gap: var(--space-3);
		min-height: 44px;
	}

	.footer-hint {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.footer-stats {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.count-badge {
		font-size: 11px;
		color: var(--ink-faint);
	}

	.footer-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.footer-btn {
		padding: 4px 14px;
		background: var(--bg-base);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: var(--text-xs);
		font-weight: 600;
		cursor: pointer;
		transition: background var(--dur-fast), border-color var(--dur-fast), color var(--dur-fast);
	}

	.footer-btn:hover {
		background: var(--bg-hover);
		border-color: var(--brand);
		color: var(--brand-ink);
	}

	@media (max-width: 768px) {
		.modal-window {
			width: 96vw;
			max-height: calc(100vh - 48px);
		}

		.modal-header {
			flex-wrap: wrap;
			gap: var(--space-2);
		}

		.header-center {
			order: 3;
			max-width: 100%;
			width: 100%;
		}

		.columns-grid {
			grid-template-columns: 1fr;
			gap: var(--space-3);
		}

		.footer-stats {
			display: none;
		}
	}
</style>
