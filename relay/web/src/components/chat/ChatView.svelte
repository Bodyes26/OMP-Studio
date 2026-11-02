<!--
  ChatView.svelte — Chat di un ramo, pensata per il telefono (Gate R48, R-REM-04…07, R-REM-13).

  Intestazione su una riga (×, progetto con il ramo sotto, ⋯) e nient'altro fra
  intestazione e campo di scrittura: lo spazio va alla conversazione. Le domande
  dell'agente stanno nel flusso della chat, con un richiamo quando escono dalla
  vista; le richieste di altri progetti arrivano come avviso sovrapposto, senza
  spostare la vista ne' toccare la bozza. Se Studio chiude il ramo o il progetto
  la conversazione resta leggibile con il suo esito.
-->
<script lang="ts">
	import { t } from '../../i18n.ts';
	import { tick } from 'svelte';
	import { navigation, type LiveChatRoute } from '../../navigation.svelte.ts';
	import { connection } from '../../connection.svelte.ts';
	import { workSheet } from '../../work.svelte.ts';
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
	import { getLaneStatus, getLaneSummary } from '../../projectHelpers.ts';
	import Transcript from './Transcript.svelte';
	import Composer from './Composer.svelte';
	import AttentionCard from '../AttentionCard.svelte';
	import ContextControl from './ContextControl.svelte';
	import QuotaSheet from '../QuotaSheet.svelte';
	import ProjectHistorySheet from '../ProjectHistorySheet.svelte';
	import { IconClose, IconMore, IconChevronDown, IconArrowUp, IconArrowDown } from '../../icons.ts';
	import type { RemoteComposerAttachment } from '../../chat/remoteAttachments.svelte.ts';
	import { setAgentUiHooks } from '#lib/agent/ui-context.ts';
	import { PreviewStore, setPreviewContext } from '../../preview.svelte.ts';
	import PreviewSurface from './PreviewSurface.svelte';

	let { route }: { route: LiveChatRoute } = $props();

	const wireLaneId = $derived(route.laneId === 'main' ? null : route.laneId);

	let messages = $state<RemoteChatMessage[]>([]);
	let beforeCursor = $state<string | null>(null);
	let loadingHistory = $state(false);
	let loadingOlder = $state(false);
	let errorMessage = $state<string | null>(null);
	let transcriptRef = $state<ReturnType<typeof Transcript> | null>(null);
	let activeImageModal = $state<{ url: string; mimeType?: string } | null>(null);
	let imageDialogEl = $state<HTMLDialogElement | null>(null);
	let pageVisible = $state(false);
	let historyReady = $state(false);

	// Fogli aperti dal menu ⋯ e dall'intestazione: uno alla volta.
	let sheet = $state<'menu' | 'branches' | 'quota' | 'history' | null>(null);

	const preview = new PreviewStore();
	setPreviewContext(preview);
	let expandPreview = $state(false);

	$effect(() => {
		preview.setRouteContext({
			hostId: route.hostId,
			projectId: route.projectId,
			laneId: wireLaneId,
			isHistory: false
		});
	});

	$effect(() => () => preview.destroy());

	$effect(() => {
		if (!preview.isOpen) expandPreview = false;
	});

	setAgentUiHooks({
		openDiagram: (diagram) => {
			if (!hostFeatures.includes('artifacts')) return;
			void preview.open({
				kind: 'mermaid',
				title: diagram.title || t('artifactKindDiagram'),
				content: diagram.mermaid
			});
		},
		openImage: (data, mimeType) => {
			openImageModal(data.startsWith('data:') ? data : `data:${mimeType};base64,${data}`, mimeType);
		},
		openFile: () => {},
		openSubagent: () => {},
		switchToTerminal: () => {}
	});

	let isWide = $state(typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : true);
	$effect(() => {
		const mql = window.matchMedia('(min-width: 1024px)');
		const handler = (e: MediaQueryListEvent) => {
			isWide = e.matches;
		};
		mql.addEventListener('change', handler);
		isWide = mql.matches;
		return () => mql.removeEventListener('change', handler);
	});

	$effect(() => {
		const update = () => {
			pageVisible = document.visibilityState === 'visible';
		};
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

	const host = $derived(connection.hosts.find((h) => h.id === route.hostId));
	const hostName = $derived(host?.name ?? '');
	const hostFeatures = $derived<Feature[]>(host?.features ?? []);
	const hostOnline = $derived(Boolean(host?.online));

	const hostState = $derived(connection.hostStates[route.hostId]?.state);
	const project = $derived<RemoteProject | undefined>(hostState?.projects.find((p) => p.id === route.projectId));
	const lane = $derived<RemoteLane | undefined>(project?.lanes.find((l) => l.id === route.laneId));

	// Ultimo stato visto: quando Studio chiude ramo o progetto la chat resta
	// leggibile con il suo esito invece di svuotarsi (R-REM-13).
	let lastProject = $state<RemoteProject | null>(null);
	let lastLane = $state<RemoteLane | null>(null);
	$effect(() => {
		if (project) lastProject = project;
	});
	$effect(() => {
		if (lane) lastLane = lane;
	});

	const viewProject = $derived(project ?? lastProject);
	const viewLane = $derived(lane ?? lastLane);
	const projectClosed = $derived(Boolean(hostState && !project && lastProject));
	const laneClosed = $derived(Boolean(hostState && project && !lane && lastLane));

	const canSessionControl = $derived(hostFeatures.includes('session_control'));
	const canChat = $derived(hostFeatures.includes('chat'));
	const canLaneConfig = $derived(hostFeatures.includes('lane_config'));
	const isWorking = $derived(lane?.agent.state === 'working');

	let catalog = $state<RemoteComposerCatalog | null>(null);

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

	// L'override ottimistico vale finche' l'istantanea non conferma il nuovo valore.
	$effect(() => {
		if (lane?.agent.role && lane.agent.role === optimisticRole) optimisticRole = null;
		if (lane?.agent.modelId && lane.agent.modelId === optimisticModelId) {
			optimisticModelId = null;
			optimisticModelLabel = null;
			optimisticProvider = null;
		}
		if (lane?.agent.thinkingLevel && lane.agent.thinkingLevel === optimisticThinking) optimisticThinking = null;
	});

	const sessionSnapshot = $derived(lane?.session);

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
					laneId: wireLaneId,
					sessionId,
					completionId: completion.id
				}).catch((error: unknown) => {
					errorMessage = messageOf(error, t('errFailed'));
				});
			});
		});
		return () => {
			cancelled = true;
			cancelAnimationFrame(frame);
		};
	});

	function messageOf(err: unknown, fallback: string): string {
		if (err instanceof Error && err.message) return err.message;
		const message = (err as { message?: unknown } | null)?.message;
		return typeof message === 'string' && message ? message : fallback;
	}

	async function fetchComposerCatalog(): Promise<void> {
		if (!canLaneConfig || connection.status !== 'connected') return;
		try {
			const res = (await connection.sendCommand(route.hostId, {
				kind: 'composer_catalog',
				projectId: route.projectId,
				laneId: wireLaneId
			})) as RemoteComposerCatalog | undefined;
			if (res) catalog = res;
		} catch (err: unknown) {
			console.warn('[ChatView] Catalogo del composer non disponibile:', err);
		}
	}

	async function handleSetRole(roleId: string): Promise<void> {
		if (!canLaneConfig) return;
		optimisticRole = roleId;
		const roleOpt = catalog?.roles.find((r) => r.id === roleId);
		if (roleOpt?.model) {
			const slash = roleOpt.model.indexOf('/');
			optimisticProvider = slash > 0 ? roleOpt.model.slice(0, slash) : null;
			optimisticModelId = slash > 0 ? roleOpt.model.slice(slash + 1) : roleOpt.model;
			optimisticModelLabel = roleOpt.modelLabel ?? optimisticModelId;
			if (roleOpt.thinking) optimisticThinking = roleOpt.thinking;
		}
		errorMessage = null;
		try {
			await connection.sendCommand(route.hostId, {
				kind: 'set_lane_role',
				projectId: route.projectId,
				laneId: wireLaneId,
				roleId
			});
			void fetchComposerCatalog();
		} catch (err: unknown) {
			optimisticRole = null;
			optimisticModelId = null;
			optimisticModelLabel = null;
			optimisticProvider = null;
			optimisticThinking = null;
			errorMessage = messageOf(err, t('errFailed'));
		}
	}

	async function handleSetModel(provider: string, modelId: string): Promise<void> {
		if (!canLaneConfig) return;
		optimisticProvider = provider;
		optimisticModelId = modelId;
		optimisticModelLabel = catalog?.models.find((m) => m.provider === provider && m.id === modelId)?.name ?? modelId;
		errorMessage = null;
		try {
			await connection.sendCommand(route.hostId, {
				kind: 'set_lane_model',
				projectId: route.projectId,
				laneId: wireLaneId,
				provider,
				modelId
			});
			// I livelli di ragionamento dipendono dal modello appena scelto.
			void fetchComposerCatalog();
		} catch (err: unknown) {
			optimisticModelId = null;
			optimisticModelLabel = null;
			optimisticProvider = null;
			errorMessage = messageOf(err, t('errFailed'));
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
				laneId: wireLaneId,
				level
			});
		} catch (err: unknown) {
			optimisticThinking = null;
			errorMessage = messageOf(err, t('errFailed'));
		}
	}

	// Richiesta di questa corsia: quelle senza corsia sono della Principale.
	const pendingAttention = $derived<RemoteAttention | null>(
		project?.attention?.find((a) => a.laneId === route.laneId || (!a.laneId && route.laneId === 'main')) ?? null
	);

	// --- Richiamo «Domanda in attesa» (R-REM-05) ---------------------------------
	let attentionEl = $state<HTMLDivElement | null>(null);
	let attentionPosition = $state<'visible' | 'above' | 'below'>('visible');

	$effect(() => {
		const el = attentionEl;
		if (!el) {
			attentionPosition = 'visible';
			return;
		}
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) {
					attentionPosition = 'visible';
					return;
				}
				const rootTop = entry.rootBounds?.top ?? 0;
				attentionPosition = entry.boundingClientRect.top < rootTop ? 'above' : 'below';
			},
			{ threshold: 0.2 }
		);
		observer.observe(el);
		return () => observer.disconnect();
	});

	function scrollToAttention(): void {
		attentionEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}

	// --- Richieste in altri progetti (R-REM-05) -----------------------------------
	interface ElsewhereNotice {
		requestId: string;
		projectId: string;
		laneId: string;
		projectName: string;
		text: string;
	}

	let notice = $state<ElsewhereNotice | null>(null);
	// Richieste gia' presenti all'apertura: l'avviso riguarda solo quelle nuove.
	let knownRequests: Set<string> | null = null;

	$effect(() => {
		const projects = hostState?.projects;
		if (!projects) return;
		const current = new Set<string>();
		let fresh: ElsewhereNotice | null = null;
		for (const p of projects) {
			for (const a of p.attention ?? []) {
				current.add(a.requestId);
				if (p.id === route.projectId || !knownRequests || knownRequests.has(a.requestId)) continue;
				fresh = {
					requestId: a.requestId,
					projectId: p.id,
					laneId: a.laneId ?? 'main',
					projectName: p.name,
					text: a.questions[0]?.question || a.title || a.message || t('attentionFallbackTitle')
				};
			}
		}
		knownRequests = current;
		if (fresh) notice = fresh;
		else if (notice && !current.has(notice.requestId)) notice = null;
	});

	function openNotice(): void {
		const target = notice;
		if (!target) return;
		notice = null;
		navigation.openChat({ hostId: route.hostId, projectId: target.projectId, laneId: target.laneId });
	}

	// --- Stato del composer -------------------------------------------------------
	const disabledReason = $derived.by(() => {
		if (connection.status !== 'connected') return t('chatReconnecting');
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
				laneId: wireLaneId,
				force
			});
		} catch (err: unknown) {
			errorMessage = messageOf(err, t('errFailed'));
		}
	}

	async function handleCompactContext(): Promise<void> {
		if (!canSessionControl || disabledReason) return;
		errorMessage = null;
		sheet = null;
		try {
			await connection.sendCommand(route.hostId, {
				kind: 'compact_context',
				projectId: route.projectId,
				laneId: wireLaneId
			});
		} catch (err: unknown) {
			errorMessage = messageOf(err, t('errFailed'));
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
				laneId: wireLaneId,
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
			errorMessage = messageOf(err, t('chatLoadError'));
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
				laneId: wireLaneId,
				before: beforeCursor,
				limit: 50
			})) as RemoteChatPage | undefined;
			if (res && Array.isArray(res.messages)) {
				const merged = applyChatPage(messages, res, 'prepend');
				messages = merged.messages;
				beforeCursor = merged.before;
			}
		} catch (err: unknown) {
			errorMessage = messageOf(err, t('chatLoadOlderError'));
		} finally {
			loadingOlder = false;
		}
	}

	function handleIncomingChatEvent(event: RemoteChatEvent): void {
		if (event.kind === 'reset') {
			messages = [];
			beforeCursor = null;
			preview.reset();
			void loadInitialHistory();
			void fetchComposerCatalog();
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
			if (effectiveAttachments.some((a) => a.status === 'staging')) throw new Error(t('chatAttachStaging'));
			if (effectiveAttachments.some((a) => a.status === 'error')) throw new Error(t('chatAttachFailed'));

			const stagedNonImages = effectiveAttachments.filter((a) => a.kind !== 'image' && a.stagedPath);
			let totalInlineBytes = 0;
			let totalPhysicalImageBytes = 0;
			const imagesToSend: RemotePromptImage[] = [];
			for (const att of effectiveAttachments) {
				if (att.kind !== 'image') continue;
				if (att.stagedPath) {
					imagesToSend.push({ type: 'image', path: att.stagedPath, mimeType: att.mimeType || 'image/jpeg' });
				} else if (att.base64) {
					totalInlineBytes += att.base64.length;
					imagesToSend.push({ type: 'image', data: att.base64, mimeType: att.mimeType || 'image/jpeg' });
				}
				if (att.base64) totalPhysicalImageBytes += att.base64.length;
			}
			// Il frame del relay e' di 512 KiB: le immagini inline devono restarci dentro.
			if (totalInlineBytes > 400_000) throw new Error(t('chatImagesFrameLimit'));
			if (totalPhysicalImageBytes + text.length > 700_000) throw new Error(t('chatImagesModelLimit'));

			await connection.sendCommand(route.hostId, {
				kind: 'send_prompt',
				projectId: route.projectId,
				laneId: wireLaneId,
				text: text.trim(),
				whileBusy,
				images: imagesToSend.length > 0 ? imagesToSend : undefined,
				attachments: stagedNonImages.length > 0
					? stagedNonImages.map((a) => ({ path: a.stagedPath!, name: a.name }))
					: undefined
			});
			queueMicrotask(() => transcriptRef?.scrollToBottom(true));
		} catch (err: unknown) {
			errorMessage = messageOf(err, t('chatSendError'));
			throw err;
		}
	}

	async function handleStop(): Promise<void> {
		errorMessage = null;
		try {
			await connection.sendCommand(route.hostId, {
				kind: 'abort',
				projectId: route.projectId,
				laneId: wireLaneId
			});
		} catch (err: unknown) {
			errorMessage = messageOf(err, t('chatStopError'));
			throw err;
		}
	}

	$effect(() => {
		if (connection.status !== 'connected') return;
		void loadInitialHistory();
		void fetchComposerCatalog();
		const unlisten = connection.subscribeChat(route.hostId, route.projectId, route.laneId, (ev) => {
			handleIncomingChatEvent(ev);
		});
		return () => unlisten();
	});

	// --- Navigazione fra rami e chiusure ------------------------------------------
	function openLane(laneId: string): void {
		sheet = null;
		if (laneId === route.laneId) return;
		navigation.openChat({ hostId: route.hostId, projectId: route.projectId, laneId });
	}

	let reopening = $state(false);
	const canReopen = $derived(Boolean(lastProject?.path) && hostFeatures.includes('projects') && hostOnline);

	async function reopenProject(): Promise<void> {
		const path = lastProject?.path;
		if (!path || reopening) return;
		reopening = true;
		errorMessage = null;
		try {
			const res = (await connection.sendCommand(route.hostId, { kind: 'open_project', path })) as
				| { projectId: string }
				| undefined;
			const projectId = res?.projectId ?? route.projectId;
			navigation.openChat({ hostId: route.hostId, projectId, laneId: 'main' });
		} catch (err: unknown) {
			errorMessage = messageOf(err, t('errFailed'));
		} finally {
			reopening = false;
		}
	}

	const laneKindLabel = $derived.by(() => {
		if (viewLane?.kind === 'main') return t('laneMain');
		if (viewLane?.kind === 'lab') return t('laneLab');
		return '';
	});
	const branchLabel = $derived(viewLane ? (viewLane.kind === 'main' ? t('laneMain') : viewLane.title) : route.laneId);
	const hasOtherLanes = $derived((project?.lanes.length ?? 0) > 1);

	const menuItems = $derived.by(() => {
		const items: Array<{ id: 'new' | 'branches' | 'history' | 'quota'; label: string }> = [];
		if (project && hostFeatures.includes('task_edit')) items.push({ id: 'new', label: t('chatMenuNewWork') });
		if (hasOtherLanes) items.push({ id: 'branches', label: t('chatMenuBranches') });
		if (viewProject && hostFeatures.includes('fleet')) items.push({ id: 'history', label: t('chatMenuHistory') });
		if (hostState?.quota) items.push({ id: 'quota', label: t('chatMenuQuota') });
		return items;
	});

	function pickMenu(id: 'new' | 'branches' | 'history' | 'quota'): void {
		if (id === 'new') {
			sheet = null;
			workSheet.openNew({ hostId: route.hostId, projectId: route.projectId });
			return;
		}
		sheet = id;
	}

	const showContextRow = $derived(Boolean(lane?.agent.context) && canSessionControl);
	const hideChatColumn = $derived(isWide && preview.isOpen && expandPreview);
</script>

<div class="chat-view safe-top">
	<header class="chat-bar">
		<button
			type="button"
			class="icon-btn"
			onclick={() => navigation.closeChat()}
			aria-label={t('chatClose')}
			title={t('chatClose')}
			data-testid="back-home"
		>
			<IconClose />
		</button>

		<button
			type="button"
			class="bar-title"
			disabled={!hasOtherLanes}
			onclick={() => (sheet = 'branches')}
			aria-label={hasOtherLanes ? t('chatChangeBranch') : undefined}
			data-testid="branch-switch"
		>
			<span class="bar-project">{viewProject?.name ?? ''}</span>
			<span class="bar-branch">
				<span class="branch-dot {viewLane && project && lane ? getLaneStatus(project, lane) : 'idle'}" aria-hidden="true"></span>
				<span class="branch-name">{branchLabel}</span>
				{#if laneKindLabel && viewLane?.kind !== 'main'}
					<span class="branch-kind">· {laneKindLabel}</span>
				{/if}
				{#if hasOtherLanes}
					<span class="branch-caret" aria-hidden="true"><IconChevronDown /></span>
				{/if}
			</span>
		</button>

		<button
			type="button"
			class="icon-btn"
			onclick={() => (sheet = 'menu')}
			aria-label={t('chatMenu')}
			title={t('chatMenu')}
			aria-haspopup="dialog"
			data-testid="menu"
		>
			<IconMore />
		</button>
	</header>

	{#if errorMessage}
		<div class="chat-error" role="alert">
			<span>{errorMessage}</span>
			<button type="button" class="error-dismiss" onclick={() => (errorMessage = null)} aria-label={t('close')}>
				<IconClose />
			</button>
		</div>
	{/if}

	<div class="chat-split" class:has-preview={preview.isOpen}>
		<div class="chat-column" class:hidden={hideChatColumn}>
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
					subagents={sessionSnapshot?.subagents ?? []}
					jobs={sessionSnapshot?.jobs ?? []}
					{hostFeatures}
					hostId={route.hostId}
					projectId={route.projectId}
					laneId={wireLaneId}
					isHistory={false}
				>
					{#if pendingAttention && project}
						<div class="attention-inline" bind:this={attentionEl} data-testid="attention">
							<AttentionCard
								hostId={route.hostId}
								{hostName}
								{hostFeatures}
								projectId={route.projectId}
								attention={pendingAttention}
							/>
						</div>
					{/if}
				</Transcript>

				{#if pendingAttention && attentionPosition !== 'visible'}
					<button type="button" class="ask-pill" onclick={scrollToAttention} data-testid="ask-pill">
						{#if attentionPosition === 'above'}
							<IconArrowUp />
						{:else}
							<IconArrowDown />
						{/if}
						<span>{t('chatAskPending')}</span>
					</button>
				{/if}

				{#if notice}
					<div class="notice" role="status">
						<span class="notice-dot" aria-hidden="true"></span>
						<span class="notice-text">
							<strong>{notice.projectName}</strong>
							<span>{notice.text}</span>
						</span>
						<button type="button" class="notice-open" onclick={openNotice}>{t('chatNoticeOpen')}</button>
						<button type="button" class="icon-btn small" onclick={() => (notice = null)} aria-label={t('close')}>
							<IconClose />
						</button>
					</div>
				{/if}
			</main>

			<footer class="chat-footer">
				<div class="footer-inner">
					{#if projectClosed}
						<div class="endbar" data-testid="project-closed">
							<span>{t('chatProjectClosed')}</span>
							{#if canReopen}
								<button type="button" class="endbar-btn" disabled={reopening} onclick={reopenProject}>
									{t('chatProjectReopen')}
								</button>
							{/if}
						</div>
					{:else if laneClosed}
						<div class="endbar" data-testid="branch-closed">
							<span>{t('chatBranchClosed')}</span>
							<button type="button" class="endbar-btn" onclick={() => openLane('main')}>
								{t('chatGoToMain')}
							</button>
						</div>
					{:else}
						<Composer
							isWorking={isWorking}
							disabled={Boolean(disabledReason)}
							{disabledReason}
							{canSessionControl}
							hasLaneConfig={canLaneConfig}
							role={activeRole}
							modelLabel={activeModelLabel}
							modelId={activeModelId}
							provider={activeProvider}
							thinkingLevel={activeThinking}
							{catalog}
							onSend={handleSend}
							onStop={handleStop}
							onSetRole={handleSetRole}
							onSetModel={handleSetModel}
							onSetThinking={handleSetThinking}
							onOpenImage={openImageModal}
							hostId={route.hostId}
							projectId={route.projectId}
							laneId={wireLaneId}
							{connection}
							onNotice={(_variant, msg) => {
								errorMessage = msg;
							}}
						/>
					{/if}
				</div>
			</footer>
		</div>

		<PreviewSurface
			{preview}
			{expandPreview}
			onToggleExpand={isWide ? () => (expandPreview = !expandPreview) : undefined}
		/>
	</div>

	{#if sheet === 'menu' || sheet === 'branches'}
		<div class="backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) sheet = null; }}>
			<div
				class="sheet"
				role="dialog"
				aria-modal="true"
				aria-label={sheet === 'menu' ? t('chatMenu') : t('chatMenuBranches')}
			>
				<div class="grip" aria-hidden="true"></div>
				{#if sheet === 'menu'}
					<div class="sheet-head">
						<h2>{viewProject?.name ?? ''}</h2>
						<span class="sheet-sub">{branchLabel}</span>
					</div>
					<div class="menu-list">
						{#each menuItems as item (item.id)}
							<button type="button" class="menu-item" onclick={() => pickMenu(item.id)} data-testid={`menu-${item.id}`}>
								{item.label}
							</button>
						{/each}
						{#if showContextRow && lane?.agent.context}
							<div class="menu-item context-row">
								<span>{t('chatMenuContext')}</span>
								<ContextControl
									context={lane.agent.context}
									disabled={isWorking}
									onRefresh={handleRefreshContext}
									onCompact={handleCompactContext}
								/>
							</div>
						{/if}
					</div>
				{:else}
					<div class="sheet-head">
						<h2>{t('chatMenuBranches')}</h2>
						<span class="sheet-sub">{viewProject?.name ?? ''}</span>
					</div>
					<div class="menu-list">
						{#each project?.lanes ?? [] as candidate (candidate.id)}
							{@const status = getLaneStatus(project!, candidate)}
							<button
								type="button"
								class="menu-item branch-item"
								class:current={candidate.id === route.laneId}
								onclick={() => openLane(candidate.id)}
								aria-current={candidate.id === route.laneId ? 'true' : undefined}
								data-testid={`branch-${candidate.id}`}
							>
								<span class="branch-dot {status}" aria-hidden="true"></span>
								<span class="branch-text">
									<strong>{candidate.kind === 'main' ? t('laneMain') : candidate.title}</strong>
									<small>{getLaneSummary(project!, candidate)}</small>
								</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}

	{#if sheet === 'quota' && host && hostState}
		<QuotaSheet
			hostId={route.hostId}
			{hostName}
			features={hostFeatures}
			quota={hostState.quota}
			projects={hostState.projects}
			onClose={() => (sheet = null)}
		/>
	{/if}

	{#if sheet === 'history' && viewProject}
		<ProjectHistorySheet hostId={route.hostId} project={viewProject} onClose={() => (sheet = null)} />
	{/if}

	{#if activeImageModal}
		<dialog
			bind:this={imageDialogEl}
			class="image-modal"
			aria-label={t('chatImageCountSingular')}
			onclick={(event) => { if (event.target === event.currentTarget) closeImageModal(); }}
			onclose={closeImageModal}
			oncancel={closeImageModal}
		>
			<button type="button" class="image-modal-close" onclick={closeImageModal} aria-label={t('close')}>
				<IconClose />
			</button>
			<img src={activeImageModal.url} alt={t('chatImageCountSingular')} class="image-modal-img" />
		</dialog>
	{/if}
</div>

<style>
	.chat-view {
		position: relative;
		width: 100%;
		height: 100%;
		background: var(--bg-sunken);
		display: flex;
		flex-direction: column;
		min-width: 0;
		overflow: hidden;
	}

	/* ------------------------------------------------ Intestazione a una riga */

	.chat-bar {
		display: flex;
		align-items: center;
		gap: 4px;
		min-height: 52px;
		padding: 4px 6px;
		background: var(--bg-raised);
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		flex-shrink: 0;
		border: none;
		border-radius: 12px;
		background: transparent;
		color: var(--ink-muted);
		cursor: pointer;
		--icon-size: 20px;
	}

	.icon-btn.small {
		width: 36px;
		height: 36px;
		--icon-size: 16px;
	}

	.icon-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.icon-btn:focus-visible,
	.bar-title:focus-visible,
	.menu-item:focus-visible,
	.endbar-btn:focus-visible,
	.ask-pill:focus-visible,
	.notice-open:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}

	.bar-title {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1px;
		padding: 4px 6px;
		border: none;
		border-radius: 10px;
		background: transparent;
		color: var(--ink);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.bar-title:disabled {
		cursor: default;
	}

	.bar-title:not(:disabled):active {
		background: var(--bg-hover);
	}

	.bar-project {
		max-width: 100%;
		font-size: 16px;
		font-weight: 650;
		line-height: 1.25;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.bar-branch {
		display: flex;
		align-items: center;
		gap: 5px;
		max-width: 100%;
		font-size: 13px;
		color: var(--ink-muted);
		line-height: 1.25;
		min-width: 0;
	}

	.branch-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	.branch-kind {
		flex-shrink: 0;
		color: var(--ink-faint);
	}

	.branch-caret {
		display: inline-flex;
		flex-shrink: 0;
		--icon-size: 13px;
	}

	.branch-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
		background: var(--ink-faint);
	}

	.branch-dot.question {
		background: var(--warn);
	}

	.branch-dot.working {
		background: var(--brand);
	}

	.chat-error {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 4px 4px 12px;
		background: color-mix(in oklch, var(--danger) 14%, var(--bg-raised));
		color: var(--danger);
		font-size: var(--text-caption);
		flex-shrink: 0;
	}

	.chat-error span {
		flex: 1;
		min-width: 0;
	}

	.error-dismiss {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border: none;
		background: transparent;
		color: inherit;
		cursor: pointer;
		--icon-size: 16px;
	}

	/* ------------------------------------------------ Corpo: chat e anteprima */

	.chat-split {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
		overflow: hidden;
	}

	.chat-column {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
	}

	.chat-column.hidden {
		display: none;
	}

	@media (min-width: 1024px) {
		.chat-split.has-preview .chat-column {
			min-width: 340px;
		}
	}

	.chat-main {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		min-width: 0;
		overflow: hidden;
	}

	.attention-inline {
		margin: 12px 0 4px;
		scroll-margin: 16px;
	}

	.ask-pill {
		position: absolute;
		left: 50%;
		bottom: 12px;
		transform: translateX(-50%);
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 40px;
		padding: 0 16px;
		border: 1px solid color-mix(in oklab, var(--warn) 40%, transparent);
		border-radius: 20px;
		background: color-mix(in oklab, var(--warn) 14%, var(--bg-raised));
		color: var(--ink);
		font: inherit;
		font-size: var(--text-label);
		font-weight: 560;
		box-shadow: var(--shadow-raise);
		cursor: pointer;
		z-index: 5;
		--icon-size: 15px;
	}

	.notice {
		position: absolute;
		top: 8px;
		left: 8px;
		right: 8px;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 4px 6px 12px;
		border: 1px solid var(--line-strong);
		border-radius: 14px;
		background: var(--bg-raised);
		box-shadow: var(--shadow-overlay);
		z-index: 6;
		animation: notice-in 0.2s ease-out;
	}

	.notice-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--warn);
		flex-shrink: 0;
	}

	.notice-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		font-size: var(--text-caption);
		line-height: 1.3;
	}

	.notice-text strong {
		color: var(--ink);
	}

	.notice-text span {
		color: var(--ink-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.notice-open {
		min-height: 36px;
		padding: 0 12px;
		border: 1px solid var(--line-strong);
		border-radius: 10px;
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-size: var(--text-caption);
		font-weight: 600;
		cursor: pointer;
		flex-shrink: 0;
	}

	@keyframes notice-in {
		from {
			opacity: 0;
			transform: translateY(-8px);
		}
	}

	/* ------------------------------------------------ Piede: composer o esito */

	.chat-footer {
		flex-shrink: 0;
		padding: 6px 8px calc(8px + var(--safe-bottom, 0px));
		background: var(--bg-sunken);
	}

	.footer-inner {
		width: 100%;
		max-width: 720px;
		margin: 0 auto;
	}

	.endbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 52px;
		padding: 6px 6px 6px 14px;
		border: 1px solid var(--line);
		border-radius: 16px;
		background: var(--bg-raised);
		color: var(--ink-muted);
		font-size: var(--text-label);
	}

	.endbar-btn {
		min-height: 40px;
		padding: 0 14px;
		border: none;
		border-radius: 12px;
		background: var(--brand-ink);
		color: var(--bg-base);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		flex-shrink: 0;
	}

	.endbar-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	/* ------------------------------------------------ Fogli */

	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		background: color-mix(in oklch, var(--ink) 35%, transparent);
		display: flex;
		align-items: flex-end;
		justify-content: center;
		animation: fade 0.16s ease-out;
	}

	.sheet {
		width: 100%;
		max-width: 560px;
		max-height: min(80dvh, var(--app-height, 100dvh));
		display: flex;
		flex-direction: column;
		background: var(--bg-raised);
		border-radius: 18px 18px 0 0;
		padding: 8px 12px calc(12px + env(safe-area-inset-bottom));
		box-shadow: var(--shadow-overlay);
		animation: sheet-up 0.24s cubic-bezier(0.22, 1, 0.36, 1);
	}

	.grip {
		width: 36px;
		height: 5px;
		border-radius: 3px;
		background: var(--line-strong);
		margin: 0 auto 8px;
		flex-shrink: 0;
	}

	.sheet-head {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 4px 6px 10px;
		border-bottom: 1px solid var(--line);
	}

	.sheet-head h2 {
		margin: 0;
		font-size: 17px;
		font-weight: 650;
		color: var(--ink);
	}

	.sheet-sub {
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	.menu-list {
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		padding-top: 4px;
	}

	.menu-item {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 52px;
		padding: 8px 10px;
		border: none;
		border-radius: 12px;
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-size: 16px;
		text-align: left;
		cursor: pointer;
	}

	.menu-item:hover {
		background: var(--bg-hover);
	}

	.context-row {
		justify-content: space-between;
		cursor: default;
	}

	.branch-item.current {
		background: var(--bg-hover);
	}

	.branch-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.branch-text small {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	@keyframes fade {
		from {
			opacity: 0;
		}
	}

	@keyframes sheet-up {
		from {
			transform: translateY(24px);
			opacity: 0.6;
		}
	}

	/* ------------------------------------------------ Immagine a schermo intero */

	.image-modal {
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
	}

	.image-modal-close {
		position: absolute;
		top: calc(var(--space-4) + env(safe-area-inset-top, 0px));
		right: var(--space-4);
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.15);
		border: none;
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		--icon-size: 20px;
	}

	.image-modal-img {
		max-width: 90vw;
		max-height: 85dvh;
		object-fit: contain;
		border-radius: var(--radius-md);
	}

	@media (prefers-reduced-motion: reduce) {
		.backdrop,
		.sheet,
		.notice {
			animation: none;
		}
	}
</style>
