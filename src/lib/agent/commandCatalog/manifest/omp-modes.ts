// Voci del catalogo per le modalita' operative, la gestione dei modelli
// e gli strumenti di controllo di omp (21 comandi builtin).
//
// L'ordine esportato qui rispetta l'ordine di fabbrica stabilito nel contratto.
// fast, slow e prewalk hanno defaultPlacement come chip nella riga di stato (statusLine),
// coerentemente con il comportamento visibile dell'interfaccia di Studio.

import type { CommandManifestEntry } from '../types';

export const OMP_ENTRIES_MODES: readonly CommandManifestEntry[] = [
	{
		id: 'security',
		origin: 'omp',
		category: 'security',
		icon: 'IconLock',
		control: 'action',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		argsHint: '<plan|scan|status|cancel|scans|show|import|export|validate|compare|disposition>',
		text: {
			it: {
				title: 'Scansione sicurezza',
				summary:
					'Pianifica, avvia, convalida ed esporta revisioni di sicurezza native del codice e audit SARIF.',
				benefits: [
					'Crea piani di scansione immutabili ancorati allo snapshot esatto di Git e diff dei commit.',
					'Esegue verifiche isolate con reviewer dedicati producendo finding dettagliati e verificabili.',
					'Supporta importazione ed esportazione di report in formato standard SARIF e bundle Codex Security.'
				],
				examples: [
					{
						command: '/security plan',
						note: 'Crea un piano di revisione immutabile per lo scope specificato'
					},
					{
						command: '/security scan',
						note: 'Avvia l’audit di sicurezza nativo sul piano predisposto'
					},
					{
						command: '/security status',
						note: 'Mostra lo stato di avanzamento della scansione e i problemi rilevati'
					}
				],
				whenToUse:
					'Prima di merge critici o rilasci di produzione per verificare vulnerabilità, regressioni di sicurezza e dipendenze.'
			},
			en: {
				title: 'Security scan',
				summary:
					'Plan, run, inspect, validate, and export native security code audits and SARIF reports.',
				benefits: [
					'Creates immutable scan plans pinned to exact Git snapshots and revision diffs.',
					'Executes isolated reviews with dedicated agents producing verified, reproducible findings.',
					'Supports importing and exporting standard SARIF reports and Codex Security bundles.'
				],
				examples: [
					{
						command: '/security plan',
						note: 'Create an immutable security review plan for the chosen scope'
					},
					{
						command: '/security scan',
						note: 'Start the native security audit using the prepared plan'
					},
					{
						command: '/security status',
						note: 'Inspect running operation progress and identified findings'
					}
				],
				whenToUse:
					'Before major merges or production releases to detect vulnerabilities, security regressions, and insecure patterns.'
			}
		}
	},
	{
		id: 'model',
		origin: 'omp',
		category: 'models',
		icon: 'IconModels',
		control: 'action',
		supported: [
			{ zone: 'toolbar', form: 'chip' },
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		text: {
			it: {
				title: 'Modello attivo',
				summary:
					'Mostra il modello attualmente in uso nella sessione, il provider associato e le specifiche attive.',
				benefits: [
					'Conferma rapida dell’identificatore esatto del modello e della dimensione della finestra di contesto.',
					'Verifica trasparente delle credenziali del provider e dei parametri di inferenza correnti.'
				],
				examples: [
					{
						command: '/model',
						note: 'Stampa le informazioni complete sul modello selezionato per la sessione'
					}
				],
				whenToUse:
					'Quando vuoi verificare al volo quale modello sta per elaborare il prompt prima di inviare un compito impegnativo.'
			},
			en: {
				title: 'Active model',
				summary:
					'Displays the model currently selected for this session, its provider, and runtime parameters.',
				benefits: [
					'Instantly confirms the exact model identifier and available context window size.',
					'Provides full transparency on active provider credentials and inference parameters.'
				],
				examples: [
					{
						command: '/model',
						note: 'Print complete details for the active session model'
					}
				],
				whenToUse:
					'Whenever you need to verify which model is active before submitting complex or high-token tasks.'
			}
		}
	},
	{
		id: 'switch',
		origin: 'omp',
		category: 'models',
		icon: 'IconCycle',
		control: 'action',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		argsHint: '[model]',
		text: {
			it: {
				title: 'Cambia modello sessione',
				summary:
					'Cambia il modello solo per la sessione corrente, senza alterare la configurazione globale salvata.',
				benefits: [
					'Permette di testare un modello diverso al volo senza toccare i file di configurazione.',
					'Supporta nomi canonici, alias parziali (opus, gpt-5) e riferimenti ai ruoli (@slow, @smol).'
				],
				examples: [
					{
						command: '/switch openai/gpt-5.2',
						note: 'Passa a GPT-5.2 per le successive risposte di questa sessione'
					},
					{
						command: '/switch claude-sonnet-4-5',
						note: 'Seleziona Claude Sonnet usando la ricerca rapida per nome'
					}
				],
				whenToUse:
					'Quando un passaggio specifico richiede una capacità di ragionamento differente o un provider alternativo.'
			},
			en: {
				title: 'Switch session model',
				summary:
					'Switches the model for the current session only, leaving global saved configuration untouched.',
				benefits: [
					'Test or leverage a different model on the fly without editing persistent config files.',
					'Accepts canonical IDs, fuzzy aliases (opus, gpt-5), and configured role names (@slow, @smol).'
				],
				examples: [
					{
						command: '/switch openai/gpt-5.2',
						note: 'Switch to GPT-5.2 for subsequent turns in this session'
					},
					{
						command: '/switch claude-sonnet-4-5',
						note: 'Select Claude Sonnet using fuzzy model matching'
					}
				],
				whenToUse:
					'When a particular turn requires a different reasoning capability or an alternate provider without changing project defaults.'
			}
		}
	},
	{
		id: 'fast',
		origin: 'omp',
		category: 'modes',
		icon: 'IconFastMode',
		control: 'toggle',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: { zone: 'statusLine', form: 'chip' },
		argsHint: '[on|ultra|off|status]',
		text: {
			it: {
				title: 'Modalità veloce',
				summary:
					'Attiva o disattiva il tier di servizio prioritario o ultrafast sui provider compatibili.',
				benefits: [
					'Abbassa nettamente la latenza iniziale e accelera i tempi di completamento delle risposte.',
					'Assegna priorità di elaborazione sui server del provider saltando le code standard nelle ore di picco.',
					'Si alterna in modo pulito ed esclusivo con la modalità lenta senza richiedere cambio modello.'
				],
				examples: [
					{
						command: '/fast',
						note: 'Alterna l’attivazione della modalità veloce per la sessione'
					},
					{
						command: '/fast ultra',
						note: 'Richiede il livello Ultrafast con throughput massimizzato per i modelli che lo supportano'
					},
					{
						command: '/fast status',
						note: 'Verifica se la corsia prioritaria è attiva, in pausa o non supportata dal modello'
					}
				],
				whenToUse:
					'Ideale per sessioni di debugging interattivo, modifiche rapide e risposte istantanee quando il provider offre code prioritari.'
			},
			en: {
				title: 'Fast mode',
				summary:
					'Toggles priority or ultrafast service tiers on supported model providers.',
				benefits: [
					'Significantly reduces first-token latency and accelerates overall response turnaround.',
					'Grants higher server processing priority, bypassing shared queues during peak hours.',
					'Seamlessly alternates with slow mode without requiring any model change.'
				],
				examples: [
					{
						command: '/fast',
						note: 'Toggle fast mode on or off for this session'
					},
					{
						command: '/fast ultra',
						note: 'Request maximum throughput Ultrafast tier where supported by the provider'
					},
					{
						command: '/fast status',
						note: 'Check whether priority tier is active, paused, or unsupported by active model'
					}
				],
				whenToUse:
					'Ideal for interactive debugging loops, quick edits, and rapid fixes when you want minimum turnaround latency.'
			}
		}
	},
	{
		id: 'slow',
		origin: 'omp',
		category: 'modes',
		icon: 'IconSlowMode',
		control: 'toggle',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: { zone: 'statusLine', form: 'chip' },
		argsHint: '[on|off|status]',
		text: {
			it: {
				title: 'Modalità lenta (Flex)',
				summary:
					'Attiva la modalità a bassa priorità o tier Flex per risparmiare costi e preservare le quote orarie.',
				benefits: [
					'Riduce i costi sfruttando sconti per elaborazione in differita o code a bassa priorità (es. OpenAI Flex).',
					'Permette di continuare a lavorare con modelli Anthropic quando si raggiunge il limite standard di sessione.',
					'Disattiva automaticamente la modalità veloce per evitare conflitti tra livelli di servizio.'
				],
				examples: [
					{
						command: '/slow',
						note: 'Alterna l’attivazione della modalità lenta'
					},
					{
						command: '/slow on',
						note: 'Attiva il tier Flex o la bassa priorità sul provider attivo'
					},
					{
						command: '/slow status',
						note: 'Mostra se la modalità lenta è abilitata e l’ambito attivo (sessione o globale)'
					}
				],
				whenToUse:
					'Consigliata per compiti pesanti non urgenti, grandi refactoring in background o per preservare il budget di token.'
			},
			en: {
				title: 'Slow mode (Flex)',
				summary:
					'Toggles low-priority or Flex tiers to reduce spending and extend usage quotas.',
				benefits: [
					'Reduces inference costs by leveraging off-peak or deferred pricing tiers (such as OpenAI Flex).',
					'Enables continued work on Anthropic models even after reaching standard session rate limits.',
					'Automatically disarms fast mode to prevent contradictory tier selections.'
				],
				examples: [
					{
						command: '/slow',
						note: 'Toggle slow mode on or off'
					},
					{
						command: '/slow on',
						note: 'Enable Flex tier or low-priority execution on the active provider'
					},
					{
						command: '/slow status',
						note: 'Show current slow mode state and effective scope (session or global)'
					}
				],
				whenToUse:
					'Recommended for heavy non-urgent jobs, large background refactors, or preserving quotas across long working days.'
			}
		}
	},
	{
		id: 'skillful',
		origin: 'omp',
		category: 'modes',
		icon: 'IconSkill',
		control: 'toggle',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		argsHint: '[on|off|status]',
		text: {
			it: {
				title: 'Elenco skill nel prompt',
				summary:
					'Controlla se l’elenco delle skill scoperte viene incluso nel prompt di sistema della sessione.',
				benefits: [
					'Disattivando l’elenco si risparmiano centinaia di token di contesto a ogni richiesta.',
					'Attivandolo permette al modello di scoprire e invocare gli schemi operativi specialistici del progetto.'
				],
				examples: [
					{
						command: '/skillful',
						note: 'Alterna l’inclusione delle skill nel prompt'
					},
					{
						command: '/skillful off',
						note: 'Esclude l’elenco delle skill per ridurre al minimo il prompt iniziale'
					},
					{
						command: '/skillful status',
						note: 'Mostra se l’elenco delle skill è attualmente visibile al modello'
					}
				],
				whenToUse:
					'Disattiva quando svolgi compiti diretti o hai una finestra di contesto ridotta; attiva se fai affidamento su skill custom.'
			},
			en: {
				title: 'Skill listing',
				summary:
					'Toggles whether discovered skills are injected into the session system prompt.',
				benefits: [
					'Disabling saves hundreds of prompt tokens on every turn when skills are unneeded.',
					'Enabling ensures the assistant discovers specialized project skills and invocation triggers.'
				],
				examples: [
					{
						command: '/skillful',
						note: 'Toggle skill listing inclusion for this session'
					},
					{
						command: '/skillful off',
						note: 'Omit skills listing to minimize system prompt token overhead'
					},
					{
						command: '/skillful status',
						note: 'Check whether skill definitions are currently exposed to the model'
					}
				],
				whenToUse:
					'Turn off to preserve tokens during simple editing sessions; turn on when working with specialized domain skills.'
			}
		}
	},
	{
		id: 'extended-context',
		origin: 'omp',
		category: 'modes',
		icon: 'IconContextWindow',
		control: 'toggle',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		argsHint: '[on|off|status]',
		text: {
			it: {
				title: 'Finestra di contesto estesa',
				summary:
					'Abilita o disabilita finestre di contesto extra-large per i modelli che offrono tier estesi a tariffa differenziata.',
				benefits: [
					'Consente di caricare interi codebase, file voluminosi o cronologie prolungate nella stessa sessione.',
					'Mantenendola disattivata si evitano sovrapprezzi e tariffe maggiorate applicate da alcuni provider per finestre XL.'
				],
				examples: [
					{
						command: '/extended-context',
						note: 'Alterna la finestra di contesto estesa per la sessione'
					},
					{
						command: '/extended-context on',
						note: 'Abilita la finestra estesa massima supportata dal modello'
					},
					{
						command: '/extended-context status',
						note: 'Verifica lo stato della finestra e la dimensione massima effettiva'
					}
				],
				whenToUse:
					'Da attivare quando occorre elaborare enormi moli di log, documentazione vasta o refactoring trasversali su molti file.'
			},
			en: {
				title: 'Extended context',
				summary:
					'Toggles extra-large context windows for models that offer extended context tiers.',
				benefits: [
					'Allows loading massive codebases, long transcripts, or large documents in a single turn.',
					'Keeping it off prevents provider premium surcharge pricing on extra-large token windows.'
				],
				examples: [
					{
						command: '/extended-context',
						note: 'Toggle extended context window for this session'
					},
					{
						command: '/extended-context on',
						note: 'Enable the maximum supported extended context window'
					},
					{
						command: '/extended-context status',
						note: 'Inspect current extended context status and maximum token window'
					}
				],
				whenToUse:
					'Enable when ingesting extensive documentation, whole-repository contexts, or large diffs; leave off for everyday edits.'
			}
		}
	},
	{
		id: 'computer',
		origin: 'omp',
		category: 'modes',
		icon: 'IconInspect',
		control: 'toggle',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		argsHint: '[on|off|status]',
		text: {
			it: {
				title: 'Automazione desktop (Computer use)',
				summary:
					'Abilita o disabilita il controllo del desktop host, l’acquisizione di finestre e l’albero di accessibilità.',
				benefits: [
					'Consente all’agente di interagire con applicazioni native, scattare screenshot e simulare input.',
					'Isolamento e sicurezza: mantenuto spento previene qualsiasi interazione involontaria con il desktop del sistema operativo.'
				],
				examples: [
					{
						command: '/computer',
						note: 'Alterna il preludio computer use nella sessione'
					},
					{
						command: '/computer on',
						note: 'Abilita l’automazione desktop per testare o interagire con app native'
					},
					{
						command: '/computer status',
						note: 'Verifica lo stato del preludio e i permessi del sistema operativo'
					}
				],
				whenToUse:
					'Quando devi automatizzare o collaudare interfacce desktop native, simulatori o finestre non pilotabili via browser web.'
			},
			en: {
				title: 'Computer use',
				summary:
					'Toggles host desktop automation, window capture, native input, and accessibility tree inspection.',
				benefits: [
					'Enables the agent to inspect application windows, take screenshots, and send native input.',
					'Provides safety by keeping desktop control off until deliberately required by the workflow.'
				],
				examples: [
					{
						command: '/computer',
						note: 'Toggle computer use prelude for this session'
					},
					{
						command: '/computer on',
						note: 'Enable desktop automation to interact with native GUI applications'
					},
					{
						command: '/computer status',
						note: 'Check current computer use status and OS accessibility permissions'
					}
				],
				whenToUse:
					'When automating native desktop software, inspecting GUI layout states, or driving applications outside the terminal.'
			}
		}
	},
	{
		id: 'ratchet',
		origin: 'omp',
		category: 'modes',
		icon: 'IconTarget',
		control: 'action',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		argsHint: '[flow and goal]',
		text: {
			it: {
				title: 'Ottimizzazione eval (Ratchet)',
				summary:
					'Costruisce un benchmark di valutazione per un flusso LLM ed esegue un ciclo di hillclimbing non presidiato.',
				benefits: [
					'Affina automaticamente prompt, tool e regole confrontando i risultati con criteri di successo oggettivi.',
					'Elimina la necessità di test manuali ripetitivi per far convergere un agente su metriche di qualità elevate.'
				],
				examples: [
					{
						command: '/ratchet',
						note: 'Mostra lo stato dell’ottimizzazione o avvia il flusso predefinito'
					},
					{
						command: '/ratchet pipeline-estrazione massimizza recall json',
						note: 'Configura ed esegue un hillclimb guidato dall’obiettivo indicato'
					}
				],
				whenToUse:
					'Quando progetti pipeline di agenti o prompt strutturati e vuoi trovare automaticamente la formulazione ottimale.'
			},
			en: {
				title: 'Ratchet eval optimization',
				summary:
					'Builds or reuses an evaluation harness for an LLM flow, then hillclimbs it unattended.',
				benefits: [
					'Automatically refines prompts, tools, and rules against objective benchmark assertions.',
					'Eliminates tedious manual trial-and-error when optimizing agent accuracy and consistency.'
				],
				examples: [
					{
						command: '/ratchet',
						note: 'Display optimization status or launch default eval loop'
					},
					{
						command: '/ratchet extraction-pipeline maximize json recall',
						note: 'Configure and launch an unattended hillclimb with the specified goal'
					}
				],
				whenToUse:
					'When crafting structured agent flows or complex prompts and aiming for automated convergence on the best performance.'
			}
		}
	},
	{
		id: 'prewalk',
		origin: 'omp',
		category: 'modes',
		icon: 'IconPrewalk',
		control: 'toggle',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: { zone: 'statusLine', form: 'chip' },
		argsHint: '[restart|off]',
		text: {
			it: {
				title: 'Passaggio rapido (Prewalk)',
				summary:
					'Innesca un passaggio automatico dal modello principale al modello rapido (@smol) al primo edit del codice.',
				benefits: [
					'Sfrutta l’intelligenza di un modello di punta per esplorare il repository e impostare la checklist todo.',
					'Passa in automatico al modello economico (@smol) appena inizia la fase di scrittura dei file.',
					'Ripetibile con restart: alla richiesta successiva ripristina il modello di pianificazione per un nuovo ciclo.'
				],
				examples: [
					{
						command: '/prewalk',
						note: 'Attiva il passaggio automatico verso @smol al primo edit'
					},
					{
						command: '/prewalk restart',
						note: 'Ritorna al modello predefinito @default e riarma il passaggio verso @smol'
					},
					{
						command: '/prewalk off',
						note: 'Annulla il passaggio pianificato mantenendo il modello corrente'
					}
				],
				whenToUse:
					'Fondamentale nei task complessi: concentri i token di ragionamento su analisi e piano, lasciando la stesura a un modello veloce.'
			},
			en: {
				title: 'Prewalk handoff',
				summary:
					'Arms a one-shot handoff from the planning model to the fast @smol model at the first workspace edit.',
				benefits: [
					'Invests a frontier model’s reasoning into repository exploration and task planning.',
					'Delegates file editing and boilerplate changes to a fast, cost-effective model as soon as editing begins.',
					'Easily repeatable with restart to return to the planning model for subsequent prompts.'
				],
				examples: [
					{
						command: '/prewalk',
						note: 'Arm the one-shot handoff to @smol on first file edit'
					},
					{
						command: '/prewalk restart',
						note: 'Return to @default planning model and re-arm the handoff to @smol'
					},
					{
						command: '/prewalk off',
						note: 'Cancel the pending handoff without changing the currently active model'
					}
				],
				whenToUse:
					'Essential for larger tasks: spend reasoning tokens on architecture and planning, then let a fast model implement the diffs.'
			}
		}
	},
	{
		id: 'modelpreset',
		origin: 'omp',
		category: 'models',
		icon: 'IconSparkles',
		control: 'action',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		argsHint: '[list|save|switch|delete] [name]',
		text: {
			it: {
				title: 'Preset di modelli',
				summary:
					'Salva, applica ed elenca preset nominati di configurazione dei ruoli modello e dei livelli di thinking.',
				benefits: [
					'Passa all’istante da un assetto di sviluppo quotidiano economico a uno ad altissimo ragionamento.',
					'Configura in un colpo solo i ruoli default, smol, slow e advisor.'
				],
				examples: [
					{
						command: '/modelpreset list',
						note: 'Elenca tutti i preset di modelli salvati'
					},
					{
						command: '/modelpreset save deep-review',
						note: 'Salva l’attuale configurazione di ruoli ed effort con il nome indicato'
					},
					{
						command: '/modelpreset switch deep-review',
						note: 'Applica il preset alla sessione corrente'
					}
				],
				whenToUse:
					'Quando alterni frequentemente scenari di lavoro diversi, come stesura rapida di codice o audit architetturali complessi.'
			},
			en: {
				title: 'Model presets',
				summary:
					'Saves, applies, and manages named presets of model roles and thinking levels.',
				benefits: [
					'Instantly toggles between curated configurations for fast daily edits versus heavy reasoning.',
					'Updates default, smol, slow, and advisor roles together in a single command.'
				],
				examples: [
					{
						command: '/modelpreset list',
						note: 'List all saved model role presets'
					},
					{
						command: '/modelpreset save deep-review',
						note: 'Save current model roles and effort under the given preset name'
					},
					{
						command: '/modelpreset switch deep-review',
						note: 'Apply a previously saved preset to the active session'
					}
				],
				whenToUse:
					'When frequently switching between fast lightweight workflows and rigorous multi-model review setups.'
			}
		}
	},
	{
		id: 'effort',
		origin: 'omp',
		category: 'models',
		icon: 'IconBrain',
		control: 'picker',
		supported: [
			{ zone: 'toolbar', form: 'chip' },
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		argsHint: '[off|minimal|low|medium|high|xhigh|max|auto]',
		text: {
			it: {
				title: 'Livello di ragionamento (Effort)',
				summary:
					'Imposta o mostra il budget di thinking e riflessione per i modelli dotati di ragionamento esteso.',
				benefits: [
					'Modula la profondità di pensiero in proporzione alla difficoltà del problema affrontato.',
					'Riduce tempi di attesa e consumo di token sui task semplici, o spinge il thinking al massimo per bug insidiosi.'
				],
				examples: [
					{
						command: '/effort high',
						note: 'Imposta un budget di ragionamento profondo (~16k token di thinking)'
					},
					{
						command: '/effort off',
						note: 'Disattiva il thinking per ottenere risposte dirette e immediate'
					},
					{
						command: '/effort auto',
						note: 'Consente al modello o provider di calibrare automaticamente il thinking per ogni prompt'
					}
				],
				whenToUse:
					'Usa low o off per modifiche testuali o stili CSS; aumenta a high o xhigh per logiche concorrenti, algoritmi e refactor critici.'
			},
			en: {
				title: 'Reasoning effort',
				summary:
					'Sets or displays thinking effort and reasoning token budget for capable models.',
				benefits: [
					'Calibrates thinking depth to match the specific problem complexity.',
					'Saves latency and cost on simple edits while unlocking deep analysis for intricate challenges.'
				],
				examples: [
					{
						command: '/effort high',
						note: 'Set deep reasoning budget (~16k thinking tokens)'
					},
					{
						command: '/effort off',
						note: 'Disable thinking for immediate direct answers'
					},
					{
						command: '/effort auto',
						note: 'Let the model or provider dynamically calibrate thinking per prompt'
					}
				],
				whenToUse:
					'Use low or off for straightforward edits and boilerplate; dial up to high or max for tricky race conditions and algorithms.'
			}
		}
	},
	{
		id: 'advisor',
		origin: 'omp',
		category: 'modes',
		icon: 'IconRoleAdvisor',
		control: 'toggle',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		argsHint: '[on|off|status|dump [raw]|configure]',
		text: {
			it: {
				title: 'Revisore watchdog (Advisor)',
				summary:
					'Attiva un modello revisore indipendente che osserva l’agente in tempo reale e inserisce consigli e correzioni.',
				benefits: [
					'Intercetta allucinazioni, regressioni o scelte architetturali errate prima che i file vengano modificati.',
					'Lavora in background senza rallentare il flusso principale a meno di anomalie critiche (blocker).',
					'Personalizzabile tramite WATCHDOG.md per dare priorità ai requisiti e ai pericoli specifici del progetto.'
				],
				examples: [
					{
						command: '/advisor on',
						note: 'Attiva il revisore watchdog per la sessione corrente'
					},
					{
						command: '/advisor status',
						note: 'Mostra stato, modello in uso, consumo di token e note emesse dall’advisor'
					},
					{
						command: '/advisor dump',
						note: 'Copia negli appunti il transcript sintetico dei pareri del revisore'
					}
				],
				whenToUse:
					'Consigliato durante refactoring delicati o task autonomi prolungati per avere un secondo parere autorevole in tempo reale.'
			},
			en: {
				title: 'Advisor watchdog',
				summary:
					'Attaches an independent reviewer model that monitors the conversation and injects guidance.',
				benefits: [
					'Catches hallucinations, regressions, and design mismatches before flawed diffs are committed.',
					'Operates asynchronously in the background, only interrupting the loop on critical blockers.',
					'Configurable with WATCHDOG.md instructions to emphasize repository-specific safety checks.'
				],
				examples: [
					{
						command: '/advisor on',
						note: 'Enable the advisor reviewer for this session'
					},
					{
						command: '/advisor status',
						note: 'Inspect advisor runtime status, model, token usage, and costs'
					},
					{
						command: '/advisor dump',
						note: 'Copy the concise advisor review transcript to clipboard'
					}
				],
				whenToUse:
					'Recommended during high-stakes refactorings or long autonomous runs to maintain an independent safety and quality review.'
			}
		}
	},
	{
		id: 'tools',
		origin: 'omp',
		category: 'tools',
		icon: 'IconFileCog',
		control: 'action',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		text: {
			it: {
				title: 'Strumenti disponibili',
				summary:
					'Mostra l’elenco completo di tutti i tool, le estensioni e i device attivi e autorizzati nella sessione.',
				benefits: [
					'Offre un inventario trasparente delle capacità operative attive (bash, read, edit, LSP, MCP, ecc.).',
					'Consente di verificare subito se uno strumento atteso è bloccato dalle policy di sicurezza.'
				],
				examples: [
					{
						command: '/tools',
						note: 'Elenca tutti i tool a disposizione del modello per questa sessione'
					}
				],
				whenToUse:
					'Quando vuoi verificare quali permessi operativi ha l’agente o diagnosticare perché uno strumento sembra non rispondere.'
			},
			en: {
				title: 'Available tools',
				summary:
					'Displays the full inventory of active and authorized tools, extensions, and devices in the session.',
				benefits: [
					'Provides clear visibility into active agent capabilities (bash, read, edit, LSP, MCP, etc.).',
					'Helps diagnose whether an expected tool is missing or restricted by current approval policies.'
				],
				examples: [
					{
						command: '/tools',
						note: 'List all tools currently accessible to the assistant'
					}
				],
				whenToUse:
					'To inspect what actions the assistant is permitted to take or debug why a particular tool is unavailable.'
			}
		}
	},
	{
		id: 'mcp',
		origin: 'omp',
		category: 'tools',
		icon: 'IconPlug',
		control: 'action',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		argsHint: '<subcommand>',
		text: {
			it: {
				title: 'Server MCP',
				summary:
					'Gestisce i server Model Context Protocol (MCP) per connettere endpoint, API esterne e database.',
				benefits: [
					'Integra server MCP locali o remoti arricchendo la sessione con strumenti e risorse specializzate.',
					'Permette di testare, riautenticare o ricaricare i server a caldo senza riavviare l’applicazione.',
					'Supporta ricerca e installazione rapida di integrazioni tramite il registro Smithery.'
				],
				examples: [
					{
						command: '/mcp list',
						note: 'Elenca tutti i server MCP configurati e il relativo stato di connessione'
					},
					{
						command: '/mcp test github',
						note: 'Verifica la connessione e la risposta del server MCP specificato'
					},
					{
						command: '/mcp reload',
						note: 'Forza la ricarica a caldo dei tool da tutti i server MCP attivi'
					}
				],
				whenToUse:
					'Per collegare l’agente a database Postgres, sistemi Jira/GitHub, documentazioni interne o API proprietarie.'
			},
			en: {
				title: 'MCP servers',
				summary:
					'Manages Model Context Protocol (MCP) servers to integrate external tools, data, and endpoints.',
				benefits: [
					'Connects local and remote MCP servers, extending session capabilities with custom tools and resources.',
					'Enables testing, re-authenticating, and reloading servers on the fly without restarting.',
					'Supports fast discovery and deployment of integrations via the Smithery registry.'
				],
				examples: [
					{
						command: '/mcp list',
						note: 'List all configured MCP servers and their connection state'
					},
					{
						command: '/mcp test github',
						note: 'Test communication and health of the specified MCP server'
					},
					{
						command: '/mcp reload',
						note: 'Force reload runtime tools across all connected MCP servers'
					}
				],
				whenToUse:
					'Whenever you need to interface with external databases, issue trackers, documentation hubs, or bespoke APIs.'
			}
		}
	},
	{
		id: 'ssh',
		origin: 'omp',
		category: 'tools',
		icon: 'IconTerminal',
		control: 'action',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		argsHint: '<subcommand>',
		text: {
			it: {
				title: 'Connessioni SSH',
				summary:
					'Configura e gestisce gli host remoti accessibili tramite il protocollo ssh:// per modifiche e comandi remoti.',
				benefits: [
					'Consente all’agente di navigare, modificare file ed eseguire comandi su server remoti in modo trasparente.',
					'Memorizza configurazioni con porte, chiavi crittografiche e utenti a livello di progetto o utente.'
				],
				examples: [
					{
						command: '/ssh list',
						note: 'Elenca tutti gli host SSH configurati'
					},
					{
						command: '/ssh add staging --host 192.168.1.50 --user deploy',
						note: 'Registra un nuovo server SSH per l’accesso remoto'
					}
				],
				whenToUse:
					'Per compiti di deployment, verifica log su macchine di staging o interventi diretti su server remoti.'
			},
			en: {
				title: 'SSH connections',
				summary:
					'Configures and manages remote hosts accessible via ssh:// protocol for remote edits and commands.',
				benefits: [
					'Allows the assistant to inspect, edit files, and run commands on remote servers transparently.',
					'Saves reusable host connection definitions with keys and ports at project or user scope.'
				],
				examples: [
					{
						command: '/ssh list',
						note: 'List all configured SSH remote connections'
					},
					{
						command: '/ssh add staging --host 192.168.1.50 --user deploy',
						note: 'Register a new SSH remote target for remote execution'
					}
				],
				whenToUse:
					'When orchestrating remote staging environments, inspecting remote logs, or administering remote servers.'
			}
		}
	},
	{
		id: 'browser',
		origin: 'omp',
		category: 'tools',
		icon: 'IconGlobe',
		control: 'toggle',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		argsHint: '[headless|visible]',
		text: {
			it: {
				title: 'Modalità browser web',
				summary:
					'Alterna l’esecuzione del browser integrato tra modalità nascosta (headless) e finestra visibile a schermo.',
				benefits: [
					'La modalità visibile permette di osservare in diretta la navigazione, i clic e le schermate compilate dall’agente.',
					'La modalità headless è rapida, silenziosa e non apre finestre che disturbano il lavoro a schermo.'
				],
				examples: [
					{
						command: '/browser visible',
						note: 'Rende visibile a schermo la finestra del browser'
					},
					{
						command: '/browser headless',
						note: 'Esegue l’automazione web in background senza finestre visibili'
					}
				],
				whenToUse:
					'Passa a visible quando vuoi effettuare il debug visivo di flussi web o verificare il layout CSS; usa headless per test veloci.'
			},
			en: {
				title: 'Browser mode',
				summary:
					'Toggles embedded browser execution between silent headless mode and visible desktop window.',
				benefits: [
					'Visible mode lets you watch live page navigation, interactions, and form fills in real time.',
					'Headless mode provides fast, non-intrusive automation without stealing desktop focus.'
				],
				examples: [
					{
						command: '/browser visible',
						note: 'Make browser window visible on your desktop'
					},
					{
						command: '/browser headless',
						note: 'Switch back to silent background headless browser execution'
					}
				],
				whenToUse:
					'Switch to visible when debugging user flows, visual rendering, or authentication; use headless for background checks.'
			}
		}
	},
	{
		id: 'todo',
		origin: 'omp',
		category: 'tools',
		icon: 'IconListTodo',
		control: 'action',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		argsHint: '<subcommand>',
		text: {
			it: {
				title: 'Gestione Todo',
				summary:
					'Visualizza, modifica, espande ed esporta l’elenco dei compiti e delle fasi operative della sessione.',
				benefits: [
					'Mantiene visibile lo stato di avanzamento per evitare deviazioni su compiti multi-fase complessi.',
					'Supporta l’editing in Markdown, l’esportazione nel file TODO.md del progetto e la sincronizzazione negli appunti.',
					'Si integra perfettamente con il gating di esecuzione del prewalk.'
				],
				examples: [
					{
						command: '/todo expand',
						note: 'Espande tutti i compiti e le fasi nel pannello visibile'
					},
					{
						command: '/todo copy',
						note: 'Copia la checklist dei todo in formato Markdown negli appunti'
					},
					{
						command: '/todo export',
						note: 'Esporta l’elenco attuale in un file TODO.md nel progetto'
					}
				],
				whenToUse:
					'Per strutturare grandi implementazioni a tappe, monitorare i progressi o sincronizzare le checklist col team.'
			},
			en: {
				title: 'Todo management',
				summary:
					'Inspects, edits, expands, and exports session task checklists and operational phases.',
				benefits: [
					'Structures multi-step work so the assistant tracks milestones without drifting.',
					'Supports round-trip Markdown editing, clipboard synchronization, and export to TODO.md.',
					'Coordinates seamlessly with the prewalk execution gating loop.'
				],
				examples: [
					{
						command: '/todo expand',
						note: 'Expand all phases and tasks in the visible HUD panel'
					},
					{
						command: '/todo copy',
						note: 'Copy current todo checklist as Markdown to clipboard'
					},
					{
						command: '/todo export',
						note: 'Write the active checklist into a project TODO.md file'
					}
				],
				whenToUse:
					'To organize multi-turn implementations, track step-by-step progress, or export task checklists to documentation.'
			}
		}
	},
	{
		id: 'jobs',
		origin: 'omp',
		category: 'tools',
		icon: 'IconQueue',
		control: 'action',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		argsHint: '[full]',
		text: {
			it: {
				title: 'Processi in background (Jobs)',
				summary:
					'Mostra lo stato dei comandi bash asincroni e dei job eseguiti in background nella sessione.',
				benefits: [
					'Elenca PID, comando, durata e stato di completamento di ogni processo in esecuzione.',
					'Verifica con certezza se build lunghe, test runner o watcher sono ancora attivi o hanno terminato.'
				],
				examples: [
					{
						command: '/jobs',
						note: 'Mostra i processi asincroni attualmente attivi'
					},
					{
						command: '/jobs full',
						note: 'Visualizza le righe di comando complete senza troncamenti'
					}
				],
				whenToUse:
					'Quando lanci compilazioni prolungate o server di test e vuoi verificarne l’avanzamento senza bloccare la chat.'
			},
			en: {
				title: 'Background jobs',
				summary:
					'Displays the status of asynchronous bash commands and background tasks in this session.',
				benefits: [
					'Lists PID, command line, running time, and state for every active background task.',
					'Verifies whether long builds, test runners, or file watchers are still executing or completed.'
				],
				examples: [
					{
						command: '/jobs',
						note: 'List currently running background jobs'
					},
					{
						command: '/jobs full',
						note: 'Show complete unclipped command lines for all background jobs'
					}
				],
				whenToUse:
					'When running long-lived builds or test servers in the background and monitoring progress without blocking chat.'
			}
		}
	},
	{
		id: 'trace',
		origin: 'omp',
		category: 'tools',
		icon: 'IconNetwork',
		control: 'action',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		text: {
			it: {
				title: 'Traccia sessione (Trace)',
				summary:
					'Apre la traccia dettagliata delle chiamate, dei turni e dei tempi di risposta nella dashboard delle statistiche.',
				benefits: [
					'Ispeziona visivamente la timeline di ciascun turno, distinguendo latenza del modello, thinking e chiamate ai tool.',
					'Identifica colli di bottiglia e consumi anomali di token lungo la conversazione.'
				],
				examples: [
					{
						command: '/trace',
						note: 'Apre la vista di tracciamento per la sessione corrente'
					}
				],
				whenToUse:
					'Per diagnosticare risposte lente, analizzare le prestazioni dei provider o profilare l’impatto dei subagenti.'
			},
			en: {
				title: 'Session trace',
				summary:
					'Opens this session’s execution trace and performance metrics in the stats dashboard.',
				benefits: [
					'Visually inspects turn timelines, distinguishing model latency, thinking phases, and tool calls.',
					'Highlights performance bottlenecks and unexpected token expenditures across turns.'
				],
				examples: [
					{
						command: '/trace',
						note: 'Open the detailed trace visualization for this session'
					}
				],
				whenToUse:
					'To diagnose slow turns, analyze provider round-trip latencies, or profile multi-agent coordination overhead.'
			}
		}
	},
	{
		id: 'dump',
		origin: 'omp',
		category: 'tools',
		icon: 'IconDownload',
		control: 'action',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: null,
		argsHint: '[all]',
		text: {
			it: {
				title: 'Dump transcript e log',
				summary:
					'Esporta l’intero transcript della sessione in formato testo con i percorsi dei payload JSON delle richieste LLM.',
				benefits: [
					'Fornisce un tracciato trasparente e completo di ogni prompt inviato e di ogni risposta generata.',
					'Con l’opzione all crea un archivio ZIP contenente il transcript principale e i log di tutti i subagenti.'
				],
				examples: [
					{
						command: '/dump',
						note: 'Restituisce il transcript completo della sessione come testo piano'
					},
					{
						command: '/dump all',
						note: 'Genera uno zip con transcript principale, JSON delle chiamate LLM e log dei subagenti'
					}
				],
				whenToUse:
					'Per archiviare una sessione, condividere report tecnici approfonditi o esaminare le richieste grezze inviate alle API.'
			},
			en: {
				title: 'Transcript and request dump',
				summary:
					'Exports the full session transcript as plain text, including LLM request JSON paths.',
				benefits: [
					'Provides an exhaustive, transparent audit log of every submitted prompt and received response.',
					'With "all", packages a comprehensive ZIP archive containing primary transcript and subagent logs.'
				],
				examples: [
					{
						command: '/dump',
						note: 'Return the complete session transcript as plain text'
					},
					{
						command: '/dump all',
						note: 'Create a ZIP bundle with main transcript, LLM request JSON, and subagent logs'
					}
				],
				whenToUse:
					'For archiving sessions, sharing in-depth bug reports, or inspecting raw API payloads sent to model providers.'
			}
		}
	}
];
