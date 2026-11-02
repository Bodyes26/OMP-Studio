/**
 * Gestione delle richieste di conferma per l'avvio dei task (Gate R48).
 *
 * Unica sorgente di verita' condivisa tra i dialoghi desktop (LaneDispatchDialog,
 * LaneProfileDialog) e il controllo remoto (RemoteProject.dispatchConfirmations).
 * Rispondere su una superficie chiude immediatamente la conferma anche sull'altra.
 */

import type { RemoteDispatchConfirmation, RemoteAgentState } from '$remote-protocol';
import type { ConcurrencyWarning } from '#lib/lanes/queueDispatch.ts';
import type { ProjectProfileReview } from '#lib/lanes/laneProfile.ts';

export interface ConcurrencyPrompt {
	id: string;
	projectId: string;
	taskId: string;
	mode: 'busy-main' | 'concurrency';
	taskTitle: string;
	warning: ConcurrencyWarning | null;
	activeLanes: Array<{ laneId: string; title: string; modelLabel: string | null; state: RemoteAgentState }>;
	forceLane: { laneId: string; title: string } | null;
	follow: boolean;
}

export interface ProfilePrompt {
	id: string;
	projectId: string;
	taskId: string;
	taskTitle: string;
	review: ProjectProfileReview;
	follow: boolean;
}

class DispatchConfirmationsStore {
	concurrencyPrompt = $state<ConcurrencyPrompt | null>(null);
	profilePrompt = $state<ProfilePrompt | null>(null);

	setConcurrency(prompt: ConcurrencyPrompt): void {
		this.concurrencyPrompt = prompt;
	}

	clearConcurrency(): void {
		this.concurrencyPrompt = null;
	}

	setProfile(prompt: ProfilePrompt): void {
		this.profilePrompt = prompt;
	}

	clearProfile(): void {
		this.profilePrompt = null;
	}

	clearConfirmation(confirmationId: string): boolean {
		if (this.concurrencyPrompt?.id === confirmationId) {
			this.concurrencyPrompt = null;
			return true;
		}
		if (this.profilePrompt?.id === confirmationId) {
			this.profilePrompt = null;
			return true;
		}
		return false;
	}

	findConfirmation(confirmationId: string):
		| { kind: 'concurrency'; prompt: ConcurrencyPrompt }
		| { kind: 'local_files'; prompt: ProfilePrompt }
		| null {
		if (this.concurrencyPrompt?.id === confirmationId) {
			return { kind: 'concurrency', prompt: this.concurrencyPrompt };
		}
		if (this.profilePrompt?.id === confirmationId) {
			return { kind: 'local_files', prompt: this.profilePrompt };
		}
		return null;
	}

	getConfirmationsForProject(projectId: string): RemoteDispatchConfirmation[] {
		const result: RemoteDispatchConfirmation[] = [];
		if (
			this.concurrencyPrompt &&
			this.concurrencyPrompt.projectId === projectId &&
			this.concurrencyPrompt.mode === 'concurrency'
		) {
			result.push({
				id: this.concurrencyPrompt.id,
				kind: 'concurrency',
				taskId: this.concurrencyPrompt.taskId,
				taskTitle: this.concurrencyPrompt.taskTitle,
				activeLanes: this.concurrencyPrompt.activeLanes
			});
		}
		if (this.profilePrompt && this.profilePrompt.projectId === projectId) {
			result.push({
				id: this.profilePrompt.id,
				kind: 'local_files',
				taskId: this.profilePrompt.taskId,
				taskTitle: this.profilePrompt.taskTitle,
				files: this.profilePrompt.review.pendingCandidates.map((candidate) => ({
					path: candidate.relativePath,
					category: candidate.rule,
					bytes: typeof candidate.bytes === 'number' ? candidate.bytes : null,
					suggested: true
				}))
			});
		}
		return result;
	}
}

export const dispatchConfirmationsStore = new DispatchConfirmationsStore();
