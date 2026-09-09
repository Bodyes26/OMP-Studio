<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { slide } from 'svelte/transition';
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import { companionStore, type QuickTaskAiParsed } from '$lib/stores/companion.svelte';
	import { projectStore, type Project } from '$lib/stores/projects.svelte';
	import { quotaStore } from '$lib/stores/quota.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { modelSettingsStore } from '$lib/stores/modelSettings.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { THEMES, anchorsFor } from '$lib/theme';
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
		IconCheck,
		IconClose,
		IconPin,
		IconPinned,
		IconStatusPending,
		IconStatusRunning,
		IconWarning,
		IconSparkles,
		IconPlus
	} from '$lib/icons';

	const ROLES = ['smol', 'default', 'slow', 'plan'];

	/** Ordine di urgenza con cui si leggono i progetti nell'elenco. */
	const STATE_RANK: Record<string, number> = {
		attention: 0,
		working: 1,
		finished: 2,
		idle: 3,
		unknown: 4
	};

	let inputEl = $state<HTMLTextAreaElement | null>(null);
	let taskInput = $state('');
	let caret = $state(0);
	let mentionIndex = $state(0);
	let aiParsed = $state<QuickTaskAiParsed | null>(null);
	let isSaving = $state(false);
	let successNotice = $state<string | null>(null);
	let expandedHistory = $state<Record<string, boolean>>({});
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

	/** Tasti gestiti dalla textarea quando il suggeritore e' aperto. */
	function handleInputKeydown(e: KeyboardEvent) {
		if (!mentionOpen) {
			syncCaret();
			return;
		}
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			mentionIndex = (mentionIndex + 1) % mentionItems.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			mentionIndex = (mentionIndex - 1 + mentionItems.length) % mentionItems.length;
		} else if (e.key === 'Tab' || (e.key === 'Enter' && !e.ctrlKey && !e.metaKey)) {
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
							<p class="ask-question">{req.pendingUi.message || req.pendingUi.title || 'Seleziona un’opzione:'}</p>

							<!-- Opzioni Select -->
							{#if req.pendingUi.options && req.pendingUi.options.length > 0}
								<div class="options-grid">
									{#each req.pendingUi.options as opt, idx (opt)}
										<button
											type="button"
											class="option-btn"
											onclick={() => void handleQuickReplySelect(req.projectId, opt)}
										>
											<span class="opt-num">{idx + 1}</span>
											<span class="opt-label">{opt}</span>
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
			<div class="task-input-box">
				{#if mentionOpen}
					<!-- Suggeritore locale: filtra in memoria, nessuna latenza e nessun costo -->
					<div class="mention-popover" role="listbox" aria-label="Suggerimenti">
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

				<textarea
					bind:this={inputEl}
					bind:value={taskInput}
					oninput={handleInput}
					onkeydown={handleInputKeydown}
					onclick={syncCaret}
					onkeyup={syncCaret}
					rows="3"
					placeholder="Cosa c'è da fare? Usa @progetto, /direttiva, !ruolo"
					aria-label="Testo del task in linguaggio naturale"
				></textarea>

				<div class="input-actions">
					<span class="kbd-hint">Ctrl+Invio per salvare</span>
					<button
						type="button"
						class="save-task-btn"
						disabled={!taskInput.trim() || isSaving || companionStore.isParsingTask}
						onclick={handleSaveTask}
					>
						{#if isSaving || companionStore.isParsingTask}
							<span class="spinner"></span>
							<span>{companionStore.isParsingTask ? 'Interpretazione AI...' : 'Salvataggio...'}</span>
						{:else}
							<IconPlus />
							<span>Salva task</span>
						{/if}
					</button>
				</div>
			</div>

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

			<!-- Anteprima dell'interpretazione: locale e gratuita, oppure quella dell'AI dopo il salvataggio -->
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
				<div class="parsed-preview" transition:slide={{ duration: 180 }}>
					<div class="parsed-header">
						<div class="parsed-tags">
							{#if preview.projectName}
								<span class="parsed-tag project">{preview.projectName}</span>
							{:else}
								<span class="parsed-tag missing">Progetto da scegliere</span>
							{/if}

							{#if preview.role}
								<span class="parsed-tag role">Ruolo: {preview.role}</span>
							{/if}

							{#if preview.modelSelector}
								<span class="parsed-tag model">Modello: {preview.modelSelector}</span>
							{/if}

							{#each preview.directiveIds as dId (dId)}
								{@const dir = knownDirectives.find((d) => d.id === dId)}
								<span class="parsed-tag directive">+{dir?.name ?? dId}</span>
							{/each}
						</div>

						{#if aiParsed}
							<span class="badge-title"><IconSparkles /> interpretato con AI</span>
						{/if}
					</div>

					{#if preview.taskPrompt}
						<div class="parsed-prompt">
							<span class="prompt-label">Prompt:</span>
							<p>{preview.taskPrompt}</p>
						</div>
					{/if}

					{#if preview.ambiguities && preview.ambiguities.length > 0}
						<div class="ambiguities-box">
							{#each preview.ambiguities as amb, idx (idx)}
								<p class="ambiguity-item"><IconWarning /> {amb}</p>
							{/each}
						</div>
					{:else if !preview.projectPath}
						<div class="ambiguities-box">
							<p class="ambiguity-item">
								<IconWarning /> Nessun progetto riconosciuto: scrivi @progetto oppure salva e lascia decidere all'AI.
							</p>
						</div>
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
						<div class="project-row" style="--proj-hue: {p.hue}" class:busy>
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

	.companion-shell {
		position: relative;
		display: flex;
		flex-direction: column;
		width: 100vw;
		height: 100vh;
		background: color-mix(in srgb, var(--bg-raised) 94%, transparent);
		color: var(--ink);
		border: 1px solid var(--line-strong);
		border-radius: 12px;
		box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4), 0 0 0 1px var(--line);
		overflow: hidden;
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		box-sizing: border-box;
	}

	/* Comparsa: la finestra e' un richiamo, non deve apparire di scatto. */
	.companion-shell.just-opened {
		animation: companion-pop 180ms cubic-bezier(0.2, 0.85, 0.25, 1) both;
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
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3), 0 0 0 1px var(--brand-line);
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
		border-radius: 999px;
		background: var(--warning-tint);
		color: var(--warning);
		border: 1px solid var(--warning-line);
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

	/* Card Richiesta di Attenzione */
	.attention-card {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-left: 4px solid hsl(var(--proj-hue, 220), 80%, 55%);
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
		font-weight: 600;
		font-size: var(--text-sm);
		color: var(--ink);
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

	.ask-question {
		font-weight: 500;
		font-size: var(--text-sm);
		margin: 0 0 var(--space-2) 0;
		color: var(--ink);
	}

	.options-grid {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.option-btn {
		display: flex;
		align-items: center;
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
		color: var(--brand-contrast);
		border-color: var(--brand);
	}

	.action-btn.cancel {
		background: var(--bg-hover);
		color: var(--ink-muted);
	}

	/* Sezione Input Rapido Task */
	.quick-task-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.task-input-box {
		position: relative;
		display: flex;
		flex-direction: column;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-2);
		transition: border-color var(--dur-fast);
	}

	.task-input-box:focus-within {
		border-color: var(--brand);
		box-shadow: 0 0 0 1px var(--brand-line);
	}

	.task-input-box textarea {
		width: 100%;
		border: none;
		background: transparent;
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		resize: none;
		outline: none;
		box-sizing: border-box;
	}

	.input-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: var(--space-2);
		padding-top: var(--space-2);
		border-top: 1px solid var(--line);
	}

	.kbd-hint {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		font-family: var(--font-mono);
	}

	.save-task-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-3);
		background: var(--brand);
		color: var(--brand-contrast);
		border: none;
		border-radius: var(--radius-sm);
		font-weight: 600;
		font-size: var(--text-xs);
		cursor: pointer;
		transition: opacity var(--dur-fast);
	}

	.save-task-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.notice {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
	}

	.notice.success {
		background: var(--success-tint);
		color: var(--success);
		border: 1px solid var(--success-line);
	}

	.notice.error {
		background: var(--danger-tint);
		color: var(--danger);
		border: 1px solid var(--danger-line);
	}

	/* Anteprima Task Interpretato */
	.parsed-preview {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.parsed-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.badge-title {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--brand);
	}

	.parsed-tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}

	.parsed-tag {
		font-size: var(--text-xs);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
	}

	.parsed-tag.project {
		background: var(--brand-tint);
		color: var(--brand);
		border: 1px solid var(--brand-line);
	}

	.parsed-tag.missing {
		background: var(--danger-tint);
		color: var(--danger);
		border: 1px solid var(--danger-line);
	}

	.parsed-tag.role {
		background: var(--bg-hover);
		color: var(--ink);
		border: 1px solid var(--line);
	}

	.parsed-tag.model {
		background: var(--bg-hover);
		color: var(--ink-muted);
		border: 1px solid var(--line);
	}

	.parsed-tag.directive {
		background: var(--bg-hover);
		color: var(--ink-muted);
		border: 1px solid var(--line);
	}

	.parsed-prompt {
		font-size: var(--text-xs);
		line-height: 1.4;
	}

	.prompt-label {
		color: var(--ink-faint);
		font-weight: 600;
		margin-right: var(--space-1);
	}

	.parsed-prompt p {
		margin: 2px 0 0 0;
		color: var(--ink);
	}

	.ambiguities-box {
		padding: var(--space-2);
		background: var(--warning-tint);
		border: 1px solid var(--warning-line);
		border-radius: var(--radius-sm);
	}

	.ambiguity-item {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--warning);
		display: flex;
		align-items: center;
		gap: var(--space-1);
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

	.p-dot {
		width: 8px;
		height: 8px;
		flex: none;
		border-radius: 50%;
		background: hsl(var(--proj-hue, 220), 80%, 55%);
	}

	.p-dot.pulsing {
		animation: dot-pulse 1.4s ease-in-out infinite;
	}

	@keyframes dot-pulse {
		0%,
		100% {
			opacity: 1;
			box-shadow: 0 0 0 0 hsl(var(--proj-hue, 220), 80%, 55%, 0.5);
		}
		50% {
			opacity: 0.55;
			box-shadow: 0 0 0 4px hsl(var(--proj-hue, 220), 80%, 55%, 0);
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
		color: var(--success);
	}

	.p-state.state-attention {
		color: var(--warning);
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

	/* Suggeritore @progetto e /direttiva: si apre sopra la textarea */
	.mention-popover {
		position: absolute;
		bottom: calc(100% + 4px);
		left: 0;
		right: 0;
		z-index: 5;
		display: flex;
		flex-direction: column;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
		overflow: hidden;
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
		border: 2px solid var(--brand-contrast);
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
