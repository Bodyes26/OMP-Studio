// Voci del catalogo per i controlli interattivi del composer (8 controlli di base).
//
// L'ordine esportato definisce la sequenza di fabbrica nel composer:
// prima le azioni fisse della toolbar (allegati, menzione @), poi i selettori
// modello/ruolo/thinking, il monitoraggio del contesto e infine gli indicatori
// di spesa e limite nella riga di stato (statusLine).

import type { CommandManifestEntry } from '../types';

export const CONTROL_ENTRIES: readonly CommandManifestEntry[] = [
	{
		id: 'ctl.attach',
		origin: 'control',
		category: 'context',
		icon: 'IconAttach',
		control: 'panel',
		supported: [
			{ zone: 'toolbar', form: 'icon' },
			{ zone: 'toolbar', form: 'chip' }
		],
		defaultPlacement: { zone: 'toolbar', form: 'icon' },
		locked: true,
		text: {
			it: {
				title: 'Allega file',
				summary: 'Allega immagini, documenti o cartelle al messaggio corrente del composer.',
				benefits: [
					'Aggiunge file e immagini direttamente al prompt per l’analisi multimodale.',
					'Supporta sia la selezione da finestra di dialogo nativa sia il trascinamento diretto.',
					'Calcola e mostra la stima immediata dell’ingombro in token degli allegati.'
				],
				examples: [
					{
						command: 'Clicca sull’icona graffetta',
						note: 'Apre il menu a comparsa per scegliere file o cartelle dal disco'
					},
					{
						command: 'Trascina un’immagine nel composer',
						note: 'Prepara automaticamente l’anteprima e la conversione base64 per il modello'
					}
				],
				whenToUse:
					'Quando vuoi sottoporre all’assistente uno screenshot, un documento o file sorgente senza doverne incollare manualmente il testo.'
			},
			en: {
				title: 'Attach files',
				summary: 'Attaches images, documents, or folders to the current composer draft.',
				benefits: [
					'Adds files and images directly to the prompt for multimodal analysis.',
					'Supports native file dialog selection as well as drag-and-drop into the composer.',
					'Calculates and displays real-time estimated token usage for staged attachments.'
				],
				examples: [
					{
						command: 'Click paperclip icon',
						note: 'Opens the popup menu to pick files or folders from disk'
					},
					{
						command: 'Drag an image into composer',
						note: 'Automatically stages the thumbnail preview and base64 payload for the model'
					}
				],
				whenToUse:
					'When sharing screenshots, assets, or documents with the assistant without manual copy-pasting.'
			}
		}
	},
	{
		id: 'ctl.mention',
		origin: 'control',
		category: 'context',
		icon: 'IconAt',
		control: 'action',
		supported: [
			{ zone: 'toolbar', form: 'icon' },
			{ zone: 'toolbar', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' },
			{ zone: 'statusLine', form: 'chip' }
		],
		defaultPlacement: { zone: 'toolbar', form: 'icon' },
		text: {
			it: {
				title: 'Menzione file (@)',
				summary: 'Inserisce il carattere @ nel messaggio per citare file del progetto con autocompletamento.',
				benefits: [
					'Cerca e seleziona i percorsi del progetto con autocompletamento fuzzy intelligente.',
					'Include con precisione il contenuto dei file citati nel contesto della conversazione.',
					'Evita errori di battitura nei percorsi annidati e velocizza la stesura del prompt.'
				],
				examples: [
					{
						command: 'Digita @src/lib/agent/session.svelte',
						note: 'Cita il file del progetto creando un badge interattivo nel messaggio'
					},
					{
						command: 'Clicca sul pulsante @',
						note: 'Inserisce il marcatore @ alla posizione del cursore e apre i suggerimenti'
					}
				],
				whenToUse:
					'Quando intendi fare riferimento esplicito a uno o più file specifici del repository dentro la richiesta.'
			},
			en: {
				title: 'File mention (@)',
				summary: 'Inserts the @ symbol in the draft to reference project files with fuzzy autocompletion.',
				benefits: [
					'Searches and picks repository paths using fast fuzzy autocompletion.',
					'Accurately injects referenced file contents into conversation context.',
					'Prevents typos in deep directory structures and speeds up prompting.'
				],
				examples: [
					{
						command: 'Type @src/lib/agent/session.svelte',
						note: 'References the project file as an interactive badge in the draft'
					},
					{
						command: 'Click @ button',
						note: 'Inserts @ trigger at caret position and brings up file suggestions'
					}
				],
				whenToUse:
					'When explicitly pointing the assistant toward one or more repository files inside your prompt.'
			}
		}
	},
	{
		id: 'ctl.role',
		origin: 'control',
		category: 'models',
		icon: 'IconRoleDefault',
		control: 'picker',
		supported: [
			{ zone: 'toolbar', form: 'chip' },
			{ zone: 'toolbar', form: 'icon' }
		],
		defaultPlacement: { zone: 'toolbar', form: 'chip' },
		locked: true,
		text: {
			it: {
				title: 'Ruolo modello',
				summary: 'Seleziona il profilo di ruolo attivo del modello (chat, plan, smol, slow, vision, task, commit, advisor).',
				benefits: [
					'Applica all’istante la combinazione ottimale di modello, thinking e parametri per il compito desiderato.',
					'Permette di passare senza sforzo da risposte ultra-rapide a pianificazione o revisione critica.',
					'Configurabile in ogni dettaglio nella scheda ruoli delle impostazioni modelli.'
				],
				examples: [
					{
						command: 'Clicca sul chip del ruolo',
						note: 'Apre il menu con l’elenco dei ruoli preconfigurati e il modello assegnato'
					},
					{
						command: '/role plan',
						note: 'Comando slash equivalente per attivare il ruolo di pianificazione architetturale'
					}
				],
				whenToUse:
					'Quando vuoi adattare il comportamento dell’IA alla fase di lavoro (es. pianificazione prima di scrivere codice, refactoring o commit rapido).'
			},
			en: {
				title: 'Model role',
				summary: 'Selects the active model role profile (chat, plan, smol, slow, vision, task, commit, advisor).',
				benefits: [
					'Instantly switches to the optimal model, reasoning effort, and parameters for the target task.',
					'Seamlessly transitions between lightning-fast edits, deep architectural planning, and code review.',
					'Fully customizable via the Roles tab in model settings.'
				],
				examples: [
					{
						command: 'Click role chip',
						note: 'Opens popover displaying configured roles and their assigned models'
					},
					{
						command: '/role plan',
						note: 'Equivalent slash command to activate architectural planning profile'
					}
				],
				whenToUse:
					'When tailoring AI behavior to your current development stage (e.g. design before coding, heavy refactoring, or git commits).'
			}
		}
	},
	{
		id: 'ctl.model',
		origin: 'control',
		category: 'models',
		icon: 'IconModels',
		control: 'picker',
		supported: [
			{ zone: 'toolbar', form: 'chip' },
			{ zone: 'toolbar', form: 'icon' }
		],
		defaultPlacement: { zone: 'toolbar', form: 'chip' },
		locked: true,
		text: {
			it: {
				title: 'Selettore modello',
				summary: 'Mostra il modello linguistico attivo e apre il catalogo per sceglierne un altro o passare al successivo.',
				benefits: [
					'Visualizza immediatamente provider, nome e identificativo del modello in uso.',
					'Permette la ricerca rapida nel catalogo di tutti i modelli configurati o scaricati.',
					'Evidenzia le capacità di visione e ragionamento supportate da ciascun modello.'
				],
				examples: [
					{
						command: 'Clicca sul nome del modello',
						note: 'Apre il catalogo interattivo con filtro di ricerca per fornitore e nome'
					},
					{
						command: '/model next',
						note: 'Avanza al modello successivo definito nell’ordine ciclico'
					}
				],
				whenToUse:
					'Quando vuoi verificare o sostituire il motore di intelligenza artificiale impiegato per la conversazione.'
			},
			en: {
				title: 'Model selector',
				summary: 'Displays the active language model and opens catalog search or cycles to the next configured model.',
				benefits: [
					'Immediately identifies provider, model family, and specific variant in use.',
					'Enables instant filtering across all configured cloud and local models.',
					'Highlights multimodal vision and reasoning capabilities for each candidate.'
				],
				examples: [
					{
						command: 'Click model name chip',
						note: 'Opens interactive catalog popover with instant search by provider and name'
					},
					{
						command: '/model next',
						note: 'Cycles to the next model specified in your cycle sequence'
					}
				],
				whenToUse:
					'Whenever checking or swapping the underlying language model powering the current session.'
			}
		}
	},
	{
		id: 'ctl.thinking',
		origin: 'control',
		category: 'models',
		icon: 'IconBrain',
		control: 'picker',
		supported: [
			{ zone: 'toolbar', form: 'chip' },
			{ zone: 'toolbar', form: 'icon' }
		],
		defaultPlacement: { zone: 'toolbar', form: 'chip' },
		locked: true,
		text: {
			it: {
				title: 'Livello di ragionamento',
				summary: 'Regola l’impegno di pensiero (thinking) del modello tramite cursore interattivo da off a max.',
				benefits: [
					'Adatta il budget di ragionamento e deduzione alla reale complessità del problema.',
					'Riduce drasticamente latenza e token consumati per domande immediate impostando off.',
					'Aumenta la profondità logica per problemi architetturali o indagini su bug ostici.'
				],
				examples: [
					{
						command: 'Trascina il cursore thinking',
						note: 'Regola visivamente il livello di reasoning (off, low, medium, high, max)'
					},
					{
						command: '/thinking high',
						note: 'Comando slash equivalente per impostare direttamente il reasoning su high'
					}
				],
				whenToUse:
					'Quando affronti compiti critici che richiedono riflessione preliminare estesa, o al contrario quando cerchi risposte immediate e sintetiche.'
			},
			en: {
				title: 'Thinking effort',
				summary: 'Adjusts reasoning effort (thinking) using an interactive slider from off to max.',
				benefits: [
					'Tailors deduction and reflection budget to the actual complexity of the problem.',
					'Drastically reduces latency and token consumption on quick queries by setting off.',
					'Deepens deductive reasoning for intricate architectural puzzles or tricky debugging.'
				],
				examples: [
					{
						command: 'Drag thinking slider',
						note: 'Visually adjusts reasoning level (off, low, medium, high, max)'
					},
					{
						command: '/thinking high',
						note: 'Equivalent slash command to set reasoning effort directly to high'
					}
				],
				whenToUse:
					'When tackling difficult tasks that demand extended internal reasoning, or conversely when prioritizing rapid, low-token responses.'
			}
		}
	},
	{
		id: 'ctl.context',
		origin: 'control',
		category: 'context',
		icon: 'IconContextWindow',
		control: 'readout',
		supported: [
			{ zone: 'toolbar', form: 'chip' },
			{ zone: 'statusLine', form: 'chip' }
		],
		defaultPlacement: { zone: 'toolbar', form: 'chip' },
		text: {
			it: {
				title: 'Finestra di contesto',
				summary: 'Mostra i token consumati rispetto al limite massimo e apre la scomposizione dettagliata del contesto.',
				benefits: [
					'Indicatore circolare colorato (verde, giallo, rosso) sullo stato di saturazione della finestra di contesto.',
					'Mostra i token effettivi della conversazione più la stima in tempo reale della bozza corrente.',
					'Apre il pannello dettagliato con la ripartizione tra messaggi, output di strumenti e riscaldamento cache.'
				],
				examples: [
					{
						command: 'Clicca sull’indicatore contesto',
						note: 'Apre il pannello con la ripartizione granulare dei token e lo stato della cache'
					},
					{
						command: '/compact',
						note: 'Comando slash per compattare la cronologia quando la finestra si avvicina al limite'
					}
				],
				whenToUse:
					'Per monitorare l’occupazione della finestra di contesto e intervenire tempestivamente prima che i turni più vecchi vengano troncati.'
			},
			en: {
				title: 'Context window',
				summary: 'Displays consumed tokens against model capacity and opens detailed context breakdown.',
				benefits: [
					'Radial color-coded gauge (green, yellow, red) reflecting context saturation at a glance.',
					'Shows exact transcript tokens plus real-time estimate of the current draft.',
					'Opens detailed breakdown dialog itemizing messages, tool outputs, and cache warming.'
				],
				examples: [
					{
						command: 'Click context gauge',
						note: 'Opens detailed dialog with granular token breakdown and cache status'
					},
					{
						command: '/compact',
						note: 'Slash command to compress conversation history when context approaches limits'
					}
				],
				whenToUse:
					'To monitor context saturation and prevent unexpected context truncation during long-running sessions.'
			}
		}
	},
	{
		id: 'ctl.cost',
		origin: 'control',
		category: 'info',
		icon: 'IconQuota',
		control: 'readout',
		supported: [{ zone: 'statusLine', form: 'chip' }],
		defaultPlacement: { zone: 'statusLine', form: 'chip' },
		text: {
			it: {
				title: 'Costo sessione',
				summary: 'Mostra la spesa monetaria cumulativa in dollari della sessione, inclusi i subagenti delegati.',
				benefits: [
					'Controllo immediato della spesa economica maturata durante l’intera sessione.',
					'Tooltip esplicativo con suddivisione tra spesa della chat principale e subagenti avviati.',
					'Aggiornato automaticamente a ogni messaggio o chiamata a strumento completata.'
				],
				examples: [
					{
						command: 'Passa il mouse sul chip costo',
						note: 'Mostra il tooltip con la separazione tra spesa locale e subagenti paralleli'
					},
					{
						command: '/cost',
						note: 'Comando slash per stampare nella chat il riepilogo dettagliato di token e spesa'
					}
				],
				whenToUse:
					'Per tenere sotto controllo il budget economico durante indagini estese, benchmark o compiti con molti subagenti.'
			},
			en: {
				title: 'Session cost',
				summary: 'Displays cumulative session monetary expenditure in USD, including delegated subagents.',
				benefits: [
					'Immediate visibility into monetary budget spent during the entire session.',
					'Explanatory tooltip breaking down expenditure between main chat and background subagents.',
					'Automatically updated after every completed assistant response or tool execution.'
				],
				examples: [
					{
						command: 'Hover over cost chip',
						note: 'Displays tooltip breaking down local session cost versus parallel subagents'
					},
					{
						command: '/cost',
						note: 'Slash command to print detailed token and monetary metrics directly into chat'
					}
				],
				whenToUse:
					'To maintain strict budget awareness during intensive tasks, benchmark runs, or multi-agent delegations.'
			}
		}
	},
	{
		id: 'ctl.limit',
		origin: 'control',
		category: 'info',
		icon: 'IconWarning',
		control: 'readout',
		supported: [{ zone: 'statusLine', form: 'chip' }],
		defaultPlacement: { zone: 'statusLine', form: 'chip' },
		text: {
			it: {
				title: 'Limite di utilizzo',
				summary: 'Segnala quando una quota di chiamate o un rate limit del fornitore è in esaurimento o attivo.',
				benefits: [
					'Segnalazione visiva immediata di avviso nella riga di stato con tooltip descrittivo.',
					'Permette di prevenire errori di chiamata passando per tempo a un altro provider o modello.',
					'Compare dinamicamente solo quando omp riscontra vincoli di quota o rallentamenti forzati.'
				],
				examples: [
					{
						command: 'Passa il mouse sul chip limite',
						note: 'Mostra il dettaglio del vincolo di quota e l’orario previsto di ripristino'
					},
					{
						command: '/usage',
						note: 'Comando slash per aprire il cruscotto completo delle quote e dei consumi'
					}
				],
				whenToUse:
					'Per verificare tempestivamente le restrizioni di quota o rate limiting prima di inviare prompt gravosi.'
			},
			en: {
				title: 'Usage limit',
				summary: 'Warns when provider quota limits or rate limits are active or approaching exhaustion.',
				benefits: [
					'Immediate visual warning indicator on the status line with detailed tooltip.',
					'Prevents request failures by alerting you in time to switch providers or roles.',
					'Appears dynamically only when omp detects rate limits or provider quota constraints.'
				],
				examples: [
					{
						command: 'Hover over limit chip',
						note: 'Displays quota constraint details and estimated reset timestamp'
					},
					{
						command: '/usage',
						note: 'Slash command to open full quotas and consumption dashboard'
					}
				],
				whenToUse:
					'To stay ahead of provider rate limits or monthly quota caps before submitting large requests.'
			}
		}
	}
];
