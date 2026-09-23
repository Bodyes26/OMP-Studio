// Estrazione evidenze di verifica reali dal transcript della corsia (Gate R27 / PLAN W12).
//
// Invarianti:
// 1. Mostra solo comandi realmente registrati nel transcript (bash, eval).
// 2. Mostra exit code reale e durata misurata.
// 3. Vietato inventare o sintetizzare stati "passed" o test fittizi.

import type { TranscriptEntry, ToolEntry } from '$lib/agent/session.svelte';
import { asRecord, num, str, resultText } from '$lib/agent/tools/types';

export interface CommandEvidence {
	id: number;
	command: string;
	exitCode?: number;
	durationMs?: number;
	isError: boolean;
	running: boolean;
	outputSnippet?: string;
}

export function extractCommandEvidence(entries: TranscriptEntry[]): CommandEvidence[] {
	const evidence: CommandEvidence[] = [];

	for (const entry of entries) {
		if (entry.kind !== 'tool') continue;
		const tool = entry as ToolEntry;
		if (tool.toolName !== 'bash' && tool.toolName !== 'eval') continue;

		const command =
			str(tool.args?.command) ??
			str(tool.args?.cmd) ??
			str(tool.args?.code) ??
			tool.intent ??
			'';

		if (!command.trim()) continue;

		const details = asRecord(tool.result?.details);
		const exitCode = num(details?.exitCode) ?? num(details?.exit_code);

		const durationMs =
			num(details?.wallTimeMs) ??
			(tool.endedAt && tool.startedAt ? tool.endedAt - tool.startedAt : undefined);

		const text = resultText(tool.result);
		const snippet = text ? text.trim().slice(0, 300) : undefined;

		evidence.push({
			id: tool.id,
			command,
			exitCode,
			durationMs,
			isError: tool.result?.isError === true || (exitCode !== undefined && exitCode !== 0),
			running: tool.running,
			outputSnippet: snippet
		});
	}

	return evidence;
}
