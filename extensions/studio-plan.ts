// Estensione OMP: modalita' Piano per la chat GUI di Studio (`--mode rpc-ui`).
//
// Il `/plan` di omp esiste solo nella TUI (nessun comando RPC, nessun campo in
// `get_state`): Studio intercetta `/plan` e `/plan-review` scritti nel composer
// e chiede a questa estensione di fare cio' che farebbe omp:
//
// 1. comando `/studio-plan on|off|status|review` (il nome diverso da `plan` e'
//    voluto: nel Terminale resta il `/plan` nativo, e qui l'estensione e' inerte);
// 2. hook `before_agent_start`: aggiunge al prompt di sistema la copia adattata di
//    `plan-mode-active.md` (subagenti: `plan-mode-subagent.md`);
// 3. hook `tool_call`: blocca `write`/`edit`/`ast_edit` fuori da `local://` e da
//    `.omp/plans/`, e sempre rinomina ed eliminazione;
// 4. strumento `studio_plan_submit({slug, title})`: legge `local://<slug>-plan.md`
//    e apre la revisione di Studio con una `extension_ui_request` di tipo `editor`
//    il cui titolo inizia con `studio-plan-review:` (meta JSON) e il cui testo
//    precompilato e' il piano. La risposta e' la decisione JSON di Studio.
//
// Il passaggio (nuova sessione, corsia, compattazione, ruolo) lo orchestra Studio
// con i comandi RPC esistenti: qui si spegne solo la guardia e si archivia il
// piano in `.omp/plans/`.
//
// I testi dei prompt sono adattati da oh-my-pi (MIT, Copyright (c) 2025 Mario
// Zechner, (c) 2025-2026 Can Boluk, (c) 2026 Stencil Labs, Inc.):
// packages/coding-agent/src/prompts/system/plan-mode-active.md e
// plan-mode-subagent.md, versione 18.8.4. Vanno riallineati quando upstream li
// cambia (controllo di release dei comandi, docs/COMMANDS.md).

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

/* ------------------------------------------------------------------ costanti */

/** Prefisso del titolo della richiesta di revisione: Studio lo riconosce. */
export const PLAN_REVIEW_TITLE_PREFIX = "studio-plan-review:";
/** Chiave di `setStatus` con lo stato JSON del Piano per Studio. */
export const PLAN_STATUS_KEY = "studio-plan";
/** customType della voce di sessione che fa sopravvivere il modo a un resume. */
export const PLAN_STATE_ENTRY = "studio-plan-state";
export const PLAN_SUBMIT_TOOL = "studio_plan_submit";

/** Strumenti che scrivono file: fuori da `local://` e `.omp/plans/` sono bloccati. */
const WRITE_TOOLS: Record<string, true> = {
	write: true,
	edit: true,
	ast_edit: true,
	notebook: true,
	notebook_edit: true,
	apply_patch: true
};

const WINDOWS_LOCAL_ROOT_MAX_CHARS = 180;

/* ------------------------------------------------------------------- prompt */

export const PLAN_MODE_ACTIVE_PROMPT = `<critical>
Plan mode active (OMP Studio).
- Working tree/system read-only: NEVER create, edit, delete, or rename working-tree files; NEVER run state-changing commands (\`git commit\`, \`npm install\`, migrations) or otherwise change the system.
- \`local://\`: session-local planning artifacts; MAY create/update only when explicitly requested or needed for the plan; NEVER delete/rename.
- Canonical plan: MUST write \`local://<slug>-plan.md\`.

Submitting: call \`${PLAN_SUBMIT_TOOL}\` with \`slug\` (MUST match \`local://<slug>-plan.md\`; letters, numbers, underscores, hyphens) and a short human \`title\`. The user then reviews the plan in OMP Studio and selects an execution option; full write access is restored by Studio.

NEVER ask user to exit plan mode or request approval in prose or with \`ask\`; approval ONLY via \`${PLAN_SUBMIT_TOOL}\`.
</critical>

## What a plan is

Plan: execution spec, not design doc. Approval may clear/compact the conversation; another engineer/fresh agent implements solely from the file. A competent implementer unfamiliar with the conversation MUST execute top-to-bottom with ZERO design decisions; file contains every choice.

Detail removes implementer decisions, not padding. Decision-completeness > brevity.

## Plan file

Choose short kebab-case task \`<slug>\`; create \`local://<slug>-plan.md\` (e.g. \`local://auth-token-refresh-plan.md\`). If a plan for the same task already exists, read it and update it incrementally. File NEVER renamed on approval; submit this same \`<slug>\`.

Use \`##\` headings for the sections below: OMP Studio shows each \`##\` section as a reviewable block (comment, edit, delete). Write the file incrementally while learning; NEVER defer all writing to the end.

## Ground every claim

Resolve unknowns by discovery, not questions.

- Discoverable facts (locations, behavior, signatures, configs): MUST discover with \`glob\`, \`grep\`, \`read\`, or parallel read-only \`scout\` subagents via \`task\`. Every asserted path, symbol, signature, behavior: actually read this session. Unconfirmed: mark inline \`unverified — confirm first\`.
- Preferences/tradeoffs (intent, UX, scope edges): ask early via \`ask\` with 2–4 mutually exclusive options and a recommended default. Unanswered → use default; record under Assumptions.

Every question MUST alter the plan or resolve a load-bearing choice; batch questions. NEVER ask what exploration answers.

## Workflow

1. **Understand**: request and supporting code; find reusable code before proposing new. Spawn read-only scouts for wide scopes.
2. **Design**: draft the approach from findings, weigh tradeoffs briefly, commit.
3. **Review**: read intended files; validate approach against code and literal request.
4. **Write**: plan per **Plan contents**, then submit with \`${PLAN_SUBMIT_TOOL}\`.

## Plan contents

Scannable markdown; depth follows change.

- **Context**: literal ask, need, intended end state; 2–4 sentences.
- **Approach**: load-bearing ordered change steps, grouped by behavior, never by file. Each step: concrete edit (verb, exact target, new behavior); existing functions to reuse; exact signatures/literals for new symbols; every callsite for renames/removals; error and empty-state handling.
- **Critical files**: at most 5 files disambiguating non-obvious work: path, symbol/region, one-line reason.
- **Verification**: end-to-end proof with at least one new-behavior check (concrete input → expected observable output) and exact commands.
- **Assumptions**: only user-overridable decisions, each with a pre-decided fallback.

NEVER include Non-Goals, Alternatives Considered, Risks, Future Work, changelog/doc chores, or references to the planning conversation.

<critical>
Before submitting: an engineer unfamiliar with the conversation can execute every step without a design decision and determine success at each step.

Turn ends ONLY by:
1. \`ask\` to gather requirements or choose approaches; OR
2. \`${PLAN_SUBMIT_TOOL}\` with the plan slug and title.

If \`${PLAN_SUBMIT_TOOL}\` returns requested changes: update the same plan file, then submit again. If it says the plan was approved or saved: stop immediately with one short sentence; OMP Studio continues.
</critical>`;

export const PLAN_MODE_SUBAGENT_PROMPT = `<critical>
Plan mode active. You MUST perform READ-ONLY operations only.

You NEVER:
- Create, edit, delete, move, or copy files
- Run state-changing commands (git, build system, package manager, migrations)
- Make any changes to the system
</critical>

<role>
Software architect and planning specialist for the main agent.
You MUST explore the codebase and report findings. The main agent updates the plan file.
</role>

<output>
End response with:

### Critical Files for Implementation

List 3-5 files most critical for implementing this plan:
- \`path/to/file1.ts\` — Brief reason
</output>`;

export const LAB_PLAN_MODE_SUBAGENT_PROMPT = `<critical>
Modalita' Piano attiva nel Laboratorio (OMP Studio).
Sei un agente di ricognizione in SOLA LETTURA per l'agente Lab.
- Vietato creare, modificare, rinominare o eliminare file.
- Vietato invocare comandi shell, build o sottomissione del piano.
- Esplora il codice sorgente del progetto o la documentazione e riporta fatti precisi all'agente principale.
</critical>

<output>
Riporta all'agente principale:
1. File sorgente rilevanti per la superficie richiesta.
2. Token di design, stili e convenzioni osservate.
3. Modelli dei dati e terminologia di dominio riscontrata.
4. Eventuali lacune o ambiguita' riscontrate.
</output>`;

export const LAB_EXECUTION_SUBAGENT_PROMPT = `<critical>
Sei un autore delegato per una variante specifica del prototipo in OMP Studio Lab.
- Lavora ESCLUSIVAMENTE all'interno del file assegnato per la tua variante nel workspace del prototipo.
- Importa i dati simulati e le funzioni comuni dai moduli condivisi; NON ridefinire dati mock duplicati o isolati.
- Rispetta fedelmente l'asse di differenziazione assegnato, il nome e la motivazione della variante.
- Il progetto ospite e' in sola lettura. Shell, interpreti e accessi esterni sono disabilitati.
- Non invocare tool riservati all'agente principale (\`corsia_*\`, \`studio_plan_submit\`).
</critical>`;

export const LAB_RECIPE_EXECUTION_PROMPT = `## OMP Studio Lab — Istruzioni di costruzione e memoria di lavoro

Il brief e' stato approvato in OMP Studio ed e' salvato in \`.lab/brief.md\`.
Le scritture nel workspace del prototipo sono ora sbloccate.

### 1. Memoria di lavoro (\`.lab/brief.md\`)
- Consulta regolarmente \`.lab/brief.md\` come fonte di verita' dei requisiti, dei dati mock, della ricetta e dei vincoli di design concordati.
- Se nei turni successivi l'utente richiede cambi di scopo o modifiche architetturali, aggiorna direttamente \`.lab/brief.md\` per mantenerlo allineato.
- Le modifiche future a \`.lab/brief.md\` sono consentite senza nuovo blocco, a meno che l'utente non richieda esplicitamente un nuovo Piano (/plan o /studio-plan on).
- Questo documento sopravvive alle compattazioni di sessione e ai riavvii.

### 2. Regole di costruzione del prototipo
- **Stack**: Progetto Vite autonomo con React 19 + TypeScript + Tailwind CSS v4 nel workspace del prototipo.
- **Entry point**: \`src/main.tsx\` e \`src/App.tsx\`. Modifica i file sorgente in \`src/\`, configurazioni e asset necessari.
- **Dati simulati**: Tutti i dati devono essere simulati/mockati. Nessun accesso a database reali o backend remoti.
- **Browser anteprima**: Il tool \`browser\` puo' interagire ESCLUSIVAMENTE con l'anteprima locale. Non tentare in nessun caso di navigare verso l'applicazione reale.
- **Progetto ospite in sola lettura**: Il progetto ospite resta consultabile per riferimento ma non puo' mai essere modificato.

### 3. Esecuzione secondo la ricetta approvata nel brief
- **Se la ricetta e' "Varianti divergenti"**:
  1. Definisci prima i dati simulati e le funzioni di utilita' comuni in un modulo condiviso (es. \`src/data/mockData.ts\`). Tutte le alternative devono basarsi sullo stesso dataset comune.
  2. Separa i file delle varianti (es. \`src/variants/VariantA.tsx\`, \`src/variants/VariantB.tsx\`, ecc.).
  3. Assegna la costruzione di ogni variante (3–5 varianti) a un sottoagente autore distinto tramite \`task\` (un subagent per variante), specificandone l'asse di differenziazione e il file dedicato.
  4. Integra le varianti in \`src/App.tsx\` con un selettore visibile (schede, bottoni o menu) che permetta il confronto interattivo immediato sulle stesse prenotazioni/dati.
  5. Ogni variante deve mostrare nome e motivazione nel selettore. Differenze solo cromatiche non sono ammesse.
- **Se la ricetta e' "Flusso"**:
  1. Rendi navigabili tutti i passi del flusso con controlli per avanzare, tornare indietro e reimpostare.
  2. Implementa e rendi esercitabili gli stati: vuoto (empty), caricamento (loading), errore di validazione e successo.
  3. Mantieni i dati inseriti o selezionati coerenti fra un passo e l'altro.
- **Se la ricetta e' "Fedele"**:
  1. Rispetta convenzioni visive, token e terminologia del progetto ospite.
  2. Rendi chiaramente identificabili le novita' o i miglioramenti rispetto all'esistente.
- **Se la ricetta e' "Libera"**:
  1. Esplora layout moderni ed ergonomici senza il vincolo dei token storici.
  2. Preserva rigorosamente le regole di business e la terminologia riscontrata nel brief.

### 4. Verifica e completamento
- Salva un riepilogo conciso di 2-3 righe con il tool \`lab_set_summary\`.
- Controlla la compilazione e l'assenza di errori con il tool \`lab_preview_status\`.
- Quando il prototipo e' pronto e funzionante, segnala il completamento con \`corsia_fatto\`.`;

export function buildLabPlanPrompt(projectPath: string | null = process.env.OMP_LAB_PROJECT_PATH || null): string {
	const hasHostProject = Boolean(projectPath && projectPath.trim());
	const resolvedHost = hasHostProject ? resolve(projectPath!.trim()) : "";

	const hostReconInstructions = hasHostProject
		? `1. **Ricognizione mirata del progetto ospite (sola lettura)**:
   - Percorso reale del progetto ospite: "${resolvedHost}".
   - Consulta la documentazione di progetto se presente e leggibile: AGENTS.md, DESIGN.md, PRODUCT.md. Non inventare documenti assenti.
   - Esplora i sorgenti rilevanti per la richiesta: individua la superficie citata (pagine, componenti, route), file sorgente effettivi, token di design, convenzioni stilistiche (CSS/Tailwind), modelli dei dati e terminologia di dominio reale.
   - Per applicazioni legacy (es. Web Forms): esamina il code-behind e le definizioni di stored procedure presenti nei sorgenti. Nessun accesso a database o backend reali e' necessario o consentito.
   - Includi nel perimetro di lettura il working tree corrente del progetto, comprese eventuali modifiche non committate pertinenti.
   - File protetti o sensibili (.git/, credenziali, .env*, chiavi) restano inaccessibili.
   - Puoi usare sottoagenti read-only (scout) tramite \`task\` per accelerare l'esplorazione.`
		: `1. **Bozza libera (senza progetto ospite)**:
   - Questo prototipo e' una bozza libera indipendente: NON esiste un progetto ospite associato.
   - NON cercare repository o percorsi su disco esterni: ricava tutto il contesto dalla richiesta iniziale dell'utente, da eventuali riferimenti e dall'intervista.`;

	return `<critical>
Modalita' Piano attiva nel Laboratorio (OMP Studio).
- Il workspace del prototipo e' in SOLA LETTURA: e' tassativamente vietato creare, modificare, rinominare o eliminare file nel workspace (inclusi \`src/\`, \`package.json\`, \`index.html\`, CSS e asset).
- Comandi di stato o shell (\`bash\`, \`eval\`, interpreti, pacchetti) sono disabilitati.
- File del piano: scrivi il brief esclusivamente su \`local://<slug>-plan.md\`.
- Sottomissione del brief: chiama \`${PLAN_SUBMIT_TOOL}\` con \`slug\` (corrispondente a \`local://<slug>-plan.md\`) e un breve \`title\` leggibile.
- Approvazione obbligatoria: lo sblocco delle scritture avviene ESCLUSIVAMENTE tramite la decisione di approvazione dell'utente nella scheda di revisione di OMP Studio.
- Nessun bypass consentito: la presenza di un file su disco, comandi \`/studio-plan off\` o risposte ad \`ask\` NON equivalgono all'approvazione del Piano. I sottoagenti NON possono sottomettere il piano ne' aggirare la guardia.
</critical>

## Sequenza operativa obbligatoria

${hostReconInstructions}

2. **Intervista adattiva all'utente (\`ask\`)**:
   - Chiarisci con \`ask\` SOLTANTO decisioni rilevanti che cambiano il risultato: superficie ambigua, operazioni ed esperienze da esplorare, grado di fedelta' al design, ricetta scelta e varianti.
   - NON fare domande su fatti gia' deducibili dai sorgenti o dalla richiesta.
   - Screenshot di riferimento manuale:
     1. Se sono gia' state allegate immagini alla richiesta iniziale, considerale gia' acquisite e procedi senza chiedere screenshot.
     2. Altrimenti, se la richiesta tocca una superficie visiva esistente ma non ci sono immagini allegate, proponi tramite \`ask\` due opzioni:
        - "Prosegui senza screenshot" (annota nel brief sotto Assunzioni che la pagina reale non e' stata osservata visivamente);
        - "Allego screenshot nel prossimo messaggio" (invita l'utente a inviare lo screenshot dal composer nel messaggio successivo).
     In nessun caso tentare di catturare la pagina reale tramite browser host.

3. **Scelta di una delle quattro ricette testuali**:
   Studio fornisce quattro ricette ufficiali per guidare la costruzione:
   - **Fedele**: Riusa token, stili e convenzioni del progetto ospite; modifica la superficie richiesta e rende riconoscibili le differenze rispetto all'esistente.
   - **Varianti divergenti**: Confronta 3–5 alternative reali con dati mock e funzioni comuni e assi di differenziazione dichiarati (es. densita' informativa, gerarchia visiva, modello di interazione; differenze puramente cromatiche NON sono sufficienti). Assegna la costruzione di ogni variante a un sottoagente autore distinto.
   - **Flusso**: Rende navigabili passi e stati pertinenti, inclusi stati vuoti (empty), caricamento (loading), errore e successo, con dati coerenti fra i passi.
   - **Libera**: Esplora senza vincolo del design system esistente, mantenendo validi i fatti di prodotto, la terminologia e i vincoli funzionali documentati.
   Proponi la ricetta adeguata nell'intervista o recepiscila dalla richiesta, registrandola nel brief.

4. **Stesura del brief (\`local://<slug>-plan.md\`)**:
   Il brief e' la memoria di lavoro dell'agente. Usa obbligatoriamente le seguenti 6 sezioni con intestazione \`##\` per la revisione in Studio:

   ## 1. Superficie
   Pagina/componente target e file sorgente di riferimento nel progetto (o scopo per bozze libere).

   ## 2. Dominio e terminologia
   Entita', concetti di business e vocabolario specifico riscontrato nei sorgenti o concordato.

   ## 3. Dati
   Forma dei dati reali e simulazioni/mock previsti (modelli, campi, relazioni).

   ## 4. Vincoli di design
   Token, convenzioni visive, librerie e grado di fedelta' scelto.

   ## 5. Varianti ed esplorazione
   Ricetta selezionata, obiettivo, interazioni chiave, cosa resta fisso e cosa varia. Per "Varianti divergenti": 3–5 varianti con nome, motivazione e assi di confronto.

   ## 6. Assunzioni
   Lacune, decisioni non deducibili dai sorgenti e stato dell'osservazione visiva (screenshot disponibile o pagina non osservata).

5. **Sottomissione per revisione**:
   - Salva il file in \`local://<slug>-plan.md\`.
   - Invoca \`${PLAN_SUBMIT_TOOL}\` indicando slug e titolo.
   - Studio mostrera' la scheda di revisione a 6 sezioni. All'approvazione, Studio salvera' \`.lab/brief.md\` nel workspace e sblocchera' la modalita' di costruzione.

<critical>
Il turno termina ESCLUSIVAMENTE con:
1. \`ask\` per l'intervista all'utente o richiesta screenshot; OPPURE
2. \`${PLAN_SUBMIT_TOOL}\` con slug e titolo del brief.
Se l'utente chiede modifiche (\`refine\`), aggiorna lo stesso file \`local://<slug>-plan.md\` e invoca nuovamente \`${PLAN_SUBMIT_TOOL}\`.
Se approvato, termina subito con una breve frase di conferma: Studio avviera' la fase di costruzione.
</critical>`;
}

export const LAB_PLAN_MODE_ACTIVE_PROMPT = buildLabPlanPrompt();

/* -------------------------------------------------------------- stato del modo */

export interface StudioPlanState {
	enabled: boolean;
	/** `local://<slug>-plan.md` dell'ultimo piano proposto. */
	planFilePath: string | null;
	/** Titolo dell'ultimo piano proposto. */
	title: string | null;
	kind?: "lab";
	briefApproved?: boolean;
}

// Lo stato vive a livello di processo: in `rpc-ui` c'e' una sola sessione
// principale per processo omp, e i subagenti (stesso processo) devono vedere la
// stessa guardia. Solo la sessione principale lo cambia.
const STATE_SYMBOL = Symbol.for("omp-studio.plan-state");
type GlobalWithPlan = typeof globalThis & { [STATE_SYMBOL]?: StudioPlanState };

export function planState(): StudioPlanState {
	const g = globalThis as GlobalWithPlan;
	if (!g[STATE_SYMBOL]) {
		g[STATE_SYMBOL] = {
			enabled: false,
			planFilePath: null,
			title: null,
			kind: isLabSession() ? "lab" : undefined,
			briefApproved: false
		};
	}
	return g[STATE_SYMBOL]!;
}

export function resetPlanState(next?: Partial<StudioPlanState>): StudioPlanState {
	const state = planState();
	state.enabled = next?.enabled ?? false;
	state.planFilePath = next?.planFilePath ?? null;
	state.title = next?.title ?? null;
	state.kind = next?.kind;
	state.briefApproved = next?.briefApproved;
	return state;
}

/* ------------------------------------------------------------------ guardia */

export interface ToolCallLike {
	toolName: string;
	input?: Record<string, unknown>;
}

export interface GuardResult {
	block: true;
	reason: string;
}

const READ_ONLY_REASON =
	"Plan mode (OMP Studio): the working tree is read-only. Write your plan to a local://<slug>-plan.md file instead.";

/** Toglie l'involucro hashline `[path#TAG]` come la guardia nativa. */
function unwrapHashline(raw: string): string {
	const trimmed = raw.trim();
	const match = /^\[(.+?)(?:#[0-9A-Fa-f]{4})?\]$/.exec(trimmed);
	return match ? match[1] : trimmed;
}

/**
 * Vero se `target` resta in un'area scrivibile durante il Piano: lo spazio di
 * sessione `local://` oppure `<cwd>/.omp/plans/`.
 */
export function isPlanWritablePath(target: string, cwd: string): boolean {
	const path = unwrapHashline(target);
	if (!path) return false;
	if (/^local:\/\//i.test(path)) return !path.includes("..");
	// Ogni altro schema interno (`skill://`, `memory://`, ...) resta fuori.
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return false;
	const plansDir = resolve(cwd, ".omp", "plans");
	const absolute = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
	const rel = relative(plansDir, absolute);
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Percorsi toccati da una chiamata di scrittura; `rename`/`delete` sempre vietati. */
export function collectWriteTargets(input: Record<string, unknown>): { paths: string[]; forbidden: string | null } {
	const paths: string[] = [];
	let forbidden: string | null = null;
	for (const key of ["path", "file", "file_path", "filePath", "target"]) {
		const value = input[key];
		if (typeof value === "string" && value.trim()) paths.push(value);
	}
	if (input.delete === true || input.op === "delete") forbidden = "delete";
	if (typeof input.rename === "string" || typeof input.move === "string") forbidden = "rename";
	const edits = Array.isArray(input.edits) ? input.edits : [];
	for (const edit of edits) {
		if (!edit || typeof edit !== "object") continue;
		const record = edit as Record<string, unknown>;
		if (typeof record.path === "string" && record.path.trim()) paths.push(record.path);
		if (record.op === "delete") forbidden = "delete";
		if (typeof record.rename === "string" || typeof record.move === "string") forbidden = "rename";
	}
	// `apply_patch`: i file stanno nelle intestazioni della patch.
	const patch = typeof input.input === "string" ? input.input : typeof input.patch === "string" ? input.patch : "";
	if (patch) {
		for (const line of patch.split(/\r?\n/)) {
			const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line.trim());
			if (header) {
				paths.push(header[2].trim());
				if (header[1] === "Delete") forbidden = "delete";
			}
			if (/^\*\*\* Move to: /.test(line.trim())) forbidden = "rename";
		}
	}
	return { paths, forbidden };
}

/**
 * Decisione della guardia per una chiamata: `undefined` lascia passare.
 * Fail-closed: uno strumento di scrittura senza un percorso riconoscibile viene
 * bloccato, meglio un tentativo in piu' dell'agente che un file toccato.
 */
export function evaluatePlanToolCall(event: ToolCallLike, cwd: string, enabled: boolean): GuardResult | undefined {
	if (!enabled) return undefined;
	if (WRITE_TOOLS[event.toolName] !== true) return undefined;
	const { paths, forbidden } = collectWriteTargets(event.input ?? {});
	if (forbidden === "rename") return { block: true, reason: "Plan mode (OMP Studio): renaming files is not allowed." };
	if (forbidden === "delete") return { block: true, reason: "Plan mode (OMP Studio): deleting files is not allowed." };
	if (paths.length === 0) return { block: true, reason: READ_ONLY_REASON };
	for (const path of paths) {
		if (!isPlanWritablePath(path, cwd)) return { block: true, reason: READ_ONLY_REASON };
	}
	return undefined;
}

/* ------------------------------------------------------------ file del piano */

/** Stesso schema di `normalizePlanTitle` di omp: solo lettere, cifre, `_` e `-`. */
export function normalizePlanSlug(raw: string): string | null {
	const slug = raw
		.trim()
		.replace(/^local:\/\//i, "")
		.replace(/\.md$/i, "")
		.replace(/-plan$/i, "")
		.replace(/\s+/g, "-")
		.replace(/[^A-Za-z0-9_-]/g, "")
		.replace(/-{2,}/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug ? slug : null;
}

/** Copia di `planSaveFileName` di omp (`plan-autosave.ts`): `<TITOLO>_PLAN.md`. */
export function planSaveFileName(title: string): string {
	let stem = title
		.normalize("NFC")
		.replace(/[^\p{L}\p{N}]+/gu, "_")
		.replace(/_+/g, "_")
		.replace(/^_+|_+$/g, "")
		.toUpperCase();
	if (stem.length > 32) {
		const cut = stem.lastIndexOf("_", 32);
		stem = cut > 0 ? stem.slice(0, cut) : stem.slice(0, 32);
	}
	if (!stem || stem === "PLAN") return "PLAN.md";
	return `${stem.endsWith("_PLAN") ? stem : `${stem}_PLAN`}.md`;
}

/** Radice di `local://` come `resolveLocalRoot` di omp. */
export function resolveLocalRoot(
	artifactsDir: string | null | undefined,
	sessionId: string | null | undefined,
	platform: string = process.platform
): string {
	const safeId = (sessionId ?? "session").replace(/[^a-zA-Z0-9_.-]/g, "_") || "session";
	if (artifactsDir) {
		const candidate = resolve(artifactsDir, "local");
		if (platform === "win32" && candidate.length >= WINDOWS_LOCAL_ROOT_MAX_CHARS) {
			return join(tmpdir(), "omp-local", safeId);
		}
		return candidate;
	}
	return join(tmpdir(), "omp-local", safeId);
}

/**
 * Scrive una copia in `.omp/plans/` senza sovrascrivere (come l'autosave di omp:
 * `<stem>-<n>.md` se il nome e' gia' preso). Restituisce il percorso relativo.
 */
export function savePlanCopy(cwd: string, title: string, content: string): string {
	const dir = join(cwd, ".omp", "plans");
	mkdirSync(dir, { recursive: true });
	const fileName = planSaveFileName(title);
	const dot = fileName.lastIndexOf(".");
	const stem = fileName.slice(0, dot);
	for (let index = 0; index < 1000; index++) {
		const name = index === 0 ? fileName : `${stem}-${index}.md`;
		const target = join(dir, name);
		try {
			writeFileSync(target, content, { encoding: "utf8", flag: "wx" });
			return `.omp/plans/${name}`;
		} catch (error) {
			if ((error as { code?: string }).code !== "EEXIST") throw error;
		}
	}
	const fallback = `${Date.now()}-${fileName}`;
	writeFileSync(join(dir, fallback), content, { encoding: "utf8", flag: "wx" });
	return `.omp/plans/${fallback}`;
}

/**
 * Normalizza un percorso per il binding crittograficamente/strutturalmente certo nel marker,
 * risolvendo percorsi reali (anche symlink/junction) e gestendo case-folding su Windows.
 */
export function normalizePathForBinding(pathStr: string | null | undefined): string | null {
	if (!pathStr || !pathStr.trim()) return null;
	const trimmed = pathStr.trim();
	try {
		const resolved = resolve(trimmed);
		const real = existsSync(resolved) ? realpathSync(resolved) : resolved;
		return process.platform === "win32" ? real.toLowerCase() : real;
	} catch {
		const resolved = resolve(trimmed);
		return process.platform === "win32" ? resolved.toLowerCase() : resolved;
	}
}

/**
 * Salva atomicamente il brief approvato in `.lab/brief.md` e il marker
 * transitorio protetto `.lab/.brief-approved.json` nel workspace del prototipo,
 * legandolo al workspace e al progetto ospite corrente (se presente).
 */
export function saveLabBriefAndMarker(
	workspaceDir: string,
	slug: string,
	content: string,
	projectPath: string | null = process.env.OMP_LAB_PROJECT_PATH || null
): string {
	const labDir = join(workspaceDir, ".lab");
	mkdirSync(labDir, { recursive: true });

	const targetBrief = join(labDir, "brief.md");
	const targetMarker = join(labDir, ".brief-approved.json");

	// Invalida subito il vecchio marker prima di modificare il brief per evitare che
	// un fallimento I/O lasci un'approvazione precedente associata a contenuto parziale
	try {
		if (existsSync(targetMarker)) unlinkSync(targetMarker);
	} catch {}

	// 1. Scrittura atomica di .lab/brief.md (fail closed: temp+rename senza fallback a scrittura diretta)
	const tempBrief = join(labDir, `brief.${randomUUID()}.tmp`);
	writeFileSync(tempBrief, content, "utf8");
	try {
		try {
			if (existsSync(targetBrief)) unlinkSync(targetBrief);
		} catch {}
		renameSync(tempBrief, targetBrief);
	} catch (err) {
		try {
			if (existsSync(tempBrief)) unlinkSync(tempBrief);
		} catch {}
		throw err;
	}

	// 2. Scrittura atomica del marker transitorio protetto .lab/.brief-approved.json con binding obbligatori
	const canonicalWorkspace = normalizePathForBinding(workspaceDir);
	const canonicalProject = normalizePathForBinding(projectPath);
	const expectedProto =
		process.env.OMP_LAB_PROTOTYPE_ID && process.env.OMP_LAB_PROTOTYPE_ID.trim()
			? process.env.OMP_LAB_PROTOTYPE_ID.trim()
			: null;

	const markerPayload = JSON.stringify(
		{
			approved: true,
			approvedAt: new Date().toISOString(),
			prototypeId: expectedProto,
			workspaceDir: canonicalWorkspace,
			projectDir: canonicalProject,
			slug
		},
		null,
		2
	);
	const tempMarker = join(labDir, `marker.${randomUUID()}.tmp`);
	writeFileSync(tempMarker, markerPayload, "utf8");
	try {
		renameSync(tempMarker, targetMarker);
	} catch (err) {
		try {
			if (existsSync(tempMarker)) unlinkSync(tempMarker);
		} catch {}
		throw err;
	}

	return ".lab/brief.md";
}

export function isLabBriefApprovedOnDisk(
	workspaceDir: string,
	expectedPrototypeId: string | null = process.env.OMP_LAB_PROTOTYPE_ID || null,
	expectedProjectPath: string | null = process.env.OMP_LAB_PROJECT_PATH || null
): boolean {
	try {
		const markerPath = join(workspaceDir, ".lab", ".brief-approved.json");
		if (!existsSync(markerPath)) return false;
		const raw = JSON.parse(readFileSync(markerPath, "utf8"));
		if (!raw || typeof raw !== "object") return false;

		// 1. Approvazione esplicita e campi informativi obbligatori
		if (!("approved" in raw) || raw.approved !== true) return false;
		if (!("approvedAt" in raw) || typeof raw.approvedAt !== "string" || !raw.approvedAt.trim()) return false;
		if (!("slug" in raw) || typeof raw.slug !== "string" || !raw.slug.trim()) return false;

		// 2. prototypeId deve coincidere esattamente con l'atteso (stringa ID o esplicito null)
		const expectedProto =
			expectedPrototypeId && expectedPrototypeId.trim() ? expectedPrototypeId.trim() : null;
		if (!("prototypeId" in raw)) return false;
		const protoId = raw.prototypeId === null || typeof raw.prototypeId === "string" ? raw.prototypeId : undefined;
		if (protoId !== expectedProto) return false;

		// 3. workspaceDir deve essere presente e coincidere esattamente con il workspace canonico normalizzato
		const currentWorkspace = normalizePathForBinding(workspaceDir);
		if (!("workspaceDir" in raw) || typeof raw.workspaceDir !== "string" || !currentWorkspace) return false;
		if (raw.workspaceDir !== currentWorkspace) return false;

		// 4. projectDir deve essere presente e coincidere esattamente (stringa canonica o esplicito null)
		const currentProject = normalizePathForBinding(expectedProjectPath);
		if (!("projectDir" in raw)) return false;
		const boundProject = raw.projectDir === null || typeof raw.projectDir === "string" ? raw.projectDir : undefined;
		if (boundProject !== currentProject) return false;

		return true;
	} catch {
		return false;
	}
}


/* ------------------------------------------------------- decisione di Studio */

export type PlanExecMode = "fresh" | "lane" | "compact" | "keep";

export interface PlanReviewDecision {
	action: "approve" | "refine" | "save" | "cancel";
	mode?: PlanExecMode;
	role?: string;
	autosave?: boolean;
	feedback?: string;
	/** Piano riscritto da Studio (sezioni modificate o eliminate). */
	content?: string;
}

export function parseDecision(raw: string | undefined): PlanReviewDecision {
	if (!raw) return { action: "cancel" };
	try {
		const parsed = JSON.parse(raw) as Partial<PlanReviewDecision>;
		const action =
			parsed.action === "approve" || parsed.action === "refine" || parsed.action === "save" ? parsed.action : "cancel";
		const mode =
			parsed.mode === "fresh" || parsed.mode === "lane" || parsed.mode === "compact" || parsed.mode === "keep"
				? parsed.mode
				: undefined;
		return {
			action,
			mode,
			role: typeof parsed.role === "string" ? parsed.role : undefined,
			autosave: parsed.autosave !== false,
			feedback: typeof parsed.feedback === "string" ? parsed.feedback : undefined,
			content: typeof parsed.content === "string" ? parsed.content : undefined
		};
	} catch {
		// Testo libero: lo si tratta come richiesta di modifiche.
		return raw.trim() ? { action: "refine", feedback: raw.trim() } : { action: "cancel" };
	}
}

/** Testo che l'agente riceve come risultato di `studio_plan_submit`. */
export function decisionResultText(
	decision: PlanReviewDecision,
	planFilePath: string,
	savedPath: string | null,
	isLab = false
): string {
	switch (decision.action) {
		case "refine":
			return [
				`The user reviewed the ${isLab ? "brief" : "plan"} in OMP Studio and requested changes:`,
				"",
				decision.feedback?.trim() || `(no comment: re-check the ${isLab ? "brief" : "plan"} for completeness)`,
				"",
				`Update ${planFilePath} accordingly (plan mode is still active), then submit it again with ${PLAN_SUBMIT_TOOL}.`
			].join("\n");
		case "approve":
			if (isLab) {
				return [
					`Brief approved in OMP Studio (saved to ${savedPath || ".lab/brief.md"}).`,
					"Plan mode is off and workspace writes are unlocked.",
					"Reply with one short sentence and wait for execution instructions."
				].join("\n");
			}
			return [
				`Plan approved in OMP Studio${savedPath ? ` (copy saved to ${savedPath})` : ""}.`,
				"Plan mode is off. OMP Studio now hands the plan to the executor: STOP NOW. Reply with one short sentence and do not call any other tool."
			].join("\n");
		case "save":
			if (isLab) {
				return [
					`The user chose "Save and quit"${savedPath ? `: brief saved to ${savedPath}` : ""}.`,
					"The brief is saved but NOT approved. Writes remain locked until a brief is approved in Studio. STOP NOW with one short sentence."
				].join("\n");
			}
			return [
				`The user chose "Save and quit"${savedPath ? `: plan saved to ${savedPath}` : ""}.`,
				"Plan mode is off and nothing will be executed. STOP NOW with one short sentence."
			].join("\n");
		default:
			return [
				`The user closed the ${isLab ? "brief" : "plan"} review without a decision. Plan mode is still active${isLab ? " and workspace writes remain locked" : ""}.`,
				`STOP NOW and wait: the user can reopen the review with /plan-review or send new instructions.`
			].join("\n");
	}
}

/* -------------------------------------------------------------- tipi di omp */

interface ZodType {
	optional(): ZodType;
	describe(text: string): ZodType;
}

interface ZodBuilder {
	object(shape: Record<string, ZodType>): ZodType;
	string(): ZodType;
}

interface PlanUi {
	editor(title: string, prefill?: string, dialogOptions?: { signal?: AbortSignal }): Promise<string | undefined>;
	setStatus(key: string, text: string | undefined): void;
	notify(message: string, type?: "info" | "warning" | "error"): void;
}

interface PlanContext {
	ui?: PlanUi;
	hasUI?: boolean;
	mode?: string;
	cwd?: string;
	agent?: { kind?: "main" | "sub" };
	localProtocolOptions?: { getArtifactsDir?: () => string | null; getSessionId?: () => string | null };
	sessionManager?: {
		getCwd?: () => string;
		getArtifactsDir?: () => string | null;
		getSessionId?: () => string | null;
		getBranch?: () => unknown[];
		getEntries?: () => unknown[];
	};
}

interface ToolResult {
	content: { type: "text"; text: string }[];
	details?: Record<string, unknown>;
	isError?: boolean;
}

interface PlanToolParams {
	slug?: string;
	title?: string;
}

interface StudioPlanApi {
	zod: ZodBuilder;
	registerTool(definition: {
		name: string;
		label: string;
		description: string;
		parameters: ZodType;
		approval: "read" | "write" | "exec";
		execute(
			toolCallId: string,
			params: PlanToolParams,
			signal: AbortSignal | undefined,
			onUpdate: unknown,
			ctx: PlanContext | undefined
		): Promise<ToolResult>;
	}): void;
	registerCommand(
		name: string,
		command: { description: string; handler: (args: string, ctx: PlanContext) => Promise<void> }
	): void;
	on(event: string, handler: (event: Record<string, unknown>, ctx: PlanContext) => unknown): void;
	appendEntry?(customType: string, data?: unknown): void;
	sendUserMessage?(content: string): void;
	getActiveTools?(): string[];
	setActiveTools?(names: string[]): Promise<void>;
}

/* ----------------------------------------------------------------- utilita' */

function text(value: string, details?: Record<string, unknown>, isError = false): ToolResult {
	const result: ToolResult = { content: [{ type: "text", text: value }] };
	if (details) result.details = details;
	if (isError) result.isError = true;
	return result;
}

function contextCwd(ctx: PlanContext | undefined): string {
	return ctx?.sessionManager?.getCwd?.() ?? ctx?.cwd ?? process.cwd();
}

function localRootOf(ctx: PlanContext | undefined): string {
	const options = ctx?.localProtocolOptions;
	const artifacts = options?.getArtifactsDir?.() ?? ctx?.sessionManager?.getArtifactsDir?.() ?? null;
	const sessionId = options?.getSessionId?.() ?? ctx?.sessionManager?.getSessionId?.() ?? null;
	return resolveLocalRoot(artifacts, sessionId);
}

/**
 * Solo per `rpc-ui`/`rpc`: nella TUI resta il `/plan` nativo e l'estensione tace.
 * Studio marca il processo GUI con `OMP_STUDIO_PLAN=gui` (rpc/mod.rs); `--mode`
 * resta come riserva se la variabile si perde.
 */
export function isLabSession(env: Record<string, string | undefined> = process.env): boolean {
	return env.OMP_LAB_SESSION === "1" || Boolean(env.OMP_LAB_WORKSPACE && env.OMP_LAB_WORKSPACE.trim());
}

export function isGuiHost(
	argv: readonly string[] = process.argv,
	env: Record<string, string | undefined> = process.env
): boolean {
	if (env.OMP_STUDIO_PLAN === "gui") return true;
	if (env.OMP_STUDIO_PLAN === "off") return false;
	if (env.OMP_LAB_SESSION === "1" || Boolean(env.OMP_LAB_WORKSPACE && env.OMP_LAB_WORKSPACE.trim())) return true;
	const index = argv.indexOf("--mode");
	if (index >= 0) return argv[index + 1] === "rpc-ui" || argv[index + 1] === "rpc";
	return argv.some((arg) => arg === "--mode=rpc-ui" || arg === "--mode=rpc");
}

/** Ultimo stato salvato nella sessione (voce custom `studio-plan-state`). */
export function restoreFromEntries(entries: unknown[] | undefined, isLab = false): StudioPlanState {
	let found: StudioPlanState = { enabled: false, planFilePath: null, title: null };
	for (const entry of entries ?? []) {
		if (!entry || typeof entry !== "object") continue;
		if (!("type" in entry) || !("customType" in entry)) continue;
		const type = entry.type;
		const customType = entry.customType;
		if (type !== "custom" || customType !== PLAN_STATE_ENTRY) continue;
		const rawData = "data" in entry && entry.data && typeof entry.data === "object" ? entry.data : {};
		const enabled = "enabled" in rawData && rawData.enabled === true;
		const planFilePath = "planFilePath" in rawData && typeof rawData.planFilePath === "string" ? rawData.planFilePath : null;
		const title = "title" in rawData && typeof rawData.title === "string" ? rawData.title : null;
		const kind = "kind" in rawData && rawData.kind === "lab" ? "lab" : undefined;
		const briefApproved = "briefApproved" in rawData && rawData.briefApproved === true;
		found = { enabled, planFilePath, title, kind, briefApproved };
	}
	if (isLab) {
		found.kind = "lab";
		if (!found.briefApproved) {
			found.enabled = true;
		}
	}
	return found;
}


/* -------------------------------------------------------------- entrypoint */

export default function studioPlanExtension(pi: StudioPlanApi): void {
	if (!isGuiHost()) return;
	const z = pi.zod;
	const isLab = isLabSession();

	// Nel Laboratorio la guardia parte abilitata finche' non c'e' approvazione confermata
	if (isLab) {
		const state = planState();
		state.kind = "lab";
		const workspace = process.env.OMP_LAB_WORKSPACE || process.cwd();
		const approvedOnDisk = isLabBriefApprovedOnDisk(workspace);
		if (approvedOnDisk) {
			state.briefApproved = true;
			state.enabled = false;
		} else {
			state.briefApproved = false;
			state.enabled = true;
		}
	}

	const publish = (ctx: PlanContext | undefined) => {
		const state = planState();
		try {
			ctx?.ui?.setStatus(PLAN_STATUS_KEY, JSON.stringify(state));
		} catch {
			// Nessuna UI (stampa, json): lo stato resta comunque nella sessione.
		}
	};

	const persist = () => {
		try {
			pi.appendEntry?.(PLAN_STATE_ENTRY, { ...planState() });
		} catch {
			// Sessione effimera (`--no-session`): niente resume da proteggere.
		}
	};

	const syncTools = async () => {
		if (!pi.getActiveTools || !pi.setActiveTools) return;
		try {
			const active = pi.getActiveTools();
			const enabled = planState().enabled;
			const next = active.filter((name) => name !== PLAN_SUBMIT_TOOL);
			if (enabled) {
				next.push(PLAN_SUBMIT_TOOL);
				// Come omp: `write` serve a scrivere il piano, anche se era spento.
				if (!next.includes("write")) next.push("write");
			}
			if (next.length !== active.length || next.some((name, index) => name !== active[index])) {
				await pi.setActiveTools(next);
			}
		} catch {
			// L'elenco degli strumenti non e' essenziale: lo strumento rifiuta da solo fuori dal Piano.
		}
	};

	const setEnabled = async (ctx: PlanContext | undefined, enabled: boolean) => {
		const state = planState();
		if (isLab) {
			state.kind = "lab";
			// Nel Lab, se il brief non e' approvato, il Piano non puo' essere disattivato
			if (!enabled && !state.briefApproved) {
				state.enabled = true;
				persist();
				await syncTools();
				publish(ctx);
				return;
			}
		}
		if (state.enabled === enabled) {
			publish(ctx);
			return;
		}
		state.enabled = enabled;
		persist();
		await syncTools();
		publish(ctx);
	};

	const restore = async (ctx: PlanContext) => {
		if (ctx?.agent?.kind === "sub") return;
		const entries = ctx?.sessionManager?.getBranch?.() ?? ctx?.sessionManager?.getEntries?.();
		const restored = restoreFromEntries(entries, isLab);

		if (isLab) {
			const cwd = contextCwd(ctx);
			const workspace = process.env.OMP_LAB_WORKSPACE || cwd;
			// Verifica rigorosa fail-closed: marker su disco verificato per questo specifico workspace/prototipo
			const markerApproved = isLabBriefApprovedOnDisk(workspace);
			// Se il marker non e' presente su disco, qualsiasi vecchia voce di sessione viene invalidata
			const approved = markerApproved && (restored.briefApproved === true || !(entries && entries.length > 0));
			restored.kind = "lab";
			restored.briefApproved = approved;
			restored.enabled = !approved || restored.enabled;
		}

		resetPlanState(restored);
		await syncTools();
		publish(ctx);
	};

	pi.on("session_start", (_event, ctx) => restore(ctx));
	pi.on("session_switch", (_event, ctx) => restore(ctx));

	pi.on("before_agent_start", (event, ctx) => {
		const state = planState();
		const base = Array.isArray(event.systemPrompt) ? (event.systemPrompt as string[]) : [];

		if (isLab) {
			const workspace = process.env.OMP_LAB_WORKSPACE || contextCwd(ctx);
			const onDisk = isLabBriefApprovedOnDisk(workspace);
			if (!onDisk) {
				state.briefApproved = false;
				state.enabled = true;
				persist();
				publish(ctx);
			}

			if (state.enabled || !state.briefApproved) {
				const addition = ctx?.agent?.kind === "sub" ? LAB_PLAN_MODE_SUBAGENT_PROMPT : buildLabPlanPrompt();
				return { systemPrompt: [...base, addition] };
			} else {
				const addition = ctx?.agent?.kind === "sub" ? LAB_EXECUTION_SUBAGENT_PROMPT : LAB_RECIPE_EXECUTION_PROMPT;
				return { systemPrompt: [...base, addition] };
			}
		}

		if (!state.enabled) return undefined;
		const addition = ctx?.agent?.kind === "sub" ? PLAN_MODE_SUBAGENT_PROMPT : PLAN_MODE_ACTIVE_PROMPT;
		return { systemPrompt: [...base, addition] };
	});

	pi.on("tool_call", (event, ctx) => {
		const toolName = typeof event.toolName === "string" ? event.toolName : "";
		const input = event.input && typeof event.input === "object" ? (event.input as Record<string, unknown>) : {};
		return evaluatePlanToolCall({ toolName, input }, contextCwd(ctx), planState().enabled);
	});

	/**
	 * Apre la revisione in Studio e applica la decisione. Condivisa fra lo
	 * strumento (turno in corso) e `/studio-plan review` (sessione ferma).
	 */
	const review = async (
		ctx: PlanContext | undefined,
		slug: string,
		title: string,
		signal?: AbortSignal
	): Promise<
		| { decision: PlanReviewDecision; planFilePath: string; savedPath: string | null; content: string }
		| { error: string }
	> => {
		const planFilePath = `local://${slug}-plan.md`;
		const localPath = join(localRootOf(ctx), `${slug}-plan.md`);
		if (!existsSync(localPath)) {
			return { error: `Plan file not found: ${planFilePath}. Write the ${isLab ? "brief" : "plan"} there first, then submit again.` };
		}
		const content = readFileSync(localPath, "utf8");
		if (!content.trim()) return { error: `${isLab ? "Brief" : "Plan"} file is empty: ${planFilePath}.` };
		if (!ctx?.ui) return { error: "No OMP Studio UI is attached to this session." };

		const state = planState();
		state.planFilePath = planFilePath;
		state.title = title;
		if (isLab) {
			state.kind = "lab";
		}
		persist();
		publish(ctx);

		const meta: Record<string, unknown> = { v: 1, slug, title, planFilePath, localPath };
		if (isLab) {
			meta.kind = "lab";
		}
		const raw = await ctx.ui.editor(`${PLAN_REVIEW_TITLE_PREFIX}${JSON.stringify(meta)}`, content, { signal });
		const decision = parseDecision(raw);

		// Nel Laboratorio sono ammesse soltanto le due modalita' "compact" o "keep" (default "compact")
		if (isLab) {
			if (decision.mode !== "keep") {
				decision.mode = "compact";
			}
		}

		// Le modifiche fatte in revisione arrivano subito su disco, come in omp.
		if (decision.content !== undefined && decision.content !== content && decision.content.trim()) {
			writeFileSync(localPath, decision.content, "utf8");
		}
		// Senza modifiche nella card si rilegge il file: «Apri nell'editor» puo'
		// averlo cambiato mentre la revisione era aperta.
		let finalContent = content;
		if (decision.content?.trim()) finalContent = decision.content;
		else {
			try {
				finalContent = readFileSync(localPath, "utf8") || content;
			} catch {
				finalContent = content;
			}
		}

		let savedPath: string | null = null;
		if (decision.action === "approve") {
			if (isLab) {
				const workspaceDir = process.env.OMP_LAB_WORKSPACE || contextCwd(ctx);
				try {
					savedPath = saveLabBriefAndMarker(workspaceDir, slug, finalContent, process.env.OMP_LAB_PROJECT_PATH || null);
					state.briefApproved = true;
					await setEnabled(ctx, false);
				} catch (error) {
					ctx.ui.notify(
						`Salvataggio brief in .lab/brief.md non riuscito: ${error instanceof Error ? error.message : String(error)}`,
						"error"
					);
				}
			} else {
				if (decision.autosave !== false) {
					try {
						savedPath = savePlanCopy(contextCwd(ctx), title, finalContent);
					} catch (error) {
						ctx.ui.notify(
							`Copia del piano in .omp/plans non riuscita: ${error instanceof Error ? error.message : String(error)}`,
							"warning"
						);
					}
				}
				await setEnabled(ctx, false);
			}
		} else if (decision.action === "save") {
			if (isLab) {
				// Nel Laboratorio "Salva ed esci" salva la bozza ma mantiene la guardia CHIUSA (non e' approvazione)
				const workspaceDir = process.env.OMP_LAB_WORKSPACE || contextCwd(ctx);
				try {
					const labDir = join(workspaceDir, ".lab");
					mkdirSync(labDir, { recursive: true });
					const draftPath = join(labDir, "brief-draft.md");
					writeFileSync(draftPath, finalContent, "utf8");
					savedPath = ".lab/brief-draft.md";
				} catch {}
				state.briefApproved = false;
				state.enabled = true;
				persist();
				publish(ctx);
			} else {
				try {
					savedPath = savePlanCopy(contextCwd(ctx), title, finalContent);
				} catch (error) {
					ctx.ui.notify(
						`Copia del piano in .omp/plans non riuscita: ${error instanceof Error ? error.message : String(error)}`,
						"warning"
					);
				}
				await setEnabled(ctx, false);
			}
		} else if (decision.action === "refine" || decision.action === "cancel") {
			if (isLab) {
				state.briefApproved = false;
				state.enabled = true;
				persist();
				publish(ctx);
			}
		}

		return { decision, planFilePath, savedPath, content: finalContent };
	};

	pi.registerTool({
		name: PLAN_SUBMIT_TOOL,
		label: isLab ? "Studio Lab Brief Submit" : "Studio Plan Submit",
		description: isLab
			? "Submit the brief written to local://<slug>-plan.md for review in OMP Studio. Only available while brief review is pending. Blocks until the user decides: returns requested changes (update the brief and submit again) or approval (stop immediately)."
			: "Submit the plan written to local://<slug>-plan.md for review in OMP Studio. Only available while Studio plan mode is active. " +
			  "Blocks until the user decides: returns requested changes (update the plan and submit again) or approval (stop immediately).",
		parameters: z.object({
			slug: z.string().describe("Plan slug: the <slug> of local://<slug>-plan.md (letters, numbers, _ and -)."),
			title: z.string().optional().describe("Short human-readable plan title shown to the user.")
		}),
		approval: "read",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (ctx?.agent?.kind === "sub") {
				return text("Subagents cannot submit plans or brief reviews. Only the main agent can submit.", undefined, true);
			}
			const state = planState();
			if (!state.enabled && (!isLab || state.briefApproved)) {
				return text(isLab ? "Studio Lab brief review is not active." : "Studio plan mode is not active: there is nothing to submit.", undefined, true);
			}
			const slug = normalizePlanSlug(typeof params?.slug === "string" ? params.slug : "");
			if (!slug) return text("Invalid slug: use letters, numbers, underscores or hyphens.", undefined, true);
			const title = (typeof params?.title === "string" && params.title.trim()) || slug.replace(/[-_]+/g, " ");
			const outcome = await review(ctx, slug, title, signal);
			if ("error" in outcome) return text(outcome.error, undefined, true);
			return text(decisionResultText(outcome.decision, outcome.planFilePath, outcome.savedPath, isLab), {
				action: outcome.decision.action,
				mode: outcome.decision.mode,
				role: outcome.decision.role,
				planFilePath: outcome.planFilePath,
				savedPath: outcome.savedPath,
				// `details` non va al modello: Studio ci legge il piano/brief finale.
				planContent: outcome.decision.action === "approve" ? outcome.content : undefined
			});
		}
	});

	pi.registerCommand("studio-plan", {
		description: "OMP Studio: modalita' Piano della chat GUI (on|off|status|review)",
		handler: async (args, ctx) => {
			if (ctx?.agent?.kind === "sub") return;
			const state = planState();
			const op = args.trim().split(/\s+/)[0]?.toLowerCase() || "status";
			if (op === "on") {
				await setEnabled(ctx, true);
				return;
			}
			if (op === "off") {
				if (isLab && !state.briefApproved) {
					ctx?.ui?.notify(
						"Nel Laboratorio la modalita' Piano e' obbligatoria fino all'approvazione del brief.",
						"warning"
					);
					publish(ctx);
					return;
				}
				await setEnabled(ctx, false);
				return;
			}
			if (op === "review") {
				// Sessione ferma: la revisione non deve tenere bloccata la risposta
				// di `prompt`, quindi parte senza attendere e applica l'esito dopo.
				const slug = normalizePlanSlug(state.planFilePath ?? "");
				if (!slug) {
					ctx?.ui?.notify(isLab ? "Nessun brief da rivedere in questa sessione." : "Nessun piano da rivedere in questa sessione.", "info");
					return;
				}
				const title = state.title ?? slug;
				void review(ctx, slug, title).then((outcome) => {
					if ("error" in outcome) {
						ctx?.ui?.notify(outcome.error, "warning");
						return;
					}
					if (outcome.decision.action === "refine") {
						// Il commento dell'utente apre la bolla (Studio la marca «Piano»);
						// l'istruzione per l'agente segue su una riga a parte.
						const feedback = outcome.decision.feedback?.trim() || decisionResultText(outcome.decision, outcome.planFilePath, null, isLab);
						pi.sendUserMessage?.(
							`${feedback}\n\n(Update ${outcome.planFilePath} and submit it again with ${PLAN_SUBMIT_TOOL}.)`
						);
					}
				});
				return;
			}
			publish(ctx);
		}
	});
}
