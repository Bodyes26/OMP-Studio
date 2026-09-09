<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { slide } from 'svelte/transition';
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import { companionStore, type AttentionRequest, type QuickTaskAiParsed } from '$lib/stores/companion.svelte';
	import { askQuestionText, parseAskTitle } from '$lib/agent/askTitle';
	import { projectStore, type Project } from '$lib/stores/projects.svelte';
	import { quotaStore } from '$lib/stores/quota.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { modelSettingsStore } from '$lib/stores/modelSettings.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { THEMES, anchorsFor, automaticProjectHue } from '$lib/theme';
	import { anchoredPopover } from '$lib/anchoredPopover';
	import { computeQuotaInfo } from '$lib/quota/projectQuota';
	import QuotaChip from '$lib/components/quota/QuotaChip.svelte';
	import UsagePopover from '$lib/components/UsagePopover.svelte';
	import {
		parseQuickTaskLocal,
		mentionStateAt,
		applyMention,
		type LocalQuickTask
	} from '$lib/companion/quickTaskLocal';
	import {
		IconArrowUp,
		IconCheck,
		IconClose,
		IconPin,
		IconPinned,
		IconStatusPending,
		IconStatusRunning,
		IconWarning,
		IconSparkles
	} from '$lib/icons';

	const ROLES = ['smol', 'default', 'slow', 'plan'];

	/**
	 * Prefissi del linguaggio del campo: sono i soli comandi visibili, e stanno
	 * sulla riga bassa del composer perche' un placeholder che li elenca tutti
	 * diventa illeggibile appena si scrive il primo carattere.
	 */
	const TOKEN_HINTS = [
		{ char: '@', label: 'progetto', title: 'Scegli il progetto di destinazione' },
		{ char: '/', label: 'direttiva', title: 'Aggiungi una direttiva al task' },
		{ char: '!', label: 'ruolo', title: 'Forza il ruolo o il modello' }
	];

	/** Ordine di urgenza con cui si leggono i progetti nell'elenco. */
	const STATE_RANK: Record<string, number> = {
		attention: 0,
		working: 1,
		finished: 2,
		idle: 3,
		unknown: 4
	};

	let inputEl = $state<HTMLTextAreaElement | null>(null);
	let composerEl = $state<HTMLElement | null>(null);
	let taskInput = $state('');
	let caret = $state(0);
	let mentionIndex = $state(0);
	let aiParsed = $state<QuickTaskAiParsed | null>(null);
	let isSaving = $state(false);
	let successNotice = $state<string | null>(null);
	let expandedHistory = $state<Record<string, boolean>>({});
	/** Testo in corso di scrittura per le richieste a risposta libera. */
	let replyDrafts = $state<Record<string, string>>({});
	let usageOpen = $state(false);
	let justOpened = $state(false);

	let unlistenSummon: UnlistenFn | null = null;

	const isLightTheme = $derived(anchorsFor(THEMES[themeStore.current] ?? THEMES['titanium']).isLight);
	const attentionList = $derived(companionStore.attentionRequests);

	const knownProjects = $derived(
		companionStore.projects.length > 0 ? companionStore.projects : projectStore.projects
	);
	const knownDirectives = $derived(settingsStore.taskDirectives.filter((d) => !d.hidden));

	/**
	 * Interpretazione del testo mentre si scrive: e' puramente locale e sincrona.
	 * Nessun processo `omp` viene avviato durante la digitazione; l'AI entra in
	 * gioco solo al salvataggio e solo se il progetto resta indeterminato.
	 */
	const local = $derived<LocalQuickTask>(
		parseQuickTaskLocal(taskInput, {
			projects: knownProjects.map((p) => ({ id: p.id, name: p.name, label: p.label ?? undefined, path: p.path })),
			directives: knownDirectives.map((d) => ({ id: d.id, name: d.name, tag: d.tag, hidden: d.hidden })),
			roles: ROLES
		})
	);

	const mention = $derived(mentionStateAt(taskInput, caret));

	const mentionItems = $derived.by<Array<{ value: string; label: string; hint?: string }>>(() => {
		if (mention.kind === 'project') {
			const q = mention.query.toLowerCase();
			return knownProjects
				.filter((p) => p.path)
				.filter((p) => !q || (p.label ?? p.name).toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
				.slice(0, 6)
				.map((p) => ({ value: p.name, label: p.label?.trim() || p.name, hint: p.name }));
		}
		if (mention.kind === 'directive') {
			const q = mention.query.toLowerCase();
			return knownDirectives
				.filter((d) => !q || d.name.toLowerCase().includes(q) || (d.tag ?? '').toLowerCase().includes(q))
				.slice(0, 6)
				.map((d) => ({ value: (d.tag ?? d.name).replace(/^\//, ''), label: d.name, hint: d.tag }));
		}
		return [];
	});

	const mentionOpen = $derived(mention.kind !== null && mentionItems.length > 0);

	const isBusy = $derived(isSaving || companionStore.isParsingTask);
	const canSave = $derived(taskInput.trim().length > 0 && !isBusy);

	/** Progetti ordinati per urgenza: chi chiede risposta sta in cima, chi e' fermo in fondo. */
	const monitorProjects = $derived.by<Project[]>(() => {
		const list = knownProjects.filter((p) => p.path);
		return [...list].sort((a, b) => {
			const ra = STATE_RANK[a.agentState] ?? 9;
			const rb = STATE_RANK[b.agentState] ?? 9;
			if (ra !== rb) return ra - rb;
			return (a.label?.trim() || a.name).localeCompare(b.label?.trim() || b.name);
		});
	});

	// In Spotlight la finestra e' una barra di comando: si mostrano poche righe.
	const visibleProjects = $derived(companionStore.isPinned ? monitorProjects : monitorProjects.slice(0, 3));
	const hiddenProjectsCount = $derived(monitorProjects.length - visibleProjects.length);

	function runtimeFor(projectId: string) {
		return companionStore.projectRuntimes.find((r) => r.projectId === projectId);
	}

	/**
	 * Tinta del progetto identica a quella della barra nella finestra
	 * principale: in modalita' automatica non e' il valore salvato ma quello
	 * che il tema corrente assegna al percorso.
	 */
	function hueFor(project: Project): number {
		if (!project.path || project.colorMode === 'custom') return project.hue;
		return automaticProjectHue(THEMES[themeStore.current] ?? THEMES['titanium'], project.path);
	}

	function stateLabel(state: string): string {
		if (state === 'attention') return 'Chiede risposta';
		if (state === 'working') return 'Al lavoro';
		if (state === 'finished') return 'Completato';
		if (state === 'idle') return 'Fermo';
		return 'Non avviato';
	}

	onMount(() => {
		void companionStore.init();
		void quotaStore.init();
		void settingsStore.init();
		void modelSettingsStore.loadAll();

		// Focus automatico del campo input
		void tick().then(() => inputEl?.focus());
		playOpenAnimation();

		// Ascolta l'evento di summon globale da Rust
		void listen('companion-summon', () => {
			playOpenAnimation();
			void tick().then(() => inputEl?.focus());
		}).then((fn) => {
			unlistenSummon = fn;
		});

		// Auto-chiusura su blur solo se non pinnato
		const handleBlur = () => {
			if (!companionStore.isPinned && !usageOpen) {
				void companionStore.hideCompanion();
			}
		};

		window.addEventListener('blur', handleBlur);

		return () => {
			window.removeEventListener('blur', handleBlur);
			unlistenSummon?.();
		};
	});

	/** Rilancia l'animazione di comparsa a ogni richiamo della finestra. */
	function playOpenAnimation() {
		justOpened = false;
		void tick().then(() => {
			justOpened = true;
			setTimeout(() => (justOpened = false), 220);
		});
	}

	/**
	 * Il campo cresce con il testo invece di occupare tre righe fisse: a vuoto
	 * e' una riga sola, come nel composer della finestra principale. Oltre il
	 * tetto scorre al proprio interno.
	 */
	const INPUT_MAX_HEIGHT = 160;

	$effect(() => {
		const el = inputEl;
		// Dipendenza esplicita: l'altezza si ricalcola a ogni cambio di testo.
		const text = taskInput;
		if (!el) return;
		el.style.height = 'auto';
		const target = text ? Math.min(el.scrollHeight, INPUT_MAX_HEIGHT) : 0;
		el.style.height = target > 0 ? `${target}px` : '';
		el.style.overflowY = text && el.scrollHeight > INPUT_MAX_HEIGHT ? 'auto' : 'hidden';
	});

	/** Inserisce un prefisso al punto di inserimento e apre il suggeritore. */
	function insertToken(char: string) {
		const el = inputEl;
		const at = el?.selectionStart ?? taskInput.length;
		const before = taskInput.slice(0, at);
		const needsSpace = before.length > 0 && !/\s$/.test(before);
		const insert = `${needsSpace ? ' ' : ''}${char}`;
		taskInput = before + insert + taskInput.slice(el?.selectionEnd ?? at);
		const next = at + insert.length;
		aiParsed = null;
		companionStore.parseError = null;
		mentionIndex = 0;
		void tick().then(() => {
			inputEl?.focus();
			inputEl?.setSelectionRange(next, next);
			caret = next;
		});
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			if (usageOpen) {
				usageOpen = false;
				return;
			}
			if (mentionOpen) {
				// Chiude solo il suggeritore: la finestra resta aperta
				caret = -1;
				return;
			}
			void companionStore.hideCompanion();
		} else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			void handleSaveTask();
		}
	}

	/**
	 * Tasti della textarea. Invio salva (Maiusc+Invio va a capo) come nel
	 * composer della chat; quando il suggeritore e' aperto vince lui, perche'
	 * Invio deve prima confermare la voce selezionata.
	 */
	function handleInputKeydown(e: KeyboardEvent) {
		if (!mentionOpen) {
			if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
				e.preventDefault();
				void handleSaveTask();
				return;
			}
			syncCaret();
			return;
		}
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			mentionIndex = (mentionIndex + 1) % mentionItems.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			mentionIndex = (mentionIndex - 1 + mentionItems.length) % mentionItems.length;
		} else if (e.key === 'Tab' || (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey)) {
			e.preventDefault();
			chooseMention(mentionItems[Math.min(mentionIndex, mentionItems.length - 1)].value);
		}
	}

	function syncCaret() {
		void tick().then(() => {
			caret = inputEl?.selectionStart ?? taskInput.length;
		});
	}

	function handleInput() {
		caret = inputEl?.selectionStart ?? taskInput.length;
		mentionIndex = 0;
		// L'anteprima AI precedente non descrive piu' il testo corrente
		aiParsed = null;
		companionStore.parseError = null;
	}

	function chooseMention(value: string) {
		const next = applyMention(taskInput, mention, value);
		taskInput = next.text;
		mentionIndex = 0;
		void tick().then(() => {
			inputEl?.focus();
			inputEl?.setSelectionRange(next.caret, next.caret);
			caret = next.caret;
		});
	}

	async function handleSaveTask() {
		const text = taskInput.trim();
		if (!text || isSaving) return;

		isSaving = true;
		try {
			let toSave: QuickTaskAiParsed | null = null;

			if (!local.needsAi && local.projectPath) {
				// Interpretazione locale sufficiente: nessuna chiamata al modello
				toSave = {
					projectPath: local.projectPath,
					projectName: local.projectName,
					taskPrompt: local.taskPrompt || text,
					role: local.role,
					modelSelector: local.modelSelector,
					directiveIds: local.directiveIds,
					ambiguities: []
				};
			} else {
				const res = await companionStore.parseQuickTask(text);
				if (!res || !res.projectPath) {
					aiParsed = res;
					return;
				}
				aiParsed = res;
				toSave = res;
			}

			const ok = await companionStore.saveTask(toSave);
			if (ok) {
				successNotice = `Task aggiunto a ${toSave.projectName || 'progetto'}!`;
				// L'avviso di un tentativo precedente non descrive piu' nulla: il
				// campo e' vuoto e non basterebbe piu' scrivere per farlo sparire.
				companionStore.parseError = null;
				taskInput = '';
				caret = 0;
				aiParsed = null;
				setTimeout(() => {
					successNotice = null;
					if (!companionStore.isPinned) {
						void companionStore.hideCompanion();
					}
				}, 1200);
			}
		} finally {
			isSaving = false;
		}
	}

	async function handleQuickReplySelect(projectId: string, value: string) {
		await companionStore.respondUi(projectId, { action: 'select', value });
	}

	async function handleQuickReplyConfirm(projectId: string, confirmed: boolean) {
		await companionStore.respondUi(projectId, { action: 'confirm', confirmed });
	}

	async function handleQuickReplyCancel(projectId: string) {
		await companionStore.respondUi(projectId, { action: 'cancel' });
	}

	/**
	 * Risposta libera per i metodi `input` ed `editor`: sul filo e' lo stesso
	 * frame di una scelta, con il testo al posto dell'opzione.
	 */
	async function handleQuickReplyText(projectId: string) {
		const value = (replyDrafts[projectId] ?? '').trim();
		if (!value) return;
		delete replyDrafts[projectId];
		await companionStore.respondUi(projectId, { action: 'select', value });
	}

	function draftFor(req: AttentionRequest): string {
		return replyDrafts[req.projectId] ?? req.pendingUi.prefill ?? '';
	}

	/** Vero quando la richiesta vuole testo libero e non una scelta. */
	function wantsText(pending: AttentionRequest['pendingUi']): boolean {
		if (pending.options && pending.options.length > 0) return false;
		return pending.method === 'input' || pending.method === 'editor';
	}

	function toggleHistory(projectId: string) {
		expandedHistory[projectId] = !expandedHistory[projectId];
	}

	function togglePinned() {
		void companionStore.setPinned(!companionStore.isPinned);
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class="companion-shell"
	class:pinned={companionStore.isPinned}
	class:just-opened={justOpened}
>
	<!--
		In Spotlight la finestra non ha barra: e' una superficie di comando con
		una sottile area invisibile di trascinamento in alto. La barra compare
		solo quando la finestra resta appesa allo schermo.
	-->
	{#if companionStore.isPinned}
		<header class="companion-header" data-tauri-drag-region="deep">
			<div class="header-left" data-tauri-drag-region="deep">
				<img
					src={isLightTheme ? '/logo-topbar-light.png' : '/logo-topbar.png'}
					alt="OMP Studio"
					class="brand-logo-img"
					draggable="false"
				/>
				{#if attentionList.length > 0}
					<span class="attention-counter">{attentionList.length} in attesa</span>
				{/if}
			</div>

			<div class="header-right">
				<button
					type="button"
					class="icon-btn active"
					onclick={togglePinned}
					title="Sblocca finestra (torna in modalità Spotlight)"
					aria-label="Sblocca finestra"
				>
					<IconPinned />
				</button>

				<button
					type="button"
					class="icon-btn close-btn"
					onclick={() => void companionStore.hideCompanion()}
					title="Chiudi (Esc)"
					aria-label="Chiudi finestra"
				>
					<IconClose />
				</button>
			</div>
		</header>
	{:else}
		<div class="spotlight-drag-region" data-tauri-drag-region></div>
		<!-- In Spotlight l'unico comando visibile e' il pin, discreto finche' non serve. -->
		<div class="floating-controls">
			<button
				type="button"
				class="icon-btn"
				onclick={togglePinned}
				title="Fissa su questo monitor (modalità Widget persistente)"
				aria-label="Fissa finestra"
			>
				<IconPin />
			</button>
		</div>
	{/if}

	<!-- Popover con il dettaglio dei consumi, aperto dalle chip di quota -->
	{#if usageOpen}
		<UsagePopover open={usageOpen} onClose={() => (usageOpen = false)} />
	{/if}

	<main class="companion-body">
		<!-- Sezione Richieste di Attenzione Prioritarie (Quick Reply) -->
		{#if attentionList.length > 0}
			<section class="attention-section">
				<div class="section-title">
					<IconWarning />
					<span>Richieste di intervento ({attentionList.length})</span>
				</div>

				{#each attentionList as req (req.projectId)}
					{@const parsed = parseAskTitle(req.pendingUi.title)}
					{@const detail = parsed.text && req.pendingUi.message ? req.pendingUi.message : null}
					<div class="attention-card" style="--proj-hue: {req.projectHue}">
						<div class="card-header">
							<span class="project-pill">{req.projectName}</span>
							{#if req.modelName}
								<span class="model-badge">{req.modelName}</span>
							{/if}
						</div>

						<!-- Contesto Chat (ultimi messaggi) -->
						{#if req.recentMessages && req.recentMessages.length > 0}
							{@const messagesToShow = expandedHistory[req.projectId]
								? req.recentMessages
								: req.recentMessages.slice(-2)}
							<div class="chat-context">
								{#each messagesToShow as msg, i (i)}
									<div class="context-bubble {msg.role}">
										<span class="role-tag">{msg.role === 'user' ? 'Tu' : 'Agente'}:</span>
										<span class="bubble-text">{msg.text}</span>
									</div>
								{/each}

								{#if req.recentMessages.length > 2}
									<button
										type="button"
										class="history-toggle-btn"
										onclick={() => toggleHistory(req.projectId)}
									>
										{expandedHistory[req.projectId] ? 'Mostra meno contesto' : `Mostra altri ${req.recentMessages.length - 2} messaggi`}
									</button>
								{/if}
							</div>
						{/if}

						<!-- Domanda / Richiesta interattiva -->
						<div class="ask-box">
							<div class="ask-head">
								<p class="ask-question">{askQuestionText(req.pendingUi, 'Seleziona un’opzione:')}</p>
								{#if parsed.counter}
									<span class="ask-counter">{parsed.counter}</span>
								{/if}
							</div>
							{#if detail}
								<p class="ask-detail">{detail}</p>
							{/if}

							<!-- Opzioni Select -->
							{#if req.pendingUi.options && req.pendingUi.options.length > 0}
								<div class="options-grid">
									{#each req.pendingUi.options as opt, idx (opt)}
										{@const description = req.pendingUi.optionDetails?.[idx]?.description}
										<button
											type="button"
											class="option-btn"
											onclick={() => void handleQuickReplySelect(req.projectId, opt)}
										>
											<span class="opt-num">{idx + 1}</span>
											<span class="opt-body">
												<span class="opt-label">{opt}</span>
												{#if description}
													<span class="opt-desc">{description}</span>
												{/if}
											</span>
										</button>
									{/each}
								</div>
							{:else if req.pendingUi.method === 'confirm'}
								<div class="confirm-actions">
									<button
										type="button"
										class="action-btn confirm"
										onclick={() => void handleQuickReplyConfirm(req.projectId, true)}
									>
										<IconCheck /> <span>Sì, procedi</span>
									</button>
									<button
										type="button"
										class="action-btn cancel"
										onclick={() => void handleQuickReplyConfirm(req.projectId, false)}
									>
										<IconClose /> <span>No, annulla</span>
									</button>
								</div>
							{:else if wantsText(req.pendingUi)}
								<!--
									`input` ed `editor` vogliono testo libero: senza questo campo
									la companion mostrava la domanda e la sola uscita "Ignora".
								-->
								<div class="text-reply">
									<textarea
										class="reply-input"
										rows="2"
										placeholder={req.pendingUi.placeholder || 'Scrivi la risposta…'}
										value={draftFor(req)}
										oninput={(e) => (replyDrafts[req.projectId] = e.currentTarget.value)}
										onkeydown={(e) => {
											if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
												e.preventDefault();
												e.stopPropagation();
												void handleQuickReplyText(req.projectId);
											}
										}}
									></textarea>
									<div class="reply-actions">
										<span class="reply-hint">Invio per inviare</span>
										<button
											type="button"
											class="action-btn cancel"
											onclick={() => void handleQuickReplyCancel(req.projectId)}
										>Ignora</button>
										<button
											type="button"
											class="action-btn confirm"
											disabled={!draftFor(req).trim()}
											onclick={() => void handleQuickReplyText(req.projectId)}
										><IconArrowUp /> <span>Invia</span></button>
									</div>
								</div>
							{:else}
								<div class="generic-actions">
									<button
										type="button"
										class="action-btn cancel"
										onclick={() => void handleQuickReplyCancel(req.projectId)}
									>
										Ignora / Chiudi
									</button>
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</section>
		{/if}

		<!-- Sezione Inserimento Rapido Task in Linguaggio Naturale -->
		<section class="quick-task-section">
			<!--
				Composer: una sola superficie arrotondata, il campo cresce con il
				testo e i comandi stanno sulla riga bassa. Cliccare in qualunque
				punto della superficie mette a fuoco il campo.
			-->
			<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
			<div
				class="composer"
				bind:this={composerEl}
				role="presentation"
				onclick={() => inputEl?.focus()}
			>
				<textarea
					bind:this={inputEl}
					bind:value={taskInput}
					oninput={handleInput}
					onkeydown={handleInputKeydown}
					onclick={syncCaret}
					onkeyup={syncCaret}
					rows="1"
					class="composer-input"
					placeholder="Cosa c'è da fare?"
					aria-label="Testo del task in linguaggio naturale"
				></textarea>

				<div class="composer-rail">
					<div class="token-hints">
						{#each TOKEN_HINTS as hint (hint.char)}
							<button
								type="button"
								class="token-hint"
								title={hint.title}
								onclick={(e) => {
									e.stopPropagation();
									insertToken(hint.char);
								}}
							>
								<span class="token-char">{hint.char}</span>{hint.label}
							</button>
						{/each}
					</div>

					<button
						type="button"
						class="send-btn"
						class:busy={isBusy}
						disabled={!canSave}
						title={isBusy
							? 'Salvataggio in corso'
							: 'Salva il task (Invio · Maiusc+Invio va a capo)'}
						aria-label="Salva task"
						onclick={(e) => {
							e.stopPropagation();
							void handleSaveTask();
						}}
					>
						{#if isBusy}
							<span class="spinner"></span>
						{:else}
							<IconArrowUp />
						{/if}
					</button>
				</div>
			</div>

			{#if isBusy}
				<p class="composer-status">
					{companionStore.isParsingTask ? 'Interpretazione con AI…' : 'Salvataggio…'}
				</p>
			{/if}

			{#if mentionOpen}
				<!--
					Suggeritore locale: filtra in memoria, nessuna latenza e nessun
					costo. Vive nel top layer, altrimenti lo `overflow` del corpo lo
					taglierebbe appena il composer sta in cima alla finestra.
				-->
				<div
					class="mention-popover"
					role="listbox"
					aria-label="Suggerimenti"
					popover="manual"
					use:anchoredPopover={{ anchor: composerEl, offset: 6, matchWidth: true, constrainHeight: true }}
				>
					{#each mentionItems as item, idx (item.value)}
						<button
							type="button"
							class="mention-item"
							class:selected={idx === Math.min(mentionIndex, mentionItems.length - 1)}
							role="option"
							aria-selected={idx === Math.min(mentionIndex, mentionItems.length - 1)}
							onmousedown={(e) => {
								e.preventDefault();
								chooseMention(item.value);
							}}
						>
							<span class="mention-label">{item.label}</span>
							{#if item.hint && item.hint !== item.label}
								<span class="mention-hint">{item.hint}</span>
							{/if}
						</button>
					{/each}
				</div>
			{/if}

			<!-- Notifica di successo -->
			{#if successNotice}
				<div class="notice success" transition:slide={{ duration: 180 }}>
					<IconCheck />
					<span>{successNotice}</span>
				</div>
			{/if}

			<!-- Avvisi di parsing o ambiguita' -->
			{#if companionStore.parseError}
				<div class="notice error" transition:slide={{ duration: 180 }}>
					<IconWarning />
					<span>{companionStore.parseError}</span>
				</div>
			{/if}

			<!--
				Anteprima dell'interpretazione: locale e gratuita mentre si scrive,
				quella dell'AI dopo il salvataggio. E' una striscia, non una scheda:
				sta sotto il composer come una riga di stato.
			-->
			{#if taskInput.trim()}
				{@const preview = aiParsed ?? {
					projectName: local.projectName,
					projectPath: local.projectPath,
					taskPrompt: local.taskPrompt,
					role: local.role,
					modelSelector: local.modelSelector,
					directiveIds: local.directiveIds,
					ambiguities: []
				}}
				<div class="parsed-strip" transition:slide={{ duration: 180 }}>
					<div class="parsed-tags">
						{#if preview.projectName}
							<span class="parsed-tag project">{preview.projectName}</span>
						{:else}
							<span class="parsed-tag pending">Progetto da scegliere</span>
						{/if}

						{#if preview.role}
							<span class="parsed-tag">{preview.role}</span>
						{/if}

						{#if preview.modelSelector}
							<span class="parsed-tag">{preview.modelSelector}</span>
						{/if}

						{#each preview.directiveIds as dId (dId)}
							{@const dir = knownDirectives.find((d) => d.id === dId)}
							<span class="parsed-tag">+{dir?.name ?? dId}</span>
						{/each}

						{#if aiParsed}
							<span class="parsed-ai"><IconSparkles /> AI</span>
						{/if}
					</div>

					{#if preview.taskPrompt}
						<p class="parsed-prompt">{preview.taskPrompt}</p>
					{/if}

					{#if preview.ambiguities && preview.ambiguities.length > 0}
						{#each preview.ambiguities as amb, idx (idx)}
							<p class="parsed-note"><IconWarning /><span>{amb}</span></p>
						{/each}
					{:else if !preview.projectPath}
						<p class="parsed-note">
							<IconWarning />
							<span>Scrivi <span class="token-char">@</span>progetto, oppure salva e lascia decidere all'AI.</span>
						</p>
					{/if}
				</div>
			{/if}
		</section>

		<!-- Stato in tempo reale dei progetti aperti -->
		{#if monitorProjects.length > 0}
			<section class="live-monitor-section">
				<div class="section-title">
					<IconStatusRunning />
					<span>Progetti ({monitorProjects.length})</span>
				</div>

				<div class="projects-list">
					{#each visibleProjects as p (p.id)}
						{@const rt = runtimeFor(p.id)}
						{@const busy = p.agentState === 'working' || p.agentState === 'attention'}
						<div class="project-row" style="--proj-hue: {hueFor(p)}" class:busy>
							<span class="p-dot" class:pulsing={p.agentState === 'working'}></span>
							<span class="p-name">{p.label?.trim() || p.name}</span>

							{#if busy && rt?.provider}
								{@const info = computeQuotaInfo(rt.provider, rt.modelId, rt.credentialPin)}
								<QuotaChip
									variant="ringHalo"
									showProvider={true}
									alwaysShowPct={true}
									semanticColors={true}
									status={info.status}
									remainingPct={info.remainingPct}
									usedPct={info.usedPct}
									shortName={rt.modelLabel ?? info.shortName}
									hasLimits={info.hasLimits}
									title={info.tooltip}
									ariaLabel={info.tooltip}
									longWindowAlert={info.longWindowAlert}
									accountEmail={info.accountEmail}
									onclick={(e) => {
										e.stopPropagation();
										usageOpen = !usageOpen;
									}}
								/>
							{/if}

							<span class="p-state state-{p.agentState}">
								{#if p.agentState === 'working'}
									<IconStatusRunning /> {stateLabel(p.agentState)}
								{:else if p.agentState === 'attention'}
									<IconWarning /> {stateLabel(p.agentState)}
								{:else if p.agentState === 'finished'}
									<IconCheck /> {stateLabel(p.agentState)}
								{:else}
									<IconStatusPending /> {stateLabel(p.agentState)}
								{/if}
							</span>
						</div>
					{/each}

					{#if hiddenProjectsCount > 0}
						<button type="button" class="more-projects" onclick={togglePinned}>
							+{hiddenProjectsCount} altri — fissa la finestra per vederli tutti
						</button>
					{/if}
				</div>
			</section>
		{/if}
	</main>
</div>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		background: transparent !important;
		user-select: none;
	}

	/*
		Tinte e bordi accentati derivati dai token reali del tema.
		Il sistema definisce solo `--brand`, `--warn` e `--danger`: le loro
		versioni traslucide vivono qui, in un posto solo, invece di essere
		nomi inventati in ogni regola (che il browser scarterebbe, lasciando
		fondi trasparenti e testo del colore ereditato).
	*/
	.companion-shell {
		--brand-tint: color-mix(in srgb, var(--brand) 14%, transparent);
		--brand-line: color-mix(in srgb, var(--brand) 38%, transparent);
		--warn-tint: color-mix(in srgb, var(--warn) 16%, transparent);
		--warn-line: color-mix(in srgb, var(--warn) 40%, transparent);
		--danger-tint: color-mix(in srgb, var(--danger) 14%, transparent);
		--danger-line: color-mix(in srgb, var(--danger) 38%, transparent);

		position: relative;
		display: flex;
		flex-direction: column;
		width: 100vw;
		height: 100vh;
		background: color-mix(in srgb, var(--bg-raised) 94%, transparent);
		color: var(--ink);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		overflow: hidden;
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		box-sizing: border-box;
	}

	/* Comparsa: la finestra e' un richiamo, non deve apparire di scatto. */
	.companion-shell.just-opened {
		animation: companion-pop var(--dur-base) var(--ease-out) both;
	}

	@keyframes companion-pop {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.companion-shell.just-opened {
			animation: none;
		}
	}

	.companion-shell.pinned {
		border-color: var(--brand);
		box-shadow: var(--shadow-overlay), 0 0 0 1px var(--brand-line);
	}

	.companion-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 30px;
		padding: 0 var(--space-2);
		background: var(--bg-raised);
		border-bottom: 1px solid var(--line);
		cursor: grab;
	}

	.brand-logo-img {
		height: 18px;
		width: auto;
		display: block;
		-webkit-user-drag: none;
	}

	.attention-counter {
		font-size: var(--text-xs);
		padding: 1px 6px;
		border-radius: var(--radius-full);
		background: var(--warn-tint);
		color: var(--warn);
		border: 1px solid var(--warn-line);
	}

	.spotlight-drag-region {
		position: absolute;
		top: 0;
		left: 0;
		right: 40px;
		height: 24px;
		z-index: 2;
		cursor: grab;
	}

	/* In Spotlight non c'e' barra: il solo comando galleggia in alto a destra. */
	.floating-controls {
		position: absolute;
		top: 6px;
		right: 6px;
		z-index: 3;
		opacity: 0.35;
		transition: opacity var(--dur-fast);
	}

	.companion-shell:hover .floating-controls,
	.floating-controls:focus-within {
		opacity: 1;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.companion-header .icon-btn {
		width: 22px;
		height: 22px;
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		cursor: pointer;
	}

	.icon-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.icon-btn.active {
		color: var(--brand);
		background: var(--brand-tint);
		border-color: var(--brand-line);
	}

	.close-btn:hover {
		color: var(--danger);
		background: var(--danger-tint);
	}

	.companion-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);
		overflow-y: auto;
	}

	.section-title {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: var(--space-2);
	}

	/*
		Card Richiesta di Attenzione. L'identita' del progetto e' il punto
		colorato accanto al nome, non una fascia sul bordo: la tinta arriva da
		`--proj-hue` nella stessa rampa OKLCH della barra dei progetti, cosi'
		lo stesso progetto ha lo stesso colore nelle due finestre.
	*/
	.attention-card {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}

	.card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.project-pill {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-weight: 600;
		font-size: var(--text-sm);
		color: var(--ink);
	}

	.project-pill::before {
		content: '';
		width: 7px;
		height: 7px;
		border-radius: var(--radius-full);
		background: oklch(var(--proj-l-fill) var(--proj-c-fill) var(--proj-hue, 260));
	}

	.model-badge {
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		padding: 1px 6px;
		background: var(--bg-hover);
		border-radius: var(--radius-sm);
		color: var(--ink-faint);
	}

	.chat-context {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		background: var(--bg-base);
		padding: var(--space-2);
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		max-height: 160px;
		overflow-y: auto;
	}

	.context-bubble {
		display: flex;
		gap: var(--space-2);
		font-size: var(--text-xs);
		line-height: 1.4;
	}

	.context-bubble.user .role-tag {
		color: var(--brand);
		font-weight: 600;
	}

	.context-bubble.assistant .role-tag {
		color: var(--ink-muted);
		font-weight: 600;
	}

	.bubble-text {
		color: var(--ink-muted);
		white-space: pre-wrap;
		word-break: break-word;
	}

	.history-toggle-btn {
		align-self: flex-start;
		background: none;
		border: none;
		color: var(--brand);
		font-size: var(--text-xs);
		padding: 2px 0;
		cursor: pointer;
	}

	.ask-box {
		margin-top: var(--space-1);
	}

	.ask-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.ask-question {
		font-weight: 500;
		font-size: var(--text-sm);
		margin: 0 0 var(--space-2) 0;
		color: var(--ink);
		white-space: pre-wrap;
		word-break: break-word;
	}

	/* Posizione nella sequenza (`k/N` o `(N selected)`), dichiarata dal protocollo. */
	.ask-counter {
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		padding: 1px var(--space-1);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
	}

	.ask-detail {
		margin: calc(-1 * var(--space-1)) 0 var(--space-2) 0;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		white-space: pre-wrap;
		word-break: break-word;
	}

	.options-grid {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.option-btn {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		text-align: left;
		cursor: pointer;
		font-size: var(--text-sm);
		transition: background var(--dur-fast), border-color var(--dur-fast);
	}

	.opt-body {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.opt-label {
		word-break: break-word;
	}

	.opt-desc {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		word-break: break-word;
	}

	.option-btn:hover {
		background: var(--bg-hover);
		border-color: var(--brand);
	}

	.opt-num {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.confirm-actions {
		display: flex;
		gap: var(--space-2);
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		border: 1px solid var(--line);
	}

	.action-btn.confirm {
		background: var(--brand);
		color: var(--on-brand);
		border-color: var(--brand);
	}

	.action-btn.cancel {
		background: var(--bg-hover);
		color: var(--ink-muted);
	}

	/* Risposta libera: metodi `input` ed `editor`. */
	.text-reply {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.reply-input {
		width: 100%;
		resize: vertical;
		padding: var(--space-2);
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-family: inherit;
		font-size: var(--text-sm);
		line-height: 1.4;
	}

	.reply-input:focus {
		outline: none;
		border-color: var(--brand-line);
	}

	.reply-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.reply-hint {
		margin-right: auto;
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.action-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Sezione Input Rapido Task */
	.quick-task-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	/*
		Composer: una superficie sola, non un campo con una barra sotto.
		Il testo e i comandi condividono lo stesso riquadro, che sale di un
		gradino rispetto al guscio invece di scavare un pozzo: e' l'oggetto
		attivo della finestra, non un modulo da riempire.
	*/
	.composer {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-2) var(--space-1);
		background: var(--bg-overlay);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		cursor: text;
		transition: border-color var(--dur-fast) var(--ease-out);
	}

	.composer:focus-within {
		border-color: var(--brand-line);
	}

	.composer-input {
		width: 100%;
		min-height: 22px;
		max-height: 160px;
		padding: var(--space-1) var(--space-1) 0;
		border: none;
		background: transparent;
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-base);
		line-height: 1.45;
		resize: none;
		outline: none;
		overflow-y: hidden;
		box-sizing: border-box;
	}

	.composer-input::placeholder {
		color: var(--ink-faint);
	}

	.composer-rail {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	/* I tre prefissi del linguaggio: pastiglie cliccabili, non testo di aiuto. */
	.token-hints {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		min-width: 0;
		overflow: hidden;
	}

	.token-hint {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 2px var(--space-2);
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-full);
		color: var(--ink-muted);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		line-height: 1.5;
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
	}

	.token-hint:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.token-char {
		font-family: var(--font-mono);
		color: var(--brand);
		font-weight: 600;
	}

	/* Invio: pastiglia tonda in basso a destra, come nelle app di chat. */
	.send-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 28px;
		height: 28px;
		padding: 0;
		background: var(--brand);
		color: var(--on-brand);
		border: 1px solid var(--brand);
		border-radius: var(--radius-full);
		cursor: pointer;
		--icon-size: 16px;
		transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
	}

	.send-btn:hover:not(:disabled) {
		background: var(--brand-ink);
		border-color: var(--brand-ink);
	}

	.send-btn:active:not(:disabled) {
		background: var(--brand-dim);
	}

	.send-btn:disabled {
		background: var(--bg-hover);
		border-color: var(--line);
		color: var(--ink-faint);
		cursor: default;
	}

	/* In lavorazione non e' spento: il pulsante resta acceso e gira. */
	.send-btn.busy:disabled {
		background: var(--brand);
		border-color: var(--brand);
		color: var(--on-brand);
	}

	.composer-status {
		margin: 0;
		padding-left: var(--space-1);
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.notice {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
	}

	/* Conferma: il salvataggio e' l'esito atteso, quindi parla con l'accento. */
	.notice.success {
		background: var(--brand-tint);
		color: var(--brand);
		border: 1px solid var(--brand-line);
	}

	.notice.error {
		background: var(--danger-tint);
		color: var(--danger);
		border: 1px solid var(--danger-line);
	}

	/*
		Anteprima dell'interpretazione. E' una striscia sotto il composer, non
		una scheda: una scheda dentro il corpo della finestra creerebbe un
		secondo riquadro in competizione con il campo, e con la scatola degli
		avvisi dentro diventerebbe una scheda dentro una scheda.
	*/
	.parsed-strip {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: 0 var(--space-1);
	}

	.parsed-tags {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
	}

	.parsed-tag {
		padding: 2px 7px;
		border-radius: var(--radius-full);
		background: var(--bg-hover);
		border: 1px solid transparent;
		color: var(--ink-muted);
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		line-height: 1.5;
	}

	.parsed-tag.project {
		background: var(--brand-tint);
		border-color: var(--brand-line);
		color: var(--brand);
		font-family: var(--font-ui);
		font-weight: 600;
	}

	/*
		Progetto mancante non e' un errore: il task si salva comunque e decide
		l'AI. Quindi attenzione, non pericolo.
	*/
	.parsed-tag.pending {
		background: var(--warn-tint);
		border-color: var(--warn-line);
		color: var(--warn);
		font-family: var(--font-ui);
	}

	.parsed-ai {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--brand);
	}

	.parsed-prompt {
		margin: 0;
		font-size: var(--text-xs);
		line-height: 1.45;
		color: var(--ink);
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		overflow: hidden;
	}

	/* Icona in colonna propria: un avviso lungo va a capo allineato, non sotto l'icona. */
	.parsed-note {
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: start;
		gap: 5px;
		margin: 0;
		font-size: var(--text-xs);
		line-height: 1.45;
		color: var(--warn);
	}

	.parsed-note .token-char {
		color: inherit;
	}

	/* Live Monitor */
	.live-monitor-section {
		border-top: 1px solid var(--line);
		padding-top: var(--space-2);
	}

	.projects-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.project-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		background: var(--bg-sunken);
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
	}

	/* Un progetto con un agente vivo si stacca dalla lista dei progetti fermi. */
	.project-row.busy {
		border-color: var(--line);
		background: var(--bg-base);
	}

	/*
		Punto identita' progetto: stessa rampa OKLCH della barra nella finestra
		principale. Con `hsl()` la tinta veniva letta come gradi HSL e lo stesso
		progetto usciva di un altro colore; l'alone, scritto come quarto
		argomento di `hsl()` legacy, era una dichiarazione non valida.
	*/
	.p-dot {
		width: 8px;
		height: 8px;
		flex: none;
		border-radius: var(--radius-full);
		background: oklch(var(--proj-l-fill) var(--proj-c-fill) var(--proj-hue, 260));
	}

	.p-dot.pulsing {
		animation: dot-pulse var(--dur-pulse) var(--ease-in-out) infinite;
	}

	@keyframes dot-pulse {
		0%,
		100% {
			opacity: 1;
			box-shadow: 0 0 0 0 oklch(var(--proj-l-fill) var(--proj-c-fill) var(--proj-hue, 260) / 0.5);
		}
		50% {
			opacity: 0.55;
			box-shadow: 0 0 0 4px oklch(var(--proj-l-fill) var(--proj-c-fill) var(--proj-hue, 260) / 0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.p-dot.pulsing {
			animation: none;
		}
	}

	.p-name {
		flex: 1;
		min-width: 0;
		font-weight: 500;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.p-state {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		flex: none;
		color: var(--ink-faint);
	}

	.p-state.state-working {
		color: var(--brand);
	}

	.p-state.state-attention {
		color: var(--warn);
	}

	.p-state.state-finished {
		color: var(--ink-muted);
	}

	.more-projects {
		align-self: flex-start;
		background: none;
		border: none;
		padding: 2px 0;
		font-size: var(--text-xs);
		color: var(--ink-faint);
		cursor: pointer;
	}

	.more-projects:hover {
		color: var(--ink);
	}

	/*
		Suggeritore @progetto e /direttiva. Vive nel top layer e si piazza in JS:
		dentro il corpo scorrevole veniva tagliato, e con il composer in cima
		alla finestra si apriva fuori dallo schermo.
	*/
	.mention-popover {
		position: fixed;
		inset: auto;
		margin: 0;
		padding: 0;
		z-index: var(--z-overlay);
		display: flex;
		flex-direction: column;
		background: var(--bg-overlay);
		color: var(--ink);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-overlay);
		max-height: min(200px, var(--anchored-space, 200px));
		overflow-y: auto;
	}

	.mention-item {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		padding: 4px var(--space-2);
		background: none;
		border: none;
		text-align: left;
		font-size: var(--text-xs);
		color: var(--ink);
		cursor: pointer;
	}

	.mention-item.selected,
	.mention-item:hover {
		background: var(--bg-hover);
	}

	.mention-hint {
		color: var(--ink-faint);
		font-family: var(--font-mono);
	}

	.spinner {
		width: 12px;
		height: 12px;
		border: 2px solid currentColor;
		border-top-color: transparent;
		border-radius: var(--radius-full);
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
