/**
 * Regole pure dell'aggiornamento di un'altra macchina (R-MI-38), separate dal
 * negozio per provarle senza finestra.
 */

export type WaitReason = 'agents' | 'questions' | 'jobs' | 'unsaved';

/** Canale di chi chiede: una Nightly porta l'altra macchina sulla Nightly. */
export function channelOf(version: string): 'stable' | 'nightly' {
	return version.includes('-nightly') ? 'nightly' : 'stable';
}

/** L'altra macchina va aggiornata: in linea, con una versione diversa da questa. */
export function needsUpdate(peer: { online: boolean; version: string | null }, own: string | null): boolean {
	return Boolean(peer.online && peer.version && own && peer.version !== own);
}

/**
 * Cosa tiene occupata questa macchina prima di installare e riavviare:
 * agenti al lavoro (anche automazioni), domande in attesa, job chiesti da
 * altre macchine, file non salvati.
 */
export function waitReasons(input: {
	workingAgents: number;
	pendingQuestions: number;
	activeJobs: number;
	incomingJobs: number;
	unsavedProjects: number;
}): WaitReason[] {
	const reasons: WaitReason[] = [];
	if (input.workingAgents > 0 || input.activeJobs > 0) reasons.push('agents');
	if (input.pendingQuestions > 0) reasons.push('questions');
	if (input.incomingJobs > 0) reasons.push('jobs');
	if (input.unsavedProjects > 0) reasons.push('unsaved');
	return reasons;
}
