import { asRecord, recordList, str } from './tools/types';
import type { JobResult } from './notices';

export interface SessionJob {
	id: string;
	label: string;
	status: string;
}

/** Solo metadati strutturati: chiedere `async` non dimostra che il job sia nato. */
export function observeSessionJobs(
	current: SessionJob[],
	toolName: string,
	args: Record<string, unknown>,
	rawDetails: unknown
): SessionJob[] {
	const details = asRecord(rawDetails);
	if (!details) return current;
	const proc = asRecord(details.proc);
	const records = recordList(details.jobs ?? proc?.jobs);
	const single = asRecord(proc?.job) ?? asRecord(details.async);
	if (single) records.push(single);
	if (str(details.jobId)) records.push(details);
	let next = current;
	for (const record of records) {
		const id = str(record.id) ?? str(record.jobId) ?? str(record.name);
		const type = str(record.type) ?? (toolName === 'bash' || toolName === 'eval' ? toolName : undefined);
		if (!id || (type !== 'bash' && type !== 'eval')) continue;
		const existing = next.find((job) => job.id === id);
		const label = str(record.label) ?? str(record.task) ?? existing?.label ?? str(args.command) ?? str(args.i) ?? id;
		const status = str(record.status) ?? str(record.state) ?? existing?.status ?? 'unknown';
		// Il replay puo' rivedere il lancio dopo aver gia' ricevuto l'esito:
		// l'identita' nativa del job non viene riutilizzata per una nuova esecuzione.
		if (existing && ['completed', 'failed', 'cancelled', 'aborted'].includes(existing.status) &&
			['running', 'pending', 'in_progress', 'unknown'].includes(status)) continue;
		if (existing?.label === label && existing.status === status) continue;
		if (next === current) next = [...current];
		const index = next.findIndex((job) => job.id === id);
		const job = { id, label: label.slice(0, 500), status };
		if (index < 0) next.push(job);
		else next[index] = job;
	}
	return next;
}

/** L'esito consegnato da omp prevale sul vecchio snapshot del lancio. */
export function finishSessionJobs(current: SessionJob[], results: JobResult[]): SessionJob[] {
	let next = current;
	for (const result of results) {
		if ((result.jobType !== 'bash' && result.jobType !== 'eval') || result.jobId === 'unknown') continue;
		const existing = next.find((job) => job.id === result.jobId);
		const status = result.status ?? result.statusKind;
		const label = result.label ?? existing?.label ?? result.jobId;
		if (existing?.status === status && existing.label === label) continue;
		if (next === current) next = [...current];
		const index = next.findIndex((job) => job.id === result.jobId);
		const job = { id: result.jobId, label: label.slice(0, 500), status };
		if (index < 0) next.push(job);
		else next[index] = job;
	}
	return next;
}
