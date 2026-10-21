// Parsers per blocchi Intelligent UI (ui:metric, ui:tabs, ui:steps, ui:compare, ui:accordion)
// e callout GitHub-flavored (> [!NOTE], > [!WARNING], ecc.)

import type { Token } from '../markdown';
import type { CalloutKind } from './CalloutCard.svelte';
import type { StatItem } from './StatCard.svelte';
import type { TabItem } from './InteractiveTabs.svelte';
import type { StepItem } from './ProcessStepper.svelte';

export interface CalloutParseResult {
	kind: CalloutKind;
	title?: string;
	bodyTokens: Token[];
}

/**
 * Riconosce i callout in stile GitHub (> [!NOTE], > [!TIP], > [!WARNING], ecc.)
 */
export function parseCallout(token: Token): CalloutParseResult | null {
	if (token.type !== 'blockquote' || !token.tokens || token.tokens.length === 0) return null;
	const first = token.tokens[0];
	if (!first || first.type !== 'paragraph' || !first.tokens || first.tokens.length === 0) return null;
	const firstInline = first.tokens[0];
	if (!firstInline || !('text' in firstInline) || typeof firstInline.text !== 'string') return null;
	const inlineText = firstInline.text;

	const match = inlineText.match(/^\[!(NOTE|TIP|WARNING|CAUTION|IMPORTANT|SUCCESS)\](?:\s+(.*))?/i);
	if (!match) return null;

	const kindStr = match[1].toLowerCase() as CalloutKind;
	const customTitle = match[2]?.trim() || undefined;

	const remainingFirstText = inlineText.slice(match[0].length).trim();
	const restTokens = [...token.tokens];

	if (remainingFirstText) {
		const newFirst = {
			...first,
			tokens: [
				{ ...firstInline, text: remainingFirstText, raw: remainingFirstText },
				...first.tokens.slice(1)
			]
		};
		restTokens[0] = newFirst;
	} else if (first.tokens.length > 1) {
		const newFirst = {
			...first,
			tokens: first.tokens.slice(1)
		};
		restTokens[0] = newFirst;
	} else {
		restTokens.shift();
	}

	return {
		kind: kindStr,
		title: customTitle,
		bodyTokens: restTokens
	};
}

/**
 * Parser per blocchi ```ui:metric o ```ui:stat
 */
export function parseMetricBlock(text: string): StatItem[] | null {
	const trimmed = text.trim();
	if (!trimmed) return null;

	// Prova JSON
	if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
		try {
			const parsed = JSON.parse(trimmed);
			const arr = Array.isArray(parsed) ? parsed : [parsed];
			return arr.map((item) => ({
				label: String(item.label || item.name || 'Metrica'),
				value: item.value ?? 0,
				change: item.change,
				trend: item.trend,
				tone: item.tone || 'neutral',
				subtext: item.subtext
			}));
		} catch {
			// Continua con parser a righe
		}
	}

	// Parser riga per riga (stile chiave: valore con divisore ---)
	const sections = trimmed.split(/\n\s*---\s*\n/);
	const items: StatItem[] = [];

	for (const sec of sections) {
		const lines = sec.split('\n');
		const item: Partial<StatItem> = {};
		for (const line of lines) {
			const idx = line.indexOf(':');
			if (idx === -1) continue;
			const key = line.slice(0, idx).trim().toLowerCase();
			const val = line.slice(idx + 1).trim();
			if (key === 'label' || key === 'name') item.label = val;
			else if (key === 'value' || key === 'val') item.value = val;
			else if (key === 'change' || key === 'delta') item.change = val;
			else if (key === 'trend') item.trend = val as StatItem['trend'];
			else if (key === 'tone' || key === 'color') item.tone = val as StatItem['tone'];
			else if (key === 'subtext' || key === 'note') item.subtext = val;
		}
		if (item.label && item.value !== undefined) {
			items.push(item as StatItem);
		}
	}

	return items.length > 0 ? items : null;
}

/**
 * Parser per blocchi ```ui:tabs
 */
export function parseTabsBlock(text: string): TabItem[] | null {
	const trimmed = text.trim();
	if (!trimmed) return null;

	// Prova JSON
	if (trimmed.startsWith('[')) {
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) {
				return parsed.map((t, idx) => ({
					id: t.id || `tab-${idx}`,
					title: String(t.title || `Tab ${idx + 1}`),
					lang: t.lang,
					content: String(t.content || '')
				}));
			}
		} catch {
			// Continua
		}
	}

	// Parser a sezioni === Titolo Tab ===
	const tabRegex = /===\s*(.+?)\s*===/g;
	const matches = [...trimmed.matchAll(tabRegex)];
	if (matches.length === 0) return null;

	const tabs: TabItem[] = [];
	for (let i = 0; i < matches.length; i++) {
		const match = matches[i];
		const title = match[1].trim();
		const startIndex = match.index! + match[0].length;
		const endIndex = i + 1 < matches.length ? matches[i + 1].index! : trimmed.length;
		const content = trimmed.slice(startIndex, endIndex).trim();
		tabs.push({
			id: `tab-${i}`,
			title,
			content
		});
	}

	return tabs.length > 0 ? tabs : null;
}

/**
 * Parser per blocchi ```ui:steps
 */
export function parseStepsBlock(text: string): StepItem[] | null {
	const trimmed = text.trim();
	if (!trimmed) return null;

	// Prova JSON
	if (trimmed.startsWith('[')) {
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) {
				return parsed.map((s, idx) => ({
					id: s.id || idx + 1,
					title: String(s.title || `Passo ${idx + 1}`),
					status: s.status || 'pending',
					description: s.description
				}));
			}
		} catch {
			// Continua
		}
	}

	// Parser per righe markdown / elenco numerato o checkbox
	const lines = trimmed.split('\n');
	const steps: StepItem[] = [];

	for (const raw of lines) {
		const line = raw.trim();
		if (!line) continue;

		// Checkbox: - [x] Passo o - [ ] Passo
		const checkMatch = line.match(/^[-*]\s*\[([ xX])\]\s*(.+)/);
		if (checkMatch) {
			const isDone = checkMatch[1].toLowerCase() === 'x';
			steps.push({
				title: checkMatch[2].trim(),
				status: isDone ? 'done' : 'pending'
			});
			continue;
		}

		// Numerato: 1. Passo: descrizione
		const numMatch = line.match(/^\d+[.)]\s*(.+)/);
		if (numMatch) {
			const content = numMatch[1];
			const colonIdx = content.indexOf(':');
			if (colonIdx !== -1) {
				steps.push({
					title: content.slice(0, colonIdx).trim(),
					description: content.slice(colonIdx + 1).trim(),
					status: 'pending'
				});
			} else {
				steps.push({
					title: content.trim(),
					status: 'pending'
				});
			}
			continue;
		}
	}

	return steps.length > 0 ? steps : null;
}

/**
 * Parser per blocchi ```ui:compare
 */
export function parseCompareBlock(text: string): { before: string; after: string; labelBefore?: string; labelAfter?: string } | null {
	const trimmed = text.trim();
	if (!trimmed) return null;

	// Prova JSON
	if (trimmed.startsWith('{')) {
		try {
			const parsed = JSON.parse(trimmed);
			if (parsed.before && parsed.after) {
				return {
					before: String(parsed.before),
					after: String(parsed.after),
					labelBefore: parsed.labelBefore,
					labelAfter: parsed.labelAfter
				};
			}
		} catch {
			// Continua
		}
	}

	// Divisore === DOPO === o === AFTER ===
	const splitMatch = trimmed.split(/===\s*(?:DOPO|AFTER)\s*===/i);
	if (splitMatch.length >= 2) {
		const beforePart = splitMatch[0].replace(/===\s*(?:PRIMA|BEFORE)\s*===/i, '').trim();
		const afterPart = splitMatch[1].trim();
		return {
			before: beforePart,
			after: afterPart,
			labelBefore: 'Prima',
			labelAfter: 'Dopo'
		};
	}

	return null;
}

/**
 * Parser per blocchi ```ui:accordion
 */
export function parseAccordionBlock(text: string): { title: string; badge?: string; content: string } | null {
	const trimmed = text.trim();
	if (!trimmed) return null;

	// Prova JSON
	if (trimmed.startsWith('{')) {
		try {
			const parsed = JSON.parse(trimmed);
			if (parsed.title && parsed.content) {
				return {
					title: String(parsed.title),
					badge: parsed.badge,
					content: String(parsed.content)
				};
			}
		} catch {
			// Continua
		}
	}

	// Prima riga come titolo
	const lines = trimmed.split('\n');
	if (lines.length > 1) {
		return {
			title: lines[0].replace(/^#+\s*/, '').trim(),
			content: lines.slice(1).join('\n').trim()
		};
	}

	return null;
}
