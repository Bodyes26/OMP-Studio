// Registro dei renderer: nome del tool -> componente.
//
// Un tool senza voce qui cade su `Generic`, che e' una card corretta e non
// uno stato rotto: e' anche il percorso normale per tutti gli `mcp__*`, la
// cui forma non e' conoscibile in anticipo.

import Generic from './Generic.svelte';
import type { ToolRenderer } from './types';

import Ask from './renderers/Ask.svelte';
import AstEdit from './renderers/AstEdit.svelte';
import AstGrep from './renderers/AstGrep.svelte';
import Bash from './renderers/Bash.svelte';
import Browser from './renderers/Browser.svelte';
import Debug from './renderers/Debug.svelte';
import Edit from './renderers/Edit.svelte';
import Eval from './renderers/Eval.svelte';
import Fetch from './renderers/Fetch.svelte';
import GenerateImage from './renderers/GenerateImage.svelte';
import Github from './renderers/Github.svelte';
import Glob from './renderers/Glob.svelte';
import Goal from './renderers/Goal.svelte';
import Grep from './renderers/Grep.svelte';
import Hub from './renderers/Hub.svelte';
import InspectImage from './renderers/InspectImage.svelte';
import Irc from './renderers/Irc.svelte';
import Job from './renderers/Job.svelte';
import Lsp from './renderers/Lsp.svelte';
import Read from './renderers/Read.svelte';
import Recall from './renderers/Recall.svelte';
import Reflect from './renderers/Reflect.svelte';
import ReportIssue from './renderers/ReportIssue.svelte';
import Resolve from './renderers/Resolve.svelte';
import Retain from './renderers/Retain.svelte';
import Task from './renderers/Task.svelte';
import Todo from './renderers/Todo.svelte';
import WebSearch from './renderers/WebSearch.svelte';
import Write from './renderers/Write.svelte';
import Yield from './renderers/Yield.svelte';

const GENERIC: ToolRenderer = { component: Generic, expandable: true };

const REGISTRY: Record<string, ToolRenderer> = {
	ask: { component: Ask, expandable: true },
	ast_edit: { component: AstEdit, expandable: true },
	ast_grep: { component: AstGrep, expandable: true },
	bash: { component: Bash, expandable: true },
	browser: { component: Browser, expandable: true },
	debug: { component: Debug, expandable: true },
	edit: { component: Edit, expandable: true },
	eval: { component: Eval, expandable: true },
	fetch: { component: Fetch, expandable: true },
	generate_image: { component: GenerateImage, expandable: true },
	github: { component: Github, expandable: true },
	glob: { component: Glob, expandable: true },
	goal: { component: Goal, expandable: true },
	grep: { component: Grep, expandable: true },
	hub: { component: Hub, expandable: true },
	inspect_image: { component: InspectImage, expandable: true },
	irc: { component: Irc, expandable: true },
	job: { component: Job, expandable: true },
	lsp: { component: Lsp, expandable: true },
	read: { component: Read, expandable: true },
	recall: { component: Recall, expandable: true },
	reflect: { component: Reflect, expandable: true },
	report_issue: { component: ReportIssue, expandable: true },
	resolve: { component: Resolve, expandable: true },
	retain: { component: Retain, expandable: true },
	task: { component: Task, expandable: true },
	todo: { component: Todo, expandable: true },
	web_search: { component: WebSearch, expandable: true },
	write: { component: Write, expandable: true },
	yield: { component: Yield, expandable: true }
};

/**
 * Nomi alternativi con cui gli stessi tool si presentano. Tenerli separati
 * dal registro rende visibile quali sono alias e quali renderer veri.
 */
const ALIASES: Record<string, string> = {
	astedit: 'ast_edit',
	'ast-edit': 'ast_edit',
	astgrep: 'ast_grep',
	'ast-grep': 'ast_grep',
	'generate-image': 'generate_image',
	generateimage: 'generate_image',
	'inspect-image': 'inspect_image',
	inspectimage: 'inspect_image',
	'web-search': 'web_search',
	websearch: 'web_search',
	'report-tool-issue': 'report_issue',
	report_tool_issue: 'report_issue',
	'memory-recall': 'recall',
	memory_recall: 'recall',
	'memory-reflect': 'reflect',
	memory_reflect: 'reflect',
	'memory-retain': 'retain',
	memory_retain: 'retain',
	reject: 'resolve'
};

export function rendererFor(toolName: string): ToolRenderer {
	const direct = REGISTRY[toolName];
	if (direct) return direct;
	const aliased = ALIASES[toolName.toLowerCase()];
	if (aliased) return REGISTRY[aliased] ?? GENERIC;
	return GENERIC;
}
