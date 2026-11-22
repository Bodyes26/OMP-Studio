/**
 * Funzioni pure per stato, ordinamento e metadati di progetti e corsie (Gate R48).
 * Valgono per una singola copia; l'unione delle copie e' in `multiMachine.ts`
 * (R-REM-02, R-REM-03, R-REM-08, R-REM-17).
 */

import type {
	RemoteProject,
	RemoteLane,
	RemoteQuotaProvider,
	RemoteQuotaWindow
} from '../../src/protocol.ts';
import { normalizeProviderId } from '#lib/components/models/providerLogos.ts';
import { t } from './i18n.ts';

export type ProjectStatus = 'question' | 'working' | 'idle';

/**
 * Calcola lo stato di una singola corsia:
 * - 'question': ha richieste di attenzione o l'agente e' in stato 'attention';
 * - 'working': l'agente sta lavorando o ha processi in background;
 * - 'idle': pronta, inattiva o offline.
 */
export function getLaneStatus(project: RemoteProject, lane: RemoteLane): ProjectStatus {
	const hasAttention =
		project.attention?.some(
			(a) => a.laneId === lane.id || (lane.kind === 'main' && a.laneId === null)
		) || lane.agent.state === 'attention';
	if (hasAttention) return 'question';

	if (lane.agent.state === 'working' || lane.agent.state === 'background') {
		return 'working';
	}

	return 'idle';
}

/**
 * Calcola lo stato aggregato di un progetto (R-REM-02):
 * prima richieste ('question'), poi al lavoro ('working'), poi fermi ('idle').
 */
export function getProjectStatus(project: RemoteProject): ProjectStatus {
	const hasAttention =
		(project.attention && project.attention.length > 0) ||
		project.lanes.some((l) => l.agent.state === 'attention');
	if (hasAttention) return 'question';

	const isWorking = project.lanes.some(
		(l) => l.agent.state === 'working' || l.agent.state === 'background'
	);
	if (isWorking) return 'working';

	return 'idle';
}

/**
 * Rango numerico di priorita per l'ordinamento:
 * question (0) < working (1) < idle (2).
 */
export function getProjectPriority(project: RemoteProject): number {
	const status = getProjectStatus(project);
	if (status === 'question') return 0;
	if (status === 'working') return 1;
	return 2;
}

/**
 * Ordina i progetti (R-REM-02): prima quelli con richieste, poi quelli al
 * lavoro, poi i fermi. Dentro ogni gruppo resta l'ordine pubblicato dalla
 * macchina, che e' quello della barra dei progetti di Studio.
 */
export function sortProjects(projects: readonly RemoteProject[]): RemoteProject[] {
	return projects
		.map((project, originalIndex) => ({ project, originalIndex, prio: getProjectPriority(project) }))
		.sort((a, b) => a.prio - b.prio || a.originalIndex - b.originalIndex)
		.map((item) => item.project);
}

/** Nome del ramo come lo mostra Studio: la Principale con il suo nome localizzato. */
export function laneLabel(lane: RemoteLane): string {
	return lane.kind === 'main' ? t('laneMain') : lane.title;
}

/** Lavori ancora in coda: quelli in avvio o gia' partiti si seguono nella chat. */
export function queuedTaskCount(project: RemoteProject): number {
	return (project.tasks ?? []).filter((task) => task.status === 'queued').length;
}

/**
 * Nome del provider come lo riconosce l'utente, lo stesso dei loghi di Studio:
 * Claude per Anthropic, ChatGPT per OpenAI, Gemini per Google.
 */
export function providerDisplayName(raw: string | null | undefined): string {
	if (!raw) return '';
	const id = normalizeProviderId(raw);
	if (id === 'anthropic') return 'Claude';
	if (id === 'openai-codex') return 'ChatGPT';
	if (id === 'google' || id === 'gemini' || id === 'google-antigravity' || id === 'google-vertex') return 'Gemini';
	const base = raw.trim();
	return base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * Restituisce la sintesi leggibile dell'attivita o dello stato di una corsia.
 */
export function getLaneSummary(project: RemoteProject, lane: RemoteLane): string {
	const att = project.attention?.find(
		(a) => a.laneId === lane.id || (lane.kind === 'main' && a.laneId === null)
	);
	if (att) {
		return att.form?.title || att.questions[0]?.question || att.title || att.message || t('attentionFallbackTitle');
	}
	if (lane.agent.headsUp) {
		return lane.agent.headsUp;
	}
	if (lane.agent.activity?.text) {
		return lane.agent.activity.text;
	}
	if (lane.session?.title) {
		return lane.session.title;
	}
	if (lane.agent.state === 'working' || lane.agent.state === 'background') {
		return t('projectStatusWorking');
	}
	return t('laneStatusReady');
}

/**
 * Restituisce la finestra di quota con il massimo consumo (quella che blocca per prima).
 */
export function getWorstQuotaWindow(provider: RemoteQuotaProvider): RemoteQuotaWindow | null {
	if (!provider.windows || provider.windows.length === 0) return null;
	return provider.windows.reduce((worst, cur) => {
		const worstFrac = worst.usedFraction ?? 0;
		const curFrac = cur.usedFraction ?? 0;
		return curFrac > worstFrac ? cur : worst;
	});
}

/**
 * Livello cromatico del consumo di quota secondo le soglie di Studio:
 * - 'exhausted': >= 98% o status exhausted
 * - 'warning': >= 85% o status warning
 * - 'ok': sotto 85%
 */
export function getQuotaLevel(
	usedFraction: number | null,
	status?: string
): 'ok' | 'warning' | 'exhausted' {
	if (status === 'exhausted' || (usedFraction != null && usedFraction >= 0.98)) {
		return 'exhausted';
	}
	if (status === 'warning' || (usedFraction != null && usedFraction >= 0.85)) {
		return 'warning';
	}
	return 'ok';
}

/**
 * Normalizza un identificatore di provider grezzo al ProviderId canonico.
 */
export function normalizeProvider(raw: string | null | undefined): string {
	return normalizeProviderId(raw);
}

/**
 * Ricava l'insieme dei provider canonici usati dalle corsie attive (non idle) del progetto.
 */
export function getWorkingProviders(project: RemoteProject): string[] {
	const providers = new Set<string>();
	for (const lane of project.lanes) {
		if (getLaneStatus(project, lane) !== 'idle') {
			const raw = lane.agent.provider;
			if (raw) {
				providers.add(normalizeProviderId(raw));
			}
		}
	}
	return Array.from(providers);
}

/**
 * Ricava l'insieme dei provider canonici in uso su tutta la macchina (rami non fermi).
 */
export function getProvidersInUse(projects: readonly RemoteProject[]): Set<string> {
	const set = new Set<string>();
	for (const p of projects) {
		for (const prov of getWorkingProviders(p)) {
			set.add(prov);
		}
	}
	return set;
}
