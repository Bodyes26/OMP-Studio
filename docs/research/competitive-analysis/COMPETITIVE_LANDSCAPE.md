# Competitive landscape — OMP Studio

**Rilevazione: 2026-10-25. Base locale: `omp-studio-app` 1.8.0.** Ricerca e piano; nessun codice del prodotto modificato. Documento sostitutivo della prima bozza: rimossi confronti di RAM/FPS non misurati, presunte esclusività e descrizioni obsolete dei concorrenti.

## Conclusione decisionale

**Studio non deve diventare un altro editor AI. Deve rendere più affidabile il governo di sessioni, corsie e risultati.** Le fondamenta pertinenti sono già presenti: multi-progetto, doppia superficie alternativa, worktree, revisione, browser con takeover, Lab e Companion. I migliori interventi immediati sono accessibilità del resize, persistenza della geometria e handoff TUI/GUI sicuro; non una nuova sidebar o un nuovo motore di agenti.

**Worktree e agenti paralleli non sono un'esclusiva:** Zed e Codex li documentano esplicitamente. Anche Cursor documenta takeover del desktop remoto e artefatti di verifica. Il vantaggio possibile è la coerenza locale di tutto il ciclo, con controllo e provenienza chiari, non la presenza isolata di una feature.

### Come leggere l'evidenza

- **SRC:** implementazione letta; non implica esecuzione del concorrente.
- **DOC:** documentazione ufficiale/README del maintainer; capacità dichiarata, non benchmark indipendente.
- **OBS:** comportamento esercitato in questa ricerca, con scenario dichiarato.
- **ISSUE:** segnalazione di utente o discussione; non prova che ogni versione abbia il difetto.
- **INF:** inferenza e rischio; da confermare prima di cambiare prodotto.
- **PROP:** adattamento originale proposto.

Le pagine web sono vive; «verificato» indica accesso durante la rilevazione, non garanzia che tutta la documentazione corrisponda a una specifica release installata. I riferimenti sorgente fissati e le licenze sono approfonditi in [TECHNICAL_FINDINGS](TECHNICAL_FINDINGS.md) e nel registro sorgenti del [backlog](IMPROVEMENT_OPPORTUNITIES.md). Nessun concorrente commerciale è stato installato o pilotato: demo e video sono **riferimenti visivi ufficiali**, non comportamento osservato in prima persona. Per le limitazioni runtime locali vedere [audit UI](UI_UX_MOTION_AUDIT.md#metodo-prove-e-limiti).

## 1. Identità del nostro prodotto

### Utenti, problemi e workflow

**DOC [PRODUCT](../../PRODUCT.md#users), righe9-95:** sviluppatori che governano più progetti e agenti nello stesso desktop per lunghe sessioni; il lavoro primario è assegnare, leggere, verificare e rispondere, non scrivere ogni file a mano.

1. Aprire progetti, scegliere corsia e riprendere sessione senza cercare finestre separate.
2. Preparare richieste in coda persistita con ruoli/modelli/thinking/direttive/allegati; avviare manualmente o secondo gate automatici.
3. Lavorare in Principale o delegare a worktree isolati, mantenendo bozza/editor/sessione per corsia.
4. Leggere transcript/tool/todo/domande nella GUI oppure usare la TUI originale. Lo switch **chiude e riapre** il processo con resume: non conserva job/kernel/browser effimeri.
5. Verificare diff e comandi eseguiti, integrare o risolvere conflitti nella corsia senza lasciare il target in conflitto.
6. Guidare browser, visualizzare diagrammi e anteprime, iterare un prototipo nel Lab; consegnarlo all'implementazione reale.
7. Seguire attenzione multi-progetto via Companion/notifiche, quota/reset e cronologia.

### Implementato, pianificato, incerto

| Stato | Capacità | Prova e cautela |
|---|---|---|
| Implementato SRC | Surface routing, registro sessioni/corsie e resume | `src/lib/lanes/laneOrchestrator.svelte.ts:433-483`; un processo per corsia, Lab solo GUI |
| Implementato SRC | Window transcript300 entry e caricamento precedenti | `src/lib/agent/transcriptWindow.ts:9-33`; non virtualizzazione a memoria costante |
| Implementato SRC | Diff/review e evidenze comandi | `LaneReviewModal.svelte:149-157`, `commandEvidence.ts:11-59`; le evidenze non sono legate a SHA/fingerprint |
| Implementato SRC | Integrazione worktree e undo | `src-tauri/src/projects/worktrees/lane_integrate.rs`; merge-tree e preservazione target; non OS sandbox |
| Implementato SRC/DOC | Lab, Browser live, private/takeover e remoto facoltativo | Moduli `src/lib/lab/`, `browser-live.ts`, backend/browser; DOC PRODUCT:73-81,124. Non esercitati end-to-end qui |
| Implementato SRC | Reduced motion, native dialog, tooltip e roving tab focus | `motionState.svelte.ts`, `ui/Dialog.svelte`, `ui/Tooltip.svelte`, `ui/ColumnTabs.svelte` |
| Promessa non soddisfatta nel percorso letto | Larghezze persistenti per progetto | PRODUCT:234 vs route:3049-3245 stato solo locale; opportunità O02 |
| Gap SRC | Resize dei divisori da tastiera | Route:3622-3629,3746-3753, solo pointer/doubleclick; O01 |
| Non dimostrato | Performance/FPS, consumo RAM totale, conformità AA di tutti i temi, stato di ogni voce del vecchio PLAN | Nessun benchmark completo né smoke desktop multi-OS. Checkbox storiche non sono inventario autoritativo |
| Futuro PROP | Ricevute di verifica per revisione, quota admission advisory, handoff Lab più tracciabile | Estensioni di capacità esistenti, non feature già implementate o promesse di delivery |

### Architettura e vincoli da rispettare

**SRC `package.json`:** Svelte5/TypeScript, SvelteKit statico/Vite6; Tauri2/Rust, Monaco0.56, xterm6, marked/DOMPurify, Mermaid; esbuild-wasm per Lab. Rune/store reattivi e helper puri, non React nello shell. React19/Tailwind del Lab non giustificano una migrazione della shell.

**SRC/DOC:** trasporto stdio NDJSON RPC, channel Tauri, processi PTY; SQLite runtime in sola lettura, file atomici e metadata locali per code/corsie/settings; process tree lifecycle. Backend controlla Git/path/processi. Frontend rende e orchestra la superficie, non deve diventare un secondo runtime LLM. Dettagli e punti deboli nel [documento tecnico](TECHNICAL_FINDINGS.md).

**Scelte intenzionali, non difetti:** niente IDE generico/debugger/marketplace; niente command palette globale aggiunta per imitazione; TUI intatta e shortcut limitate; local-first con relay opzionale dell'utente; copia file locali con consenso; processo e buffer non devono morire cambiando progetto; temi coordinati. `tools.approvalMode:yolo` è una scelta runtime documentata, non un'architettura di sandbox. Rendere trasparente il confine di fiducia senza aggiungere un pannello di permessi fittizi.

## 2. Candidati e pertinenza

### Diretti o convergenti

| Prodotto | Perché studiarlo | Capacità ufficiale pertinente | Limite del confronto/stato verificato |
|---|---|---|---|
| **Codex app + CLI** | Conversazioni/worktree e handoff locale | [D01](#d01): Local/Worktree, branch di partenza, ambienti, snapshot prima di cleanup, ripristino, file ignorati espliciti | App commerciale e core OSS sono superfici diverse: il core aperto non rende aperti tutti gli interni desktop |
| **Zed** | Governo thread multi-progetto e review vicino al codice | [D02](#d02): sidebar thread, agenti diversi, scelta isolamento per thread, confronto e merge | Rust/GPUI non trasferibile come UI Svelte; licenza per componente; nessun FPS/RAM misurato qui |
| **Cursor** | Agent workflow locale/cloud e prova del risultato | [D03](#d03): Cloud Agent su VM dedicata, PR con video/screenshot/log, takeover desktop remoto | Interni proprietari non esaminati; non dedurre che cloud sostituisca ogni modalità locale o che non abbia worktree |
| **OpenHands / Agent Canvas** | Control center agentico e backend locali/remoti | [D04](#d04): ACP, backend multipli, automazioni, opzione locale senza sandbox e Docker opzionale | `main` corrente non va descritto solo col vecchio runtime Python Action/Observation; self-hosted non equivale automaticamente a sicuro |
| **Windsurf / Devin Desktop** | Continuità contesto, coda, distinzione consulenza/esecuzione | [D05](#d05): fonte esaminata JetBrains Cascade con Write/Chat, queue, auto-execution e revert | Questa specifica pagina dice legacy plugin in maintenance e Cascade deprecato. **Non** estendere le conclusioni a tutto il desktop attuale |

### Adiacenti e riferimenti tecnici

| Prodotto | Utilità per Studio | Forza/limite da trasferire |
|---|---|---|
| **VS Code** | Tastiera, accessibilità, editor/terminal lifecycle e flow control | [D06](#d06) descrive focus tra parti, roving toolbar/tab, accessible diff. È anti-riferimento come identità, non per qualità dei meccanismi |
| **Cline** | Checkpoint e approvazione/ripristino nel loop agentico | [D07](#d07) e source review: studiare confine Git/chat e crash recovery; issue storiche non provano difetto nell'ultima release |
| **Aider** | Context budget e lint/test loop semplici | [D08](#d08), [D09](#d09): repo-map e verifica dopo edit. La logica va nel runtime omp se serve, non copiata nella shell |
| **Claude Code** | Delegazione/sessioni e utilizzo headless | [D10](#d10): pratica ufficiale headless e task; non rappresentarlo come «solo CLI, senza nessun altro frontend» in tutto l'ecosistema |
| **Continue** | Storia dei context provider e architettura estensione | [D11](#d11) README dichiara non più mantenuto/read-only e release finale2.0.0. Riferimento storico, non dipendenza strategica nuova |
| **Roo Code** | Ruoli/mode e specializzazione tool | [D12](#d12): Code/Architect/Ask/Debug/custom; archivio15 maggio2026 e shutdown dichiarato. Non considerarlo oggi «molto attivo» |
| **Void** | Diff streaming e sincronizzazione buffer nel fork VS Code | [D13](#d13): deprecato/archiviato2 giugno2026; componenti descritti nel README, implementazione non auditata qui. Archiviazione non dimostra da sola costi del fork come causa |
| **PearAI** | Caso di shell fork e core separato/submodule | [D14](#d14): repo app fork VS Code, funzionalità soprattutto submodule fork Continue. Stato attuale del servizio non stabilito dal solo README; nessuna promessa di manutenzione |

Goose/OpenCode sono ulteriori candidati pertinenti, ma non usati per aggiungere una riga superficiale alla matrice: la prima tranche ha già più di8 prodotti con fonti ufficiali. Prima di cambiare decisioni sulla base dei loro protocolli occorre verificare implementazione/versione specifiche.

## 3. Matrice comparativa verificata

**D = dichiarato in fonte ufficiale; S = codice esaminato nel relativo documento; ? = non accertato in questa ricerca, non «assente»; N/A = superficie differente.** Colonne non sono ranking di qualità. Nessuna spunta significa che la versione commerciale sia stata esercitata.

| Prodotto/superficie | Multi-thread/progetto | Isolamento Git/worktree | Review/ripristino | Contesto trasparente | Attività lunga/prova |
|---|---|---|---|---|---|
| Studio | S/D progetti+corsie+Companion | S worktree, merge-tree, undo integrazione | S Monaco+comandi; attualità verifica non certificata | S mentions/editor/preflight; manifest per invio proposto | D browser/Lab e notifiche; ricevuta revisionata proposta |
| Codex | D chat parallele | D Git worktree, handoff, ignored include esplicito | D snapshot cleanup/ripristino | D ambiente/checkout identificati; completo? | D background worktree/automazioni |
| Zed | D thread su più progetti | D scelta per thread | D agent review/compare/merge | D @mention/selection | D thread status; no misure latenza |
| Cursor Cloud | D agenti separati | D VM isolata; politica worktree locale ? | D PR e artefatti | D repository/ambiente/segreti selezionati | D video/log/screenshot, takeover |
| Agent Canvas | D backend/progetti multipli | D sandbox opzionale; worktree specifico ? | ? per singolo backend | D agent/backend, policy dipendente dal backend | D automazioni/schedule/eventi |
| Cascade JetBrains legacy | D queue conversazione; multi-progetto ? | ? | D revert esplicitamente irreversibile nella pagina | D consapevolezza editor | D tool/terminal, auto-execution livelli |
| VS Code | D workbench/accessibilità; agenti specifici fuori confronto | ? da questa fonte | D accessible diff | D aiuti contestuali/focus | S notifiche quota, baseline e dismiss; non benchmark |
| Cline | D task/loop; multi-progetto ? | D checkpoint; implementazione Git corrente non auditata | S associazione checkpoint/run dei messaggi; restore Git non provato | D tool/prompt, comparabilità budget ? | D task/tool; qualità risultati non misurata |
| Aider | D CLI repo, non shell multi-progetto | D Git workflow; worktree gestito ? | D lint/test e correzione | S repo map con budget/cache | D test dopo edit configurabile |
| Claude Code | D delegazione/headless | ? in fonte esaminata | ? | D selezione contesto/isolamento task nella guida | D fan-out/headless; metriche prodotto non dedotte |
| Continue/Roo/Void/PearAI | Riferimenti storici o manutenzione non accertata | Non derivare dalle fork le stesse capacità | Consultare fonte/revisione specifica | Pattern utili, non garanzia corrente | Non confrontati come prodotti attivi equivalenti |

### Cosa manca davvero rispetto ai riferimenti pertinenti

- **Resize accessibile** a parità dell'azione pointer, non «shortcut» in generale: Studio ne ha già.
- **Ripristino della geometria per progetto** già promesso, non altra gestione preferenze.
- **Semantica sicura di handoff** e chiarezza delle perdite effimere; non nuova TUI.
- **Evidenza del risultato legata al codice attuale**, anziché solo elenco di comandi nel transcript; da distinguere da checkpoint/undo che Studio già possiede.
- **Provenienza unificata del contesto del singolo invio**: non assenza di file mention/context panel.
- **Scalabilità verificata della lettura lunga**: assenza di benchmark comparabile, non lentezza accertata.

Cloud VM gestite, marketplace e completamento inline universale non sono automaticamente gap: sono altri prodotti. La scelta utile è completare i workflow esistenti prima di ampliare la superficie.

## 4. Pattern da adottare, adattare, rifiutare

| Riferimento | Meccanismo reale | Dove adattarlo in Studio | Decisione e trade-off |
|---|---|---|---|
| Codex worktrees | Ownership esplicita Local/Worktree e ripristino dopo cleanup | `laneProfile.ts`, review/cleanup e handoff surface (diversi tipi di handoff!) | Adattare chiarezza/recovery. Non copiare automaticamente `.env`; allowlist Studio esiste già |
| Zed thread sidebar | Un thread per linea di lavoro, scelta isolamento e review | `LaneStrip`, Companion e queue esistenti | Consolidare stato/provenienza invece di nuova sidebar parallela. Le corsie sono già unità d'isolamento |
| Cursor artefatti PR | Video/screenshot/log a supporto risultato | `commandEvidence.ts`, `LaneReviewModal`, Lab handoff | Ricevuta deterministica con SHA+dirty fingerprint; video non prova che test sia della revisione attuale |
| VS Code accessibilità | Roving tab stops, focus tra parti, diff accessibile | `ColumnTabs`, splitter route, Monaco/xterm | Completare primitivi; non introdurre palette globale o imitare tutta la workbench |
| Cline checkpoint | Stato codice e conversazione separabili; storia Git dedicata | `lane_integrate.rs` e undo esistenti | Prendere requisiti di ripristino, non rinomina `.git` o reset cieco. Trade-off: worktree consuma disco e non limita tool OS |
| Aider repo-map | Ranking simboli entro budget, cache | `promptPreflight.ts` solo come consumatore di capacità runtime | Non implementare secondo indice AST in Studio senza necessità misurata e ownership runtime |
| Aider lint/test | Verifica e ritorno errori | Profilo progetto/receipt R05 | Esporre comandi approvati ed evidenze, non retry infinito o shell presa da testo non fidato |
| OpenHands | Backend/sandbox dichiarati e confini eventi | Registro sessioni, diagnostica, proiezioni Companion/remoto | Confini tipizzati/generazione; no migrazione all'event sourcing generale per imitazione |
| Roo/Cascade mode | Intento e poteri espliciti | Ruoli, Piano e task directive esistenti | Migliorare spiegazione del livello reale, non toolbar con cinque nuovi modi duplicati |

## 5. Licenze: idee ≠ codice ≠ asset

Nessun sorgente, icona, screenshot o asset di terzi viene importato in Studio da questa ricerca. I link visivi restano link. Un algoritmo o comportamento può essere reimplementato originariamente; la copia letterale richiede revisione della licenza del **file e della revisione**, notizie terze parti e NOTICE.

| Progetto | Licenza/scope verificato | Decisione di riutilizzo |
|---|---|---|
| Codex core | Apache-2.0 nel repo OSS, app/servizio con termini propri | Studiare protocollo/core, non dedurre diritto a copiare app privata |
| VS Code OSS | MIT; distribuzione Microsoft e asset/brand non coincidenti | Pattern/meccanismi piccoli riimplementati; preservare avvisi se copia autorizzata |
| Cline | Apache-2.0 nel repository | Controllare eventuale NOTICE e file vendorizzati prima di estrazione |
| Aider | Apache-2.0 nel repository | Stessi obblighi; Tree-sitter grammar e dipendenze hanno licenze proprie |
| Zed | [README licensing](https://github.com/zed-industries/zed#licensing): prevalentemente GPL-3.0-or-later, Apache-2.0 dove indicato | Non copiare codice GPL nel progetto MIT assumendo compatibilità distributiva; preferire idea/implementazione originale |
| OpenHands | Root MIT nella pagina repository; superficie corrente Agent Canvas | Controllare subpackage/servizi/vendor prima di copiare; nessuna licenza globale dei backend desunta |
| Continue/Roo | Apache-2.0 nei README/root; repo archiviati/non mantenuti | Un repo aperto ma non mantenuto non è buona nuova dipendenza runtime |
| Void | [LICENSE.txt](https://raw.githubusercontent.com/voideditor/void/main/LICENSE.txt) Apache-2.0 Glass Devtools; esiste `LICENSE-VS-Code.txt` ereditato | Non descriverlo semplicemente MIT; distinguere file ereditati e contributi |
| PearAI | [LICENSE.txt app](https://raw.githubusercontent.com/trypear/pearai-app/main/LICENSE.txt) MIT Microsoft; README dice Pear OSS Apache-2.0 e core in submodule | Discrepanza di scope da risolvere file-per-file/submodule prima di qualunque copia. Nessun riuso letterale raccomandato |
| Cursor/Windsurf/Claude Code prodotto | Implementazioni commerciali non auditate qui | Solo idee/comportamenti pubblicamente documentati; niente ricostruzione speculativa degli interni |

Non è consulenza legale. Licenza permissiva non autorizza uso del marchio né elimina verifica copyright/attribuzione e dipendenze.

## 6. Librerie e componenti pertinenti

**Regola: prima usare ciò che è già nello stack.** I costi riportati sono manutenzione/integrazione, non KB di bundle non misurati.

| Soluzione | Riferimento | Fit/costo e decisione |
|---|---|---|
| Svelte transition/animate/motion | [transitions](https://svelte.dev/docs/svelte/transition), [animate](https://svelte.dev/docs/svelte/animate), [motion](https://svelte.dev/docs/svelte/svelte-motion), [licenza letta](https://github.com/sveltejs/svelte/blob/main/LICENSE.md) | Dipendenza già presente, primitive framework MIT. Bidirezionalità e reduced motion già adottate; nessun altro motore animazioni |
| Monaco diff/actions | [Monaco](https://github.com/microsoft/monaco-editor), MIT | Già presente. Verificare accessibilità e modello condiviso prima di nuovo diff renderer |
| xterm flow control | [guida](https://xtermjs.org/docs/guides/flowcontrol/), [repo](https://github.com/xtermjs/xterm.js), MIT | Già presente. Callback write/backlog prima di cambiare renderer; nessun WebGL imposto senza prova WebView2/WKWebView |
| TanStack Virtual, adapter Svelte | [Svelte Virtual](https://tanstack.com/virtual/latest/docs/framework/svelte/svelte-virtual), [licenza MIT letta](https://github.com/TanStack/virtual/blob/main/LICENSE) | Candidato condizionale O17: altezze variabili, focus/copia/find e API adapter da provare con Svelte5; non installato |
| Floating UI DOM | [docs](https://floating-ui.com/docs/computePosition), [licenza MIT letta](https://github.com/floating-ui/floating-ui/blob/master/LICENSE) | Opportunità se posizionamento diventa realmente complesso; helper interno già top-layer/flip/clamp/rAF/cleanup. Non aggiungerlo per caso point già contenuto dal CSS del menu |
| Bits UI | [docs](https://bits-ui.com/docs/introduction), [licenza MIT letta](https://github.com/huntabyte/bits-ui/blob/main/LICENSE) | Headless Svelte. Utile come riferimento APG per nuovi widget, non migrazione di dialog/tab/tooltip già funzionanti |
| Tree-sitter | [repo](https://github.com/tree-sitter/tree-sitter), MIT core (grammar separati) | Costo parser/cache/index/invalidazione multilingua; se serve, ownership nel runtime omp e contratto verso Studio |

Una nuova libreria richiede versione fissata, prova di compatibilità, licenza file-level, costo build/runtime osservato e removal path. Nessuna di queste è stata aggiunta.

## 7. Feedback, issue e limiti: non confondere segnalazione e prevalenza

- [Cline #4388](https://github.com/cline/cline/issues/4388): meta-issue aperta dal23 giugno2025, con segnalazioni utenti e commenti automatici. È materiale per fault injection/recovery, non prova che l'implementazione corrente continui a corrompere `.git`; distinguere corpo segnalazione, bot e sorgente.
- [Cline #5243](https://github.com/cline/cline/issues/5243): issue chiusa, segnalazione del30 luglio2025 su Cline3.20.2/macOS arm64, lock file. Valutare crash/retry/idempotenza, non «Cline rompe sempre Git»; chiusura non dimostra da sola fix tecnico.
- [OpenHands #15061](https://github.com/OpenHands/OpenHands/issues/15061): discussione sull'estrazione dell'interprete eventi conversazione. Riferimento storico a confini di responsabilità; non mappa autoritativa del `main` Agent Canvas corrente.
- [WAI splitter issue129](https://github.com/w3c/aria-practices/issues/129): lo stesso pattern segnala review/esempio non completati; usare semantica e test con tecnologie assistive, non compliance presunta.
- Void/Roo/Continue: stato comunicato dal maintainer; **non** evidenza che ogni fork/editor open source sia economicamente insostenibile.

Non è stata raccolta una coorte di utenti né contata la ricorrenza delle issue. Non presentiamo stelle GitHub, benchmark dei vendor, screenshot promozionali o thread isolati come metrica di soddisfazione.

## 8. Posizionamento che vale preservare

**Punti forti supportati, non «unicità assolute»:**

1. Unità progetto/corsia/sessione, non semplice chat accanto all'editor.
2. TUI originale disponibile e GUI derivata dal protocollo; esplicitare però il costo del cambio superficie.
3. Worktree e merge pipeline che preservano target sporco non sovrapposto e confinano conflitto nella corsia.
4. Browser takeover/private e Lab integrati nel luogo di verifica, senza confonderli con isolamento OS o produzione full-stack.
5. Quote/reset e attenzione come strumenti operativi, con Companion che non dovrebbe sostituire ciò che si sta leggendo.
6. Primitive UI condivise, reduced motion e ancoraggio scroll già presenti.

**Tre opportunità differenzianti PROP:** ricevuta codice+verifica+artefatti, quota admission trasparente senza costo stimato finto, consegna Lab revisionata con limiti delle simulazioni. Sono combinazioni pragmatiche delle capacità Studio; non si sostiene che nessun concorrente le realizzi.

## Registro fonti ufficiali

Tutti i link seguenti consultati nella rilevazione; redirect possibili, documentazione senza release fissa. I sorgenti immutabili sono nel backlog/relazione tecnica.

<a id="d01"></a>**D01 — Codex Worktrees:** <https://developers.openai.com/codex/environments/git-worktrees> → `learn.chatgpt.com/docs/environments/git-worktrees`. Local/worktree, handoff, snapshot cleanup, include ignorati; [core OSS](https://github.com/openai/codex).

<a id="d02"></a>**D02 — Zed Parallel Agents:** <https://zed.dev/parallel-agents>, [agent panel](https://zed.dev/docs/ai/agent-panel), [repo e licensing](https://github.com/zed-industries/zed#licensing). Immagini sidebar/worktree/review collegate dalla pagina.

<a id="d03"></a>**D03 — Cursor Cloud/Background Agents:** <https://cursor.com/help/ai-features/background-agents>. VM, network/segreti controllati, prove e takeover. Non usata la precedente speculazione «shadow workspace rimosso per RAM».

<a id="d04"></a>**D04 — OpenHands Agent Canvas:** <https://github.com/OpenHands/OpenHands>. README attuale con opzioni senza sandbox/Docker/backend multipli e avviso accesso filesystem.

<a id="d05"></a>**D05 — Cascade JetBrains legacy:** <https://docs.devin.ai/windsurf/plugins/cascade/cascade-overview>. Video modalità, voice/revert e screenshot auto-execution, avviso deprecazione. Durate/easing video non misurati.

<a id="d06"></a>**D06 — VS Code Accessibility:** <https://code.visualstudio.com/docs/editor/accessibility> → <https://code.visualstudio.com/docs/configure/accessibility/accessibility>. Prima URL `docs/configure/accessibility` senza segmento finale aveva restituito404; alternativa risolta.

<a id="d07"></a>**D07 — Cline:** <https://github.com/cline/cline>, issue4388/5243 sopra e implementazioni citate nel backlog.

<a id="d08"></a>**D08 — Aider Repo Map:** <https://aider.chat/docs/repomap.html>; [repository](https://github.com/Aider-AI/aider). Ranking non va attribuito a un'implementazione interna del nostro runtime non letta.

<a id="d09"></a>**D09 — Aider lint/test:** <https://aider.chat/docs/usage/lint-test.html>. Auto-lint, auto-test configurabile, exit nonzero, recupero tramite modello. Non importare qui retry senza limite.

<a id="d10"></a>**D10 — Claude Code best practices:** [guida corrente](https://code.claude.com/docs/en/best-practices), verifica del risultato, subagenti, context budget e distinzione permessi/sandbox. [Blog storico](https://www.anthropic.com/research/claude-code-best-practices) su headless/fan-out dichiara dal26 gennaio2026 di non essere più mantenuto: non usarlo per attestare versione corrente di ogni comando o assenza di GUI.

<a id="d11"></a>**D11 — Continue:** <https://github.com/continuedev/continue>, notice maintainer e release finale2.0.0 nel README.

<a id="d12"></a>**D12 — Roo Code:** <https://github.com/RooCodeInc/Roo-Code>, archivio/shutdown15 maggio2026 e modalità storiche.

<a id="d13"></a>**D13 — Void:** <https://github.com/voideditor/void>, deprecazione/archivio2 giugno2026, README descrive EditCodeService/VoidModelService; LICENSE.txt Apache2.

<a id="d14"></a>**D14 — PearAI:** <https://github.com/trypear/pearai-app>, core <https://github.com/trypear/pearai-submodule>, scope licenza da verificare prima di riuso.

## Documenti collegati

- [Opportunità con ID e priorità](IMPROVEMENT_OPPORTUNITIES.md)
- [Audit implementazioni e contratti](TECHNICAL_FINDINGS.md)
- [UI/UX/motion: riscontri e limiti osservativi](UI_UX_MOTION_AUDIT.md)
- [Roadmap: dodici piani incrementali, primi tre e criteri di accettazione](IMPLEMENTATION_ROADMAP.md)
