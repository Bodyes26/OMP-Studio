// Voci del catalogo comandi per la gestione della sessione, contesto e workspace di omp.
// I comandi elencati qui corrispondono ai builtin ufficiali del runtime omp.

import type { CommandManifestEntry, CommandPlacement } from '../types';

/** Posizioni standard per azioni e pannelli che possono risiedere nella riga di stato del composer. */
const STATUS_LINE_PLACEMENTS: readonly CommandPlacement[] = [
	{ zone: 'statusLine', form: 'chip' },
	{ zone: 'statusLine', form: 'icon' }
];

export const OMP_ENTRIES_SESSION: readonly CommandManifestEntry[] = [
	{
		id: 'export',
		origin: 'omp',
		category: 'session',
		icon: 'IconDownload',
		control: 'action',
		supported: [...STATUS_LINE_PLACEMENTS],
		defaultPlacement: null,
		argsHint: '[--themes] [path]',
		text: {
			it: {
				title: 'Esporta sessione',
				summary: 'Esporta la sessione corrente in un file HTML autonomo navigabile con rendering completo di tool e messaggi.',
				benefits: [
					'Genera un documento consultabile offline in qualsiasi browser',
					'Preserva la visualizzazione completa dei tool call e dei sotto-agenti',
					'Supporta i temi chiaro e scuro di omp con l\'opzione --themes'
				],
				examples: [
					{ command: '/export', note: 'Esporta nella cartella di lavoro con nome generato automaticamente' },
					{ command: '/export report.html', note: 'Esporta specificando il percorso del file di destinazione' },
					{ command: '/export --themes archivio.html', note: 'Esporta includendo le varianti di tema chiaro e scuro' }
				],
				whenToUse: 'Quando vuoi archiviare, condividere via email o consultare il lavoro svolto fuori da OMP Studio.'
			},
			en: {
				title: 'Export Session',
				summary: 'Export current session to a standalone, browsable HTML file with full tool and message rendering.',
				benefits: [
					'Produces an offline document viewable in any modern web browser',
					'Preserves full visualization of tool calls and nested sub-agent runs',
					'Supports dark and light omp theme options with --themes'
				],
				examples: [
					{ command: '/export', note: 'Export to the current workspace with an auto-generated filename' },
					{ command: '/export report.html', note: 'Export to a specific target file path' },
					{ command: '/export --themes archive.html', note: 'Export including both dark and light theme variations' }
				],
				whenToUse: 'When you want to archive, share via email, or view your work outside of OMP Studio.'
			}
		}
	},
	{
		id: 'share',
		origin: 'omp',
		category: 'session',
		icon: 'IconExternalLink',
		control: 'action',
		supported: [...STATUS_LINE_PLACEMENTS],
		defaultPlacement: null,
		text: {
			it: {
				title: 'Condividi sessione',
				summary: 'Condivide la sessione tramite un link cifrato end-to-end su share server o secret gist di GitHub.',
				benefits: [
					'Cifratura AES-256-GCM lato client con chiave preservata unicamente nel frammento URL',
					'Redazione automatica di segreti, token e chiavi API prima della trasmissione',
					'Funziona anche per sessioni residenti solo in memoria senza file persistito'
				],
				examples: [
					{ command: '/share', note: 'Genera e apre un link cifrato per consultare la sessione via web' }
				],
				whenToUse: 'Quando vuoi mostrare rapidamente una sessione o un problema a un collega garantendo la riservatezza.'
			},
			en: {
				title: 'Share Session',
				summary: 'Share session via an end-to-end encrypted link hosted on a share server or secret GitHub gist.',
				benefits: [
					'Client-side AES-256-GCM encryption with key stored exclusively in the URL fragment',
					'Automatic redaction of secrets, tokens, and API credentials before upload',
					'Works even for in-memory sessions without requiring an on-disk session file'
				],
				examples: [
					{ command: '/share', note: 'Generate and open an encrypted link to view the session in a browser' }
				],
				whenToUse: 'When you need to quickly show a session or troubleshoot an issue with a teammate securely.'
			}
		}
	},
	{
		id: 'session',
		origin: 'omp',
		category: 'session',
		icon: 'IconTerminal',
		control: 'action',
		supported: [...STATUS_LINE_PLACEMENTS],
		defaultPlacement: null,
		argsHint: '[info|delete|pin [account]]',
		text: {
			it: {
				title: 'Gestione sessione',
				summary: 'Mostra informazioni diagnostiche sulla sessione corrente, gestisce l\'eliminazione o fissa l\'account provider.',
				benefits: [
					'Mostra metriche dettagliate, token accumulati e file sorgente della sessione',
					'Permette di collegare stabilmente un account OAuth a questa sessione',
					'Consente di eliminare in sicurezza la sessione attiva e i suoi artefatti'
				],
				examples: [
					{ command: '/session info', note: 'Visualizza statistiche, identificativi e percorso del file di sessione' },
					{ command: '/session pin work-account', note: 'Fissa il provider all\'account OAuth specificato' },
					{ command: '/session delete', note: 'Elimina la sessione corrente e ritorna al selettore' }
				],
				whenToUse: 'Quando vuoi verificare le credenziali usate, i token consumati o ripulire la sessione attiva.'
			},
			en: {
				title: 'Session Management',
				summary: 'Show diagnostic info for the active session, manage deletion, or pin a provider account.',
				benefits: [
					'Displays detailed metrics, accumulated tokens, and the on-disk session file path',
					'Allows pinning a specific stored OAuth account to this session',
					'Enables safe deletion of the active session and its associated artifacts'
				],
				examples: [
					{ command: '/session info', note: 'Display stats, IDs, and file location of the current session' },
					{ command: '/session pin work-account', note: 'Pin the provider to a specific stored OAuth account' },
					{ command: '/session delete', note: 'Delete the active session and return to selector' }
				],
				whenToUse: 'When you need to inspect credentials, review token usage, or delete the current session.'
			}
		}
	},
	{
		id: 'usage',
		origin: 'omp',
		category: 'info',
		icon: 'IconQuota',
		control: 'panel',
		supported: [...STATUS_LINE_PLACEMENTS],
		defaultPlacement: null,
		argsHint: '[show|reset [provider/credential-id|provider/active]]',
		text: {
			it: {
				title: 'Quote e consumi',
				summary: 'Apre il pannello delle quote e consumi di Studio o interroga i contatori di token dei provider.',
				benefits: [
					'Apre direttamente il pannello visuale delle quote in Studio',
					'Consente di monitorare i consumi per ciascun provider e modello',
					'Permette di azzerare i contatori di rate limit salvati quando supportato'
				],
				examples: [
					{ command: '/usage', note: 'Apre la visualizzazione quote e consumi in OMP Studio' },
					{ command: '/usage show', note: 'Mostra i consumi dettagliati da riga di comando' },
					{ command: '/usage reset anthropic/active', note: 'Azzera il contatore di rate limit salvato per il provider attivo' }
				],
				whenToUse: 'Quando vuoi controllare quanti token hai speso o verificare i limiti di chiamata dei provider.'
			},
			en: {
				title: 'Usage & Quotas',
				summary: 'Open the usage and quota panel in Studio or query provider token counters and limits.',
				benefits: [
					'Directly opens the visual quota and consumption panel in Studio',
					'Tracks token spend across providers and configured models',
					'Allows resetting saved rate-limit cooldown timers when supported'
				],
				examples: [
					{ command: '/usage', note: 'Open the usage and quota panel in OMP Studio' },
					{ command: '/usage show', note: 'Print detailed provider usage and limits to output' },
					{ command: '/usage reset anthropic/active', note: 'Reset the saved rate limit reset counter for the active provider' }
				],
				whenToUse: 'When you want to track token spend or check if you are approaching provider rate limits.'
			}
		}
	},
	{
		id: 'stats',
		origin: 'omp',
		category: 'info',
		icon: 'IconNetwork',
		control: 'action',
		supported: [...STATUS_LINE_PLACEMENTS],
		defaultPlacement: null,
		argsHint: '[--port <port>] [--host <host>]',
		text: {
			it: {
				title: 'Statistiche e costi',
				summary: 'Riporta statistiche analitiche su token, costi e chiamate ai tool o avvia la dashboard locale.',
				benefits: [
					'Mostra il riepilogo istantaneo di costi e chiamate agli strumenti in Studio',
					'Avvia un server web locale con grafici dettagliati se lanciato da CLI',
					'Permette di individuare quali passaggi hanno consumato più risorse'
				],
				examples: [
					{ command: '/stats', note: 'Mostra il resoconto statistico di costi e token della sessione' },
					{ command: '/stats --port 9999', note: 'Avvia la dashboard locale sulla porta specificata' }
				],
				whenToUse: 'Quando vuoi verificare l\'efficienza della conversazione, la spesa stimata e l\'uso dei tool.'
			},
			en: {
				title: 'Stats & Cost',
				summary: 'Report analytical stats on tokens, costs, and tool calls or launch the local stats dashboard.',
				benefits: [
					'Displays instant summary of costs and tool invocations in Studio',
					'Launches a local web dashboard with detailed breakdowns when run via CLI',
					'Helps identify which steps consumed the most context and budget'
				],
				examples: [
					{ command: '/stats', note: 'Report token stats, costs, and tool executions for the session' },
					{ command: '/stats --port 9999', note: 'Launch the local dashboard web server on a specific port' }
				],
				whenToUse: 'When you want to audit conversational efficiency, inspect spend, and review tool frequency.'
			}
		}
	},
	{
		id: 'changelog',
		origin: 'omp',
		category: 'info',
		icon: 'IconHistory',
		control: 'panel',
		supported: [...STATUS_LINE_PLACEMENTS],
		defaultPlacement: null,
		argsHint: '[full|last [N]]',
		text: {
			it: {
				title: 'Novità e changelog',
				summary: 'Apre la finestra delle novità di omp in Studio o mostra le note di rilascio recenti nel terminale.',
				benefits: [
					'Mostra subito le nuove funzionalità, comandi e miglioramenti introdotti',
					'Permette di consultare la cronologia storica completa con l\'argomento full',
					'Filtra per le ultime N versioni con l\'opzione last'
				],
				examples: [
					{ command: '/changelog', note: 'Apre la vista delle novità dell\'ultima release' },
					{ command: '/changelog full', note: 'Mostra l\'intero changelog storico' },
					{ command: '/changelog last 3', note: 'Mostra le modifiche introdotte nelle ultime tre release' }
				],
				whenToUse: 'Dopo un aggiornamento di omp o Studio per scoprire subito comandi, modelli e opzioni nuove.'
			},
			en: {
				title: 'Changelog',
				summary: 'Open the what\'s new window in Studio or display recent release notes in the console.',
				benefits: [
					'Quickly displays new features, commands, and runtime enhancements',
					'Allows browsing complete historical release notes with full',
					'Filters down to the last N releases with the last option'
				],
				examples: [
					{ command: '/changelog', note: 'Open the what\'s new modal for the latest release' },
					{ command: '/changelog full', note: 'Display the complete historical changelog' },
					{ command: '/changelog last 3', note: 'Display release notes for the last three versions' }
				],
				whenToUse: 'After updating omp or Studio to discover newly added commands, models, and features.'
			}
		}
	},
	{
		id: 'context',
		origin: 'omp',
		category: 'context',
		icon: 'IconContextWindow',
		control: 'action',
		supported: [...STATUS_LINE_PLACEMENTS],
		defaultPlacement: null,
		text: {
			it: {
				title: 'Uso del contesto',
				summary: 'Mostra la ripartizione dettagliata dei token che compongono la finestra di contesto attiva.',
				benefits: [
					'Evidenzia quanti token sono occupati da istruzioni, messaggi, tool output e memoria',
					'Aiuta a diagnosticare quando il modello rischia di saturare il limite di contesto',
					'Permette di decidere con cognizione se eseguire /shake o /compact'
				],
				examples: [
					{ command: '/context', note: 'Visualizza la composizione dei token della finestra corrente' }
				],
				whenToUse: 'Quando la sessione diventa lunga e vuoi capire cosa sta occupando maggiormente la finestra del modello.'
			},
			en: {
				title: 'Context Usage',
				summary: 'Display a detailed breakdown of tokens occupying the active model context window.',
				benefits: [
					'Breaks down tokens by system instructions, conversation turns, tool output, and memory',
					'Diagnoses when the session is nearing the model context limit',
					'Helps you decide whether to run /shake or /compact'
				],
				examples: [
					{ command: '/context', note: 'Display the token composition of the current context window' }
				],
				whenToUse: 'When your session grows long and you want to see what is consuming the model\'s window.'
			}
		}
	},
	{
		id: 'fresh',
		origin: 'omp',
		category: 'session',
		icon: 'IconRefresh',
		control: 'action',
		supported: [...STATUS_LINE_PLACEMENTS],
		defaultPlacement: null,
		text: {
			it: {
				title: 'Ripristina stream',
				summary: 'Azzera lo stato dello stream del provider LLM senza alterare la cronologia locale né i file di sessione.',
				benefits: [
					'Sblocca sessioni con cache remota incagliata o token server-side disallineati',
					'Mantiene intatto al 100% il testo della conversazione visibile nel transcript',
					'Assegna un nuovo identificativo di stream al provider per la richiesta successiva'
				],
				examples: [
					{ command: '/fresh', note: 'Reset dello stream provider preservando tutta la cronologia locale' }
				],
				whenToUse: 'Quando il provider LLM restituisce errori di streaming insoliti o sembra bloccato, ma vuoi mantenere tutti i messaggi visibili.'
			},
			en: {
				title: 'Fresh Stream',
				summary: 'Reset provider stream state and remote cache handles without touching local chat history.',
				benefits: [
					'Unwedges stuck remote provider cache states or out-of-sync server sessions',
					'Preserves 100% of visible conversation history and local session files',
					'Issues a fresh stream ID so subsequent turns rebuild cleanly from local context'
				],
				examples: [
					{ command: '/fresh', note: 'Reset provider streaming state while keeping all conversation messages' }
				],
				whenToUse: 'When the provider stream hangs or returns unexpected protocol errors, but you want to keep all visible chat.'
			}
		}
	},
	{
		id: 'compact',
		origin: 'omp',
		category: 'context',
		icon: 'IconSparkles',
		control: 'action',
		supported: [...STATUS_LINE_PLACEMENTS],
		defaultPlacement: null,
		argsHint: '[soft|remote|snapcompact] [focus]',
		text: {
			it: {
				title: 'Compatta contesto',
				summary: 'Sintetizza i messaggi passati sostituendoli con un riassunto sulla stessa sessione per liberare token.',
				benefits: [
					'Abbatte drasticamente i token occupati mantenendo i dettagli recenti e i file toccati',
					'Supporta modalità soft (LLM locale), remote (server Responses API) e snapcompact (immagini)',
					'Accetta istruzioni di focus per guidare su cosa focalizzare il riepilogo'
				],
				examples: [
					{ command: '/compact', note: 'Compatta la conversazione usando la strategia predefinita' },
					{ command: '/compact soft mantieni le decisioni su auth', note: 'Compattazione locale guidata dal focus indicato' },
					{ command: '/compact snapcompact', note: 'Archiviazione deterministica in bitmap senza chiamate LLM' }
				],
				whenToUse: 'Quando la conversazione è molto lunga e vuoi alleggerire il contesto continuando a lavorare sullo stesso task.'
			},
			en: {
				title: 'Compact Context',
				summary: 'Summarize past messages in place to reclaim context window space while staying in the same session.',
				benefits: [
					'Drastically reduces active token count while keeping recent turns and touched files list',
					'Supports soft (local LLM), remote (provider Responses API), and snapcompact (vision bitmap) modes',
					'Accepts custom focus instructions to steer what the summary retains'
				],
				examples: [
					{ command: '/compact', note: 'Compact conversation using the default compaction strategy' },
					{ command: '/compact soft focus on auth decisions', note: 'Local compaction guided by specific instructions' },
					{ command: '/compact snapcompact', note: 'Deterministic image archival without additional LLM summarizer calls' }
				],
				whenToUse: 'When your session is long and you need to free context space while continuing the current task in place.'
			}
		}
	},
	{
		id: 'shake',
		origin: 'omp',
		category: 'context',
		icon: 'IconClear',
		control: 'action',
		supported: [...STATUS_LINE_PLACEMENTS],
		defaultPlacement: null,
		argsHint: '[elide|images|thinking]',
		text: {
			it: {
				title: 'Scuoti contesto',
				summary: 'Rimuove meccanicamente output di tool voluminosi, immagini o blocchi di reasoning a costo zero.',
				benefits: [
					'Istantaneo ed economico: non chiama alcun modello LLM di summarization',
					'Sostituisce output pesanti con riferimenti artifact:// recuperabili all\'occorrenza',
					'Permette di ripulire solo immagini o solo blocchi di reasoning del modello'
				],
				examples: [
					{ command: '/shake', note: 'Rimuove tool result prolissi e blocchi voluminosi (default elide)' },
					{ command: '/shake images', note: 'Elimina le immagini allegate dal contesto attivo' },
					{ command: '/shake thinking', note: 'Rimuove i blocchi di reasoning passati per ridurre i token' }
				],
				whenToUse: 'Quando letture di file giganti, comandi bash verbose o immagini hanno gonfiato il contesto e vuoi sgonfiarlo subito senza riassumere.'
			},
			en: {
				title: 'Shake Context',
				summary: 'Mechanically strip heavy tool outputs, images, or thinking blocks locally with zero model cost.',
				benefits: [
					'Instant and zero-cost: requires no LLM summarization call',
					'Replaces large payloads with recoverable artifact:// pointers',
					'Can selectively target attached images or historical thinking blocks'
				],
				examples: [
					{ command: '/shake', note: 'Elide verbose tool outputs and large content blocks (default)' },
					{ command: '/shake images', note: 'Drop historical attached images from the context' },
					{ command: '/shake thinking', note: 'Drop reasoning thoughts from previous turns to save tokens' }
				],
				whenToUse: 'When large file reads, verbose command runs, or images bloated context and you want an instant zero-cost reduction.'
			}
		}
	},
	{
		id: 'handoff',
		origin: 'omp',
		category: 'context',
		icon: 'IconArrowRight',
		control: 'action',
		supported: [...STATUS_LINE_PLACEMENTS],
		defaultPlacement: null,
		argsHint: '[focus instructions]',
		text: {
			it: {
				title: 'Passaggio consegne',
				summary: 'Genera un documento di passaggio consegne strutturato e compatta la sessione corrente sul posto.',
				benefits: [
					'Crea un report operativo chiaro con stato attuale, decisioni e prossimi passi',
					'Mantiene intatto l\'ID di sessione, la cronologia visibile e la cache del provider',
					'Fornisce al modello un contesto ripulito ottimizzato per iniziare una nuova fase di lavoro'
				],
				examples: [
					{ command: '/handoff', note: 'Genera il documento di passaggio consegne standard e compatta' },
					{ command: '/handoff riassumi lo stato del refactoring UI', note: 'Genera l\'handoff concentrandosi su istruzioni specifiche' }
				],
				whenToUse: 'Quando hai completato una fase di sviluppo o raggiunto un traguardo e vuoi un riepilogo operativo prima di iniziare il passo successivo.'
			},
			en: {
				title: 'Handoff Summary',
				summary: 'Summarize session into a structured handoff document and compact context in place.',
				benefits: [
					'Produces an explicit operational status document with decisions, touched files, and next steps',
					'Preserves session ID, scrollback transcript, and provider prompt cache alignment',
					'Provides the model with clean, structured grounding for the next development milestone'
				],
				examples: [
					{ command: '/handoff', note: 'Generate standard handoff summary and compact in place' },
					{ command: '/handoff summarize UI refactoring progress', note: 'Generate handoff with specific focal instructions' }
				],
				whenToUse: 'When you completed a milestone and want an explicit operational handoff report before tackling the next phase.'
			}
		}
	},
	{
		id: 'pin',
		origin: 'omp',
		category: 'session',
		icon: 'IconPin',
		control: 'action',
		supported: [...STATUS_LINE_PLACEMENTS],
		defaultPlacement: null,
		argsHint: '[session id]',
		text: {
			it: {
				title: 'Fissa sessione',
				summary: 'Fissa o toglie il pin a una sessione per mantenerla in cima alla lista di ripresa.',
				benefits: [
					'Mantiene le sessioni chiave sempre visibili in cima all\'elenco /resume',
					'Se usato senza argomenti, agisce direttamente sulla sessione attiva',
					'Facilita il ritorno rapido a task aperti frequentemente tra progetti diversi'
				],
				examples: [
					{ command: '/pin', note: 'Fissa o toglie il pin alla sessione corrente' },
					{ command: '/pin 019234ab-56cd', note: 'Fissa o toglie il pin alla sessione specificata per ID' }
				],
				whenToUse: 'Quando stai lavorando a un task importante e vuoi ritrovare al volo la sessione nell\'elenco di resume.'
			},
			en: {
				title: 'Pin Session',
				summary: 'Pin or unpin a session at the top of the resume selector list.',
				benefits: [
					'Keeps important sessions prominently pinned at the top of /resume',
					'Toggles pin state on the active session when run without arguments',
					'Makes it easy to jump back into critical long-running sessions'
				],
				examples: [
					{ command: '/pin', note: 'Pin or unpin the active session' },
					{ command: '/pin 019234ab-56cd', note: 'Pin or unpin a specific session by its identifier' }
				],
				whenToUse: 'When you are managing key workstreams and want rapid access in the session picker.'
			}
		}
	},
	{
		id: 'retry',
		origin: 'omp',
		category: 'session',
		icon: 'IconLoop',
		control: 'action',
		supported: [...STATUS_LINE_PLACEMENTS],
		defaultPlacement: null,
		text: {
			it: {
				title: 'Riprova turno',
				summary: 'Ritenta l\'ultimo turno dell\'agente fallito senza dover reinserire il messaggio.',
				benefits: [
					'Rilancia immediatamente la richiesta dopo errori temporanei di rete o del provider LLM',
					'Elimina lo stato di errore precedente ripristinando il flusso della sessione',
					'Evita di dover riscrivere o incollare nuovamente il prompt utente'
				],
				examples: [
					{ command: '/retry', note: 'Ritenta l\'ultimo turno fallito dell\'agente' }
				],
				whenToUse: 'Quando una risposta dell\'agente è fallita per un timeout, errore 503 o disconnessione transitoria.'
			},
			en: {
				title: 'Retry Turn',
				summary: 'Retry the last failed agent turn without re-entering your prompt.',
				benefits: [
					'Instantly reruns the request after transient network or provider 5xx outages',
					'Clears the recorded failure state and restores execution flow',
					'Avoids having to retype or copy-paste your previous prompt'
				],
				examples: [
					{ command: '/retry', note: 'Retry the last failed turn of the agent' }
				],
				whenToUse: 'When a model turn failed due to an API timeout, rate limit burst, or temporary connection drop.'
			}
		}
	},
	{
		id: 'memory',
		origin: 'omp',
		category: 'context',
		icon: 'IconBrain',
		control: 'action',
		supported: [...STATUS_LINE_PLACEMENTS],
		defaultPlacement: null,
		argsHint: '<subcommand>',
		text: {
			it: {
				title: 'Memoria a lungo termine',
				summary: 'Gestisce la memoria persistente di omp: visualizza le lezioni apprese, sincronizza o pulisce i dati.',
				benefits: [
					'Permette di ispezionare ciò che l\'agente ha memorizzato sui progetti con view',
					'Forza la sincronizzazione immediata e la scrittura di MEMORY.md con sync',
					'Consente di azzerare i dati memorizzati in caso di decisioni superate con clear'
				],
				examples: [
					{ command: '/memory view', note: 'Mostra il blocco di memoria attualmente iniettato nel contesto' },
					{ command: '/memory sync', note: 'Avvia immediatamente il processo di consolidamento della memoria' },
					{ command: '/memory clear', note: 'Elimina gli artefatti e i dati di memoria persistiti' }
				],
				whenToUse: 'Quando vuoi verificare le nozioni che l\'agente ha memorizzato del repository o consolidare le lezioni apprese.'
			},
			en: {
				title: 'Long-term Memory',
				summary: 'Manage persistent omp memory: inspect learned lessons, trigger consolidation, or wipe stored artifacts.',
				benefits: [
					'Inspects what background knowledge the agent has retained about the project with view',
					'Forces immediate consolidation into MEMORY.md and learned playbooks with sync',
					'Enables clearing obsolete historical memories when architecture changes with clear'
				],
				examples: [
					{ command: '/memory view', note: 'Display current memory guidance block injected into context' },
					{ command: '/memory sync', note: 'Trigger immediate background memory consolidation pass' },
					{ command: '/memory clear', note: 'Clear persisted memory database rows and markdown artifacts' }
				],
				whenToUse: 'When you want to inspect accumulated project knowledge or synchronize learned conventions.'
			}
		}
	},
	{
		id: 'rename',
		origin: 'omp',
		category: 'session',
		icon: 'IconRename',
		control: 'action',
		supported: [...STATUS_LINE_PLACEMENTS],
		defaultPlacement: null,
		argsHint: '[title]',
		text: {
			it: {
				title: 'Rinomina sessione',
				summary: 'Assegna un nuovo titolo alla sessione corrente oppure ne genera uno automatico dal contesto.',
				benefits: [
					'Rende la sessione facilmente riconoscibile nell\'elenco storico e nei fork',
					'Se lanciato senza titolo, omp sintetizza un nome appropriato dalla conversazione',
					'Aggiorna immediatamente il titolo mostrato nell\'intestazione di Studio'
				],
				examples: [
					{ command: '/rename', note: 'Genera un titolo automatico basato sui contenuti della chat' },
					{ command: '/rename Refactoring store Svelte 5', note: 'Imposta manualmente il titolo indicato' }
				],
				whenToUse: 'Quando una sessione iniziata come test diventa importante e vuoi darle un nome chiaro per ritrovarla.'
			},
			en: {
				title: 'Rename Session',
				summary: 'Rename active session with a custom title or auto-generate one from conversation contents.',
				benefits: [
					'Makes sessions quickly identifiable in history trees and resume pickers',
					'Automatically synthesizes a relevant title when invoked without arguments',
					'Instantly updates the visible title across Studio navigation bars'
				],
				examples: [
					{ command: '/rename', note: 'Auto-generate a session title based on conversation content' },
					{ command: '/rename Svelte 5 store refactoring', note: 'Set a custom explicit title for the session' }
				],
				whenToUse: 'When a quick exploratory chat turns into an important task and needs a recognizable name.'
			}
		}
	},
	{
		id: 'move',
		origin: 'omp',
		category: 'session',
		icon: 'IconFolderOpen',
		control: 'action',
		supported: [...STATUS_LINE_PLACEMENTS],
		defaultPlacement: null,
		argsHint: '[<path>]',
		text: {
			it: {
				title: 'Sposta sessione',
				summary: 'Sposta la cartella di lavoro della sessione corrente preservando l\'intera cronologia della conversazione.',
				benefits: [
					'Cambia la directory di esecuzione senza dover ricominciare una nuova sessione da zero',
					'Aggiorna percorsi relativi, tool di filesystem e impostazioni di progetto contestuali',
					'Chiede conferma se la cartella di destinazione non esiste ancora'
				],
				examples: [
					{ command: '/move ../altro-progetto', note: 'Trasferisce la sessione alla directory specificata' }
				],
				whenToUse: 'Quando hai avviato omp nella directory sbagliata o vuoi continuare la conversazione su un repository clonato.'
			},
			en: {
				title: 'Move Session',
				summary: 'Relocate the working directory of the current session while preserving all conversation context.',
				benefits: [
					'Switches active project root without having to restart a conversation from scratch',
					'Re-anchors relative file tools, settings, and workspace discovery dynamically',
					'Safely validates or creates destination directories before migrating'
				],
				examples: [
					{ command: '/move ../other-project', note: 'Migrate the current session to the specified directory' }
				],
				whenToUse: 'When you started omp in the wrong directory or want to continue working inside a newly cloned project.'
			}
		}
	},
	{
		id: 'wt',
		origin: 'omp',
		category: 'workspace',
		icon: 'IconGitBranch',
		control: 'action',
		supported: [...STATUS_LINE_PLACEMENTS],
		defaultPlacement: null,
		argsHint: '[<branch>]',
		text: {
			it: {
				title: 'Nuovo worktree Git',
				summary: 'Sposta la sessione in un nuovo worktree Git isolato, trasferendo con sé tutte le modifiche correnti.',
				benefits: [
					'Isola esperimenti complessi in un ramo Git dedicato senza intaccare il branch principale',
					'Porta automaticamente nel nuovo worktree i file modificati e non ancora committati',
					'Crea un nuovo branch se specificato, evitando conflitti con l\'albero di lavoro'
				],
				examples: [
					{ command: '/wt', note: 'Crea un worktree con nome generato automaticamente e vi sposta la sessione' },
					{ command: '/wt feature-auth', note: 'Crea il worktree sul nuovo branch feature-auth e migra la sessione' }
				],
				whenToUse: 'Quando vuoi testare modifiche invasive o refactoring senza rischiare di rompere il branch principale di lavoro.'
			},
			en: {
				title: 'Git Worktree',
				summary: 'Move this session into a new isolated Git worktree, carrying uncommitted changes along.',
				benefits: [
					'Isolates risky experimental changes on a dedicated branch without disturbing your main tree',
					'Automatically carries dirty uncommitted changes into the new worktree',
					'Creates a fresh target branch on the fly, eliminating working tree conflicts'
				],
				examples: [
					{ command: '/wt', note: 'Create an auto-named worktree and migrate the session into it' },
					{ command: '/wt feature-auth', note: 'Create a worktree on branch feature-auth and switch session there' }
				],
				whenToUse: 'When you want to run invasive refactoring or experiments without touching your current git working tree.'
			}
		}
	},
	{
		id: 'add-dir',
		origin: 'omp',
		category: 'workspace',
		icon: 'IconFolderPlus',
		control: 'action',
		supported: [...STATUS_LINE_PLACEMENTS],
		defaultPlacement: null,
		argsHint: '<path>',
		text: {
			it: {
				title: 'Aggiungi cartella workspace',
				summary: 'Aggiunge una directory supplementare alla sessione consentendo all\'agente di esplorarne i file.',
				benefits: [
					'Consente a strumenti come glob, grep e read di accedere a directory esterne al progetto principale',
					'Ideale per scenari multi-repo, librerie condivise o documentazione di riferimento',
					'Non richiede di spostare né copiare i file nel repository primario'
				],
				examples: [
					{ command: '/add-dir ../shared-types', note: 'Aggiunge la cartella dei tipi condivisi al perimetro dell\'agente' },
					{ command: '/add-dir /var/log/app', note: 'Permette all\'agente di consultare i log in una cartella esterna' }
				],
				whenToUse: 'Quando il codice su cui lavori fa riferimento a librerie, schemi o documentazione situati in un\'altra cartella.'
			},
			en: {
				title: 'Add Workspace Directory',
				summary: 'Add an additional workspace directory to this session, granting the agent file access.',
				benefits: [
					'Allows tools like glob, grep, and read to reach directories outside the primary project root',
					'Ideal for multi-repository architectures, shared packages, or external documentation',
					'Avoids copying or symlinking external files into your primary repository'
				],
				examples: [
					{ command: '/add-dir ../shared-types', note: 'Include shared types package in agent search boundary' },
					{ command: '/add-dir /var/log/app', note: 'Allow agent to inspect logs in an external directory' }
				],
				whenToUse: 'When your code depends on external libraries, schemas, or docs located in a separate directory.'
			}
		}
	},
	{
		id: 'remove-dir',
		origin: 'omp',
		category: 'workspace',
		icon: 'IconTrash',
		control: 'action',
		supported: [...STATUS_LINE_PLACEMENTS],
		defaultPlacement: null,
		argsHint: '<path>',
		text: {
			it: {
				title: 'Rimuovi cartella workspace',
				summary: 'Rimuove una directory secondaria precedentemente registrata dall\'accesso dell\'agente.',
				benefits: [
					'Ripristina il confine di lavoro ed esclude cartelle non più pertinenti',
					'Riduce il rumore e velocizza ricerche glob e grep sul workspace',
					'Non elimina alcun file su disco: revoca solo l\'accesso dell\'agente'
				],
				examples: [
					{ command: '/remove-dir ../shared-types', note: 'Rimuove la directory secondaria dal workspace della sessione' }
				],
				whenToUse: 'Quando hai completato l\'analisi su una libreria o cartella esterna e vuoi restringere il perimetro di ricerca.'
			},
			en: {
				title: 'Remove Workspace Directory',
				summary: 'Remove an external workspace directory from the active session\'s allowed scope.',
				benefits: [
					'Restores tight workspace boundaries and unlinks auxiliary paths',
					'Reduces noise and speeds up glob/grep codebase searches',
					'Does not delete any files on disk: simply revokes agent visibility'
				],
				examples: [
					{ command: '/remove-dir ../shared-types', note: 'Remove external folder from the active session workspace' }
				],
				whenToUse: 'When you are done inspecting external files and want to narrow agent search scope back to main repo.'
			}
		}
	},
	{
		id: 'dirs',
		origin: 'omp',
		category: 'workspace',
		icon: 'IconFolder',
		control: 'action',
		supported: [...STATUS_LINE_PLACEMENTS],
		defaultPlacement: null,
		text: {
			it: {
				title: 'Elenco cartelle workspace',
				summary: 'Elenca tutte le cartelle di lavoro attive e autorizzate per la sessione corrente.',
				benefits: [
					'Mostra con chiarezza la directory principale e tutte le cartelle secondarie registrate',
					'Aiuta a verificare quali percorsi gli strumenti di lettura e ricerca possono esplorare',
					'Fornisce un quadro immediato della configurazione multi-directory attiva'
				],
				examples: [
					{ command: '/dirs', note: 'Elenca la cartella di lavoro principale e tutte le cartelle aggiunte' }
				],
				whenToUse: 'Quando vuoi controllare quali cartelle sono attualmente visibili all\'agente prima di lanciare ricerche.'
			},
			en: {
				title: 'List Workspace Directories',
				summary: 'List all workspace directories currently registered and accessible to this session.',
				benefits: [
					'Displays the primary project root alongside all attached secondary directories',
					'Helps verify which paths can be targeted by glob, grep, and read tools',
					'Provides an instant overview of your multi-directory session configuration'
				],
				examples: [
					{ command: '/dirs', note: 'List the active root directory and all supplementary folders' }
				],
				whenToUse: 'When you want to verify what folders the agent has access to before executing broad searches.'
			}
		}
	},
	{
		id: 'marketplace',
		origin: 'omp',
		category: 'extensions',
		icon: 'IconGlobe',
		control: 'action',
		supported: [...STATUS_LINE_PLACEMENTS],
		defaultPlacement: null,
		argsHint: '<subcommand>',
		text: {
			it: {
				title: 'Marketplace plugin',
				summary: 'Gestisce l\'installazione, aggiornamento e scoperta di plugin da sorgenti e registri compatibili.',
				benefits: [
					'Compatibile con i cataloghi e plugin ufficiali di Claude Code e OMP',
					'Supporta installazioni a livello utente (globale) o legate allo specifico progetto',
					'Permette di aggiungere marketplace GitHub o cartelle locali con un semplice comando'
				],
				examples: [
					{ command: '/marketplace discover', note: 'Sfoglia i plugin disponibili nei marketplace registrati' },
					{ command: '/marketplace install code-review@claude-plugins-official', note: 'Installa il plugin specificato' },
					{ command: '/marketplace update', note: 'Aggiorna i cataloghi dei marketplace configurati' }
				],
				whenToUse: 'Quando vuoi estendere le capacità di omp con nuovi agenti, strumenti, server MCP o skill della community.'
			},
			en: {
				title: 'Plugin Marketplace',
				summary: 'Manage plugin discovery, installation, and updates from Git and marketplace registries.',
				benefits: [
					'Compatible with both Claude Code and native OMP plugin catalog formats',
					'Supports installing at user scope (all projects) or project scope (current repo)',
					'Enables adding Git repositories or local directory marketplaces easily'
				],
				examples: [
					{ command: '/marketplace discover', note: 'Browse plugins available across configured marketplaces' },
					{ command: '/marketplace install code-review@claude-plugins-official', note: 'Install a designated plugin' },
					{ command: '/marketplace update', note: 'Refresh all configured marketplace catalogs' }
				],
				whenToUse: 'When you want to extend omp with community tools, MCP integrations, task agents, or skills.'
			}
		}
	},
	{
		id: 'plugins',
		origin: 'omp',
		category: 'extensions',
		icon: 'IconPlug',
		control: 'action',
		supported: [...STATUS_LINE_PLACEMENTS],
		defaultPlacement: null,
		argsHint: '[list|enable|disable]',
		text: {
			it: {
				title: 'Gestione plugin',
				summary: 'Elenca, abilita o disabilita i plugin installati tramite npm o marketplace.',
				benefits: [
					'Mostra una panoramica chiara di tutti i plugin attivi e disattivati',
					'Consente di disattivare temporaneamente estensioni problematiche senza disinstallarle',
					'Supporta selettori di scope per gestire plugin di progetto o globali utente'
				],
				examples: [
					{ command: '/plugins list', note: 'Elenca tutti i plugin installati e il loro stato di attivazione' },
					{ command: '/plugins disable helper@official', note: 'Disabilita il plugin specificato' },
					{ command: '/plugins enable helper@official', note: 'Riabilita il plugin specificato' }
				],
				whenToUse: 'Quando vuoi verificare quali estensioni sono attive o isolare un plugin che causa conflitti.'
			},
			en: {
				title: 'Manage Plugins',
				summary: 'List, enable, or disable installed plugins across npm links and marketplace sources.',
				benefits: [
					'Provides a clear status overview of all installed and active plugins',
					'Temporarily disables conflicting extensions without requiring uninstallation',
					'Supports scope flags to manage user-wide or project-specific plugin states'
				],
				examples: [
					{ command: '/plugins list', note: 'List all installed plugins and their current status' },
					{ command: '/plugins disable helper@official', note: 'Disable a specific installed plugin' },
					{ command: '/plugins enable helper@official', note: 'Re-enable a previously disabled plugin' }
				],
				whenToUse: 'When you need to audit active extensions or troubleshoot an issue by toggling plugins off.'
			}
		}
	},
	{
		id: 'reload-plugins',
		origin: 'omp',
		category: 'extensions',
		icon: 'IconRefresh',
		control: 'action',
		supported: [...STATUS_LINE_PLACEMENTS],
		defaultPlacement: null,
		text: {
			it: {
				title: 'Ricarica plugin',
				summary: 'Ricarica a caldo tutti i plugin abilitati senza dover riavviare il processo di omp.',
				benefits: [
					'Aggiorna immediatamente comandi slash, agenti, skill e configurazioni MCP',
					'Evita di dover chiudere e riaprire la sessione dopo modifiche ai file dei plugin',
					'Invalida le cache di discovery riallineando il runtime allo stato su disco'
				],
				examples: [
					{ command: '/reload-plugins', note: 'Ricarica tutti i plugin e ne aggiorna le capacità nel runtime' }
				],
				whenToUse: 'Dopo aver installato, rimosso o modificato il codice di un plugin locale per applicare subito i cambiamenti.'
			},
			en: {
				title: 'Reload Plugins',
				summary: 'Hot-reload all enabled plugins and their capabilities without restarting omp.',
				benefits: [
					'Immediately refreshes custom slash commands, sub-agents, skills, and MCP definitions',
					'Eliminates the need to restart your session after updating plugin files',
					'Invalidates cached discovery trees to match updated on-disk package files'
				],
				examples: [
					{ command: '/reload-plugins', note: 'Reload all plugins and synchronize capabilities into the session' }
				],
				whenToUse: 'After installing, removing, or developing plugin code to apply changes immediately.'
			}
		}
	},
	{
		id: 'force',
		origin: 'omp',
		category: 'tools',
		icon: 'IconTarget',
		control: 'action',
		supported: [...STATUS_LINE_PLACEMENTS],
		defaultPlacement: null,
		argsHint: '<tool-name> [prompt]',
		text: {
			it: {
				title: 'Forza strumento',
				summary: 'Costringe il turno successivo dell\'agente a invocare obbligatoriamente uno specifico strumento.',
				benefits: [
					'Garantisce che il modello esegua subito l\'azione richiesta anziché rispondere solo a parole',
					'Permette di abbinare un prompt o istruzioni aggiuntive alla chiamata dello strumento',
					'Supporta qualsiasi tool registrato, inclusi bash, edit, read, web_search o strumenti MCP'
				],
				examples: [
					{ command: '/force web_search novità Svelte 5 runes', note: 'Costringe l\'agente a cercare sul web prima di rispondere' },
					{ command: '/force bash npm run build', note: 'Forza l\'esecuzione immediata del comando bash indicato' }
				],
				whenToUse: 'Quando il modello esita o risponde teoricamente e vuoi obbligarlo a usare direttamente uno strumento.'
			},
			en: {
				title: 'Force Tool',
				summary: 'Force the agent\'s next conversational turn to execute a designated tool call.',
				benefits: [
					'Guarantees the model invokes the required tool rather than providing prose answers',
					'Allows pairing additional instructions or search terms with the forced execution',
					'Works with any registered tool, including bash, edit, read, web_search, or MCP tools'
				],
				examples: [
					{ command: '/force web_search Svelte 5 runes updates', note: 'Force agent to execute a web search before answering' },
					{ command: '/force bash npm run build', note: 'Force immediate execution of the specified bash build command' }
				],
				whenToUse: 'When the model is hesitating or explaining instead of performing an action, forcing tool execution.'
			}
		}
	}
];
