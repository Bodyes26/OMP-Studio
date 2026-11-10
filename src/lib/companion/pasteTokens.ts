/**
 * Riconosce i token gia' completi dentro un testo incollato nel Companion.
 *
 * Scrivendo, la palette si apre solo sul token sotto il cursore. Un incolla
 * deposita l'intero messaggio in un colpo: qui si applicano le stesse
 * risoluzioni (`#progetto`, `!ruolo`/`!modello`, `/direttiva`, `/comando`,
 * `@file`) a ogni token del frammento, non solo all'ultimo.
 *
 * I token ambigui o sconosciuti restano testo, cosi' la palette puo' aprirsi
 * se il cursore finisce sopra uno di essi. La pulizia degli spazi segue
 * `parseQuickTaskLocal`: un token tolto diventa uno spazio, poi gli spazi
 * orizzontali collassano e il frammento si ritaglia ai bordi.
 */

import { findFileMentions } from '../agent/fileMentionSyntax.ts';
import type { ComposerSegment, ComposerTriggerKind } from '../agent/composerDoc.ts';
import { findProjectTokens, type LocalProjectRef } from './quickTaskLocal.ts';

export interface PasteProjectSource {
	name: string;
	label: string;
	hue?: number;
	path?: string;
}

export interface PasteDirectiveSource {
	id: string;
	name: string;
	tag?: string;
}

export interface PasteRoleSource {
	value: string;
	label: string;
	hue?: number;
}

export interface PasteModelSource {
	value: string;
	label: string;
}

export interface PasteCommandSource {
	name: string;
	aliases?: string[];
	source?: string;
}

export interface PasteTokenSources {
	projects: PasteProjectSource[];
	directives: PasteDirectiveSource[];
	roles: PasteRoleSource[];
	models: PasteModelSource[];
	commands: PasteCommandSource[];
}

export interface ResolvedPasteDirective {
	id: string;
	name: string;
	tag?: string;
}

export interface ResolvedPasteRole {
	kind: 'role' | 'model';
	value: string;
	label: string;
	hue?: number;
}

export interface ResolvedPaste {
	/** Vuoto se l'incolla era fatto solo di token tolti dal testo. */
	segments: ComposerSegment[];
	/** Falso: nessun token riconosciuto, l'incolla resta testo semplice. */
	changed: boolean;
	project: PasteProjectSource | null;
	directives: ResolvedPasteDirective[];
	role: ResolvedPasteRole | null;
}

export interface ResolvePasteOptions {
	triggers: readonly ComposerTriggerKind[];
	/**
	 * Nel composer di coda `/direttiva` esce dal testo e diventa badge.
	 * Nella risposta resta un badge di comando dentro il messaggio.
	 */
	liftDirectives: boolean;
}

interface DropSpan {
	start: number;
	end: number;
}

interface BadgeSpan {
	start: number;
	end: number;
	segment: Exclude<ComposerSegment, { t: 'text' }>;
}

const SLASH_RE = /(?:^|\s)(\/([\w.\-]+(?::[\w.\-]+)*))/g;
const DIRECTIVE_RE = /(?:^|\s)(\/([\w.\-]+))/g;
const ROLE_RE = /(?:^|\s)(!([\w.\-/:]+))/g;
const SENTINEL = '\uE000';

function normalizeTokenKey(value: string): string {
	return value.toLowerCase().replace(/[\s\-_]+/g, '');
}

function enabled(options: ResolvePasteOptions, kind: ComposerTriggerKind): boolean {
	return options.triggers.includes(kind);
}

function cleanTag(tag: string | undefined): string {
	if (!tag) return '';
	return tag.startsWith('/') ? tag.slice(1) : tag;
}

function matchDirective(token: string, directives: PasteDirectiveSource[]): PasteDirectiveSource | null {
	const norm = normalizeTokenKey(token);
	if (!norm) return null;
	const byTag = directives.find((d) => {
		const tag = cleanTag(d.tag);
		return tag.length > 0 && normalizeTokenKey(tag) === norm;
	});
	if (byTag) return byTag;
	return directives.find((d) => normalizeTokenKey(d.name) === norm) ?? null;
}

function matchCommand(token: string, commands: PasteCommandSource[]): PasteCommandSource | null {
	const lower = token.toLowerCase();
	const skill = lower.startsWith('skill:') ? lower.slice('skill:'.length) : null;
	return (
		commands.find((command) => {
			if (command.name.toLowerCase() === lower) return true;
			if (command.aliases?.some((alias) => alias.toLowerCase() === lower)) return true;
			if (skill && command.source === 'skill' && command.name.toLowerCase() === skill) return true;
			return false;
		}) ?? null
	);
}

function commandBadgeName(token: string, command: PasteCommandSource): string {
	// `/skill:nome` deve restare sintassi skill sul filo: il badge tiene il prefisso.
	if (token.toLowerCase().startsWith('skill:')) return `skill:${command.name}`;
	return command.name;
}

function resolveProject(text: string, projects: PasteProjectSource[]): { project: PasteProjectSource | null; spans: DropSpan[] } {
	const refs: LocalProjectRef[] = projects.map((project) => ({
		id: project.path || project.name,
		name: project.name,
		label: project.label,
		path: project.path ?? ''
	}));
	const tokens = findProjectTokens(text, refs);
	if (tokens.length === 0) return { project: null, spans: [] };

	let resolved: LocalProjectRef | null = null;
	let failed = false;
	const spans: DropSpan[] = [];
	for (const token of tokens) {
		if (!token.project?.path?.trim()) {
			failed = true;
			continue;
		}
		if (!resolved) {
			resolved = token.project;
			spans.push({ start: token.start, end: token.end });
		} else if (resolved.id === token.project.id) {
			spans.push({ start: token.start, end: token.end });
		} else {
			failed = true;
		}
	}
	// Conflitto o token irrisolto: non si toglie nulla, il testo resta selezionabile.
	if (failed || !resolved) return { project: null, spans: [] };

	const source =
		projects.find((project) => (project.path && project.path === resolved?.path) || project.name === resolved?.name) ??
		null;
	return {
		project: source ?? {
			name: resolved.name,
			label: resolved.label ?? resolved.name,
			path: resolved.path
		},
		spans
	};
}

function overlaps(start: number, end: number, spans: DropSpan[]): boolean {
	return spans.some((span) => start < span.end && end > span.start);
}

function applyMarks(text: string, drops: DropSpan[], badges: BadgeSpan[]): ComposerSegment[] {
	type Mark = { start: number; end: number; badge: BadgeSpan['segment'] | null };
	const marks: Mark[] = [
		...drops.map((span) => ({ start: span.start, end: span.end, badge: null })),
		...badges.map((span) => ({ start: span.start, end: span.end, badge: span.segment }))
	];
	marks.sort((a, b) => a.start - b.start || (a.badge === null ? -1 : 1) - (b.badge === null ? -1 : 1) || b.end - a.end);

	const used: Mark[] = [];
	let limit = 0;
	for (const mark of marks) {
		if (mark.start < limit || mark.end <= mark.start) continue;
		used.push(mark);
		limit = mark.end;
	}

	const badgeSegments: BadgeSpan['segment'][] = [];
	let built = '';
	let cursor = 0;
	for (const mark of used) {
		built += text.slice(cursor, mark.start);
		if (mark.badge) {
			built += SENTINEL;
			badgeSegments.push(mark.badge);
		} else {
			built += ' ';
		}
		cursor = mark.end;
	}
	built += text.slice(cursor);

	if (used.some((mark) => mark.badge === null)) {
		built = built.replace(/[^\S\r\n]+/g, ' ').trim();
	}

	if (!built.includes(SENTINEL)) {
		return built ? [{ t: 'text', s: built }] : [];
	}

	const parts = built.split(SENTINEL);
	const segments: ComposerSegment[] = [];
	for (let i = 0; i < parts.length; i++) {
		if (parts[i]) segments.push({ t: 'text', s: parts[i] });
		const badge = badgeSegments[i];
		if (badge) segments.push(badge);
	}
	return segments;
}

export function resolvePastedTokens(
	text: string,
	sources: PasteTokenSources,
	options: ResolvePasteOptions
): ResolvedPaste {
	const normalized = (text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	const empty: ResolvedPaste = {
		segments: normalized ? [{ t: 'text', s: normalized }] : [],
		changed: false,
		project: null,
		directives: [],
		role: null
	};
	if (!normalized) return empty;

	const drops: DropSpan[] = [];
	const badges: BadgeSpan[] = [];

	let project: PasteProjectSource | null = null;
	if (enabled(options, '#')) {
		const resolved = resolveProject(normalized, sources.projects);
		project = resolved.project;
		drops.push(...resolved.spans);
	}

	const directives: ResolvedPasteDirective[] = [];
	const seenDirectives = new Set<string>();
	if (enabled(options, '/') && options.liftDirectives) {
		const re = new RegExp(DIRECTIVE_RE);
		let match: RegExpExecArray | null;
		while ((match = re.exec(normalized)) !== null) {
			const full = match[1];
			const token = match[2];
			const start = match.index + match[0].indexOf(full);
			const found = matchDirective(token, sources.directives);
			if (!found || overlaps(start, start + full.length, drops)) continue;
			drops.push({ start, end: start + full.length });
			if (!seenDirectives.has(found.id)) {
				seenDirectives.add(found.id);
				directives.push({
					id: found.id,
					name: found.name,
					tag: found.tag ?? `/${cleanTag(found.tag) || token}`
				});
			}
		}
	}

	let role: ResolvedPasteRole | null = null;
	if (enabled(options, '!')) {
		const re = new RegExp(ROLE_RE);
		let match: RegExpExecArray | null;
		while ((match = re.exec(normalized)) !== null) {
			const full = match[1];
			const token = match[2];
			const start = match.index + match[0].indexOf(full);
			const end = start + full.length;
			if (overlaps(start, end, drops)) continue;
			const foundRole = sources.roles.find((item) => item.value.toLowerCase() === token.toLowerCase());
			const foundModel = sources.models.find((item) => item.value.toLowerCase() === token.toLowerCase());
			if (foundRole) {
				drops.push({ start, end });
				role = { kind: 'role', value: foundRole.value, label: foundRole.label, hue: foundRole.hue };
			} else if (foundModel) {
				drops.push({ start, end });
				role = { kind: 'model', value: foundModel.value, label: foundModel.label };
			}
		}
	}

	if (enabled(options, '@')) {
		for (const mention of findFileMentions(normalized)) {
			if (overlaps(mention.start, mention.end, drops)) continue;
			badges.push({ start: mention.start, end: mention.end, segment: { t: 'file', path: mention.path } });
		}
	}

	if (enabled(options, '/')) {
		const re = new RegExp(SLASH_RE);
		let match: RegExpExecArray | null;
		while ((match = re.exec(normalized)) !== null) {
			const full = match[1];
			const token = match[2];
			const start = match.index + match[0].indexOf(full);
			const end = start + full.length;
			if (overlaps(start, end, drops) || badges.some((badge) => start < badge.end && end > badge.start)) continue;

			const command = matchCommand(token, sources.commands);
			if (command) {
				badges.push({ start, end, segment: { t: 'cmd', name: commandBadgeName(token, command) } });
				continue;
			}
			// Nel messaggio di risposta la direttiva resta nel testo, come badge.
			// Un token con i due punti (`/skill:nome`) non e' una direttiva.
			if (options.liftDirectives || token.includes(':')) continue;
			const directive = matchDirective(token, sources.directives);
			if (!directive) continue;
			badges.push({
				start,
				end,
				segment: { t: 'cmd', name: cleanTag(directive.tag) || token }
			});
		}
	}

	if (drops.length === 0 && badges.length === 0) return empty;

	return {
		segments: applyMarks(normalized, drops, badges),
		changed: true,
		project,
		directives,
		role
	};
}
