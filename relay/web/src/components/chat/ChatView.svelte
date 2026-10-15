<!--
  ChatView.svelte — Vista a tutto schermo della chat di una corsia.
  Header della corsia fedele a Studio (tessera progetto, titolo, tipo, macchina, stato agente, modello),
  trascrizione cronologica centrata (720px), ComposerTray e Composer / AttentionCard ancorati in basso.
-->
<script lang="ts">
	import { t } from '../../i18n.ts';
	import { navigation, type ChatRoute } from '../../navigation.svelte.ts';
	import { connection } from '../../connection.svelte.ts';
	import type {
		Feature,
		RemoteAttention,
		RemoteChatEvent,
		RemoteChatMessage,
		RemoteChatPage,
		RemoteComposerCatalog,
		RemoteLane,
		RemoteProject
	} from '../../../../src/protocol.ts';
	import { applyChatEvent, applyChatPage } from '../../chat/merge.ts';
	import Transcript from './Transcript.svelte';
	import Composer from './Composer.svelte';
	import ComposerTray from './ComposerTray.svelte';
	import AttentionCard from '../AttentionCard.svelte';
	import StatusMark from '../StatusMark.svelte';
	import { IconArrowLeft, IconChevronDown, IconChevronUp, IconNewChat } from '../../icons.ts';

	let { route }: { route: ChatRoute } = $props();

	let messages = $state<RemoteChatMessage[]>([]);
	let beforeCursor = $state<string | null>(null);
	let loadingHistory = $state(false);
	let loadingOlder = $state(false);
	let errorMessage = $state<string | null>(null);
	let transcriptRef = $state<ReturnType<typeof Transcript> | null>(null);
	let askMinimized = $state(false);

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
	const canStartNewChat = $derived(showNewChat && !isBusy && connection.status === 'connected');
	const newChatTooltip = $derived(isBusy ? t('newChatDisabledBusy') : t('newChat'));

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
		errorMessage = null;
		try {
			await connection.sendCommand(route.hostId, {
				kind: 'new_session',
				projectId: route.projectId,
				laneId: route.laneId === 'main' ? null : route.laneId
			});
		} catch (err: unknown) {
			const e = err as { message?: string };
			errorMessage = e?.message || t('newChatError');
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

	async function loadInitialHistory(): Promise<void> {
		if (!canChat) return;
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

	async function handleSend(text: string, whileBusy: 'steer' | 'follow_up'): Promise<void> {
		errorMessage = null;
		try {
			await connection.sendCommand(route.hostId, {
				kind: 'send_prompt',
				projectId: route.projectId,
				laneId: route.laneId === 'main' ? null : route.laneId,
				text,
				whileBusy
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
			{#if project}
				<span
					class="project-hue-dot"
					style:background="hsl({project.hue}, 70%, 55%)"
				></span>
				<span class="project-name">{project.name}</span>
				<span class="header-sep">/</span>
			{/if}

			<span class="lane-title">{lane?.title ?? route.laneId}</span>
			{#if laneKindLabel}
				<span class="lane-kind-badge">{laneKindLabel}</span>
			{/if}
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

			<span class="header-host-name">{hostName}</span>
		</div>
	</header>

	{#if errorMessage}
		<div class="chat-error-banner" role="alert">
			<span>{errorMessage}</span>
		</div>
	{/if}

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
					onSend={handleSend}
					onStop={handleStop}
					onSetRole={handleSetRole}
					onSetModel={handleSetModel}
					onSetThinking={handleSetThinking}
					onNewSession={handleNewSession}
				/>
			{/if}
		</div>
	</footer>
</div>
<style>
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
		height: 48px;
		padding: 0 var(--space-3);
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
		align-items: center;
		gap: 6px;
		min-width: 0;
		overflow: hidden;
		flex: 1;
	}

	.project-hue-dot {
		width: 8px;
		height: 8px;
		border-radius: var(--radius-full);
		flex-shrink: 0;
	}

	.project-name {
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.header-sep {
		color: var(--ink-faint);
		opacity: 0.6;
		flex-shrink: 0;
	}

	.lane-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
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
