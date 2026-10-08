// Voci del catalogo per i comandi slash nativi di OMP Studio (16 comandi guscio).
//
// Questi comandi vengono intercettati localmente dal guscio GUI di Studio
// (in handleGuiSlashCommand) e non sono builtin inoltrati a omp via RPC.
// I comandi slash di Studio che collidono con builtin omp (come model, usage,
// switch, changelog, compact, handoff) sono esclusi da qui e gestiti con origin
// 'omp' nei rispettivi file del manifesto.
//
// Nessun comando del guscio ha defaultPlacement attivo: di fabbrica restano
// non fissati e possono essere aggiunti dall'utente alla riga di stato (statusLine).

import type { CommandManifestEntry } from '../types';

export const STUDIO_ENTRIES: readonly CommandManifestEntry[] = [
	{
		id: 'new',
		origin: 'studio',
		category: 'session',
		icon: 'IconNewChat',
		control: 'action',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		text: {
			it: {
				title: 'Nuova sessione',
				summary: 'Azzera la chat corrente e avvia una nuova sessione pulita nello stesso progetto.',
				benefits: [
					'Riparte immediatamente con una finestra di contesto completamente sgombra.',
					'Conserva la sessione precedente nello storico archiviato senza perdere dati.',
					'Isola un nuovo problema evitando che il modello sia influenzato da messaggi passati.'
				],
				examples: [
					{
						command: '/new',
						note: 'Crea e apre una nuova sessione vuota nella corsia attiva'
					},
					{
						command: '/clear',
						note: 'Alias equivalente per resettare la conversazione corrente'
					}
				],
				whenToUse:
					'Quando inizi un’attività del tutto slegata da quella precedente e desideri partire da zero con il contesto.'
			},
			en: {
				title: 'New session',
				summary: 'Clears the current chat and starts a fresh, clean session within the active project.',
				benefits: [
					'Immediately begins with an entirely empty context window.',
					'Preserves the previous conversation in the archived sessions history.',
					'Isolates a new topic so prior turn history does not bias model responses.'
				],
				examples: [
					{
						command: '/new',
						note: 'Creates and switches to a fresh empty session in the active lane'
					},
					{
						command: '/clear',
						note: 'Equivalent alias to reset the active conversation'
					}
				],
				whenToUse:
					'When moving on to an entirely new task and wanting a completely clean slate.'
			}
		}
	},
	{
		id: 'resume',
		origin: 'studio',
		category: 'session',
		icon: 'IconHistory',
		control: 'panel',
		supported: [{ zone: 'statusLine', form: 'chip' }],
		defaultPlacement: null,
		argsHint: '[id]',
		text: {
			it: {
				title: 'Riprendi sessione',
				summary: 'Riapre una sessione precedente indicandone l’ID o apre l’elenco dello storico delle sessioni.',
				benefits: [
					'Recupera istantaneamente una conversazione precedente con messaggi e stato intatti.',
					'Senza argomenti apre direttamente il pannello delle sessioni salvate nella barra laterale.',
					'Permette di continuare un’analisi o una revisione interrotta in precedenza.'
				],
				examples: [
					{
						command: '/resume',
						note: 'Apre il pannello laterale con l’elenco di tutte le sessioni del progetto'
					},
					{
						command: '/resume ses_123abc',
						note: 'Carica direttamente la sessione con l’identificativo indicato'
					},
					{
						command: '/sessions',
						note: 'Alias equivalente: apre l’elenco delle sessioni del progetto'
					}
				],
				whenToUse:
					'Quando vuoi riprendere una conversazione precedente interrotta o consultare lo storico delle sessioni archiviate.'
			},
			en: {
				title: 'Resume session',
				summary: 'Resumes a previous session by identifier or opens the saved session history panel.',
				benefits: [
					'Instantly restores a previous conversation with full message history and state.',
					'Without arguments, opens the sessions panel in the left sidebar.',
					'Allows continuing earlier work or reviewing past technical decisions.'
				],
				examples: [
					{
						command: '/resume',
						note: 'Opens the sidebar panel listing all project sessions'
					},
					{
						command: '/resume ses_123abc',
						note: 'Directly switches to and loads the session with the specified ID'
					},
					{
						command: '/sessions',
						note: 'Equivalent alias: opens the project session list'
					}
				],
				whenToUse:
					'When resuming an earlier conversation or browsing past discussions stored in the project.'
			}
		}
	},
	{
		id: 'thinking',
		origin: 'studio',
		category: 'models',
		icon: 'IconBrain',
		control: 'picker',
		supported: [{ zone: 'statusLine', form: 'chip' }],
		defaultPlacement: null,
		argsHint: '<livello>',
		text: {
			it: {
				title: 'Sforzo di ragionamento',
				summary: 'Imposta il livello di ragionamento (thinking) del modello: off, minimal, low, medium, high, xhigh, max. Si imposta anche dalla barra del composer.',
				benefits: [
					'Regola rapidamente lo sforzo logico del modello da tastiera senza aprire menu.',
					'Permette di azzerare la latenza impostando off o massimizzare la profondità deduttiva con high/max.',
					'Sincronizzato in tempo reale con l’indicatore thinking presente nel composer.'
				],
				examples: [
					{
						command: '/thinking high',
						note: 'Imposta il livello di ragionamento su high per riflessioni approfondite'
					},
					{
						command: '/reasoning off',
						note: 'Disattiva il ragionamento per velocizzare le risposte e ridurre i token'
					}
				],
				whenToUse:
					'Quando vuoi regolare lo sforzo di ragionamento via comando slash; si imposta anche dalla barra del composer cliccando sul chip thinking.'
			},
			en: {
				title: 'Thinking effort',
				summary: 'Sets model reasoning effort (thinking): off, minimal, low, medium, high, xhigh, max. Can also be set directly from the composer toolbar.',
				benefits: [
					'Quickly adjusts reasoning depth straight from the keyboard without opening popovers.',
					'Eliminates reasoning latency by setting off, or maximizes deductive power with high/max.',
					'Stays perfectly in sync with the thinking control displayed in the composer.'
				],
				examples: [
					{
						command: '/thinking high',
						note: 'Sets reasoning effort to high for in-depth logical deductions'
					},
					{
						command: '/reasoning off',
						note: 'Disables reasoning to speed up answers and conserve tokens'
					}
				],
				whenToUse:
					'When adjusting model thinking effort from the keyboard; can also be configured via the composer toolbar thinking chip.'
			}
		}
	},
	{
		id: 'role',
		origin: 'studio',
		category: 'models',
		icon: 'IconRoleDefault',
		control: 'picker',
		supported: [{ zone: 'statusLine', form: 'chip' }],
		defaultPlacement: null,
		argsHint: '[default|plan|smol|slow|vision|task|commit|advisor|next]',
		text: {
			it: {
				title: 'Ruolo modello',
				summary: 'Attiva un ruolo configurato (default, plan, smol, slow, vision, task, commit, advisor) o ne scorre la sequenza. Si imposta anche dalla barra del composer.',
				benefits: [
					'Cambia al volo modello e parametri ottimali per pianificare, codificare o revisionare.',
					'Con l’argomento "next" scorre rapidamente al ruolo successivo della sequenza ciclica.',
					'Senza argomenti apre la finestra di dialogo per gestire le associazioni dei ruoli.'
				],
				examples: [
					{
						command: '/role plan',
						note: 'Attiva il ruolo architectural plan con il modello associato'
					},
					{
						command: '/role next',
						note: 'Passa al prossimo ruolo configurato nella sequenza ciclica'
					},
					{
						command: '/role',
						note: 'Apre il dialogo delle impostazioni ruoli'
					}
				],
				whenToUse:
					'Quando vuoi cambiare il profilo del modello via tastiera; si imposta anche dalla barra del composer cliccando sul selettore del ruolo.'
			},
			en: {
				title: 'Model role',
				summary: 'Activates a configured role (default, plan, smol, slow, vision, task, commit, advisor) or cycles to next. Can also be set directly from the composer toolbar.',
				benefits: [
					'Instantly adopts optimal model settings for planning, implementation, or code review.',
					'Use "/role next" to swiftly cycle through configured roles.',
					'Without arguments, opens the role configuration dialog.'
				],
				examples: [
					{
						command: '/role plan',
						note: 'Activates architectural planning role with its designated model'
					},
					{
						command: '/role next',
						note: 'Cycles to the next configured role in the sequence'
					},
					{
						command: '/role',
						note: 'Opens the role management modal dialog'
					}
				],
				whenToUse:
					'When switching operational profiles from the keyboard; can also be selected from the composer toolbar role chip.'
			}
		}
	},
	{
		id: 'name',
		origin: 'studio',
		category: 'session',
		icon: 'IconRename',
		control: 'none',
		supported: [],
		defaultPlacement: null,
		argsHint: '<titolo>',
		text: {
			it: {
				title: 'Rinomina sessione',
				summary: 'Assegna un titolo personalizzato alla sessione attiva per riconoscerla nello storico.',
				benefits: [
					'Sostituisce il titolo automatico con una descrizione parlante dell’obiettivo.',
					'Facilita la ricerca e l’organizzazione delle conversazioni archiviate nel progetto.',
					'Permette di rintracciare rapidamente decisioni o esperimenti a distanza di tempo.'
				],
				examples: [
					{
						command: '/name Refactoring store comandi',
						note: 'Imposta il titolo della sessione corrente'
					},
					{
						command: '/rename Bugfix caricamento layout',
						note: 'Alias equivalente per rinominare la sessione attiva'
					}
				],
				whenToUse:
					'Quando una sessione assume un perimetro ben definito e vuoi darle un nome chiaro prima di archiviarla o riprenderla.'
			},
			en: {
				title: 'Rename session',
				summary: 'Assigns a custom descriptive title to the active session for easier identification in history.',
				benefits: [
					'Replaces auto-generated headings with an accurate task title.',
					'Makes searching and organizing archived conversations in the project effortless.',
					'Allows quick retrieval of architectural decisions and previous experiments.'
				],
				examples: [
					{
						command: '/name Command store refactoring',
						note: 'Sets the title for the active session'
					},
					{
						command: '/rename Layout loading bugfix',
						note: 'Equivalent alias to rename the active session'
					}
				],
				whenToUse:
					'When a conversation reaches a concrete milestone and deserves an identifiable name for future reference.'
			}
		}
	},
	{
		id: 'cost',
		origin: 'studio',
		category: 'info',
		icon: 'IconQuota',
		control: 'action',
		supported: [{ zone: 'statusLine', form: 'chip' }],
		defaultPlacement: null,
		text: {
			it: {
				title: 'Statistiche e costi',
				summary: 'Stampa nel transcript il resoconto completo dei token, delle chiamate a strumenti e dei costi della sessione. Si visualizza anche dalla riga di stato del composer.',
				benefits: [
					'Fornisce la scomposizione dettagliata dei token di input, output e cache per la sessione.',
					'Evidenzia il costo monetario totale in dollari e la quota attribuita ai subagenti delegati.',
					'Aiuta a valutare l’efficienza economica dei diversi modelli utilizzati.'
				],
				examples: [
					{
						command: '/cost',
						note: 'Stampa nel transcript il riepilogo statistico di token e costi maturati'
					},
					{
						command: '/stats',
						note: 'Alias equivalente per visualizzare i consumi della sessione'
					}
				],
				whenToUse:
					'Quando vuoi verificare la spesa economica e i volumi di token elaborati; la spesa complessiva è visibile anche in tempo reale nel chip ctl.cost della riga di stato.'
			},
			en: {
				title: 'Stats and cost',
				summary: 'Prints a full statistical breakdown of tokens, tool calls, and monetary costs for the session into chat. Can also be viewed on the composer status line.',
				benefits: [
					'Provides detailed token counts for input, output, and cache warming.',
					'Highlights total monetary cost in USD and splits expenses incurred by delegated subagents.',
					'Helps benchmark cost efficiency across different language models.'
				],
				examples: [
					{
						command: '/cost',
						note: 'Prints detailed token counts and financial metrics to the chat transcript'
					},
					{
						command: '/stats',
						note: 'Equivalent alias to inspect session consumption'
					}
				],
				whenToUse:
					'When auditing financial expense or token volumes; overall cost is also displayed live on the composer status line ctl.cost chip.'
			}
		}
	},
	{
		id: 'git',
		origin: 'studio',
		category: 'workspace',
		icon: 'IconGitBranch',
		control: 'panel',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		text: {
			it: {
				title: 'Pannello Git',
				summary: 'Apre la vista Git nella barra laterale per esaminare lo stato del repository, i file modificati e i diff.',
				benefits: [
					'Controllo immediato delle modifiche pendenti apportate dall’assistente.',
					'Ispezione visiva delle differenze riga per riga prima del salvataggio o commit.',
					'Gestione di stage, commit e sincronizzazione del branch senza lasciare l’app.'
				],
				examples: [
					{
						command: '/git',
						note: 'Apre il pannello Git nella barra laterale sinistra'
					},
					{
						command: '/branch',
						note: 'Alias equivalente per accedere al controllo di versione'
					}
				],
				whenToUse:
					'Quando vuoi verificare quali file sono stati modificati dall’agente o preparare un commit pulito.'
			},
			en: {
				title: 'Git panel',
				summary: 'Opens the Git view in the sidebar to inspect repository status, changed files, and diffs.',
				benefits: [
					'Instantly check pending changes introduced by the coding assistant.',
					'Inspect line-by-line diffs before staging or committing.',
					'Stage, commit, and sync branches without leaving the application.'
				],
				examples: [
					{
						command: '/git',
						note: 'Opens the Git panel in the left sidebar'
					},
					{
						command: '/branch',
						note: 'Equivalent alias to open version control view'
					}
				],
				whenToUse:
					'When reviewing edits made by the agent or preparing a git commit.'
			}
		}
	},
	{
		id: 'settings',
		origin: 'studio',
		category: 'app',
		icon: 'IconSettings',
		control: 'panel',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		text: {
			it: {
				title: 'Impostazioni modelli',
				summary: 'Apre la finestra di configurazione per gestire modelli, provider di IA, chiavi API e ruoli.',
				benefits: [
					'Configurazione centralizzata di provider cloud (Anthropic, OpenAI, OpenRouter) e locali (Ollama).',
					'Personalizzazione delle chiavi API, modelli predefiniti e sequenze di cicli.',
					'Accesso rapido a test di connessione e diagnostica dei provider.'
				],
				examples: [
					{
						command: '/settings',
						note: 'Apre il dialogo delle impostazioni modelli'
					},
					{
						command: '/setup',
						note: 'Alias per accedere alla configurazione dei provider'
					}
				],
				whenToUse:
					'Quando devi registrare nuove chiavi API, attivare modelli o personalizzare i ruoli di intelligenza artificiale.'
			},
			en: {
				title: 'Model settings',
				summary: 'Opens the settings modal to configure AI models, providers, API keys, and roles.',
				benefits: [
					'Centralized management of cloud providers (Anthropic, OpenAI, OpenRouter) and local endpoints (Ollama).',
					'Customization of API credentials, default model roles, and cycle ordering.',
					'Instant access to connectivity testing and provider diagnostics.'
				],
				examples: [
					{
						command: '/settings',
						note: 'Opens the model configuration modal dialog'
					},
					{
						command: '/setup',
						note: 'Alias to configure providers and credentials'
					}
				],
				whenToUse:
					'When adding API keys, configuring new models, or adjusting role assignments.'
			}
		}
	},
	{
		id: 'terminal',
		origin: 'studio',
		category: 'workspace',
		icon: 'IconTerminal',
		control: 'action',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		text: {
			it: {
				title: 'Terminale integrato',
				summary: 'Passa alla superficie del terminale integrato (TUI) per interagire direttamente con la shell del progetto.',
				benefits: [
					'Accesso istantaneo alla shell di sistema nella cartella del progetto attivo.',
					'Permette di lanciare build, test unitari o comandi interattivi direttamente.',
					'Mantiene lo stato del processo attivo durante il passaggio tra chat e terminale.'
				],
				examples: [
					{
						command: '/terminal',
						note: 'Passa alla visualizzazione del terminale per il progetto corrente'
					}
				],
				whenToUse:
					'Quando devi eseguire comandi shell diretti, lanciare script di compilazione o ispezionare processi attivi.'
			},
			en: {
				title: 'Integrated terminal',
				summary: 'Switches to the integrated terminal surface (TUI) for direct shell interaction in the project.',
				benefits: [
					'Immediate access to your system shell located in the active project directory.',
					'Run build scripts, test suites, or interactive commands directly.',
					'Preserves terminal process state when alternating between chat and terminal.'
				],
				examples: [
					{
						command: '/terminal',
						note: 'Switches to the terminal surface for the active project'
					}
				],
				whenToUse:
					'When executing direct shell commands, launching test runners, or monitoring terminal tools.'
			}
		}
	},
	{
		id: 'help',
		origin: 'studio',
		category: 'info',
		icon: 'IconAsk',
		control: 'action',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		text: {
			it: {
				title: 'Guida comandi',
				summary: 'Mostra nella chat l’elenco dei comandi slash supportati e le scorciatoie disponibili nel guscio GUI.',
				benefits: [
					'Panoramica rapida dei comandi disponibili senza dover consultare la documentazione esterna.',
					'Elenca sintassi, parametri opzionali e scorciatoie da tastiera.',
					'Informa su come interagire con ruoli, modelli e cronologia.'
				],
				examples: [
					{
						command: '/help',
						note: 'Mostra la guida ai comandi slash e alle scorciatoie nella chat'
					}
				],
				whenToUse:
					'Quando hai dubbi sulla sintassi esatta di un comando o desideri scoprire le funzioni disponibili.'
			},
			en: {
				title: 'Command help',
				summary: 'Displays reference list of supported slash commands and keyboard shortcuts in the GUI chat.',
				benefits: [
					'Quick in-app reference for all available commands without consulting external docs.',
					'Lists command syntax, optional parameters, and keyboard shortcuts.',
					'Explains how to interact with models, roles, and session history.'
				],
				examples: [
					{
						command: '/help',
						note: 'Prints the command and shortcut guide into the active chat'
					}
				],
				whenToUse:
					'When checking exact slash command syntax or exploring available features and keybindings.'
			}
		}
	},
	{
		id: 'login',
		origin: 'studio',
		category: 'app',
		icon: 'IconKey',
		control: 'panel',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		argsHint: '[provider]',
		text: {
			it: {
				title: 'Credenziali provider',
				summary: 'Apre la configurazione dei provider di modelli e credenziali; con un argomento apre direttamente quel provider.',
				benefits: [
					'Permette di impostare o aggiornare chiavi API e credenziali in tutta sicurezza.',
					'Inserendo il nome del provider (es. anthropic, openai) apre direttamente la scheda desiderata.',
					'Verifica immediatamente la validità delle credenziali inserite.'
				],
				examples: [
					{
						command: '/login',
						note: 'Apre la schermata di gestione provider e credenziali'
					},
					{
						command: '/login anthropic',
						note: 'Apre direttamente la scheda di configurazione del provider Anthropic'
					}
				],
				whenToUse:
					'Quando configuri un nuovo account o quando devi aggiornare una chiave API scaduta o revocata.'
			},
			en: {
				title: 'Provider login',
				summary: 'Opens the AI provider credentials modal; jumps directly to a provider if specified as argument.',
				benefits: [
					'Securely manage and update API keys and provider credentials.',
					'Passing a provider name (e.g. anthropic, openai) opens its tab directly.',
					'Instantly test and verify credentials validity.'
				],
				examples: [
					{
						command: '/login',
						note: 'Opens provider credentials dialog'
					},
					{
						command: '/login anthropic',
						note: 'Opens configuration tab for Anthropic directly'
					}
				],
				whenToUse:
					'When configuring a new AI account or renewing expired or rotated API credentials.'
			}
		}
	},
	{
		id: 'copy',
		origin: 'studio',
		category: 'session',
		icon: 'IconCopy',
		control: 'action',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		text: {
			it: {
				title: 'Copia trascrizione',
				summary: 'Copia negli appunti l’intera conversazione della sessione corrente in formato testo pulito.',
				benefits: [
					'Esporta con un solo clic tutti i messaggi dell’utente e dell’assistente.',
					'Include blocchi di testo, pensiero (thinking) e avvisi formattati in modo leggibile.',
					'Evita la selezione manuale di lunghe conversazioni scorrendo la pagina.'
				],
				examples: [
					{
						command: '/copy',
						note: 'Copia l’intero transcript della sessione negli appunti di sistema'
					}
				],
				whenToUse:
					'Quando vuoi condividere la discussione, incollarne una sintesi in un documento o conservarne un log locale.'
			},
			en: {
				title: 'Copy transcript',
				summary: 'Copies the complete conversation transcript of the active session to the system clipboard.',
				benefits: [
					'One-click export of all user prompts and assistant answers.',
					'Includes text blocks, reasoning output, and formatted notices.',
					'Avoids tedious manual text selection across long multi-turn chats.'
				],
				examples: [
					{
						command: '/copy',
						note: 'Copies entire conversation transcript to system clipboard'
					}
				],
				whenToUse:
					'When sharing a conversation, pasting an excerpt into documentation, or archiving text logs.'
			}
		}
	},
	{
		id: 'tree',
		origin: 'studio',
		category: 'session',
		icon: 'IconGitBranch',
		control: 'panel',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		text: {
			it: {
				title: 'Rami della sessione',
				summary: 'Apre il pannello Rami: l’albero delle diramazioni della sessione aperta, con il ramo attivo evidenziato.',
				benefits: [
					'Mostra dove la conversazione si è divisa (rewind, «Modifica e riprova», diramazioni) con un nodo per ogni tuo messaggio.',
					'Un clic su un ramo lo apre come nuova sessione, fino al suo ultimo messaggio, senza toccare quella di partenza.',
					'Da un nodo puoi anche diramare da prima del messaggio o rimetterlo nel composer per riprovarlo.'
				],
				examples: [
					{
						command: '/tree',
						note: 'Apre il pannello Rami sopra la chat della corsia attiva'
					}
				],
				whenToUse:
					'Quando vuoi capire da dove arriva la conversazione o riprendere un tentativo lasciato su un altro ramo. L’elenco delle sessioni è /sessions.'
			},
			en: {
				title: 'Session branches',
				summary: 'Opens the Branches panel: the fork tree of the open session, with the active branch highlighted.',
				benefits: [
					'Shows where the conversation split (rewinds, “Edit and retry”, forks) with one node per message you sent.',
					'Clicking a branch opens it as a new session, up to its last message, leaving the original untouched.',
					'From a node you can also branch from before the message or put it back in the composer to retry it.'
				],
				examples: [
					{
						command: '/tree',
						note: 'Opens the Branches panel over the active lane’s chat'
					}
				],
				whenToUse:
					'When you want to see where the conversation came from or pick up an attempt left on another branch. The session list is /sessions.'
			}
		}
	},
	{
		id: 'fork',
		origin: 'studio',
		category: 'session',
		icon: 'IconGitBranch',
		control: 'action',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		text: {
			it: {
				title: 'Dirama sessione (Fork)',
				summary: 'Copia l’intera sessione corrente, cronologia e artefatti compresi, in una nuova sessione e prosegue sulla copia.',
				benefits: [
					'Permette di sperimentare un’alternativa senza toccare la conversazione di partenza, che resta nell’elenco sessioni.',
					'La copia conserva tutto il contesto: l’agente continua da dove eri, senza ripartire da zero.',
					'Per ripartire da un punto precedente usa «Dirama da qui» o «Modifica e riprova» nel menu di un messaggio.'
				],
				examples: [
					{
						command: '/fork',
						note: 'Copia la sessione e passa subito alla copia; funziona solo ad agente fermo'
					}
				],
				whenToUse:
					'Quando vuoi provare un refactoring o un approccio rischioso mantenendo intatta la chat di partenza.'
			},
			en: {
				title: 'Fork session',
				summary: 'Copies the whole current session, history and artifacts included, into a new session and continues on the copy.',
				benefits: [
					'Try an alternative without touching the original conversation, which stays in the session list.',
					'The copy keeps the full context: the agent carries on from where you were instead of starting over.',
					'To restart from an earlier point use “Branch from here” or “Edit and retry” in a message’s menu.'
				],
				examples: [
					{
						command: '/fork',
						note: 'Copies the session and switches to the copy right away; works only while the agent is idle'
					}
				],
				whenToUse:
					'When testing a refactor or a risky approach while keeping the original conversation intact.'
			}
		}
	},
	{
		id: 'drop',
		origin: 'studio',
		category: 'session',
		icon: 'IconTrash',
		control: 'panel',
		supported: [{ zone: 'statusLine', form: 'chip' }],
		defaultPlacement: null,
		text: {
			it: {
				title: 'Elimina sessioni',
				summary: 'Apre lo storico nella barra laterale per gestire ed eliminare sessioni obsolete o non più necessarie.',
				benefits: [
					'Libera spazio rimuovendo sessioni di prova o non più rilevanti.',
					'Fornisce indicazioni e pulsanti di cancellazione sicura con conferma.',
					'Mantiene ordinato e snello l’elenco delle sessioni del progetto.'
				],
				examples: [
					{
						command: '/drop',
						note: 'Apre lo storico laterale con i controlli per rimuovere sessioni archiviate'
					}
				],
				whenToUse:
					'Quando vuoi ripulire l’elenco dei lavori salvati eliminando test temporanei o conversazioni abbandonate.'
			},
			en: {
				title: 'Drop sessions',
				summary: 'Opens the sidebar history panel to manage and delete obsolete or unneeded sessions.',
				benefits: [
					'Frees storage by removing discarded test sessions or scratchpads.',
					'Provides secure deletion controls with confirmation safeguards.',
					'Keeps the project session list clean and clutter-free.'
				],
				examples: [
					{
						command: '/drop',
						note: 'Opens the history panel with controls to drop archived sessions'
					}
				],
				whenToUse:
					'When decluttering saved project sessions and discarding temporary or failed chat experiments.'
			}
		}
	},
	{
		id: 'quit',
		origin: 'studio',
		category: 'app',
		icon: 'IconClose',
		control: 'action',
		supported: [{ zone: 'statusLine', form: 'chip' }],
		defaultPlacement: null,
		text: {
			it: {
				title: 'Esci dalla sessione',
				summary: 'Azzera la vista attiva e avvia una nuova sessione pulita nello spazio di lavoro corrente.',
				benefits: [
					'Termina prontamente l’interazione corrente resettando l’interfaccia grafica.',
					'Inizializza una sessione pulita pronta a ricevere nuovi prompt.',
					'Utile per resettare la vista senza dover chiudere la finestra dell’applicazione.'
				],
				examples: [
					{
						command: '/quit',
						note: 'Chiude la sessione attiva e reimposta una vista pulita'
					},
					{
						command: '/exit',
						note: 'Alias equivalente per chiudere la conversazione'
					}
				],
				whenToUse:
					'Quando hai concluso il lavoro nella sessione attiva e desideri azzerare l’interfaccia.'
			},
			en: {
				title: 'Quit session',
				summary: 'Resets the active conversation view and starts a fresh clean session in the project.',
				benefits: [
					'Promptly concludes active interaction and resets the graphical chat surface.',
					'Initializes a clean session ready for new tasks.',
					'Resets chat state without needing to close or restart the desktop window.'
				],
				examples: [
					{
						command: '/quit',
						note: 'Closes active session and opens a fresh clean chat'
					},
					{
						command: '/exit',
						note: 'Equivalent alias to exit the active conversation'
					}
				],
				whenToUse:
					'When finishing work in the current session and resetting the chat surface.'
			}
		}
	}
];

/**
 * «Ripeti» (/loop, variante B): pillola nel composer subito dopo @. Sta fuori
 * da STUDIO_ENTRIES perche' `index.ts` la colloca accanto ai controlli, dove
 * il prototipo approvato la mette; come voce Studio e' un'azione che apre il
 * composer in modalita' ripetizione.
 */
export const STUDIO_LOOP_ENTRY: CommandManifestEntry = {
	id: 'loop',
	origin: 'studio',
	category: 'modes',
	icon: 'IconRepeat',
	control: 'action',
	supported: [
		{ zone: 'toolbar', form: 'chip' },
		{ zone: 'toolbar', form: 'icon' },
		{ zone: 'statusLine', form: 'chip' },
		{ zone: 'statusLine', form: 'icon' }
	],
	defaultPlacement: { zone: 'toolbar', form: 'chip' },
	argsHint: "[N|10m] [--until|--while 'comando'] [prompt]",
	text: {
		it: {
			title: 'Ripeti',
			summary:
				'Trasforma il composer in modalità ripetizione: lo stesso prompt riparte a ogni giro, con un limite di giri o di tempo e una condizione di stop.',
			benefits: [
				'Lascia lavorare l’agente da solo fino a un risultato verificabile, per esempio finché i test passano.',
				'Il controllo gira in una shell separata prima di ogni giro dal secondo in poi: non entra nel contesto della chat.',
				'Pausa a fine giro, Riprendi e Stop immediato restano nel composer; i giri chiusi si ripiegano in una riga.'
			],
			examples: [
				{ command: '/loop', note: 'Apre il composer in modalità ripetizione con le pillole' },
				{
					command: "/loop 6 --until 'npm test' correggi il primo test che fallisce",
					note: 'Al massimo 6 giri, si ferma quando npm test riesce'
				},
				{ command: '/loop 30m rifinisci la documentazione', note: 'Ripete per mezz’ora' }
			],
			whenToUse:
				'Quando un compito si chiude in più passi uguali con un criterio di fine chiaro. Nel Terminale vale il /loop nativo di omp.'
		},
		en: {
			title: 'Repeat',
			summary:
				'Turns the composer into repeat mode: the same prompt runs again each round, with a round or time limit and a stop condition.',
			benefits: [
				'Lets the agent work on its own until a verifiable result, for example until the tests pass.',
				'The check runs in a separate shell before every round from the second on: it never enters the chat context.',
				'Pause at the end of a round, Resume and immediate Stop stay in the composer; finished rounds fold into one line.'
			],
			examples: [
				{ command: '/loop', note: 'Opens the composer in repeat mode with the pills' },
				{
					command: "/loop 6 --until 'npm test' fix the first failing test",
					note: 'At most 6 rounds, stops when npm test passes'
				},
				{ command: '/loop 30m polish the documentation', note: 'Repeats for half an hour' }
			],
			whenToUse:
				'When a task closes in several identical steps with a clear end criterion. In the Terminal the native omp /loop applies.'
		}
	}
};
