<script lang="ts">
	import { attachEditorContext } from '$lib/editor/editorContext';
	import Terminal from '$lib/terminal/Terminal.svelte';
	import Chat from '$lib/agent/components/Chat.svelte';
	import { AgentSession } from '$lib/agent/session.svelte';
	import type { RpcCommand, ThinkingLevel } from '$lib/agent/wire';
	import ImageModal from '$lib/agent/components/ImageModal.svelte';
	import TopBar from '$lib/components/TopBar.svelte';
	import FileTree from '$lib/components/FileTree.svelte';
	import type EditorSurface from '$lib/editor/Editor.svelte';
	import AgentPanel from '$lib/components/AgentPanel.svelte';
	import UsagePopover, { type ProviderHost } from '$lib/components/UsagePopover.svelte';
	import ProjectPicker from '$lib/components/ProjectPicker.svelte';
	import GitPanel from '$lib/components/GitPanel.svelte';
	import DiagramViewer from '$lib/components/DiagramViewer.svelte';
	import PreviewViewer from '$lib/components/PreviewViewer.svelte';
	import StudioUpdateModal from '$lib/components/StudioUpdateModal.svelte';
	import SettingsModal from '$lib/components/settings/SettingsModal.svelte';
	import QueueDrawer from '$lib/components/QueueDrawer.svelte';
	import SetupWizard from '$lib/components/setup/SetupWizard.svelte';
	import ShortcutsHelpModal from '$lib/agent/components/ShortcutsHelpModal.svelte';
	import { shortcutsModalStore } from '$lib/stores/shortcutsModal.svelte';
	import TaskEditor from '$lib/components/TaskEditor.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { studioUpdaterStore } from '$lib/stores/studioUpdater.svelte';
	import { modelSettingsStore } from '$lib/stores/modelSettings.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { projectOrder } from '$lib/stores/projectOrder.svelte';
	import { notificationManager } from '$lib/stores/notifications.svelte';
	import { onDestroy } from 'svelte';
	import { normalizeProjectPath, projectStore, type Project } from '$lib/stores/projects.svelte';
	import { taskStore, formatTaskPrompt } from '$lib/stores/tasks.svelte';
	import type { TerminalSessionInfo } from '$lib/terminal/terminal';
	import { invoke } from '@tauri-apps/api/core';
	import { listen } from '@tauri-apps/api/event';
	import { onMount } from 'svelte';
	import { trapFocus } from '$lib/focusTrap';

	let leftSection = $state<'files' | 'git' | 'agent'>('files');
	let diagramOpen = $state(false);
	let previewFile = $state<string | null>(null);
	let agentAnnouncement = $state('');
	const prevAgentStates = new Map<string, string>();

	/**
	 * L'editor porta con se' Monaco: da solo pesa quanto tutto il resto del
	 * guscio. Un import statico lo metterebbe davanti al primo frame, quindi qui
	 * il caricamento e' dinamico di proposito: la finestra si disegna e l'editor
	 * entra subito dopo.
	 */
	let EditorComponent = $state<typeof EditorSurface | null>(null);
	$effect(() => {
		if (EditorComponent) return;
		void import('$lib/editor/Editor.svelte').then((module) => {
			EditorComponent = module.default;
		});
	});

	$effect(() => {
		for (const p of projectStore.projects) {
			const prev = prevAgentStates.get(p.id);
			const curr = p.agentState;
			if (prev && prev !== curr) {
				if (curr === 'working') {
					agentAnnouncement = `L'agente ha iniziato l'elaborazione per il progetto ${p.name}`;
				} else if (curr === 'attention') {
					agentAnnouncement = `L'agente richiede il tuo intervento per il progetto ${p.name}`;
				} else if (curr === 'finished') {
					agentAnnouncement = `L'agente ha completato il lavoro per il progetto ${p.name}`;
				}
			}
			prevAgentStates.set(p.id, curr);
		}
	});

	function agentStateLabel(state?: string): string {
		switch (state) {
			case 'working': return 'In esecuzione';
			case 'attention': return 'Richiede risposta';
			case 'finished': return 'Completato';
			case 'idle': return 'In attesa';
			default: return 'Pronto';
		}
	}

	onMount(() => {
		void notificationManager.init();
		const unlistenDiagram = listen<{ cwd?: string }>('diagram://new', (e) => {
			const targetCwd = e.payload?.cwd;
			if (!targetCwd || !projectStore.activeProject || targetCwd.toLowerCase() === projectStore.activeProject.path.toLowerCase()) {
				diagramOpen = true;
			}
		});

		const unlistenPreview = listen<{ cwd?: string; file_path?: string }>('preview://new', (e) => {
			const targetCwd = e.payload?.cwd;
			if (!targetCwd || !projectStore.activeProject || targetCwd.toLowerCase() === projectStore.activeProject.path.toLowerCase()) {
				if (e.payload?.file_path) {
					previewFile = e.payload.file_path;
					diagramOpen = false;
				}
			}
		});

		return () => {
			void unlistenDiagram.then((un) => un());
			void unlistenPreview.then((un) => un());
		};
	});
	let usageOpen = $state(false);
	let pickerOpen = $state(false);
	// Vista aggregata delle code: serve a vedere in un posto solo su quali
	// progetti c'e' lavoro in attesa, senza aprirli uno a uno.
	let queueOpen = $state(false);
	// Primo avvio guidato: `contract_check` decide se e da quale carta partire.
	let setupOpen = $state(false);
	let setupStartAt = $state<'install' | 'wizard' | 'project'>('wizard');
	let setupIncomplete = $state(false);

	// Richiesta di apertura diff proveniente dal pannello GIT: porta il file
	// nell'editor gia' in modalita' diff, con la revisione giusta.
	let editorDiffRequest = $state<{
		filePath: string;
		mode: 'working' | 'commit';
		hash?: string;
		id: number;
	} | null>(null);
	let editorDiffRequestId = 0;

	// Il processo OMP resta uno per progetto: o gira in Terminal (PTY) o in Chat (RPC).
	// Passare da una superficie all'altra chiude il processo e lo riapre con --resume.
	const terminalSessions = new Map<string, import('$lib/terminal/terminal').TerminalSession>();
	const agentSessions = new Map<string, AgentSession>();
	let terminalMeta = $state<Record<string, { inputPending: boolean; sessionId: string | null }>>({});
	let terminalBusy = $state<Record<string, boolean>>({});
	let switchingSurface = $state<Record<string, boolean>>({});
	const activeSwitching = $derived(
		projectStore.activeId ? switchingSurface[projectStore.activeId] === true : false
	);
	let agentErrors = $state<Record<string, string | null>>({});
	let viewingImage = $state<{ data: string; mimeType: string } | null>(null);
	let taskEditorId = $state<string | null>(null);
	const taskEditor = $derived(taskStore.taskById(taskEditorId));
	const activeTaskEditor = $derived(
		taskEditor
		&& projectStore.activeProject
		&& taskEditor.projectPath === normalizeProjectPath(projectStore.activeProject.path).toLowerCase()
			? taskEditor
			: undefined
	);

	const guiHosts = $derived.by(() => {
		const list: ProviderHost[] = [];
		for (const project of projectStore.projects) {
			const session = agentSessions.get(project.id);
			if (!session) continue;

			// Un progetto consuma quota GUI solo se sta effettivamente generando
			// o se ha subagenti in esecuzione in questo momento.
			const isGenerating = session.isStreaming || session.agentState === 'working';
			const activeSubagents = (session.subagents || []).filter(
				(sub) => sub.status === 'running'
			);

			if (!isGenerating && activeSubagents.length === 0) {
				continue;
			}

			const projectName = project.label?.trim() || project.name;

			// 1. Modello primario attivo nella sessione GUI (solo se sta generando)
			if (isGenerating && session.model) {
				let provider = session.model.provider || '';
				let modelId = session.model.id || session.model.name || '';
				if (!provider && modelId.includes('/')) {
					const parts = modelId.split('/');
					provider = parts[0];
					modelId = parts.slice(1).join('/');
				}
				if (provider) {
					list.push({
						provider,
						model: modelId,
						host: 'OMP Studio',
						project: projectName,
						project_path: project.path,
						last_active_ms: Date.now()
					});
				}
			}

			// 2. Eventuali subagenti attualmente in esecuzione
			for (const sub of activeSubagents) {
				if (sub.resolvedModel) {
					const parts = sub.resolvedModel.split('/');
					if (parts.length >= 2) {
						list.push({
							provider: parts[0],
							model: parts.slice(1).join('/'),
							host: 'OMP Studio',
							project: projectName,
							project_path: project.path,
							last_active_ms: Date.now()
						});
					}
				}
			}
		}
		return list;
	});

	/**
	 * Crea la sessione se manca, senza aprirla. Il markup puo' chiamarla
	 * durante il rendering: l'apertura del processo omp e' un effetto
	 * collaterale e vive nell'`$effect` qui sotto, non nel disegno.
	 */
	function agentSessionFor(p: Project): AgentSession {
		let session = agentSessions.get(p.id);
		if (!session) {
			session = new AgentSession(p.path);
			agentSessions.set(p.id, session);
		}
		return session;
	}

	/** Come sopra, ma garantisce anche che il processo sia avviato. */
	function getOrCreateAgentSession(p: Project): AgentSession {
		const session = agentSessionFor(p);
		if (!session.client.isOpen) {
			void session.open(terminalMeta[p.id]?.sessionId ?? null);
		}
		return session;
	}

	// Apre i processi delle superfici GUI e ne rispecchia stato e sessione.
	// Ogni scrittura qui dentro deve convergere: `setAgentState` non riassegna
	// un valore uguale e `updateTerminalMeta` scrive solo se qualcosa cambia.
	$effect(() => {
		for (const p of projectStore.projects) {
			if (p.layout.rightSection !== 'gui') continue;
			const session = agentSessions.get(p.id);
			if (!session) continue;
			if (!session.client.isOpen && !session.exited) {
				void session.open(terminalMeta[p.id]?.sessionId ?? null);
			}
			if (session.agentState !== 'unknown') {
				projectStore.setAgentState(p.id, session.agentState);
			}
			if (session.pendingUi?.kind === 'ask' && session.pendingUi.message) {
				notificationManager.setProjectAskMessage(p.id, session.pendingUi.message);
			} else {
				notificationManager.clearProjectAskMessage(p.id);
			}
			if (session.sessionId) {
				updateTerminalMeta(p.id, { sessionId: session.sessionId });
			}
		}
	});

	// Notifiche di sistema e allerta sull'icona dell'app (Dock / Taskbar)
	$effect(() => {
		for (const p of projectStore.projects) {
			void notificationManager.onProjectStateChanged(p.id, p.agentState);
		}
	});

	// Quando cambia il progetto attivo, azzera l'alert se la finestra ha il focus
	$effect(() => {
		const activeId = projectStore.activeId;
		if (activeId) {
			notificationManager.checkFocusAcknowledgement();
		}
	});

	// Sincronizza l'attenzione se l'utente cambia l'impostazione appBadge
	$effect(() => {
		const _badgeEnabled = settingsStore.notifications.appBadge;
		void notificationManager.syncNativeAttention(false);
	});

	/**
	 * Scrive solo se qualcosa cambia davvero. La versione precedente
	 * assegnava un oggetto nuovo a ogni chiamata: dentro l'`$effect` qui sopra
	 * quella scrittura riattivava l'effetto che l'aveva prodotta, Svelte
	 * alzava `effect_update_depth_exceeded` e abbandonava il ciclo di
	 * aggiornamento dell'intera applicazione.
	 */
	function updateTerminalMeta(projectId: string, patch: Partial<{ inputPending: boolean; sessionId: string | null }>) {
		const current = terminalMeta[projectId];
		const inputPending = patch.inputPending ?? current?.inputPending ?? false;
		const sessionId = patch.sessionId !== undefined ? patch.sessionId : (current?.sessionId ?? null);
		if (current && current.inputPending === inputPending && current.sessionId === sessionId) return;
		terminalMeta[projectId] = { inputPending, sessionId };
	}

	function automationReason(projectId: string) {
		const project = projectStore.projects.find((candidate) => candidate.id === projectId);
		if (terminalBusy[projectId]) return 'Operazione in corso';
		if (project?.layout.rightSection === 'gui') {
			const session = agentSessions.get(projectId);
			if (!session?.isReady || !session?.isAttached) return 'OMP in avvio...';
			if (session?.isStreaming) return 'OMP sta lavorando';
			if (session?.isCompacting) return 'Compattazione in corso';
			if (project.agentState === 'attention') return 'OMP aspetta una risposta';
			return 'Pronto';
		}
		if (terminalMeta[projectId]?.inputPending) return 'Completa il testo nel terminale';
		if (project?.agentState === 'working') return 'OMP sta lavorando';
		if (project?.agentState === 'attention') return 'OMP aspetta una risposta';
		if (project?.agentState !== 'idle') return 'Stato OMP non disponibile';
		return 'Pronto';
	}

	function canAutomate(projectId: string) {
		return automationReason(projectId) === 'Pronto';
	}

	function openNewTask(projectPath: string) {
		const task = taskStore.createTask(projectPath);
		taskEditorId = task.id;
		diagramOpen = false;
		previewFile = null;
	}

	function openTask(taskId: string) {
		taskEditorId = taskId;
		diagramOpen = false;
		previewFile = null;
	}

	/**
	 * Apre nell'editor un task che puo' appartenere a un altro progetto: il
	 * composer vive nella colonna centrale del progetto attivo, quindi prima
	 * si cambia stanza e poi si apre il task.
	 */
	function openTaskOfProject(projectId: string, taskId: string) {
		if (projectStore.activeId !== projectId) projectStore.setActive(projectId);
		queueOpen = false;
		leftSection = 'agent';
		openTask(taskId);
	}

	/**
	 * Nuovo task chiesto dal pannello di una tessera: il composer vive nella
	 * colonna centrale del progetto attivo, quindi prima si cambia stanza.
	 */
	function openNewTaskOfProject(projectId: string) {
		const project = projectStore.projects.find((candidate) => candidate.id === projectId);
		if (!project) return;
		if (projectStore.activeId !== projectId) projectStore.setActive(projectId);
		queueOpen = false;
		leftSection = 'agent';
		openNewTask(project.path);
	}

	/**
	 * `follow` vero porta il fuoco sul progetto lanciato (Ctrl+click, o
	 * "Avvia e apri"). Falso lascia l'utente dove sta: il task parte in
	 * background e la tessera racconta lo stato.
	 */
	async function handleRunTask(projectId: string, taskId: string, follow = false) {
		const project = projectStore.projects.find((candidate) => candidate.id === projectId);
		const task = taskStore.taskById(taskId);
		if (!project || !task || !canAutomate(projectId)) return;
		if (follow && projectStore.activeId !== projectId) projectStore.setActive(projectId);
		queueOpen = false;

		terminalBusy[projectId] = true;
		agentErrors[projectId] = null;
		taskStore.markDispatching(taskId);

		try {
			if (project.layout.rightSection === 'gui') {
				const session = getOrCreateAgentSession(project);
				if (!session.client.isOpen) {
					await session.open();
				}
				const sid = await session.newSession();

				// Una configurazione esplicita e' parte del contratto del task:
				// se non si applica, il task resta in coda invece di partire col
				// modello sbagliato.
				if (task.options?.modelSelector) {
					const rawSelector = task.options.modelSelector;
					const separator = rawSelector.indexOf('/');
					const provider = separator >= 0 ? rawSelector.slice(0, separator) : session.model?.provider || '';
					const modelId = separator >= 0 ? rawSelector.slice(separator + 1) : rawSelector;
					await session.client.send({
						type: 'set_model',
						provider,
						modelId
					});
				}

				if (task.options?.thinkingLevel && task.options.thinkingLevel !== 'auto') {
					await session.client.send({
						type: 'set_thinking_level',
						level: task.options.thinkingLevel as ThinkingLevel
					});
				}

				const fullPrompt = formatTaskPrompt(task, project.path);
				await session.prompt(fullPrompt, task.images ?? [], 'steer');
				const resolvedSid = sid ?? session.sessionId;
				if (resolvedSid) {
					taskStore.completeDispatch(taskId, resolvedSid);
				}
				taskStore.setView(project.path, 'sessions');
				if (taskEditorId === taskId) taskEditorId = null;
				window.dispatchEvent(new CustomEvent('studio-sessions-refresh', {
					detail: { projectPath: project.path, sessionId: resolvedSid }
				}));
			} else {
				const term = terminalSessions.get(projectId);
				if (!term) throw new Error('Terminale non pronto');
				const fullPrompt = formatTaskPrompt(task, project.path);
				const configuration = task.options?.modelSelector
					? {
							modelSelector: task.options.modelSelector,
							thinkingLevel: task.options.thinkingLevel || 'auto'
						}
					: undefined;
				const session = await term.startTask(fullPrompt, configuration);
				taskStore.completeDispatch(taskId, session.sessionId);
				taskStore.setView(project.path, 'sessions');
				if (taskEditorId === taskId) taskEditorId = null;
				window.dispatchEvent(new CustomEvent('studio-sessions-refresh', {
					detail: { projectPath: project.path, sessionId: session.sessionId }
				}));
			}
		} catch (error) {
			taskStore.rollbackDispatch(taskId);
			agentErrors[projectId] = error instanceof Error ? error.message : String(error);
		} finally {
			terminalBusy[projectId] = false;
		}
	}

	/**
	 * Auto-avvio per progetto (spento di default, vedi docs/DECISIONS.md Gate
	 * R12): quando l'agente di un progetto con l'interruttore acceso torna
	 * `Pronto` e ha task in coda, il primo parte da solo.
	 *
	 * La spedizione esce dall'effetto con `queueMicrotask` e passa da un lock
	 * per progetto: `handleRunTask` scrive `terminalBusy` e `markDispatching`,
	 * cioe' proprio lo stato che l'effetto legge, e scriverlo qui dentro
	 * riaccenderebbe l'effetto che l'ha prodotto (`effect_update_depth_exceeded`).
	 */
	const autoDispatching = new Set<string>();
	$effect(() => {
		const candidates: Array<{ projectId: string; taskId: string }> = [];
		for (const project of projectStore.projects) {
			if (!project.autoDispatch || !project.path) continue;
			if (autoDispatching.has(project.id)) continue;
			const next = taskStore.tasksFor(project.path).find((task) => task.status === 'queued');
			if (!next) continue;
			if (automationReason(project.id) !== 'Pronto') continue;
			candidates.push({ projectId: project.id, taskId: next.id });
		}

		for (const candidate of candidates) {
			autoDispatching.add(candidate.projectId);
			queueMicrotask(() => {
				void handleRunTask(candidate.projectId, candidate.taskId)
					.finally(() => autoDispatching.delete(candidate.projectId));
			});
		}
	});

	async function handleResumeSession(projectId: string, sessionId: string) {
		const project = projectStore.projects.find((candidate) => candidate.id === projectId);
		if (!project || !canAutomate(projectId)) return;

		terminalBusy[projectId] = true;
		agentErrors[projectId] = null;
		try {
			if (project.layout.rightSection === 'gui') {
				// `agentSessionFor` e non `getOrCreateAgentSession`: quest'ultimo
				// avvierebbe un processo sulla sessione precedente proprio mentre
				// la stiamo chiudendo per riprenderne un'altra.
				const session = agentSessionFor(project);
				await session.close();
				await session.open(sessionId);
				taskStore.setView(project.path, 'sessions');
				window.dispatchEvent(new CustomEvent('studio-sessions-refresh', {
					detail: { projectPath: project.path, sessionId }
				}));
			} else {
				const term = terminalSessions.get(projectId);
				if (!term) throw new Error('Terminale non pronto');
				await term.resumeSession(sessionId);
				taskStore.setView(project.path, 'sessions');
				window.dispatchEvent(new CustomEvent('studio-sessions-refresh', {
					detail: { projectPath: project.path, sessionId }
				}));
			}
		} catch (error) {
			agentErrors[projectId] = error instanceof Error ? error.message : String(error);
		} finally {
			terminalBusy[projectId] = false;
		}
	}

	/**
	 * Handoff tra TERMINAL e GUI: un solo processo omp attivo per progetto.
	 * La sessione passa da una superficie all'altra con `--resume <sessionId>`
	 * in entrambi i versi: verso la GUI lo riceve `rpc_open`, verso il
	 * terminale lo riceve il PTY tramite la prop `resumeSessionId`.
	 */
	async function switchSurface(projectId: string, target: 'terminal' | 'gui') {
		const project = projectStore.projects.find((candidate) => candidate.id === projectId);
		if (!project || project.layout.rightSection === target) return;
		// Il cambio smonta un processo e ne avvia un altro: due clic ravvicinati
		// lascerebbero una sessione zombie senza nessuno che la chiude.
		if (switchingSurface[projectId]) return;
		switchingSurface[projectId] = true;

		try {
			const currentSessionId = terminalMeta[projectId]?.sessionId ?? agentSessions.get(projectId)?.sessionId ?? null;

			if (project.layout.rightSection === 'gui') {
				const session = agentSessions.get(projectId);
				if (session) {
					if (session.isStreaming) {
						await session.abort();
					}
					await session.close();
				}
			} else {
				// Il PTY deve aver rilasciato la sessione prima che rpc-ui la riprenda.
				// Affidarsi al cleanup del componente crea una gara tra release e --resume.
				await terminalSessions.get(projectId)?.release();
			}

			// Il terminale legge `resumeSessionId` al montaggio: il valore deve
			// essere gia' scritto quando il layout cambia.
			updateTerminalMeta(projectId, { sessionId: currentSessionId });

			projectStore.updateLayout(projectId, (l) => {
				l.rightSection = target;
			});

			if (target === 'gui') {
				const session = agentSessionFor(project);
				await session.open(currentSessionId);
			}
		} catch (error) {
			agentErrors[projectId] = error instanceof Error ? error.message : String(error);
		} finally {
			switchingSurface[projectId] = false;
		}
	}

	/**
	 * Intercettazione dei comandi slash nella chat GUI.
	 *
	 * Regola di fondo: un comando slash non deve **mai** finire in `prompt`.
	 * `omp --mode rpc-ui` non li interpreta — verificato sul binario: il
	 * comando entra nel transcript come messaggio dell'utente e l'assistente
	 * risponde vuoto. Chi non trova qui una risposta riceve un avviso, non un
	 * silenzio. Un testo che inizia per `/` ma non nomina un comando conosciuto
	 * (un percorso assoluto, per esempio) resta un prompt normale.
	 */
	function handleGuiSlashCommand(projectId: string, raw: string): boolean {
		const project = projectStore.projects.find((candidate) => candidate.id === projectId);
		const session = agentSessions.get(projectId);
		if (!project || !session) return false;

		const trimmed = raw.trim();
		const [cmd, ...rest] = trimmed.split(/\s+/);
		const lowerCmd = cmd.toLowerCase();
		const argument = rest.join(' ').trim();

		// --- comandi del guscio: li serve Studio, non omp ---------------------
		if (lowerCmd === '/new' || lowerCmd === '/clear') {
			void session.newSession();
			return true;
		}
		if (lowerCmd === '/resume' || lowerCmd === '/sessions' || lowerCmd === '/tree') {
			if (argument && lowerCmd === '/resume') {
				void handleResumeSession(projectId, argument);
			} else {
				leftSection = 'agent';
				taskStore.setView(project.path, 'sessions');
			}
			return true;
		}
		if (lowerCmd === '/fork') {
			void (async () => {
				try {
					const newId = await session.forkSession();
					session.pushNotice('info', `Sessione ramificata in un nuovo branch: ${newId ?? ''}`, 'studio');
				} catch (error) {
					session.pushNotice('error', `Errore durante il fork: ${error instanceof Error ? error.message : String(error)}`, 'studio');
				}
			})();
			return true;
		}
		if (lowerCmd === '/drop') {
			leftSection = 'agent';
			taskStore.setView(project.path, 'sessions');
			session.pushNotice('info', 'Usa il menu contestuale nella lista sessioni a sinistra per archiviare o eliminare un ramo.', 'studio');
			return true;
		}
		if (lowerCmd === '/quit' || lowerCmd === '/exit') {
			void session.newSession();
			return true;
		}
		if (lowerCmd === '/copy') {
			const transcriptText = session.entries
				.map((entry) => {
					if (entry.kind === 'user') return `User: ${entry.content || ''}`;
					if (entry.kind === 'assistant') {
						const text = entry.blocks
							.map((b) => (b.type === 'text' ? b.text : b.type === 'thinking' ? `[Thinking: ${b.text}]` : ''))
							.filter(Boolean)
							.join('\n');
						return `Assistant: ${text}`;
					}
					if (entry.kind === 'notice') return `[${entry.level}]: ${entry.message || ''}`;
					return '';
				})
				.filter(Boolean)
				.join('\n\n');
			if (transcriptText) {
				void navigator.clipboard.writeText(transcriptText);
				session.pushNotice('info', 'Trascrizione della sessione copiata negli appunti.', 'studio');
			} else {
				session.pushNotice('warning', 'Nessun messaggio da copiare nella sessione corrente.', 'studio');
			}
			return true;
		}
		if (lowerCmd === '/login' || lowerCmd === '/logout') {
			modelSettingsStore.openModal('providers');
			return true;
		}
		if (lowerCmd === '/switch') {
			pickerOpen = true;
			return true;
		}
		if (lowerCmd === '/git' || lowerCmd === '/branch') {
			leftSection = 'git';
			return true;
		}
		if (lowerCmd === '/settings' || lowerCmd === '/setup' || lowerCmd === '/models') {
			modelSettingsStore.openModal();
			return true;
		}
		if (lowerCmd === '/usage' || lowerCmd === '/quota') {
			usageOpen = true;
			return true;
		}
		if (lowerCmd === '/terminal') {
			void switchSurface(projectId, 'terminal');
			return true;
		}
		if (lowerCmd === '/help') {
			session.pushNotice('info', guiHelpText(session), 'studio');
			return true;
		}

		// --- comandi con una RPC corrispondente -------------------------------
		if (lowerCmd === '/compact') {
			void runSessionCommand(session, 'Compattazione richiesta', {
				type: 'compact',
				customInstructions: argument || undefined
			});
			return true;
		}
		if (lowerCmd === '/handoff') {
			void runSessionCommand(session, 'Handoff richiesto', {
				type: 'handoff',
				customInstructions: argument || undefined
			});
			return true;
		}
		if (lowerCmd === '/thinking' || lowerCmd === '/reasoning') {
			const level = argument.toLowerCase();
			if (!THINKING_LEVELS.includes(level as ThinkingLevel)) {
				session.pushNotice('warning', `Livelli di thinking: ${THINKING_LEVELS.join(', ')}`, 'studio');
				return true;
			}
			void runSessionCommand(session, `Thinking impostato su ${level}`, {
				type: 'set_thinking_level',
				level: level as ThinkingLevel
			});
			return true;
		}
		if (lowerCmd === '/role' || lowerCmd === '/roles') {
			if (!argument) {
				modelSettingsStore.openModal('roles');
				return true;
			}
			const arg = argument.trim().toLowerCase();
			void (async () => {
				await modelSettingsStore.ensureLoaded();
				const cfg = modelSettingsStore.config || modelSettingsStore.draftConfig;
				const rolesMap = cfg?.modelRoles || {};

				if (arg === 'next' || arg === 'cycle') {
					const cycleOrder = cfg?.cycleOrder && cfg.cycleOrder.length > 0
						? cfg.cycleOrder
						: Object.keys(rolesMap);
					const configured = cycleOrder.filter(r => Boolean(rolesMap[r]));
					if (configured.length === 0) {
						session.pushNotice('warning', 'Nessun ruolo configurato con un modello valido.', 'studio');
						return;
					}
					const curId = session.model?.id || '';
					const curProvider = session.model?.provider || '';
					let curIdx = -1;
					for (let i = 0; i < configured.length; i++) {
						const raw = (rolesMap[configured[i]] || '').split(':')[0];
						if (raw === curId || raw === `${curProvider}/${curId}` || raw.endsWith(`/${curId}`)) {
							curIdx = i;
							break;
						}
					}
					const nextRole = configured[(curIdx + 1) % configured.length];
					const full = rolesMap[nextRole];
					const [rawSelector, thinking] = full.split(':');
					const [prov, mId] = rawSelector.includes('/') ? rawSelector.split('/') : ['', rawSelector];
					await session.client.send({ type: 'set_model', provider: prov || session.model?.provider || '', modelId: mId });
					if (thinking && thinking !== 'auto') {
						await session.client.send({ type: 'set_thinking_level', level: thinking as any });
					}
					await session.refreshState();
					session.pushNotice('info', `Ruolo attivo: ${nextRole} (${session.model?.name || mId})`, 'studio');
					return;
				}

				const full = rolesMap[arg];
				if (!full) {
					session.pushNotice('warning', `Il ruolo "${arg}" non è configurato. Usa /role per aprire la configurazione.`, 'studio');
					return;
				}
				const [rawSelector, thinking] = full.split(':');
				const [prov, mId] = rawSelector.includes('/') ? rawSelector.split('/') : ['', rawSelector];
				await session.client.send({ type: 'set_model', provider: prov || session.model?.provider || '', modelId: mId });
				if (thinking && thinking !== 'auto') {
					await session.client.send({ type: 'set_thinking_level', level: thinking as any });
				}
				await session.refreshState();
				session.pushNotice('info', `Ruolo attivo: ${arg} (${session.model?.name || mId})`, 'studio');
			})();
			return true;
		}
		if (lowerCmd === '/model') {
			if (!argument) {
				modelSettingsStore.openModal('catalog');
				return true;
			}
			if (argument.toLowerCase() === 'next' || argument.toLowerCase() === 'cycle') {
				void (async () => {
					await modelSettingsStore.ensureLoaded();
					const cfg = modelSettingsStore.config || modelSettingsStore.draftConfig;
					const rolesMap = cfg?.modelRoles || {};
					const cycleOrder = cfg?.cycleOrder && cfg.cycleOrder.length > 0 ? cfg.cycleOrder : Object.keys(rolesMap);
					const configured = cycleOrder.filter(r => Boolean(rolesMap[r]));
					if (configured.length > 0) {
						const curId = session.model?.id || '';
						const curProvider = session.model?.provider || '';
						let curIdx = -1;
						for (let i = 0; i < configured.length; i++) {
							const raw = (rolesMap[configured[i]] || '').split(':')[0];
							if (raw === curId || raw === `${curProvider}/${curId}` || raw.endsWith(`/${curId}`)) {
								curIdx = i;
								break;
							}
						}
						const nextRole = configured[(curIdx + 1) % configured.length];
						const full = rolesMap[nextRole];
						const [rawSelector, thinking] = full.split(':');
						const [prov, mId] = rawSelector.includes('/') ? rawSelector.split('/') : ['', rawSelector];
						await session.client.send({ type: 'set_model', provider: prov || session.model?.provider || '', modelId: mId });
						if (thinking && thinking !== 'auto') {
							await session.client.send({ type: 'set_thinking_level', level: thinking as any });
						}
						await session.refreshState();
						session.pushNotice('info', `Ruolo attivo: ${nextRole} (${session.model?.name || mId})`, 'studio');
					} else {
						await session.client.send({ type: 'cycle_model' });
						await session.refreshState();
						const current = session.model?.name || session.model?.id || 'default';
						session.pushNotice('info', `Modello attivo: ${current}`, 'studio');
					}
				})();
				return true;
			}
			session.pushNotice(
				'info',
				'Per scegliere un modello preciso usa il chip «modello» sotto il campo di scrittura, oppure /role next per ciclare i ruoli.',
				'studio'
			);
			return true;
		}
		if (lowerCmd === '/name' || lowerCmd === '/rename') {
			if (!argument) {
				session.pushNotice('warning', 'Uso: /name <titolo della sessione>', 'studio');
				return true;
			}
			void runSessionCommand(session, `Sessione rinominata in «${argument}»`, {
				type: 'set_session_name',
				name: argument
			});
			return true;
		}
		if (lowerCmd === '/cost' || lowerCmd === '/stats' || lowerCmd === '/status') {
			void reportSessionStats(session);
			return true;
		}

		// --- Tutti gli altri comandi slash -------------------------------------
		// Qualsiasi altro comando slash (skill, template, prompt, modalita'
		// /plan, /vibe, /goal, /loop, comandi builtin come /fast, /security,
		// /todo, /mcp, /jobs, /dirs, /plugins, ecc.) viene inoltrato
		// direttamente a omp via RPC prompt: omp lo esegue ed emette l'output
		// corrispondente (command_output/notice) oppure attiva l'agente.
		return false;
	}

	const THINKING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

	/** Manda una RPC e riporta l'esito nel transcript, buono o cattivo. */
	async function runSessionCommand(session: AgentSession, done: string, command: RpcCommand) {
		try {
			await session.client.send(command);
			await session.refreshState();
			session.pushNotice('info', done, 'studio');
		} catch (error) {
			session.pushNotice(
				'error',
				`Comando non eseguito: ${error instanceof Error ? error.message : String(error)}`,
				'studio'
			);
		}
	}

	async function reportSessionStats(session: AgentSession) {
		try {
			const stats = await session.client.send<Record<string, unknown>>({ type: 'get_session_stats' });
			const cost = typeof stats?.cost === 'number' ? `$${stats.cost.toFixed(4)}` : 'non disponibile';
			const messages = typeof stats?.totalMessages === 'number' ? stats.totalMessages : '?';
			const tools = typeof stats?.toolCalls === 'number' ? stats.toolCalls : '?';
			session.pushNotice(
				'info',
				`Sessione ${session.sessionName ?? session.sessionId ?? ''} — ${messages} messaggi, ${tools} chiamate a strumenti, costo ${cost}.`,
				'studio'
			);
		} catch (error) {
			session.pushNotice(
				'error',
				`Statistiche non disponibili: ${error instanceof Error ? error.message : String(error)}`,
				'studio'
			);
		}
	}

	function guiHelpText(session: AgentSession): string {
		const lines = [
			'Comandi disponibili nella superficie GUI:',
			'/new, /clear — avvia una nuova sessione',
			'/resume [id] — riprende una sessione, o apre lo storico',
			'/compact [istruzioni] — compatta il contesto',
			'/handoff [istruzioni] — passa il testimone a una sessione nuova',
			'/thinking <off|minimal|low|medium|high|xhigh|max>',
			'/model [next] — apre le impostazioni modelli o cicla',
			'/name <titolo> — rinomina la sessione',
			'/cost, /stats, /status — riepilogo della sessione',
			'/git, /settings, /usage, /switch, /terminal — pannelli del guscio',
			'',
			'Scorciatoie principali (Alt+H per la guida completa):',
			'Alt+P: cambia modello rapido • Ctrl+P: cicla modello',
			'Alt+M: menu thinking • Alt+T: cicla thinking',
			'Alt+Q: menu coda • Alt+S: alterna steering',
			'Alt+C: interrompi/cancella • Alt+E: fuoco su composer'
		];
		if (session.availableCommands.length > 0) {
			lines.push('', `Altri ${session.availableCommands.length} comandi registrati da omp ed estensioni.`);
		}
		return lines.join('\n');
	}

	/** Il processo omp muore con la scheda: senza questo resta orfano. */
	function disposeAgentSession(projectId: string) {
		const session = agentSessions.get(projectId);
		if (!session) return;
		agentSessions.delete(projectId);
		void session.close();
	}

	onMount(() => {
		const onProjectClosed = (event: Event) => {
			const projectId = (event as CustomEvent<{ projectId?: string }>).detail?.projectId;
			if (projectId) disposeAgentSession(projectId);
		};
		window.addEventListener('studio-project-closed', onProjectClosed);
		return () => window.removeEventListener('studio-project-closed', onProjectClosed);
	});

	onDestroy(() => {
		for (const session of agentSessions.values()) {
			void session.close();
		}
		agentSessions.clear();
	});

	function handleGitPanelDiff(filePath: string, mode: 'working' | 'commit', hash?: string) {
		if (!projectStore.activeId) return;
		projectStore.openFile(projectStore.activeId, filePath);
		editorDiffRequest = { filePath, mode, hash, id: ++editorDiffRequestId };
	}

	let activeDirtyFiles = $state<string[]>([]);

	let terminalOpenRequest = $state<{
		projectId: string;
		filePath: string;
		line: number | null;
		id: number;
	} | null>(null);
	let terminalOpenRequestId = 0;

	function handleTerminalOpenFile(projectId: string, filePath: string, line: number | null) {
		if (projectStore.activeId !== projectId) projectStore.setActive(projectId);
		projectStore.openFile(projectId, filePath);
		terminalOpenRequest = {
			projectId,
			filePath,
			line,
			id: ++terminalOpenRequestId
		};
	}

	let ompVersion = $state<string | null>(null);
	let isCheckingUpdate = $state(false);
	let updateMessage = $state<string | null>(null);
	let ompBadgeType = $state<'warn' | 'success' | 'error' | null>(null);
	let showUpdatePromptModal = $state(false);
	let showRestartModal = $state(false);
	let pendingUpdateCheck = $state<{
		has_update: boolean;
		current_version: string;
		latest_version: string;
		message: string;
	} | null>(null);
	let isInstallingUpdate = $state(false);

	async function fetchOmpVersion() {
		try {
			const ver: string = await invoke('get_omp_version');
			ompVersion = ver;
		} catch (e) {
			console.error("Failed to fetch OMP version", e);
		}
	}

	/**
	 * Verifica del contratto con `omp` all'avvio (docs/PLAN.md Fase 8). Il
	 * wizard si apre solo quando c'e' qualcosa da fare, e parte dalla carta
	 * giusta: senza binario dall'installazione, senza credenziali o modello
	 * dal setup nativo, tutto a posto ma senza progetti dalla cartella.
	 */
	async function checkSetupContract() {
		try {
			// I progetti salvati arrivano dal disco in modo asincrono: senza
			// attendere, un utente con progetti vedrebbe il wizard solo perche'
			// la lista e' ancora vuota.
			await projectStore.init();
			const status = await invoke<{ missing: string[] }>('setup_status');
			setupIncomplete = status.missing.length > 0;
			if (status.missing.includes('omp')) {
				setupStartAt = 'install';
			} else if (setupIncomplete) {
				setupStartAt = 'wizard';
			} else if (projectStore.projects.length === 0) {
				setupStartAt = 'project';
			} else {
				return;
			}
			setupOpen = true;
		} catch (e) {
			console.error('Verifica del contratto omp', e);
		}
	}

	function openSetup() {
		setupStartAt = setupIncomplete ? 'wizard' : 'project';
		setupOpen = true;
	}

	async function closeSetup() {
		setupOpen = false;
		// Rileggere lo stato aggiorna il chip: se manca ancora qualcosa resta
		// visibile in barra, ma il wizard non si riapre da solo — sarebbe una
		// trappola.
		const wasIncomplete = setupIncomplete;
		await refreshSetupChip();
		if (wasIncomplete) await fetchOmpVersion();
	}

	/** Aggiorna il solo indicatore, senza decidere di aprire niente. */
	async function refreshSetupChip() {
		try {
			const status = await invoke<{ missing: string[] }>('setup_status');
			setupIncomplete = status.missing.length > 0;
		} catch (e) {
			console.error('Verifica del contratto omp', e);
		}
	}

	async function checkOmpUpdateSilently() {
		try {
			const res: {
				has_update: boolean;
				current_version: string;
				latest_version: string;
				message: string;
			} = await invoke('check_omp_update');
			if (res.current_version && res.current_version !== 'unknown') {
				ompVersion = res.current_version;
			}
			if (res.has_update) {
				pendingUpdateCheck = res;
				updateMessage = 'Nuova versione!';
				ompBadgeType = 'warn';
			}
		} catch {
			// Verifica di background: errori di rete o rate limit non sono bloccanti
		}
	}

	onMount(() => {
		fetchOmpVersion();
		void checkOmpUpdateSilently();
		void checkSetupContract();
		studioUpdaterStore.init();
	});

	onDestroy(() => {
		studioUpdaterStore.destroy();
	});

	async function handleCheckUpdate() {
		if (isCheckingUpdate || isInstallingUpdate) return;
		if (pendingUpdateCheck?.has_update) {
			showUpdatePromptModal = true;
			return;
		}
		isCheckingUpdate = true;
		updateMessage = 'Verifica...';
		ompBadgeType = null;
		try {
			const res: {
				has_update: boolean;
				current_version: string;
				latest_version: string;
				message: string;
			} = await invoke('check_omp_update');
			if (res.current_version && res.current_version !== 'unknown') {
				ompVersion = res.current_version;
			}
			if (res.has_update) {
				pendingUpdateCheck = res;
				updateMessage = 'Nuova versione!';
				ompBadgeType = 'warn';
				showUpdatePromptModal = true;
			} else {
				pendingUpdateCheck = null;
				updateMessage = 'OMP aggiornato';
				ompBadgeType = 'success';
				setTimeout(() => {
					if (!pendingUpdateCheck?.has_update) {
						updateMessage = null;
						ompBadgeType = null;
					}
				}, 3000);
			}
		} catch (e) {
			console.error("Update check failed", e);
			updateMessage = 'Errore verifica';
			ompBadgeType = 'error';
			setTimeout(() => {
				if (!pendingUpdateCheck?.has_update) {
					updateMessage = null;
					ompBadgeType = null;
				}
			}, 3000);
		} finally {
			isCheckingUpdate = false;
		}
	}

	async function handlePerformUpdate() {
		showUpdatePromptModal = false;
		isInstallingUpdate = true;
		updateMessage = 'Installazione...';
		ompBadgeType = null;
		try {
			await invoke('run_omp_update');
			await fetchOmpVersion();
			pendingUpdateCheck = null;
			updateMessage = 'Aggiornato!';
			ompBadgeType = 'success';
			showRestartModal = true;
		} catch (e) {
			console.error("Update failed", e);
			updateMessage = 'Errore aggiornamento';
			ompBadgeType = 'error';
			setTimeout(() => {
				if (!pendingUpdateCheck?.has_update) {
					updateMessage = null;
					ompBadgeType = null;
				}
			}, 4000);
		} finally {
			isInstallingUpdate = false;
		}
	}

	function handleRestartApp() {
		window.location.reload();
	}
	const SPLIT = 6;
	const MIN_COL = 160;
	let columnsEl = $state<HTMLElement | null>(null);
	let leftWidth = $state(260);
	// 0 = non ancora misurata: il centro resta elastico finche' non si trascina.
	let centerWidth = $state(0);
	let dragging = $state(false);

	const gridTemplate = $derived(
		`${leftWidth}px ${SPLIT}px ${centerWidth > 0 ? `${centerWidth}px` : 'minmax(0, 1fr)'} ${SPLIT}px minmax(0, 1fr)`
	);

	const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

	function maxCenter() {
		if (!columnsEl) return MIN_COL;
		return Math.max(MIN_COL, columnsEl.clientWidth - leftWidth - 2 * SPLIT - MIN_COL);
	}
	function startDrag(e: PointerEvent, which: 'left' | 'center') {
		if (!columnsEl) return;
		const el = columnsEl;
		const handle = e.currentTarget as HTMLElement;
		handle.setPointerCapture(e.pointerId);
		dragging = true;

		const startX = e.clientX;
		const startLeft = leftWidth;
		// Al primo trascinamento il centro va congelato alla larghezza reale,
		// altrimenti passerebbe da elastico a un valore arbitrario.
		const startCenter = centerWidth > 0
			? centerWidth
			: el.children[2].getBoundingClientRect().width;

		const onMove = (ev: PointerEvent) => {
			const dx = ev.clientX - startX;
			const total = el.clientWidth;
			if (which === 'left') {
				leftWidth = clamp(startLeft + dx, MIN_COL, total - 2 * SPLIT - 2 * MIN_COL);
				centerWidth = clamp(startCenter, MIN_COL, maxCenter());
			} else {
				centerWidth = clamp(startCenter + dx, MIN_COL, maxCenter());
			}
		};

		const onUp = () => {
			dragging = false;
			handle.removeEventListener('pointermove', onMove);
			handle.removeEventListener('pointerup', onUp);
			handle.removeEventListener('pointercancel', onUp);
		};

		handle.addEventListener('pointermove', onMove);
		handle.addEventListener('pointerup', onUp);
		handle.addEventListener('pointercancel', onUp);
	}

	function resetSplit(which: 'left' | 'center') {
		if (which === 'left') leftWidth = 260;
		else centerWidth = 0;
	}

	// Se la finestra si restringe, il centro fisso potrebbe schiacciare la
	// colonna destra a zero: va riclampato. Le misure degeneri (finestra
	// minimizzata o nascosta) vanno ignorate, altrimenti le colonne
	// resterebbero schiacciate al minimo dopo il ripristino.
	$effect(() => {
		if (!columnsEl) return;
		const el = columnsEl;
		const ro = new ResizeObserver(() => {
			const total = el.clientWidth;
			if (total < 3 * MIN_COL + 2 * SPLIT) return;
			leftWidth = clamp(leftWidth, MIN_COL, total - 2 * SPLIT - 2 * MIN_COL);
			if (centerWidth > 0) centerWidth = clamp(centerWidth, MIN_COL, maxCenter());
		});
		ro.observe(el);
		return () => {
			ro.disconnect();
		};
	});

	function handleKeydown(e: KeyboardEvent) {
		// Esc chiude il dialogo piu' esterno, dal piu' recente al piu' vecchio.
		if (e.key === 'Escape') {
			if (shortcutsModalStore.isOpen) {
				e.preventDefault();
				shortcutsModalStore.close();
				return;
			}
			if (showRestartModal) {
				e.preventDefault();
				showRestartModal = false;
				return;
			}
			if (showUpdatePromptModal) {
				e.preventDefault();
				showUpdatePromptModal = false;
				return;
			}
			return;
		}

		// Alt+H, Alt+K, F1 o Ctrl+Alt+H: guida scorciatoie globale
		const isAltOnly = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
		const keyLower = e.key.toLowerCase();
		if (
			(isAltOnly && (keyLower === 'h' || e.code === 'KeyH' || keyLower === 'k' || e.code === 'KeyK')) ||
			e.key === 'F1' ||
			((e.ctrlKey || e.metaKey) && e.altKey && (keyLower === 'h' || e.code === 'KeyH'))
		) {
			e.preventDefault();
			shortcutsModalStore.toggle();
			return;
		}

		if (!(e.ctrlKey || e.metaKey) || !e.altKey) return;
		// Su tastiere internazionali AltGr alza sia ctrlKey sia altKey: senza
		// questa guardia scrivere una parentesi graffa in un campo di testo
		// aprirebbe un pannello. Nei campi le scorciatoie del guscio tacciono.
		const target = e.target;
		if (
			target instanceof HTMLInputElement
			|| target instanceof HTMLTextAreaElement
			|| (target instanceof HTMLElement && target.isContentEditable)
		) {
			return;
		}

		if (e.key.toLowerCase() === 's') {
			e.preventDefault();
			projectStore.openScratchpad();
		} else if (e.key.toLowerCase() === 'n') {
			e.preventDefault();
			pickerOpen = true;
		} else if (e.key.toLowerCase() === 'u') {
			e.preventDefault();
			usageOpen = !usageOpen;
		} else if (e.key.toLowerCase() === 'm') {
			e.preventDefault();
			modelSettingsStore.openModal();
		} else if (e.key === ',') {
			e.preventDefault();
			settingsStore.openSection();
		} else if (e.key.toLowerCase() === 't') {
			e.preventDefault();
			queueOpen = !queueOpen;
		} else if (e.key.toLowerCase() === 'a') {
			e.preventDefault();
			if (projectStore.activeProject) {
				const next = projectStore.activeProject.layout.rightSection === 'gui' ? 'terminal' : 'gui';
				void switchSurface(projectStore.activeProject.id, next);
			}
		} else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
			e.preventDefault();
			// La navigazione segue l'ordine mostrato, non quello dell'array:
			// con ordinamento per priorita' o alfabetico i due divergono.
			const projects = projectOrder.list;
			const idx = projects.findIndex(p => p.id === projectStore.activeId);
			if (idx === -1 || projects.length < 2) return;
			if (e.shiftKey) {
				projectStore.shiftProject(projects[idx].id, e.key === 'ArrowRight' ? 1 : -1);
				return;
			}
			const nextIdx = e.key === 'ArrowRight' ? (idx + 1) % projects.length : (idx - 1 + projects.length) % projects.length;
			projectStore.setActive(projects[nextIdx].id);
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="app-layout">
	<TopBar
		onUsageClick={() => usageOpen = !usageOpen}
		onNewProject={() => pickerOpen = true}
		onSettingsClick={(section) => settingsStore.openSection(section)}
		onSetupClick={openSetup}
		onQueueClick={() => queueOpen = !queueOpen}
		{setupIncomplete}
		onRunTask={(projectId, taskId, follow) => void handleRunTask(projectId, taskId, follow)}
		onEditTask={openTaskOfProject}
		onNewTask={openNewTaskOfProject}
		canRunTask={canAutomate}
		runReason={automationReason}
	/>
	<SetupWizard open={setupOpen} startAt={setupStartAt} onClose={closeSetup} />
	<UsagePopover open={usageOpen} onClose={() => usageOpen = false} {guiHosts} />
	<ProjectPicker open={pickerOpen} onClose={() => pickerOpen = false} />
	<SettingsModal />
	<QueueDrawer
		open={queueOpen}
		onClose={() => queueOpen = false}
		onRunTask={(projectId, taskId, follow) => void handleRunTask(projectId, taskId, follow)}
		onEditTask={openTaskOfProject}
		canRunTask={canAutomate}
		runReason={automationReason}
	/>

	<div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
		{agentAnnouncement}
	</div>

	{#if projectStore.projects.length === 0}
		<main class="empty-workspace">
			<EmptyState
				variant="no-projects"
				setupIncomplete={setupIncomplete}
				onSetupClick={() => { setupOpen = true; setupStartAt = 'wizard'; }}
				primaryAction={{
					label: 'Apri progetto',
					shortcut: 'Ctrl+Alt+N',
					onClick: () => pickerOpen = true
				}}
				secondaryAction={{
					label: 'Avvia Scratchpad',
					shortcut: 'Ctrl+Alt+S',
					onClick: () => projectStore.openScratchpad()
				}}
				shortcuts={[
					{ key: 'Ctrl+Alt+N', label: 'Apri cartella progetto', action: () => pickerOpen = true },
					{ key: 'Ctrl+Alt+S', label: 'Nuova chat rapida', action: () => projectStore.openScratchpad() },
					{ key: 'Ctrl+Alt+U', label: 'Quota e consumi API', action: () => usageOpen = true },
					{ key: 'Ctrl+Alt+,', label: 'Impostazioni Studio', action: () => settingsStore.openSection() },
					{ key: 'Ctrl+Alt+M', label: 'Modelli e provider', action: () => settingsStore.openSection('models') }
				]}
			/>
		</main>
	{:else}
	<main class="columns" class:dragging bind:this={columnsEl} style:grid-template-columns={gridTemplate}>
		<aside class="col-left">
			<div class="col-header tabs-header" role="tablist" aria-label="Pannelli laterali">
				<button type="button" role="tab" aria-selected={leftSection === 'files'} class:active={leftSection === 'files'} onclick={() => leftSection = 'files'} aria-label="Pannello file">FILE</button>
				<button type="button" role="tab" aria-selected={leftSection === 'git'} class:active={leftSection === 'git'} onclick={() => leftSection = 'git'} aria-label="Pannello git">GIT</button>
				<button type="button" role="tab" aria-selected={leftSection === 'agent'} class:active={leftSection === 'agent'} onclick={() => leftSection = 'agent'} aria-label="Pannello agente">AGENTE</button>
			</div>
			<div class="col-content" class:agent-content={leftSection === 'agent'}>
				{#if projectStore.activeProject}
					{@const proj = projectStore.activeProject}
					{#if proj.path === ''}
						<div style="padding: var(--space-2); color: var(--ink-faint);">
							Chat temporanea: nessuna cartella collegata
						</div>
					{:else if leftSection === 'files'}
						{#key proj.id}
							<FileTree
								projectPath={proj.path}
								name={proj.name}
								onFileSelect={(file) => projectStore.openFile(proj.id, file)}
								onFileDiff={(path) => handleGitPanelDiff(path, 'working')}
								dirtyFilePaths={activeDirtyFiles}
								onPathRenamed={(from, to, isDir) => projectStore.renamePath(proj.id, from, to, isDir)}
								onPathTrashed={(path, isDir) => projectStore.trashPath(proj.id, path, isDir)}
							/>
						{/key}
					{:else if leftSection === 'git'}
						<GitPanel
							projectPath={proj.path}
							agentState={proj.agentState}
							onOpenWorkingDiff={(p) => handleGitPanelDiff(p, 'working')}
							onOpenCommitDiff={(p, hash) => handleGitPanelDiff(p, 'commit', hash)}
							onResumeSession={(sid) => handleResumeSession(proj.id, sid)}
							canResume={canAutomate(proj.id)}
							resumeReason={automationReason(proj.id)}
						/>
					{:else}
						<AgentPanel
							projectPath={proj.path}
							canAutomate={canAutomate(proj.id)}
							automationReason={automationReason(proj.id)}
							actionError={agentErrors[proj.id] ?? null}
							currentSessionId={terminalMeta[proj.id]?.sessionId ?? null}
							onCreateTask={() => openNewTask(proj.path)}
							onEditTask={openTask}
							onRunTask={(taskId) => void handleRunTask(proj.id, taskId)}
							onResumeSession={(sessionId) => void handleResumeSession(proj.id, sessionId)}
							onOpenFile={(relPath) => projectStore.openFile(proj.id, relPath)}
						/>
					{/if}
				{/if}
			</div>
		</aside>

		<div
			class="splitter"
			role="separator"
			aria-orientation="vertical"
			aria-label="Ridimensiona pannello file"
			onpointerdown={(e) => startDrag(e, 'left')}
			ondblclick={() => resetSplit('left')}
		></div>

		<section class="col-center">
			<div class="col-header">{activeTaskEditor ? 'TASK' : diagramOpen ? 'DIAGRAMMA' : previewFile ? 'ANTEPRIMA' : 'EDITOR'}</div>
			<div class="col-content fill" style="background: var(--bg-sunken); position: relative;">
				{#if projectStore.activeProject}
					{#if activeTaskEditor}
						<TaskEditor
							task={activeTaskEditor}
							session={agentSessions.get(projectStore.activeProject.id) ?? null}
							guiHosts={guiHosts}
							onClose={() => taskEditorId = null}
							onRunTask={(taskId: string) => void handleRunTask(projectStore.activeProject!.id, taskId)}
							onOpenImage={(data: string, mimeType: string) => (viewingImage = { data, mimeType })}
						/>
					{:else if diagramOpen}
						<DiagramViewer
							projectPath={projectStore.activeProject.path}
							onClose={() => (diagramOpen = false)}
						/>
					{:else if previewFile}
						<PreviewViewer
							projectPath={projectStore.activeProject.path}
							filePath={previewFile}
							onClose={() => (previewFile = null)}
						/>
					{:else if EditorComponent}
						<EditorComponent
							projectPath={projectStore.activeProject.path}
							filePaths={projectStore.activeProject.openFiles}
							filePath={projectStore.activeProject.activeFile}
							openFileRequest={terminalOpenRequest?.projectId === projectStore.activeProject.id ? terminalOpenRequest : null}
							editorDiffRequest={editorDiffRequest}
							onDirtyFilesChange={(paths: string[]) => (activeDirtyFiles = paths)}
							onPreviewRequest={(fp: string) => (previewFile = fp)}
							onFileSaved={() => {
								window.dispatchEvent(new CustomEvent('git-status-refresh'));
							}}
						/>
					{/if}
				{/if}
			</div>
		</section>

		<div
			class="splitter"
			role="separator"
			aria-orientation="vertical"
			aria-label="Ridimensiona editor"
			onpointerdown={(e) => startDrag(e, 'center')}
			ondblclick={() => resetSplit('center')}
		></div>

		<section class="col-right">
			<div class="col-header tabs-header" role="tablist" aria-label="Superfici di interazione">
				<button
					type="button"
					role="tab"
					aria-selected={projectStore.activeProject?.layout.rightSection !== 'gui'}
					class:active={projectStore.activeProject?.layout.rightSection !== 'gui'}
					disabled={activeSwitching}
					title={activeSwitching ? 'Passaggio di superficie in corso' : 'Superficie terminale (Ctrl+Alt+A)'}
					aria-label="Superficie terminale (Ctrl+Alt+A)"
					onclick={() => projectStore.activeProject && void switchSurface(projectStore.activeProject.id, 'terminal')}
				>TERMINAL</button>
				<button
					type="button"
					role="tab"
					aria-selected={projectStore.activeProject?.layout.rightSection === 'gui'}
					class:active={projectStore.activeProject?.layout.rightSection === 'gui'}
					disabled={activeSwitching}
					title={activeSwitching ? 'Passaggio di superficie in corso' : 'Superficie grafica (Ctrl+Alt+A)'}
					aria-label="Superficie grafica (Ctrl+Alt+A)"
					onclick={() => projectStore.activeProject && void switchSurface(projectStore.activeProject.id, 'gui')}
				>GUI</button>
			</div>
			<div class="col-content fill" style="background: var(--bg-sunken); position: relative;">
				{#each projectStore.projects as p (p.id)}
					{#if p.layout.rightSection === 'gui'}
						<Chat
							session={agentSessionFor(p)}
							visible={p.id === projectStore.activeId}
							onOpenFile={(filePath, line) => handleTerminalOpenFile(p.id, filePath, line ?? null)}
							onOpenImage={(data, mimeType) => (viewingImage = { data, mimeType })}
							onSwitchToTerminal={() => void switchSurface(p.id, 'terminal')}
							onSlashCommand={(raw) => handleGuiSlashCommand(p.id, raw)}
						/>
					{:else}
						<Terminal
							cwd={p.path}
							visible={p.id === projectStore.activeId}
							resumeSessionId={terminalMeta[p.id]?.sessionId ?? null}
							sessionRef={(s) => {
								if (s) terminalSessions.set(p.id, s);
								else terminalSessions.delete(p.id);
							}}
							onStateChange={(state) => projectStore.setAgentState(p.id, state)}
							onInputPendingChange={(inputPending) => updateTerminalMeta(p.id, { inputPending })}
							onSessionChange={(session: TerminalSessionInfo | null) => updateTerminalMeta(p.id, { sessionId: session?.sessionId ?? null })}
							onOpenFile={(filePath, line) => handleTerminalOpenFile(p.id, filePath, line)}
						/>
					{/if}
				{/each}
			</div>
		</section>
	</main>
	{/if}

	<footer class="statusbar">
		<div class="statusbar-left">
			<span class="sb-label">Progetto:</span>
			<span class="sb-value">{projectStore.activeProject?.name || 'Nessuno'}</span>
		</div>
		<div class="statusbar-right">
			<button 
				class="version-btn"
				class:spinning={studioUpdaterStore.isChecking || studioUpdaterStore.isDownloading}
				onclick={() => {
					if (studioUpdaterStore.hasUpdate) {
						studioUpdaterStore.openModal();
					} else {
						studioUpdaterStore.checkUpdate(true);
					}
				}}
				title="Clicca per verificare aggiornamenti OMP Studio"
				aria-label="Verifica aggiornamenti OMP Studio"
			>
				{studioUpdaterStore.currentVersion ? `Studio v${studioUpdaterStore.currentVersion}` : 'Studio'}
				{#if studioUpdaterStore.updateBadge}
					<span 
						class="update-chip" 
						class:warn={studioUpdaterStore.badgeType === 'warn'} 
						class:success={studioUpdaterStore.badgeType === 'success'} 
						class:error={studioUpdaterStore.badgeType === 'error'}
					>
						{studioUpdaterStore.updateBadge}
					</span>
				{/if}
			</button>
			<button 
				class="version-btn"
				class:spinning={isCheckingUpdate || isInstallingUpdate}
				onclick={handleCheckUpdate}
				title="Clicca per verificare aggiornamenti OMP CLI"
				aria-label="Verifica aggiornamenti OMP CLI"
			>
				{ompVersion ? `OMP v${ompVersion}` : 'OMP'}
				{#if updateMessage}
					<span
						class="update-chip"
						class:warn={ompBadgeType === 'warn'}
						class:success={ompBadgeType === 'success'}
						class:error={ompBadgeType === 'error'}
					>
						{updateMessage}
					</span>
				{/if}
			</button>
			<div
				class="status-indicator"
				role="status"
				aria-live="polite"
				title="Stato agente: {agentStateLabel(projectStore.activeProject?.agentState)}"
			>
				<span class="status-led {projectStore.activeProject?.agentState || 'idle'}" aria-hidden="true"></span>
				<span>Stato: {agentStateLabel(projectStore.activeProject?.agentState)}</span>
			</div>
		</div>
	</footer>

	{#if showUpdatePromptModal}
		<button type="button" class="modal-backdrop" onclick={() => showUpdatePromptModal = false} aria-label="Chiudi finestra aggiornamento" tabindex="-1"></button>
		<div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="omp-update-title" use:trapFocus={{ onEscape: () => showUpdatePromptModal = false }}>
			<div class="modal-header">
				<h3 id="omp-update-title">Aggiornamento OMP disponibile</h3>
			</div>
			<div class="modal-body">
				<p>È disponibile una nuova versione di OMP CLI.</p>
				<p class="modal-sub">Versione attualmente installata: <strong>v{ompVersion || 'sconosciuta'}</strong></p>
				{#if pendingUpdateCheck?.latest_version}
					<p class="modal-sub">Nuova versione disponibile: <strong>v{pendingUpdateCheck.latest_version}</strong></p>
				{/if}
				{#if pendingUpdateCheck?.message}
					<pre class="update-log">{pendingUpdateCheck.message}</pre>
				{/if}
			</div>
			<div class="modal-footer">
				<button class="btn btn-secondary" onclick={() => showUpdatePromptModal = false}>Annulla</button>
				<!-- svelte-ignore a11y_autofocus -->
				<button class="btn btn-primary" autofocus onclick={handlePerformUpdate}>Scarica e aggiorna</button>
			</div>
		</div>
	{/if}

	{#if showRestartModal}
		<button type="button" class="modal-backdrop" onclick={() => showRestartModal = false} aria-label="Chiudi finestra riavvio" tabindex="-1"></button>
		<div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="omp-restart-title" use:trapFocus={{ onEscape: () => showRestartModal = false }}>
			<div class="modal-header">
				<h3 id="omp-restart-title">Aggiornamento completato</h3>
			</div>
			<div class="modal-body">
				<p>L'aggiornamento di OMP è stato installato con successo.</p>
				<p>Per applicare le modifiche a tutti i terminali attivi dell'applicazione, è consigliato ricaricare l'interfaccia.</p>
			</div>
			<div class="modal-footer">
				<button class="btn btn-secondary" onclick={() => showRestartModal = false}>Chiudi</button>
				<!-- svelte-ignore a11y_autofocus -->
				<button class="btn btn-primary" autofocus onclick={handleRestartApp}>Riavvia applicazione</button>
			</div>
		</div>
	{/if}

	<StudioUpdateModal />
	<ShortcutsHelpModal />
	{#if viewingImage}
		<ImageModal
			data={viewingImage.data}
			mimeType={viewingImage.mimeType}
			onClose={() => (viewingImage = null)}
		/>
	{/if}
</div>

<style>
	.app-layout {
		display: flex;
		flex-direction: column;
		height: 100vh;
		width: 100vw;
	}

	.empty-workspace {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-base);
		overflow: auto;
		min-height: 0;
		min-width: 0;
	}

	.columns {
		display: grid;
		/* grid-template-columns arriva inline: left | splitter | center | splitter | right */
		flex: 1;
		min-height: 0;
		min-width: 0;
	}

	.columns.dragging {
		cursor: col-resize;
		user-select: none;
	}

	.col-left {
		display: flex;
		flex-direction: column;
		background: var(--bg-base);
		min-width: 0;
		overflow: hidden;
	}

	/* Le colonne si separano per luminanza, non per riga: il pozzo scuro di
	   terminale ed editor contro la base della colonna file. Nessun bordo
	   verticale nel corpo dell'app. */
	.col-center,
	.col-right {
		display: flex;
		flex-direction: column;
		background: var(--bg-sunken);
		min-width: 0;
		overflow: hidden;
	}

	.col-header {
		height: 32px;
		padding: 0 var(--space-2);
		display: flex;
		align-items: center;
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink-faint);
		background: transparent;
		letter-spacing: 0.05em;
		z-index: var(--z-sticky);
	}

	.tabs-header {
		padding: 0;
		gap: 0;
	}

	.tabs-header button {
		background: transparent;
		border: none;
		color: var(--ink-faint);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.05em;
		height: 100%;
		padding: 0 var(--space-2);
		cursor: pointer;
		border-bottom: 2px solid transparent;
	}

	.tabs-header button:hover {
		color: var(--ink-muted);
	}

	.tabs-header button.active {
		color: var(--ink);
		border-bottom-color: var(--brand);
	}

	.col-content {
		flex: 1;
		min-height: 0;
		min-width: 0;
		overflow-y: auto;
		/* Le righe svaniscono passando sotto l'header invece di essere
		   tagliate da una linea. */
		-webkit-mask-image: linear-gradient(to bottom, transparent 0, black 10px);
		mask-image: linear-gradient(to bottom, transparent 0, black 10px);
	}

	.col-content.agent-content {
		overflow: hidden;
		-webkit-mask-image: none;
		mask-image: none;
	}

	/* Editor e terminale gestiscono il proprio scroll: uno scroll esterno
	   falserebbe le misure di fit/layout. */
	.col-content.fill {
		overflow: hidden;
		-webkit-mask-image: none;
		mask-image: none;
	}

	.splitter {
		/* La larghezza reale (6px) e' definita dal grid-template inline.
		   Invisibile a riposo: separano le superfici, non una riga. */
		background-color: transparent;
		cursor: col-resize;
		touch-action: none;
		z-index: var(--z-splitter);
	}

	.splitter:hover,
	.columns.dragging .splitter:active {
		background-image: linear-gradient(var(--brand), var(--brand));
		background-size: 1px 100%;
		background-position: center;
		background-repeat: no-repeat;
	}

	.statusbar {
		height: 26px;
		background-color: var(--bg-raised);
		/* Separata per luminanza dal pozzo, come la topbar. */
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 var(--space-3);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		z-index: var(--z-sticky);
	}

	.statusbar-left, .statusbar-right {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.sb-label {
		color: var(--ink-faint);
	}
	.sb-value {
		color: var(--ink);
		font-weight: 500;
	}

	.version-btn {
		background: transparent;
		border: 1px solid transparent;
		color: var(--ink-faint);
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 6px;
		transition: all 0.15s ease;
	}

	.version-btn:hover {
		color: var(--ink);
		background: var(--bg-hover);
		border-color: var(--line);
	}

	.version-btn.spinning {
		opacity: 0.8;
	}

	.update-chip {
		font-size: 10px;
		padding: 1px var(--space-1);
		border-radius: var(--radius-full);
		background: var(--brand);
		color: var(--on-brand);
		font-weight: 600;
	}

	.update-chip.warn {
		background: var(--warn);
		color: var(--bg-sunken);
	}

	.update-chip.success {
		background: var(--brand);
		color: var(--on-brand);
	}

	.update-chip.error {
		background: var(--danger);
		color: var(--on-danger);
	}

	.status-indicator {
		display: flex;
		align-items: center;
		gap: 6px;
		font-weight: 500;
		color: var(--ink-muted);
	}

	.status-led {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		display: inline-block;
		background-color: var(--ink-faint);
	}

	.status-led.working {
		background-color: var(--brand);
		animation: state-pulse var(--dur-pulse) var(--ease-in-out) infinite;
	}

	.status-led.attention {
		background-color: var(--warn);
	}

	.status-led.finished {
		background-color: var(--brand);
	}

	/* Il velo e' un <button>: il colore lo mette la regola, ma il bordo
	   `outset` dello user agent va rimosso o disegna una cornice a 2px
	   lungo tutto il perimetro della finestra. */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: var(--backdrop);
		z-index: var(--z-backdrop);
		border: none;
		padding: 0;
		cursor: default;
	}

	.modal-dialog {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 420px;
		max-width: 90vw;
		background: var(--bg-overlay);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		z-index: var(--z-dialog);
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.modal-header h3 {
		margin: 0;
		font-size: var(--text-md);
		font-weight: 600;
	}

	.modal-body {
		font-size: var(--text-sm);
		color: var(--ink-muted);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.modal-sub {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.update-log {
		max-height: 120px;
		overflow-y: auto;
		background: var(--bg-sunken);
		padding: var(--space-2);
		border-radius: var(--radius-sm);
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--ink-faint);
		white-space: pre-wrap;
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	.btn {
		padding: 6px 14px;
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		border: 1px solid transparent;
		transition: all 0.15s ease;
	}

	.btn-secondary {
		background: transparent;
		border-color: var(--line);
		color: var(--ink);
	}
	.btn-secondary:hover {
		background: var(--bg-hover);
	}

	.btn-primary {
		background: var(--brand);
		color: var(--on-brand);
	}
	.btn-primary:hover {
		filter: brightness(1.1);
	}
</style>