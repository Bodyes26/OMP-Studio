<!--
  ChatView.svelte — Vista a tutto schermo della chat di una corsia.
  Header della corsia fedele a Studio (tessera progetto, titolo, tipo, macchina, stato agente, modello),
  trascrizione cronologica centrata (720px), ComposerTray e Composer / AttentionCard ancorati in basso.
-->
<script lang="ts">
	import { t } from '../../i18n.ts';
	import { tick } from 'svelte';
	import { navigation, type LiveChatRoute } from '../../navigation.svelte.ts';
	import { connection } from '../../connection.svelte.ts';
	import type {
		Feature,
		RemoteAttention,
		RemoteChatEvent,
		RemoteChatMessage,
		RemoteChatPage,
		RemoteComposerCatalog,
		RemotePromptImage,
		RemoteLane,
		RemoteProject
	} from '../../../../src/protocol.ts';
	import { applyChatEvent, applyChatPage } from '../../chat/merge.ts';
	import Transcript from './Transcript.svelte';
	import Composer from './Composer.svelte';
	import ComposerTray from './ComposerTray.svelte';
	import AttentionCard from '../AttentionCard.svelte';
	import StatusMark from '../StatusMark.svelte';
	import OperationalDetails from '../inbox/OperationalDetails.svelte';
	import { IconArrowLeft, IconChevronDown, IconChevronUp, IconClose, IconNewChat, IconInfo } from '../../icons.ts';
	import type { RemoteComposerAttachment } from '../../chat/remoteAttachments.svelte.ts';

	let { route }: { route: LiveChatRoute } = $props();

	let messages = $state<RemoteChatMessage[]>([]);
	let beforeCursor = $state<string | null>(null);
	let loadingHistory = $state(false);
	let loadingOlder = $state(false);
	let errorMessage = $state<string | null>(null);
	let transcriptRef = $state<ReturnType<typeof Transcript> | null>(null);
	let askMinimized = $state(false);
	let activeImageModal = $state<{ url: string; mimeType?: string } | null>(null);
	let imageDialogEl = $state<HTMLDialogElement | null>(null);
	let showOperationalSheet = $state(false);
	let operationalDialogEl = $state<HTMLDialogElement | null>(null);
	let pageVisible = $state(false);
	let historyReady = $state(false);
	$effect(() => {
		if (operationalDialogEl && !operationalDialogEl.open) operationalDialogEl.showModal();
	});
	$effect(() => {
		const update = () => { pageVisible = document.visibilityState === 'visible'; };
		update();
		document.addEventListener('visibilitychange', update);
		return () => document.removeEventListener('visibilitychange', update);
	});

	$effect(() => {
		if (imageDialogEl && !imageDialogEl.open) imageDialogEl.showModal();
	});

	function openImageModal(url: string, mimeType?: string): void {
		activeImageModal = { url, mimeType };
	}

	function closeImageModal(): void {
		activeImageModal = null;
	}
	// Risoluzione reattiva di macchina, stato, progetto e corsia
	const host = $derived(connection.hosts.find((h) => h.id === route.hostId));
	const hostName = $derived(host?.name ?? 'Macchina');
	const hostFeatures = $derived<Feature[]>(host?.features ?? []);
	const hostOnline = $derived(Boolean(host?.online));

	const hostState = $derived(connection.hostStates[route.hostId]?.state);
	const project = $derived<RemoteProject | undefined>(
		hostState?.projects.find((p) => p.id === route.projectId)
	);
	const lane = $derived<RemoteLane | undefined>(
		project?.lanes.find((l: RemoteLane) => l.id === route.laneId)
	);

	const isWorking = $derived(lane?.agent.state === 'working');
	const canSessionControl = $derived(hostFeatures.includes('session_control'));
	const canChat = $derived(hostFeatures.includes('chat'));
	const canLaneConfig = $derived(hostFeatures.includes('lane_config'));
	const isLab = $derived(lane?.kind === 'lab');
	const showNewChat = $derived(canLaneConfig && !isLab);

	const agentState = $derived(lane?.agent.state ?? 'offline');
	const isBusy = $derived(agentState === 'working' || agentState === 'background' || agentState === 'attention');
	let startingNewChat = $state(false);
	const canStartNewChat = $derived(showNewChat && !startingNewChat && connection.status === 'connected');
	const newChatTooltip = $derived(t('newChat'));

	// Catalogo del composer per ruoli, modelli e ragionamento
	let catalog = $state<RemoteComposerCatalog | null>(null);
	const catalogCache: Record<string, RemoteComposerCatalog> = {};

	// Override ottimistici locali durante la selezione
	let optimisticRole = $state<string | null>(null);
	let optimisticModelLabel = $state<string | null>(null);
	let optimisticModelId = $state<string | null>(null);
	let optimisticProvider = $state<string | null>(null);
	let optimisticThinking = $state<string | null>(null);

	const activeRole = $derived(optimisticRole ?? lane?.agent.role ?? 'default');
	const activeThinking = $derived(optimisticThinking ?? lane?.agent.thinkingLevel ?? 'off');
	const activeModelLabel = $derived(optimisticModelLabel ?? lane?.agent.modelLabel ?? lane?.agent.modelId ?? null);
	const activeModelId = $derived(optimisticModelId ?? lane?.agent.modelId ?? null);
	const activeProvider = $derived(optimisticProvider ?? lane?.agent.provider ?? null);

	$effect(() => {
		if (lane?.agent.role && lane.agent.role === optimisticRole) {
			optimisticRole = null;
		}
		if (lane?.agent.modelId && lane.agent.modelId === optimisticModelId) {
			optimisticModelId = null;
			optimisticModelLabel = null;
			optimisticProvider = null;
		}
		if (lane?.agent.thinkingLevel && lane.agent.thinkingLevel === optimisticThinking) {
			optimisticThinking = null;
		}
	});
	const sessionSnapshot = $derived(lane?.session);
	const conversationTitle = $derived(
		sessionSnapshot?.title || lane?.title || route.laneId
	);

	const operationalChips = $derived.by<string[]>(() => {
		const list: string[] = [];
		if (sessionSnapshot?.progress && sessionSnapshot.progress.total > 0) {
			list.push(`${sessionSnapshot.progress.done}/${sessionSnapshot.progress.total} todo`);
		}
		if (sessionSnapshot?.subagents && sessionSnapshot.subagents.length > 0) {
			list.push(`${sessionSnapshot.subagents.length} sub-agent`);
		}
		if (sessionSnapshot?.jobs && sessionSnapshot.jobs.length > 0) {
			list.push(`${sessionSnapshot.jobs.length} job`);
		}
		if (project?.tasks && project.tasks.length > 0) {
			list.push(`+${project.tasks.length} in coda`);
		}
		return list;
	});

	// Ogni tentativo riguarda il risultato esatto gia' disegnato, non il prossimo turno.
	const attemptedCompletions = new Set<string>();
	$effect(() => {
		const completion = sessionSnapshot?.completion;
		const sessionId = sessionSnapshot?.id;
		if (!pageVisible || !hostOnline || connection.status !== 'connected' ||
			!hostFeatures.includes('fleet') || !historyReady || loadingHistory ||
			!transcriptRef?.isAtBottom() || !sessionId || !completion || completion.seen) return;
		const exactKey = `${sessionId}:${completion.id}`;
		if (attemptedCompletions.has(exactKey)) return;
		let cancelled = false;
		let frame = 0;
		void tick().then(() => {
			if (cancelled) return;
			frame = requestAnimationFrame(() => {
				if (cancelled || document.visibilityState !== 'visible' || !transcriptRef?.isAtBottom()) return;
				attemptedCompletions.add(exactKey);
				void connection.sendCommand(route.hostId, {
					kind: 'mark_session_seen',
					projectId: route.projectId,
					laneId: route.laneId === 'main' ? null : route.laneId,
					sessionId,
					completionId: completion.id
				}).catch((error: unknown) => {
					errorMessage = error instanceof Error ? error.message : (error as { message?: string })?.message ?? t('errFailed');
				});
			});
		});
		return () => {
			cancelled = true;
			cancelAnimationFrame(frame);
		};
	});

	async function fetchComposerCatalog(force = false): Promise<void> {
		if (!canLaneConfig || connection.status !== 'connected') return;
		const cacheKey = `${route.hostId}:${route.projectId}:${route.laneId}`;
		if (!force && catalogCache[cacheKey]) {
			catalog = catalogCache[cacheKey];
			return;
		}

		try {
			const res = (await connection.sendCommand(route.hostId, {
				kind: 'composer_catalog',
				projectId: route.projectId,
				laneId: route.laneId === 'main' ? null : route.laneId
			})) as RemoteComposerCatalog | undefined;

			if (res) {
				catalog = res;
				catalogCache[cacheKey] = res;
			}
		} catch (err: unknown) {
			console.warn('[ChatView] Errore caricamento catalogo:', err);
		}
	}

	async function handleNewSession(): Promise<void> {
		if (!canStartNewChat) return;
		const interrupt = isBusy;
		if (interrupt && !window.confirm(t('newChatConfirmInterrupt'))) return;
		startingNewChat = true;
		errorMessage = null;
		try {
			await connection.sendCommand(route.hostId, {
				kind: 'new_session',
				projectId: route.projectId,
				laneId: route.laneId === 'main' ? null : route.laneId,
				interrupt
			});
		} catch (err: unknown) {
			const e = err as { message?: string };
			errorMessage = e?.message || t('newChatError');
		} finally {
			startingNewChat = false;
		}
	}

	async function handleSetRole(roleId: string): Promise<void> {
		if (!canLaneConfig) return;
		optimisticRole = roleId;
		const roleOpt = catalog?.roles.find((r) => r.id === roleId);
		if (roleOpt?.model) {
			const [p, m] = roleOpt.model.split('/');
			optimisticProvider = p;
			optimisticModelId = m;
			optimisticModelLabel = roleOpt.modelLabel ?? m;
			if (roleOpt.thinking) {
				optimisticThinking = roleOpt.thinking;
			}
		}
		errorMessage = null;
		try {
			await connection.sendCommand(route.hostId, {
				kind: 'set_lane_role',
				projectId: route.projectId,
				laneId: route.laneId === 'main' ? null : route.laneId,
				roleId
			});
			void fetchComposerCatalog(true);
		} catch (err: unknown) {
			optimisticRole = null;
			const e = err as { message?: string };
			errorMessage = e?.message || 'Errore impostazione ruolo';
		}
	}

	async function handleSetModel(provider: string, modelId: string): Promise<void> {
		if (!canLaneConfig) return;
		optimisticProvider = provider;
		optimisticModelId = modelId;
		const modelOpt = catalog?.models.find((m) => m.provider === provider && m.id === modelId);
		optimisticModelLabel = modelOpt?.name ?? modelId;
		errorMessage = null;
		try {
			await connection.sendCommand(route.hostId, {
				kind: 'set_lane_model',
				projectId: route.projectId,
				laneId: route.laneId === 'main' ? null : route.laneId,
				provider,
				modelId
			});
			void fetchComposerCatalog(true);
		} catch (err: unknown) {
			optimisticModelId = null;
			optimisticModelLabel = null;
			optimisticProvider = null;
			const e = err as { message?: string };
			errorMessage = e?.message || 'Errore impostazione modello';
		}
	}

	async function handleSetThinking(level: string): Promise<void> {
		if (!canLaneConfig) return;
		optimisticThinking = level;
		errorMessage = null;
		try {
			await connection.sendCommand(route.hostId, {
				kind: 'set_lane_thinking',
				projectId: route.projectId,
				laneId: route.laneId === 'main' ? null : route.laneId,
				level
			});
		} catch (err: unknown) {
			optimisticThinking = null;
			const e = err as { message?: string };
			errorMessage = e?.message || 'Errore impostazione thinking';
		}
	}

	const laneKindLabel = $derived.by(() => {
		const kind = lane?.kind;
		if (kind === 'main') return t('laneMain');
		if (kind === 'worktree') return t('laneWorktree');
		if (kind === 'lab') return t('laneLab');
		return '';
	});

	const modelLabel = $derived(lane?.agent.modelLabel ?? lane?.agent.modelId ?? null);

	// Richiesta che aspetta questa corsia: quelle senza corsia sono della Principale,
	// con la stessa regola del quadro (ProjectCard).
	const pendingAttention = $derived(
		project?.attention?.find(
			(a: RemoteAttention) => a.laneId === route.laneId || (!a.laneId && route.laneId === 'main')
		) ?? null
	);

	const attentionText = $derived(
		pendingAttention
			? pendingAttention.questions[0]?.question ||
					pendingAttention.title ||
					pendingAttention.message ||
					t('attentionFallbackTitle')
			: ''
	);

	$effect(() => {
		if (!pendingAttention) {
			askMinimized = false;
		}
	});

	// Ultimi todo ricevuti nella sessione per il vassoio del composer
	const latestTodos = $derived.by(() => {
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m.tool?.todos && m.tool.todos.length > 0) {
				return m.tool.todos;
			}
		}
		return [];
	});

	// Motivazione di disabilitazione se il composer non puo' operare
	const disabledReason = $derived.by(() => {
		if (connection.status !== 'connected') return t('running');
		if (!hostOnline) return t('chatMachineOffline');
		if (!canSessionControl) return t('chatNoSessionControl');
		if (!project || !lane) return t('chatLaneDisappeared');
		return null;
	});

	async function handleRefreshContext(force = false): Promise<void> {
		if (!canSessionControl || disabledReason) return;
		try {
			await connection.sendCommand(route.hostId, {
				kind: 'refresh_context',
				projectId: route.projectId,
				laneId: route.laneId === 'main' ? null : route.laneId,
				force
			});
		} catch (err: unknown) {
			errorMessage = err instanceof Error ? err.message : (err as { message?: string })?.message ?? String(err);
		}
	}

	async function handleCompactContext(): Promise<void> {
		if (!canSessionControl || disabledReason) return;
		errorMessage = null;
		try {
			await connection.sendCommand(route.hostId, {
				kind: 'compact_context',
				projectId: route.projectId,
				laneId: route.laneId === 'main' ? null : route.laneId
			});
		} catch (err: unknown) {
			errorMessage = err instanceof Error ? err.message : (err as { message?: string })?.message ?? String(err);
		}
	}

	async function loadInitialHistory(): Promise<void> {
		if (!canChat) return;
		historyReady = false;
		loadingHistory = true;
		errorMessage = null;
		try {
			const res = (await connection.sendCommand(route.hostId, {
				kind: 'chat_history',
				projectId: route.projectId,
				laneId: route.laneId === 'main' ? null : route.laneId,
				before: null,
				limit: 50
			})) as RemoteChatPage | undefined;

			if (res && Array.isArray(res.messages)) {
				const merged = applyChatPage(messages, res, 'replace');
				messages = merged.messages;
				beforeCursor = merged.before;
				historyReady = true;
			}
		} catch (err: unknown) {
			const e = err as { message?: string };
			errorMessage = e?.message || t('chatLoadError');
		} finally {
			loadingHistory = false;
		}
	}

	async function loadOlderMessages(): Promise<void> {
		if (!beforeCursor || loadingOlder || !canChat) return;
		loadingOlder = true;
		errorMessage = null;
		try {
			const res = (await connection.sendCommand(route.hostId, {
				kind: 'chat_history',
				projectId: route.projectId,
				laneId: route.laneId === 'main' ? null : route.laneId,
				before: beforeCursor,
				limit: 50
			})) as RemoteChatPage | undefined;

			if (res && Array.isArray(res.messages)) {
				const merged = applyChatPage(messages, res, 'prepend');
				messages = merged.messages;
				beforeCursor = merged.before;
			}
		} catch (err: unknown) {
			const e = err as { message?: string };
			errorMessage = e?.message || t('chatLoadOlderError');
		} finally {
			loadingOlder = false;
		}
	}

	function handleIncomingChatEvent(event: RemoteChatEvent): void {
		if (event.kind === 'reset') {
			messages = [];
			beforeCursor = null;
			void loadInitialHistory();
			void fetchComposerCatalog(true);
			return;
		}
		messages = applyChatEvent(messages, event);
	}

	async function handleSend(
		text: string,
		whileBusy: 'steer' | 'follow_up',
		attachments?: RemoteComposerAttachment[]
	): Promise<void> {
		errorMessage = null;
		try {
			const effectiveAttachments = attachments ? [...attachments] : [];
			const stillStaging = effectiveAttachments.some((a) => a.status === 'staging');
			if (stillStaging) {
				throw new Error('Salvataggio allegati ancora in corso sull\'host, attendi...');
			}
			const hasError = effectiveAttachments.some((a) => a.status === 'error');
			if (hasError) {
				throw new Error('Uno o più allegati non sono stati salvati correttamente. Rimuovili o riprova.');
			}

			const stagedNonImages = effectiveAttachments.filter((a) => a.kind !== 'image' && a.stagedPath);

			let totalInlineBytes = 0;
			const imagesToSend: RemotePromptImage[] = [];
			let totalPhysicalImageBytes = 0;
			for (const att of effectiveAttachments) {
				if (att.kind === 'image') {
					if (att.stagedPath) {
						imagesToSend.push({
							type: 'image',
							path: att.stagedPath,
							mimeType: att.mimeType || 'image/jpeg'
						});
					} else if (att.base64) {
						totalInlineBytes += att.base64.length;
						imagesToSend.push({
							type: 'image',
							data: att.base64,
							mimeType: att.mimeType || 'image/jpeg'
						});
					}
					if (att.base64) {
						totalPhysicalImageBytes += att.base64.length;
					}
				}
			}

			if (totalInlineBytes > 400_000) {
				throw new Error('Il payload complessivo delle immagini inline supera il limite del frame remoto (512 KiB). Attendi il completamento dello staging.');
			}

			if (totalPhysicalImageBytes + text.length > 700_000) {
				throw new Error('Il payload complessivo delle immagini supera il limite massimo supportato dal modello (700 KB base64). Riduci le immagini allegate.');
			}

			await connection.sendCommand(route.hostId, {
				kind: 'send_prompt',
				projectId: route.projectId,
				laneId: route.laneId === 'main' ? null : route.laneId,
				text: text.trim(),
				whileBusy,
				images: imagesToSend.length > 0 ? imagesToSend : undefined,
				attachments: stagedNonImages.length > 0
					? stagedNonImages.map((a) => ({ path: a.stagedPath!, name: a.name }))
					: undefined
			});
			queueMicrotask(() => {
				transcriptRef?.scrollToBottom(true);
			});
		} catch (err: unknown) {
			const e = err as { message?: string };
			errorMessage = e?.message || t('chatSendError');
			throw err;
		}
	}

	async function handleStop(): Promise<void> {
		errorMessage = null;
		try {
			await connection.sendCommand(route.hostId, {
				kind: 'abort',
				projectId: route.projectId,
				laneId: route.laneId === 'main' ? null : route.laneId
			});
		} catch (err: unknown) {
			const e = err as { message?: string };
			errorMessage = e?.message || t('chatStopError');
			throw err;
		}
	}

	$effect(() => {
		if (connection.status !== 'connected') return;
		void loadInitialHistory();
		void fetchComposerCatalog();
		const unlisten = connection.subscribeChat(
			route.hostId,
			route.projectId,
			route.laneId,
			(ev) => {
				handleIncomingChatEvent(ev);
			}
		);
		return () => {
			unlisten();
		};
	});
</script>

<div class="chat-view-container safe-top">
	<!-- Intestazione della corsia (allineata alla barra superiore di Studio) -->
	<header class="chat-header">
		<button
			type="button"
			class="header-back-btn"
			onclick={() => navigation.closeChat()}
			aria-label={t('chatBack')}
			title={t('chatBack')}
		>
			<IconArrowLeft />
		</button>

		<div class="header-titles">
			<div class="header-context-line">
				{#if project}
					<span
						class="project-hue-dot"
						style:background="hsl({project.hue}, 70%, 55%)"
					></span>
					<span class="context-project">{project.name}</span>
					<span class="header-sep">/</span>
				{/if}
				<span class="context-host">{hostName}</span>
				{#if laneKindLabel}
					<span class="header-sep">/</span>
					<span class="lane-kind-badge">{laneKindLabel}</span>
				{/if}
				{#if lane?.title}
					<span class="header-sep">/</span>
					<span class="context-lane">{lane.title}</span>
				{/if}
			</div>
			<div class="header-title-line">
				<h1 class="chat-conversation-title">{conversationTitle}</h1>
			</div>
		</div>

		<div class="header-right">
			{#if showNewChat}
				<button
					type="button"
					class="composer-icon-btn new-chat-btn"
					disabled={!canStartNewChat}
					onclick={handleNewSession}
					title={newChatTooltip}
					aria-label={newChatTooltip}
				>
					<IconNewChat />
				</button>
			{/if}

			{#if lane}
				<span class="agent-mark-wrapper" class:pulse={isWorking}>
					<StatusMark
						status={lane.agent.state === 'working'
							? 'running'
							: lane.agent.state === 'attention'
								? 'attention'
								: lane.agent.state === 'error'
									? 'failed'
									: 'pending'}
					/>
				</span>
			{/if}

			{#if !canLaneConfig && modelLabel}
				<span class="header-model-label font-mono">{modelLabel}</span>
			{/if}
			<button
				type="button"
				class="composer-icon-btn op-info-btn"
				onclick={() => (showOperationalSheet = !showOperationalSheet)}
				title={t('operationalDetailsTitle')}
				aria-label={t('operationalDetailsTitle')}
			>
				<IconInfo />
			</button>
			<span class="header-host-name">{hostName}</span>
		</div>
	</header>
	{#if operationalChips.length > 0}
		<button
			type="button"
			class="chat-operational-chips-bar"
			onclick={() => (showOperationalSheet = true)}
			aria-label={t('operationalDetailsTitle')}
		>
			{#each operationalChips as chip (chip)}
				<span class="op-chip font-mono">{chip}</span>
			{/each}
		</button>
	{/if}


	{#if errorMessage}
		<div class="chat-error-banner" role="alert">
			<span>{errorMessage}</span>
		</div>
	{/if}

	<div class="chat-content-split">
		<div class="chat-stream-column">
	<!-- Trascrizione centrale dei turni -->
	<main class="chat-main">
		<Transcript
			bind:this={transcriptRef}
			{messages}
			{loadingOlder}
			hasOlder={Boolean(beforeCursor)}
			onLoadOlder={loadOlderMessages}
			{isWorking}
			agentActivityText={lane?.agent.activity?.text}
			agentActivityStartedAt={lane?.agent.activity?.at}
			onOpenImage={openImageModal}
		/>
	</main>

	<!-- Riquadro inferiore: AttentionCard o Composer docked -->
	<footer class="footer-stack safe-bottom">
		<div class="footer-inner readable">
			{#if pendingAttention && !askMinimized}
				<!-- La richiesta di attenzione prende il posto del composer come AskCard in Studio -->
				<div class="attention-dock-slot rv-lift">
					<div class="attention-dock-header">
						<button
							type="button"
							class="composer-icon-btn"
							onclick={() => (askMinimized = true)}
							title={t('chatAskMinimize')}
							aria-label={t('chatAskMinimize')}
						>
							<IconChevronDown />
						</button>
					</div>
					<div class="attention-scroll-area">
						<AttentionCard
							hostId={route.hostId}
							{hostName}
							{hostFeatures}
							projectId={route.projectId}
							attention={pendingAttention}
						/>
					</div>
				</div>
			{:else}
				{#if pendingAttention && askMinimized}
					<button type="button" class="minimized-ask" onclick={() => (askMinimized = false)}>
						<StatusMark status="attention" />
						<span class="minimized-ask-text">{attentionText}</span>
						<span class="minimized-ask-action">{t('chatAskReopen')}</span>
						<IconChevronUp />
					</button>
				{/if}
				<ComposerTray todos={latestTodos} />
				<Composer
					isWorking={lane?.agent.state === 'working'}
					disabled={Boolean(disabledReason)}
					{disabledReason}
					{canSessionControl}
					hasLaneConfig={canLaneConfig}
					role={activeRole}
					modelLabel={activeModelLabel}
					modelId={activeModelId}
					provider={activeProvider}
					thinkingLevel={activeThinking}
					machineName={hostName}
					{catalog}
					context={lane?.agent.context ?? null}
					onRefreshContext={handleRefreshContext}
					onCompactContext={handleCompactContext}
					onSend={handleSend}
					onStop={handleStop}
					onSetRole={handleSetRole}
					onSetModel={handleSetModel}
					onSetThinking={handleSetThinking}
					onNewSession={handleNewSession}
					onOpenImage={openImageModal}
					hostId={route.hostId}
					projectId={route.projectId}
					laneId={route.laneId === 'main' ? null : route.laneId}
					{connection}
					onNotice={(type, msg) => {
						errorMessage = msg;
					}}
				/>
			{/if}
		</div>
	</footer>
		</div>

		{#if project}
			<aside class="chat-operational-sidebar">
				<OperationalDetails
					hostId={route.hostId}
					{hostName}
					{hostFeatures}
					{project}
					{lane}
				/>
			</aside>
		{/if}
	</div>

	{#if showOperationalSheet && project}
		<dialog
			bind:this={operationalDialogEl}
			class="mobile-operational-backdrop"
			onclick={(event) => { if (event.target === event.currentTarget) showOperationalSheet = false; }}
			oncancel={() => (showOperationalSheet = false)}
			onclose={() => (showOperationalSheet = false)}
			aria-label={t('operationalDetailsTitle')}
		>
			<div class="mobile-operational-sheet">
				<OperationalDetails
					hostId={route.hostId}
					{hostName}
					{hostFeatures}
					{project}
					{lane}
					onClose={() => (showOperationalSheet = false)}
				/>
			</div>
		</dialog>
	{/if}
	{#if activeImageModal}
		<dialog bind:this={imageDialogEl} class="image-modal-backdrop"
			aria-label={t('chatImageCountSingular')}
			onclick={(event) => { if (event.target === event.currentTarget) closeImageModal(); }}
			onclose={closeImageModal} oncancel={closeImageModal}>
			<button type="button" class="image-modal-close" onclick={closeImageModal} aria-label={t('close')}>
				<IconClose />
			</button>
			<img src={activeImageModal.url} alt={t('chatImageCountSingular')} class="image-modal-img" />
		</dialog>
	{/if}
</div>
<style>
	.image-modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 9999;
		background: rgba(0, 0, 0, 0.82);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-4);
		width: 100vw;
		height: 100dvh;
		max-width: none;
		max-height: none;
		border: 0;
		margin: 0;
		box-sizing: border-box;
		backdrop-filter: blur(4px);
	}

	.image-modal-close {
		position: absolute;
		top: var(--space-4);
		right: var(--space-4);
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.15);
		border: none;
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: background 120ms ease;
		--icon-size: 20px;
	}

	.image-modal-close:hover {
		background: rgba(255, 255, 255, 0.3);
	}

	.image-modal-img {
		max-width: 90vw;
		max-height: 85vh;
		object-fit: contain;
		border-radius: var(--radius-md);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
	}

	.chat-view-container {
		position: relative;
		width: 100%;
		height: 100%;
		background: var(--bg-sunken);
		display: flex;
		flex-direction: column;
		min-width: 0;
		overflow: hidden;
	}

	/* ---------------------------------------------------- Intestazione corsia */

	.chat-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 56px;
		padding: 6px var(--space-3);
		background: var(--bg-raised);
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
		z-index: var(--z-dock);
	}

	.header-back-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		cursor: pointer;
		--icon-size: 18px;
		transition:
			background-color var(--dur-fast),
			color var(--dur-fast);
	}

	.header-back-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.header-titles {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 3px;
		min-width: 0;
		overflow: hidden;
		flex: 1;
	}
	.header-context-line {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		font-size: var(--text-mini, 11px);
		color: var(--ink-muted);
		line-height: 1.2;
	}

	.context-project,
	.context-host,
	.context-lane {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.header-title-line {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		width: 100%;
	}

	.chat-conversation-title {
		font-size: var(--text-label, 14px);
		font-weight: 600;
		color: var(--ink);
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.chat-operational-chips-bar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 12px;
		background: var(--bg-sunken);
		border-bottom: 1px solid var(--line);
		overflow-x: auto;
		cursor: pointer;
		border-top: none;
		border-left: none;
		border-right: none;
		text-align: left;
		flex-shrink: 0;
	}

	.op-chip {
		display: inline-flex;
		align-items: center;
		padding: 2px 8px;
		border-radius: var(--radius-sm, 6px);
		background: var(--bg-base);
		border: 1px solid var(--line);
		font-size: var(--text-mini, 11px);
		color: var(--ink-muted);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.op-info-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.chat-content-split {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: row;
		overflow: hidden;
	}

	.chat-stream-column {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
	}

	.chat-operational-sidebar {
		width: 320px;
		flex-shrink: 0;
		border-left: 1px solid var(--line);
		display: none;
		background: var(--bg-base);
		overflow: hidden;
	}

	@media (min-width: 1200px) {
		.chat-operational-sidebar {
			display: flex;
		}
	}

	.mobile-operational-backdrop {
		position: fixed;
		inset: 0;
		margin: 0;
		padding: 0;
		border: 0;
		width: 100%;
		height: 100dvh;
		max-width: none;
		max-height: none;
		box-sizing: border-box;
		z-index: 200;
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
	}

	.mobile-operational-sheet {
		max-height: 80vh;
		background: var(--bg-base);
		border-radius: var(--radius-xl, 16px) var(--radius-xl, 16px) 0 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		box-shadow: var(--shadow-dock);
		border-top: 1px solid var(--line);
	}


	.project-hue-dot {
		width: 8px;
		height: 8px;
		border-radius: var(--radius-full);
		flex-shrink: 0;
	}


	.header-sep {
		color: var(--ink-faint);
		opacity: 0.6;
		flex-shrink: 0;
	}


	.lane-kind-badge {
		padding: 1px 6px;
		background: var(--bg-hover);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		font-size: var(--text-caption);
		color: var(--ink-faint);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-left: auto;
		flex-shrink: 0;
	}

	.agent-mark-wrapper {
		display: inline-flex;
		align-items: center;
	}

	.agent-mark-wrapper.pulse {
		animation: state-pulse 2s infinite ease-in-out;
	}

	.header-model-label {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		padding: 1px 6px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		white-space: nowrap;
	}

	.header-host-name {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		white-space: nowrap;
	}

	.chat-error-banner {
		padding: var(--space-2) var(--space-3);
		background: color-mix(in oklch, var(--danger) 15%, transparent);
		border-bottom: 1px solid color-mix(in oklch, var(--danger) 30%, transparent);
		color: var(--danger);
		font-size: var(--text-sm);
		text-align: center;
	}

	/* ---------------------------------------------------- Trascrizione */

	.chat-main {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		min-width: 0;
		overflow: hidden;
	}

	/* ---------------------------------------------------- Dock inferiore */

	.footer-stack {
		position: relative;
		display: flex;
		flex-direction: column;
		background: var(--bg-sunken);
		padding-bottom: var(--space-3);
		min-width: 0;
		z-index: var(--z-sticky);
	}

	.footer-inner {
		position: relative;
		width: 100%;
		display: flex;
		flex-direction: column;
		min-width: 0;
		box-sizing: border-box;
		padding-inline: var(--space-3);
	}

	.footer-inner.readable {
		max-width: 720px;
		margin: 0 auto;
	}

	.attention-dock-slot {
		width: 100%;
	}

	/* La riduzione sta sopra la scheda, a destra, come la freccia di AskCard. */
	.attention-dock-header {
		display: flex;
		justify-content: flex-end;
		margin-bottom: var(--space-1);
	}

	/* Riga ridotta: la domanda resta visibile sopra il composer, come il vassoio di Studio. */
	.minimized-ask {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		min-height: 36px;
		margin-bottom: var(--space-2);
		padding: 0 var(--space-3);
		border: 1px solid color-mix(in oklab, var(--warn) 35%, transparent);
		border-radius: var(--radius-lg);
		background: color-mix(in oklab, var(--warn) 10%, var(--bg-raised));
		color: var(--ink);
		font-size: var(--text-label);
		text-align: left;
		--icon-size: 14px;
	}

	.minimized-ask:hover {
		background: color-mix(in oklab, var(--warn) 16%, var(--bg-raised));
	}

	.minimized-ask-text {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.minimized-ask-action {
		flex-shrink: 0;
		color: var(--ink-muted);
		font-size: var(--text-caption);
	}

	@media (max-width: 480px) {
		.header-model-label,
		.header-host-name {
			display: none;
		}
		.header-back-btn {
			width: 40px;
			height: 40px;
		}
	}
</style>
