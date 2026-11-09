import type { AskFormDraft } from '#lib/agent/askForm.ts';
import { copyAskFormDraft } from '#lib/agent/askForm.ts';

interface RemoteDraftEntry {
	draft: AskFormDraft;
	dirty: boolean;
	updatedAt: number;
}

class RemoteDraftStore {
	private drafts = $state<Record<string, RemoteDraftEntry>>({});

	private makeKey(hostId: string, projectId: string, requestId: string): string {
		return `${hostId}:${projectId}:${requestId}`;
	}

	getDraft(hostId: string, projectId: string, requestId: string): AskFormDraft | undefined {
		const key = this.makeKey(hostId, projectId, requestId);
		const entry = this.drafts[key];
		return entry ? copyAskFormDraft(entry.draft) : undefined;
	}

	isDirty(hostId: string, projectId: string, requestId: string): boolean {
		const key = this.makeKey(hostId, projectId, requestId);
		return Boolean(this.drafts[key]?.dirty);
	}

	setDraft(hostId: string, projectId: string, requestId: string, draft: AskFormDraft, dirty = true): void {
		const key = this.makeKey(hostId, projectId, requestId);
		this.drafts[key] = {
			draft: copyAskFormDraft(draft),
			dirty,
			updatedAt: Date.now()
		};
	}

	deleteDraft(hostId: string, projectId: string, requestId: string): void {
		const key = this.makeKey(hostId, projectId, requestId);
		delete this.drafts[key];
	}

	deleteByRequestId(requestId: string): void {
		for (const key of Object.keys(this.drafts)) {
			if (key.endsWith(`:${requestId}`)) {
				delete this.drafts[key];
			}
		}
	}
}

export const remoteDraftStore = new RemoteDraftStore();
