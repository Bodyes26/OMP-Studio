/**
 * Stato della scheda Regole: censimento dei file di contesto e delle skill
 * dell'agente, piu' le proposte nate dall'attrito ricorrente nello storico.
 *
 * Le letture sono memorizzate per progetto e non si ripetono al cambio di
 * scheda: passare da Coda a Regole non deve costare una scansione del disco.
 * L'aggiornamento avviene solo su richiesta (`force`) o al primo ingresso.
 */

import { invoke } from '@tauri-apps/api/core';

export interface ContextRuleItem {
	id: string;
	name: string;
	path: string;
	exists: boolean;
	rule_type: 'agents_md' | 'omp_rule' | 'guidelines';
	description?: string | null;
}

export interface SkillItem {
	name: string;
	/** Percorso assoluto: serve per rivelare la skill nel file manager. */
	path: string;
	/** Presente solo per le skill dentro il progetto, le sole apribili nell'editor. */
	rel_path?: string | null;
	scope: 'project' | 'global' | 'managed';
	description?: string | null;
}

export interface RuleSuggestion {
	id: string;
	title: string;
	reason: string;
	target_type: string;
	target_file: string;
	proposed_content: string;
	occurrences: number;
}

export interface ProjectContextSummary {
	rules: ContextRuleItem[];
	skills: SkillItem[];
}

const EMPTY_CONTEXT: ProjectContextSummary = { rules: [], skills: [] };

class RulesStore {
	private context = $state<Record<string, ProjectContextSummary>>({});
	private suggestions = $state<Record<string, RuleSuggestion[]>>({});
	/** Array e non Set: `$state` non intercetta le mutazioni di un Set. */
	private dismissed = $state<string[]>([]);
	private loading = $state<Record<string, boolean>>({});
	private analyzing = $state<Record<string, boolean>>({});
	private errors = $state<Record<string, string | null>>({});

	contextFor(projectPath: string): ProjectContextSummary {
		return this.context[projectPath.toLowerCase()] ?? EMPTY_CONTEXT;
	}

	suggestionsFor(projectPath: string): RuleSuggestion[] {
		const all = this.suggestions[projectPath.toLowerCase()] ?? [];
		return all.filter((suggestion) => !this.dismissed.includes(suggestion.id));
	}

	isLoading(projectPath: string): boolean {
		return this.loading[projectPath.toLowerCase()] === true;
	}

	isAnalyzing(projectPath: string): boolean {
		return this.analyzing[projectPath.toLowerCase()] === true;
	}

	errorFor(projectPath: string): string | null {
		return this.errors[projectPath.toLowerCase()] ?? null;
	}

	async loadContext(projectPath: string, force = false) {
		const key = projectPath.toLowerCase();
		if (!projectPath || this.loading[key]) return;
		if (!force && this.context[key]) return;
		this.loading[key] = true;
		try {
			this.context[key] = await invoke<ProjectContextSummary>('get_project_context', {
				projectPath
			});
			this.errors[key] = null;
		} catch (error) {
			this.errors[key] = `Censimento non disponibile: ${String(error)}`;
		} finally {
			this.loading[key] = false;
		}
	}

	async analyzeFriction(projectPath: string, force = false) {
		const key = projectPath.toLowerCase();
		if (!projectPath || this.analyzing[key]) return;
		if (!force && this.suggestions[key]) return;
		this.analyzing[key] = true;
		try {
			this.suggestions[key] = await invoke<RuleSuggestion[]>('analyze_project_friction', {
				projectPath
			});
		} catch (error) {
			// Lo storico e' un segnale accessorio: se non si legge, la scheda
			// resta utile per il censimento e non mostra un errore a schermo.
			this.suggestions[key] = [];
			console.error('Analisi attrito sessioni non riuscita:', error);
		} finally {
			this.analyzing[key] = false;
		}
	}

	dismissSuggestion(id: string) {
		if (!this.dismissed.includes(id)) this.dismissed.push(id);
	}

	async applySuggestion(projectPath: string, suggestion: RuleSuggestion): Promise<string | null> {
		try {
			await invoke('apply_rule_suggestion', {
				projectPath,
				targetRelPath: suggestion.target_file,
				appendContent: suggestion.proposed_content
			});
		} catch (error) {
			return String(error);
		}
		this.dismissSuggestion(suggestion.id);
		await this.loadContext(projectPath, true);
		return null;
	}

	async initAgentsMd(projectPath: string): Promise<string | null> {
		try {
			const rel = await invoke<string>('create_project_agents_md', { projectPath });
			await this.loadContext(projectPath, true);
			return rel;
		} catch (error) {
			this.errors[projectPath.toLowerCase()] = `Creazione non riuscita: ${String(error)}`;
			return null;
		}
	}
}

export const rulesStore = new RulesStore();
