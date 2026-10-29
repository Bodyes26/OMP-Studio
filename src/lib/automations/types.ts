// Contratto IPC delle automazioni: stessi nomi e discriminanti nel motore Rust.
export type AutomationPlatform = 'windows' | 'macos' | 'linux';
export type AutomationState = 'draft' | 'enabled' | 'disabled' | 'suspended' | 'archived';
export type ExecutionState = 'waiting' | 'running' | 'needsInput' | 'completed' | 'error' | 'timeout' | 'interrupted' | 'skipped' | 'unknown' | 'superseded';
export type AutomationTriggerKind = 'manual' | 'once' | 'daily' | 'weekly' | 'interval' | 'afterFinish' | 'gitCommit' | 'gitBranch' | 'gitDirty' | 'gitClean' | 'file' | 'agentFinished' | 'agentQuota' | 'agentError' | 'studioStarted' | 'projectOpened';

export interface CommandVariant {
	mode: 'shell' | 'executable' | 'script';
	command: string;
	args: string[];
	interpreter: string;
}
export interface CommandAction extends CommandVariant {
	kind: 'command';
	platforms: AutomationPlatform[];
	variants: Partial<Record<AutomationPlatform, CommandVariant>>;
	environment: Record<string, string>;
	secretRefs: Record<string, string>;
	scriptPolicy: 'review' | 'follow';
	approvedFiles: Record<string, string>;
	watchedFiles: string[];
}
export interface PromptAction {
	kind: 'prompt';
	prompt: string;
	modelMode: 'role' | 'model';
	model: string;
	allowPayAsYouGo: boolean;
	maxCostUsd: number | null;
}
export type AutomationAction = CommandAction | PromptAction;
export interface TargetFilter {
	kind: 'dirty' | 'activity' | 'commit';
	period: 'today' | '24h' | '7d';
	authors: string[];
}
export interface AutomationTargets {
	source: 'selected' | 'open' | 'registered' | 'studio' | 'directory';
	projectPaths: string[];
	excludePaths: string[];
	includeStudio: boolean;
	mode: 'each' | 'aggregate';
	cwd: string;
	filters: TargetFilter[];
}
export interface AutomationTrigger {
	id: string;
	kind: AutomationTriggerKind;
	at?: number;
	time?: string;
	weekdays?: number[];
	intervalMinutes?: number;
	roots?: string[];
	includePatterns?: string[];
	excludePatterns?: string[];
	changes?: Array<'create' | 'modify' | 'remove'>;
	branches?: string[];
}
export interface AutomationQuotaPolicy {
	shortPct: number;
	weeklyPct: number;
	otherPct: number;
	windows: Record<string, number>;
}
export interface AutomationPolicy {
	timezone: string;
	maxWaitMinutes: number;
	timeoutMinutes: number;
	humanWaitMinutes: number;
	missed: 'notify' | 'ignore' | 'recover';
	recoveryMinutes: number;
	overlap: 'coalesce' | 'skip';
	quota: AutomationQuotaPolicy;
	notifySuccess: boolean;
	fileQuietSeconds: number;
	fileMaxWaitSeconds: number;
}
export interface AutomationDefinition {
	id: string;
	revision: number;
	name: string;
	description: string;
	state: AutomationState;
	action: AutomationAction;
	targets: AutomationTargets;
	triggers: AutomationTrigger[];
	branches: string[];
	policy: AutomationPolicy;
	createdAt: number;
	updatedAt: number;
	origin: string;
}
export interface AssistantMessage {
	id: string;
	role: 'user' | 'assistant';
	text: string;
	at: number;
}
export interface AutomationDraft {
	id: string;
	definition: AutomationDefinition;
	baseRevision: number | null;
	conversation: AssistantMessage[];
	createdAt: number;
	updatedAt: number;
	source: string;
}
export interface AutomationProject {
	id: string;
	path: string;
	name: string;
	open: boolean;
	workspacePaths?: string[];
}
export interface ResolvedAutomationTarget {
	key: string;
	projectId: string | null;
	path: string;
	name: string;
	kind: 'project' | 'studio' | 'directory';
}
export interface AutomationEvent {
	kind: AutomationTriggerKind;
	at: number;
	projectPath?: string;
	paths?: string[];
	branch?: string;
	commit?: string;
	origin?: 'interactive' | 'automation' | 'external';
	detail?: string;
}
export interface AutomationExecution {
	id: string;
	runId: string;
	targets: ResolvedAutomationTarget[];
	state: ExecutionState;
	reason: string | null;
	startedAt: number | null;
	finishedAt: number | null;
	exitCode: number | null;
	model: string | null;
	sessionId: string | null;
	result: string | null;
	question: string | null;
	humanDeadline: number | null;
	outputTruncated: boolean;
}
export interface AutomationOccurrence {
	id: string;
	automationId: string;
	revision: number;
	name: string;
	scheduledAt: number;
	createdAt: number;
	deadline: number;
	state: ExecutionState;
	reasons: AutomationEvent[];
	targets: ResolvedAutomationTarget[];
	executions: AutomationExecution[];
	definition: AutomationDefinition;
	acknowledged: boolean;
	requiresReview: boolean;
}
export interface AutomationSettings {
	maxAi: number;
	maxCommands: number;
	retentionDays: number;
	outputPerRunBytes: number;
	outputTotalBytes: number;
	assistantModelMode: 'role' | 'model';
	assistantModel: string;
	assistantAllowPayAsYouGo: boolean;
}
export interface AutomationSnapshot {
	definitions: AutomationDefinition[];
	drafts: AutomationDraft[];
	runs: AutomationOccurrence[];
	settings: AutomationSettings;
	projects: AutomationProject[];
	monitoringSince: number;
	errors: string[];
	nextRuns: Record<string, number | null>;
	projectRequests?: AutomationProjectRequest[];
}
export interface AutomationProjectRequest {
	requestId: string;
	operation: 'open' | 'close';
	path: string;
	executionId?: string;
	status: 'requested' | 'deferred' | 'completed' | 'error';
	createdAt: number;
}
export interface AutomationContext {
	projects: AutomationProject[];
	busyPaths: string[];
	interactiveAgentCount: number;
	maxAgentCount: number;
	interactiveWaiting: boolean;
}
export interface AutomationAiRequest {
	executionId: string;
	runId: string;
	definition: AutomationDefinition;
	targets: ResolvedAutomationTarget[];
	contextPath: string;
	cwd: string;
}
export interface AutomationAiUpdate {
	executionId: string;
	state: ExecutionState;
	sessionId?: string;
	model?: string;
	result?: string;
	question?: string;
	reason?: string;
}
export interface AutomationOutput {
	text: string;
	nextOffset: number;
	truncated: boolean;
	end: boolean;
}
export interface AutomationPreview {
	targets: ResolvedAutomationTarget[];
	nextRuns: number[];
	issues: string[];
	fileHashes: Record<string, string>;
}
export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
	maxAi: 1, maxCommands: 1, retentionDays: 90,
	outputPerRunBytes: 10 * 1024 * 1024, outputTotalBytes: 200 * 1024 * 1024,
	assistantModelMode: 'role', assistantModel: 'smol', assistantAllowPayAsYouGo: false
};
export function newAutomationDefinition(projectPath = ''): AutomationDefinition {
	const now = Date.now();
	return {
		id: crypto.randomUUID(), revision: 0, name: '', description: '', state: 'draft',
		action: { kind: 'prompt', prompt: '', modelMode: 'role', model: 'default', allowPayAsYouGo: false, maxCostUsd: null },
		targets: { source: projectPath ? 'selected' : 'directory', projectPaths: projectPath ? [projectPath] : [], excludePaths: [], includeStudio: false, mode: 'each', cwd: projectPath, filters: [] },
		triggers: [{ id: crypto.randomUUID(), kind: 'manual' }], branches: [],
		policy: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, maxWaitMinutes: 60, timeoutMinutes: 60, humanWaitMinutes: 60, missed: 'notify', recoveryMinutes: 15, overlap: 'coalesce', quota: { shortPct: 10, weeklyPct: 10, otherPct: 10, windows: {} }, notifySuccess: false, fileQuietSeconds: 2, fileMaxWaitSeconds: 30 },
		createdAt: now, updatedAt: now, origin: 'user'
	};
}
export function newCommandAction(platform: AutomationPlatform): CommandAction {
	return { kind: 'command', mode: 'shell', command: '', args: [], interpreter: platform === 'windows' ? 'cmd.exe' : '/bin/sh', platforms: [platform], variants: {}, environment: {}, secretRefs: {}, scriptPolicy: 'review', approvedFiles: {}, watchedFiles: [] };
}
