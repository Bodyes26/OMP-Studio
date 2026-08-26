<script lang="ts">
	// Modale di riepilogo per le scorciatoie da tastiera della superficie GUI e del guscio Studio.
	let {
		open = false,
		onClose
	} = $props<{
		open: boolean;
		onClose: () => void;
	}>();

	// Blocca lo scorrimento del corpo quando il modale e' aperto
	$effect(() => {
		if (!open) return;
		const originalOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = originalOverflow;
		};
	});

	function handleKeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			onClose();
		}
	}

	interface ShortcutItem {
		keys: string[];
		description: string;
		note?: string;
	}

	interface ShortcutCategory {
		title: string;
		items: ShortcutItem[];
	}

	const categories: ShortcutCategory[] = [
		{
			title: 'Modelli & Ruoli (GUI)',
			items: [
				{ keys: ['Ctrl+P'], description: 'Cicla sequenzialmente tra i ruoli configurati (default → plan → smol...)' },
				{ keys: ['Alt+R'], description: 'Apre il menu rapido di selezione ruolo' },
				{ keys: ['Alt+P'], description: 'Apre il catalogo rapido dei modelli con ricerca e tastiera' },
				{ keys: ['Alt+M'], description: 'Apre il menu livello di thinking (ragionamento)' },
				{ keys: ['Alt+T'], description: 'Cicla direttamente il livello di thinking (off → max)' },
				{ keys: ['Alt+Q'], description: 'Apre le impostazioni di accodamento e interruzione' },
				{ keys: ['Alt+S'], description: 'Alterna la modalità steering (one-at-a-time / all)' }
			]
		},
		{
			title: 'Composer & Scrittura (GUI)',
			items: [
				{ keys: ['Invio'], description: 'Invia il messaggio o seleziona il comando' },
				{ keys: ['Shift+Invio', 'Ctrl+Invio'], description: 'Inserisce una nuova riga nel campo' },
				{ keys: ['/'], description: 'Apre la palette dei comandi slash' },
				{ keys: ['Alt+E'], description: 'Mette a fuoco il campo di scrittura' },
				{ keys: ['Alt+C'], description: 'Interrompe la risposta in streaming o cancella il testo' },
				{ keys: ['Ctrl+C'], description: 'Interrompe la risposta in streaming (senza testo evidenziato)' },
				{ keys: ['Esc'], description: 'Chiude menu a comparsa, palette o interrompe lo streaming' }
			]
		},
		{
			title: 'Guscio & Finestra',
			items: [
				{ keys: ['Ctrl+Alt+A'], description: 'Passa tra la superficie GUI e il Terminale TUI' },
				{ keys: ['Ctrl+Alt+M', 'Ctrl+Alt+,'], description: 'Apre le impostazioni modelli (Ruoli, Catalogo, Provider)' },
				{ keys: ['Ctrl+Alt+N'], description: 'Nuovo progetto (apre il selettore cartella)' },
				{ keys: ['Ctrl+Alt+S'], description: 'Apre una chat Scratchpad temporanea (--no-session)' },
				{ keys: ['Ctrl+Alt+U'], description: 'Apre e chiude il pannello consumi e quote' },
				{ keys: ['Ctrl+Alt+→', 'Ctrl+Alt+←'], description: 'Passa al progetto successivo / precedente' }
			]
		},
		{
			title: 'Editor & File',
			items: [
				{ keys: ['Ctrl+S'], description: 'Salva il file corrente nell\'editor' },
				{ keys: ['Ctrl+W', 'Ctrl+F4'], description: 'Chiude il file corrente' },
				{ keys: ['Ctrl+0'], description: 'Adatta il diagramma a tutto schermo' }
			]
		}
	];
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="modal-backdrop"
		role="dialog"
		aria-modal="true"
		aria-label="Scorciatoie da tastiera"
		tabindex="-1"
		onclick={onClose}
	>
		<div class="modal-card" onclick={(e) => e.stopPropagation()}>
			<header class="modal-header">
				<div class="header-title-wrap">
					<h2>Scorciatoie da tastiera</h2>
				</div>
				<button type="button" class="close-btn" onclick={onClose} aria-label="Chiudi (Esc)">
					&times;
				</button>
			</header>

			<div class="modal-body">
				{#each categories as cat (cat.title)}
					<section class="category-section">
						<h3 class="category-title">{cat.title}</h3>
						<div class="shortcuts-grid">
							{#each cat.items as item (item.description)}
								<div class="shortcut-row">
									<div class="keys-wrap">
										{#each item.keys as key, ki (key)}
											{#if ki > 0}
												<span class="keys-or">oppure</span>
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
									<div class="desc-wrap">
										<span class="desc-text">{item.description}</span>
										{#if item.note}
											<span class="desc-note">{item.note}</span>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					</section>
				{/each}
			</div>

			<footer class="modal-footer">
				<span class="footer-tip">Premi <kbd class="key-badge small">Esc</kbd> o <kbd class="key-badge small">Alt+H</kbd> per chiudere</span>
				<button type="button" class="footer-btn" onclick={onClose}>
					Ho capito
				</button>
			</footer>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: var(--backdrop);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: var(--z-dialog);
		padding: var(--space-4);
	}

	.modal-card {
		background: var(--bg-raised);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		width: 100%;
		max-width: 680px;
		max-height: calc(100vh - 48px);
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
		padding: var(--space-3) var(--space-4);
		background: var(--bg-sunken);
		border-bottom: 1px solid var(--line);
	}

	.header-title-wrap {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}


	.modal-header h2 {
		margin: 0;
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--ink);
	}

	.close-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-size: var(--text-xl);
		line-height: 1;
		cursor: pointer;
	}

	.close-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.modal-body {
		padding: var(--space-3) var(--space-4);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.category-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.category-title {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink-faint);
		padding-bottom: 4px;
		border-bottom: 1px solid var(--line);
	}

	.shortcuts-grid {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.shortcut-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		background: var(--bg-base);
		border: 1px solid var(--line);
	}

	.shortcut-row:hover {
		background: var(--bg-hover);
	}

	.keys-wrap {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px;
		flex-shrink: 0;
	}

	.key-combo {
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}

	.keys-or {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		margin: 0 2px;
	}

	.key-plus {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		user-select: none;
	}

	.key-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 2px 6px;
		min-width: 20px;
		background: var(--bg-sunken);
		border: 1px solid var(--line-strong);
		border-bottom-width: 2px;
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
		line-height: 1.2;
	}

	.key-badge.small {
		padding: 1px 4px;
		font-size: var(--text-xs);
		min-width: 16px;
	}

	.desc-wrap {
		flex: 1;
		text-align: right;
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.desc-text {
		color: var(--ink);
	}

	.desc-note {
		display: block;
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.modal-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3) var(--space-4);
		background: var(--bg-sunken);
		border-top: 1px solid var(--line);
	}

	.footer-tip {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.footer-btn {
		padding: var(--space-2) var(--space-3);
		background: var(--brand);
		color: var(--on-brand);
		border: none;
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		font-weight: 600;
		cursor: pointer;
	}

	.footer-btn:hover {
		background: var(--brand-dim);
	}

	@media (max-width: 600px) {
		.shortcut-row {
			flex-direction: column;
			align-items: flex-start;
			gap: 4px;
		}

		.desc-wrap {
			text-align: left;
		}
	}
</style>
