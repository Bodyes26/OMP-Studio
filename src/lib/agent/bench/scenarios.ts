// Scenari di prova per il banco di test Chat v2.
// Riproducono fedelmente i 6 scenari del prototipo Lab (CodeAgent Flow) piu'
// uno scenario di stress test con ~1000 entry storiche e supporto opzionale a NDJSON.

import {
	type BenchAnswers,
	type BenchQuestion,
	type BenchScenario,
	editTool,
	globTool,
	grepTool,
	readTool,
	runTool,
	thinkTool,
	webTool,
	writeTool
} from './dsl';
import askRealRaw from '../../../../test/fixtures/chat-v2/ask-real.ndjson?raw';
import toolsRealRaw from '../../../../test/fixtures/chat-v2/tools-real.ndjson?raw';

/* ------------------------------------------------------------- scenario 1 */

const qVolumi: BenchQuestion = {
	id: 'volumi',
	header: 'Volumi',
	question: 'Come gestiamo gli export molto grandi, oltre le 10.000 righe?',
	recommended: 0,
	options: [
		{
			label: 'Download in streaming',
			description: 'Il server scrive il CSV riga per riga. Il download parte subito e la memoria resta bassa.'
		},
		{
			label: 'Export in background',
			description: 'Un job genera il file e manda un link via email. Più robusto, ma serve una coda.'
		},
		{
			label: 'Limite a 10.000 righe',
			description: 'La soluzione più semplice. Oltre il limite chiediamo di restringere i filtri.'
		}
	]
};

const csvOutcomeMap: Record<number, string> = {
	0: 'il **download in streaming**: il server scrive le righe man mano che le legge dal database, a blocchi di 1.000',
	1: "l'**export in background**: il job gira sulla coda esistente `mail-jobs` e il link resta valido 24 ore",
	2: 'un **limite di 10.000 righe**: oltre la soglia il pulsante si disattiva e un tooltip suggerisce di restringere i filtri'
};

/* ------------------------------------------------------------- scenario 2 */

const qMetodi: BenchQuestion = {
	id: 'metodi',
	header: 'Accesso',
	question: 'Quali metodi di accesso vuoi abilitare per l’area admin?',
	multi: true,
	recommended: 2,
	options: [
		{ label: 'Email e password', description: 'Classico, con reset via email. Da affiancare a 2FA.' },
		{ label: 'Magic link', description: 'Link monouso via email, niente password da gestire.' },
		{ label: 'Google Workspace (SSO)', description: 'Accesso con l’account aziendale, limitato al dominio acme.it.' },
		{ label: 'Passkey', description: 'Impronta o Face ID. Ottime, ma non tutti i browser del magazzino le supportano.' }
	]
};

const qSessione: BenchQuestion = {
	id: 'sessione',
	header: 'Sessione',
	question: 'Dove salviamo la sessione dopo il login?',
	recommended: 0,
	options: [
		{
			label: 'Cookie httpOnly',
			description: 'Il browser non la espone al JavaScript. Protegge da XSS.',
			preview: `// server/auth/session.ts\nres.cookie('sid', session.id, {\n  httpOnly: true,\n  secure: true,\n  sameSite: 'lax',\n  maxAge: 8 * 60 * 60 * 1000,\n});`
		},
		{
			label: 'JWT in localStorage',
			description: 'Semplice e senza stato, ma leggibile da qualunque script.',
			preview: `// src/auth/token.ts\nlocalStorage.setItem('token', jwt);\n\nfetch('/api/orders', {\n  headers: { Authorization: \`Bearer \${jwt}\` }\n});`
		},
		{
			label: 'Sessione su Redis',
			description: 'Revoca immediata da pannello, serve un Redis in produzione.',
			preview: `// server/auth/store.ts\nawait redis.set(\`sess:\${id}\`, JSON.stringify(user), { EX: 8 * 3600 });\n\n// revoca\nawait redis.del(\`sess:\${id}\`);`
		}
	]
};

const qRuoli: BenchQuestion = {
	id: 'ruoli',
	header: 'Permessi',
	question: 'Serve distinguere i permessi tra gli utenti admin?',
	recommended: 1,
	options: [
		{ label: 'No, tutti uguali', description: 'Chi entra nell’area admin può fare tutto.' },
		{ label: 'Tre ruoli fissi', description: 'Amministratore, operatore, sola lettura. Copre i casi di oggi.' },
		{ label: 'Ruoli configurabili', description: 'Permessi granulari da interfaccia. Richiede circa due giorni in più.' }
	]
};

const qUtenti: BenchQuestion = {
	id: 'utenti',
	header: 'Utenti esistenti',
	question: 'Cosa facciamo con i 12 account admin che esistono già?',
	recommended: 0,
	options: [
		{ label: 'Migrali al primo accesso', description: 'Al prossimo login scelgono il nuovo metodo; la vecchia password smette di valere.' },
		{ label: 'Invia un invito a tutti', description: 'Email con link di attivazione, i vecchi account vengono disattivati subito.' }
	]
};

/* ------------------------------------------------------------- scenario 6 */

const qRilascio: BenchQuestion = {
	id: 'rilascio',
	header: 'Rilascio',
	question: 'Come attiviamo Adyen in produzione?',
	recommended: 0,
	options: [
		{ label: 'Feature flag per negozio', description: 'Si accende un negozio alla volta e si torna indietro in un clic.' },
		{ label: 'Tutto insieme di notte', description: 'Un solo passaggio in una finestra di manutenzione. Più semplice, ma senza ritorno graduale.' },
		{ label: 'Traffico progressivo', description: 'Una percentuale crescente di pagamenti passa da Adyen, dal 5% al 100%.' }
	]
};

const qStripe: BenchQuestion = {
	id: 'stripe',
	header: 'Stripe',
	question: 'Cosa facciamo con Stripe dopo il passaggio?',
	multi: true,
	recommended: 0,
	options: [
		{ label: 'Attivo 30 giorni per i rimborsi', description: 'Gli ordini pagati con Stripe si rimborsano ancora da lì.' },
		{ label: 'Fallback se Adyen non risponde', description: 'Dopo due errori consecutivi il pagamento riprova su Stripe.' },
		{ label: 'Rimuovere il codice', description: 'Via dipendenza e configurazione appena il rilascio è completo.' }
	]
};

const qRimborsi: BenchQuestion = {
	id: 'rimborsi',
	header: 'Rimborsi parziali',
	question: 'Adyen non accetta più rimborsi parziali contemporanei sullo stesso ordine. Come li gestiamo?',
	recommended: 0,
	options: [
		{ label: 'Mettili in coda', description: 'Il secondo rimborso parte quando il primo è confermato. Nessun cambio per chi opera.' },
		{ label: 'Accorpali', description: 'I rimborsi della stessa giornata diventano uno solo, con il dettaglio in nota.' },
		{ label: 'Bloccali', description: 'Si può fare un solo rimborso parziale alla volta; l’interfaccia lo impedisce.' }
	]
};

/* ----------------------------------------------------------- elenco scenari */

export const SCENARIOS: BenchScenario[] = [
	{
		key: '1',
		name: 'Domanda singola',
		hint: 'Una domanda con opzioni, consigliata, “Altro” e nota.',
		prompt: 'Aggiungi l’esportazione CSV degli ordini',
		parts: [
			{
				type: 'tools',
				tools: [
					grepTool('export', 'src/ · 23 risultati'),
					readTool('src/orders/OrdersTable.tsx'),
					readTool('src/api/orders.ts', { par: true }),
					readTool('server/routes/orders.ts', { par: true }),
					runTool('pnpm db:stats orders', 'max 48.210 righe', { ms: 600 }),
					thinkTool('Valutazione dei volumi', 600)
				]
			},
			{
				type: 'text',
				text: "La tabella ordini ha già filtri e paginazione lato server, quindi l'export può riusare la stessa query. Alcuni negozi però arrivano a quasi 50.000 righe, e questo cambia l'approccio."
			},
			{ type: 'ask', questions: [qVolumi] },
			{
				type: 'tools',
				tools: [
					editTool('server/csv/writeCsv.ts', [48, 0]),
					editTool('server/routes/orders.ts', [22, 3]),
					editTool('src/orders/ExportButton.tsx', [36, 0], { par: true }),
					editTool('src/orders/OrdersTable.tsx', [5, 1]),
					runTool('pnpm test orders', '18 superati', { ms: 700 }),
					runTool('pnpm typecheck', 'nessun errore', { par: true, ms: 500 })
				]
			},
			{
				type: 'text',
				text: (a: BenchAnswers) => {
					const x = a.volumi;
					const how = x?.other?.trim()
						? `la soluzione che hai indicato: “${x.other.trim()}”`
						: csvOutcomeMap[x && !x.skipped && x.choices.length ? x.choices[0] : 0];
					const noteText = x?.note?.trim() ? `\n\nHo tenuto conto anche della tua nota: “${x.note.trim()}”.` : '';
					return `Ho aggiunto il pulsante **Esporta CSV** sopra la tabella ordini. Per i volumi grandi ho usato ${how}.

## Dettagli

- L'export rispetta i filtri attivi, quindi scarica esattamente ciò che l'utente vede.
- Le colonne sono le stesse della tabella, con importi in formato italiano e separatore \`;\` per Excel.
- Il nome del file include negozio e intervallo di date, ad esempio \`ordini-milano-2026-09.csv\`.

Vuoi che aggiunga anche la scelta delle colonne da esportare?${noteText}`;
				}
			},
			{ type: 'notice', level: 'info', message: 'File generato pronto per il download' }
		]
	},

	{
		key: '2',
		name: 'Più domande in arrivo',
		hint: 'Quattro domande generate una dopo l’altra, con scelta multipla e anteprime.',
		prompt: 'Configura l’autenticazione per l’area admin',
		parts: [
			{
				type: 'tools',
				tools: [
					readTool('package.json'),
					grepTool('/admin', 'src/ · 31 risultati', { par: true }),
					readTool('server/app.ts'),
					readTool('server/middleware/index.ts', { par: true }),
					grepTool('session', 'server/ · 0 risultati'),
					runTool('cat .env.example', '14 variabili', { ms: 400 }),
					thinkTool('Valutazione delle opzioni di autenticazione', 600)
				]
			},
			{
				type: 'text',
				text: "Oggi l'area admin è protetta solo da una password condivisa in una variabile d'ambiente. Prima di scrivere codice ho bisogno di alcune decisioni da parte tua."
			},
			{ type: 'ask', questions: [qMetodi, qSessione, qRuoli, qUtenti] },
			{
				type: 'tools',
				tools: [
					runTool('pnpm add @auth/core @auth/express', '2 pacchetti installati', { ms: 800 }),
					editTool('server/auth/config.ts', [64, 0]),
					editTool('server/auth/session.ts', [41, 0], { par: true }),
					editTool('server/middleware/requireRole.ts', [28, 0], { par: true }),
					editTool('server/app.ts', [9, 4]),
					editTool('db/migrations/0042_admin_users.sql', [37, 0]),
					editTool('src/admin/LoginPage.tsx', [118, 0]),
					editTool('src/admin/AdminLayout.tsx', [12, 6], { par: true }),
					editTool('.env.example', [4, 1], { par: true }),
					runTool('pnpm db:migrate', '1 migrazione applicata', { ms: 600 }),
					runTool('pnpm test auth', '26 superati', { ms: 750 }),
					runTool('pnpm typecheck', 'nessun errore', { par: true, ms: 500 })
				]
			},
			{
				type: 'text',
				text: (a: BenchAnswers) => {
					const mAns = a.metodi;
					const sAns = a.sessione;
					const rAns = a.ruoli;
					const uAns = a.utenti;

					const mLabels = mAns && !mAns.skipped && mAns.choices.length > 0
						? mAns.choices.map((idx) => qMetodi.options[idx]?.label ?? '')
						: [qMetodi.options[2].label];
					const sLabel = sAns && !sAns.skipped && sAns.choices.length > 0
						? qSessione.options[sAns.choices[0]]?.label
						: qSessione.options[0].label;

					const roleChoice = rAns && !rAns.skipped && rAns.choices.length > 0 ? rAns.choices[0] : 1;
					const userChoice = uAns && !uAns.skipped && uAns.choices.length > 0 ? uAns.choices[0] : 0;

					return `L'area admin ora richiede l'accesso: **${mLabels.join('**, **')}**.

## Cosa ho fatto

- La sessione usa **${sLabel}**, con scadenza dopo 8 ore di inattività.
- ${roleChoice === 0 ? 'Non ci sono ruoli: ogni admin vede e modifica tutto.' : roleChoice === 1 ? 'Ci sono tre ruoli fissi, controllati dal middleware `requireRole` su ogni rotta `/admin`.' : 'I ruoli sono configurabili da **Impostazioni › Permessi**.'}
- ${userChoice === 0 ? 'I 12 account esistenti vengono migrati al primo accesso, senza email da mandare.' : 'Ai 12 account esistenti arriva un invito; i vecchi accessi sono già disattivati.'}
- Tutti gli accessi, riusciti e falliti, finiscono nel log di audit.

I test passano e il typecheck è pulito. Vuoi che prepari anche la pagina di gestione degli utenti admin?`;
				}
			}
		]
	},

	{
		key: '3',
		name: '34 chiamate tool',
		hint: 'Molte chiamate, anche parallele, con testo intermedio tra i gruppi.',
		prompt: 'Sistema i test instabili nella CI',
		parts: [
			{
				type: 'tools',
				tools: [
					runTool('gh run list --workflow ci.yml --limit 30', '30 esecuzioni analizzate', { ms: 600 }),
					runTool('gh run view 8812 --log-failed', '3 test falliti', { ms: 500 }),
					runTool('gh run view 8790 --log-failed', '2 test falliti', { ms: 550, par: true }),
					runTool('gh run view 8764 --log-failed', '1 test fallito', { ms: 450, par: true }),
					thinkTool('Confronto dei fallimenti tra le esecuzioni', 500),
					grepTool('waitForTimeout', 'tests/ · 11 risultati'),
					grepTool('page.waitForSelector', 'tests/ · 28 risultati', { par: true }),
					readTool('tests/e2e/checkout.spec.ts')
				]
			},
			{
				type: 'text',
				text: 'I fallimenti sono concentrati nei test end-to-end: ci sono 11 `waitForTimeout` usati come workaround per animazioni non finite, e alcuni test falliscono quando la macchina di CI è sotto carico.'
			},
			{
				type: 'tools',
				tools: [
					grepTool('flaky', 'tests/ · 4 risultati'),
					readTool('tests/setup.ts'),
					runTool('git log -n 5 --oneline', '5 commit analizzati', { ms: 350 }),
					readTool('playwright.config.ts', { par: true }),
					editTool('playwright.config.ts', [12, 4]),
					readTool('tests/helpers/auth.ts'),
					thinkTool('Verifica del meccanismo di login nei test', 500),
					runTool('pnpm test:e2e checkout', '2 superati, 1 fallito', { fail: true, ms: 800 }),
					runTool('pnpm test:e2e orders', '4 superati', { par: true, ms: 750 })
				]
			},
			{
				type: 'text',
				text: 'Ho isolato il primo problema: il login nei test usava una sessione riutilizzata che scadeva durante le suite lunghe. Ho impostato il rinnovo automatico del token nel setup.'
			},
			{
				type: 'tools',
				tools: [
					editTool('tests/e2e/checkout.spec.ts', [18, 6]),
					editTool('tests/e2e/orders.spec.ts', [14, 4], { par: true }),
					editTool('tests/helpers/waitForReady.ts', [32, 0]),
					runTool('pnpm test:e2e --repeat-each 5 checkout', '15 superati', { ms: 900 }),
					editTool('tests/e2e/auth.spec.ts', [8, 3]),
					editTool('tests/helpers/auth.ts', [21, 5], { par: true }),
					thinkTool('Analisi dei test di navigazione', 400),
					readTool('tests/e2e/navigation.spec.ts'),
					editTool('tests/e2e/navigation.spec.ts', [11, 2], { par: true }),
					runTool('pnpm test:e2e navigation', '6 superati', { ms: 600 })
				]
			},
			{
				type: 'text',
				text: 'Tutti i timeout fissi sono stati sostituiti con asserzioni web-first (`expect(locator).toBeVisible()`). Ora i test attendono esattamente il tempo necessario senza rallentare la suite.'
			},
			{
				type: 'tools',
				tools: [
					runTool('pnpm test:unit', '142 superati', { ms: 700 }),
					runTool('pnpm test:integration', '58 superati', { ms: 800, par: true }),
					runTool('pnpm test:e2e --repeat-each 10', '90 superati (0 falliti)', { ms: 1200 }),
					runTool('pnpm lint', 'nessun errore', { par: true, ms: 500 }),
					runTool('pnpm typecheck', 'nessun errore', { par: true, ms: 600 }),
					runTool('gh workflow run ci.yml', 'esecuzione #8815 avviata', { ms: 600 }),
					thinkTool('Verifica finale della build', 400)
				]
			},
			{
				type: 'text',
				text: `Tutti i controlli sono verdi:
- 11 \`waitForTimeout\` eliminati
- Login rinnovato automaticamente nelle suite lunghe
- 10 ripetizioni consecutive di checkout e orders completate con successo
- CI #8815 avviata su GitHub Actions.`
			}
		]
	},

	{
		key: '4',
		name: 'Todo eseguiti uno a uno',
		hint: 'L’agente si crea una lista di todo e la spunta man mano.',
		prompt: 'Migra il progetto a React 19',
		parts: [
			{
				type: 'tools',
				tools: [
					readTool('package.json'),
					grepTool('forwardRef', 'src/ · 37 risultati'),
					grepTool('defaultProps', 'src/ · 6 risultati', { par: true }),
					runTool('pnpm outdated react react-dom', '18.3.1 → 19.1.0', { ms: 600 })
				]
			},
			{
				type: 'text',
				text: 'La migrazione tocca 43 file ma nessuna libreria è bloccante. Mi preparo un piano e lo eseguo un passo alla volta.'
			},
			{
				type: 'plan',
				items: [
					'Aggiornare react, react-dom e i tipi',
					'Sostituire defaultProps nei 6 componenti',
					'Correggere gli errori di tipo sui ref',
					'Rimuovere forwardRef dove non serve più',
					'Eseguire test, lint e build'
				]
			},
			{ type: 'step', index: 0 },
			{
				type: 'tools',
				tools: [
					runTool('pnpm add react@19 react-dom@19', '2 pacchetti aggiornati', { ms: 800 }),
					runTool('pnpm add -D @types/react@19 @types/react-dom@19', '2 pacchetti', { ms: 650, par: true }),
					runTool('pnpm typecheck', '27 errori rilevati', { fail: true, ms: 700 })
				]
			},
			{ type: 'step', index: 1 },
			{
				type: 'tools',
				tools: [
					editTool('src/ui/Button.tsx', [3, 7]),
					editTool('src/ui/Badge.tsx', [2, 5], { par: true }),
					editTool('src/ui/Tooltip.tsx', [4, 9], { par: true }),
					editTool('src/orders/OrderRow.tsx', [2, 6]),
					editTool('src/orders/StatusPill.tsx', [2, 4], { par: true }),
					editTool('src/layout/Sidebar.tsx', [3, 8], { par: true })
				]
			},
			{ type: 'step', index: 2 },
			{
				type: 'tools',
				tools: [
					runTool('pnpm typecheck', '14 errori rimasti', { fail: true, ms: 600 }),
					readTool('src/ui/Input.tsx'),
					readTool('src/ui/Select.tsx', { par: true }),
					editTool('src/ui/Input.tsx', [6, 9]),
					editTool('src/ui/Select.tsx', [5, 7], { par: true }),
					editTool('src/hooks/useAutoFocus.ts', [3, 3]),
					runTool('pnpm typecheck', '3 errori in react-select', { fail: true, ms: 550 })
				]
			},
			{
				type: 'text',
				text: 'Restano tre errori dentro `react-select`: la versione installata dichiara ancora i tipi di React 18. Aggiorno anche quella prima di proseguire.'
			},
			{
				type: 'tools',
				tools: [
					webTool('github.com/JedWatson/react-select/releases'),
					runTool('pnpm add react-select@5.10.1', '1 pacchetto', { ms: 700 }),
					runTool('pnpm typecheck', 'nessun errore', { ms: 600 })
				]
			},
			{ type: 'step', index: 3 },
			{
				type: 'tools',
				tools: [
					grepTool('forwardRef', 'src/ · 37 risultati'),
					editTool('src/ui/Input.tsx', [2, 5]),
					editTool('src/ui/Select.tsx', [2, 5], { par: true }),
					editTool('src/ui/Textarea.tsx', [2, 5], { par: true }),
					editTool('src/ui/Checkbox.tsx', [2, 4], { par: true }),
					editTool('src/ui/Dialog.tsx', [4, 9]),
					editTool('src/ui/Menu.tsx', [3, 7], { par: true }),
					editTool('src/orders/QuantityField.tsx', [2, 5], { par: true }),
					grepTool('forwardRef', 'src/ · 29 risultati nei componenti generati')
				]
			},
			{ type: 'step', index: 4 },
			{
				type: 'tools',
				tools: [
					runTool('pnpm test', '412 superati', { ms: 900 }),
					runTool('pnpm lint', 'nessun errore', { ms: 600, par: true }),
					runTool('pnpm build', '1,2 MB generati in 4,8s', { ms: 950, par: true })
				]
			},
			{ type: 'step', index: 5 },
			{
				type: 'text',
				text: `Il progetto ora gira su **React 19.1** e tutti i controlli sono verdi: 412 test, lint e build.

## Cosa è cambiato

- \`defaultProps\` sostituiti con valori di default nei parametri, in 6 componenti.
- 8 componenti usano \`ref\` come prop normale al posto di \`forwardRef\`.
- \`react-select\` aggiornato alla 5.10.1, che include i tipi per React 19.

Ho lasciato \`forwardRef\` nei 29 componenti generati da \`shadcn\`: si aggiornano rigenerandoli. Vuoi che lo faccia in una PR separata?`
			}
		]
	},

	{
		key: '5',
		name: 'Subagenti in parallelo',
		hint: 'Tre subagenti lavorano insieme; ognuno mostra la chiamata in corso e il proprio esito.',
		prompt: 'Fai una revisione di sicurezza del checkout',
		parts: [
			{
				type: 'tools',
				tools: [
					grepTool('checkout', 'src/ server/ · 58 risultati'),
					readTool('server/routes/checkout.ts'),
					readTool('server/routes/webhooks.ts', { par: true }),
					readTool('package.json', { par: true }),
					thinkTool('Suddivisione del lavoro', 500)
				]
			},
			{
				type: 'text',
				text: 'Il checkout tocca tre aree indipendenti: pagamenti, sessione e dipendenze. Le affido a tre subagenti in parallelo, così la revisione è più rapida.'
			},
			{
				type: 'agents',
				agents: [
					{
						name: 'PaymentsReview',
						task: 'Flusso di pagamento e webhook',
						result: '2 problemi: il webhook non verifica la firma e l’importo arriva dal client.',
						tools: [
							readTool('server/routes/checkout.ts', { ms: 300 }),
							readTool('server/payments/stripe.ts', { ms: 350 }),
							grepTool('amount', 'server/ · 12 risultati', { ms: 300 }),
							readTool('src/checkout/submitOrder.ts', { ms: 320 }),
							readTool('server/routes/webhooks.ts', { ms: 340 }),
							webTool('docs.stripe.com/webhooks/signature', { ms: 400 }),
							readTool('server/orders/markPaid.ts', { ms: 300 })
						]
					},
					{
						name: 'SessionAudit',
						task: 'Sessioni, cookie e CSRF',
						result: '1 problema: il form dell’indirizzo non ha il token CSRF.',
						tools: [
							readTool('server/auth/session.ts', { ms: 320 }),
							grepTool('sameSite', 'server/ · 2 risultati', { ms: 300 }),
							readTool('server/middleware/csrf.ts', { ms: 340 }),
							readTool('src/checkout/AddressForm.tsx', { ms: 360 }),
							runTool('curl -I localhost:3000/checkout', 'Set-Cookie: sid; HttpOnly; Secure', { ms: 400 })
						]
					},
					{
						name: 'DepsScan',
						task: 'Dipendenze e segreti',
						result: 'Nessun problema grave. `axios` va aggiornato alla 1.7.4.',
						tools: [
							runTool('pnpm audit --prod', '1 vulnerabilità moderata', { ms: 600 }),
							runTool('gitleaks detect --no-git', 'nessun segreto trovato', { ms: 700 }),
							readTool('pnpm-lock.yaml', { ms: 450 }),
							webTool('github.com/advisories/GHSA-8hc4-vh64-cxmj', { ms: 500 })
						]
					}
				]
			},
			{
				type: 'tools',
				tools: [
					readTool('server/routes/webhooks.ts'),
					readTool('src/checkout/AddressForm.tsx', { par: true }),
					thinkTool('Verifica dei risultati e priorità', 600)
				]
			},
			{
				type: 'text',
				text: `Ho verificato i risultati dei tre subagenti: ci sono **due problemi seri** e due minori.

## Da correggere subito

1. **Webhook senza firma.** \`/webhooks/stripe\` accetta qualunque richiesta. Chiunque potrebbe segnare un ordine come pagato. Serve \`stripe.webhooks.constructEvent\` con il segreto dell'endpoint.
2. **Importo dal client.** \`submitOrder\` invia il totale calcolato nel browser e il server lo usa così com'è. Va ricalcolato lato server a partire dal carrello.

## Minori

- Il form dell'indirizzo non invia il token CSRF. Il rischio è basso grazie a \`sameSite: lax\`, ma è l'unica rotta scoperta.
- \`axios\` 1.6.8 ha una vulnerabilità moderata, risolta nella 1.7.4.

Sessioni e segreti sono a posto. Vuoi che corregga subito i due problemi seri?`
			}
		]
	},

	{
		key: '6',
		name: 'Todo + subagenti + domande',
		hint: 'Tutto insieme: lista di todo, subagenti in parallelo, una domanda da un subagente e due dall’agente.',
		prompt: 'Passa i pagamenti da Stripe ad Adyen',
		parts: [
			{
				type: 'tools',
				tools: [
					grepTool('stripe', 'src/ server/ · 41 risultati'),
					readTool('server/payments/stripe.ts'),
					readTool('server/payments/refund.ts', { par: true }),
					readTool('server/routes/webhooks.ts', { par: true }),
					webTool('docs.adyen.com/online-payments/build-your-integration')
				]
			},
			{
				type: 'text',
				text: 'Il cambio tocca pagamenti, rimborsi e webhook, che sono indipendenti tra loro. Mi preparo una lista di todo e affido i tre moduli a tre subagenti in parallelo.'
			},
			{
				type: 'plan',
				items: [
					'Aggiungere il client Adyen e la configurazione',
					'Migrare pagamenti, rimborsi e webhook',
					'Decidere il piano di rilascio',
					'Aggiornare i test e verificare'
				]
			},
			{ type: 'step', index: 0 },
			{
				type: 'tools',
				tools: [
					runTool('pnpm add @adyen/api-library', '1 pacchetto aggiunto', { ms: 750 }),
					editTool('server/payments/adyen.ts', [54, 0]),
					editTool('server/config.ts', [8, 2], { par: true }),
					editTool('.env.example', [3, 0], { par: true })
				]
			},
			{ type: 'step', index: 1 },
			{
				type: 'agents',
				agents: [
					{
						name: 'PaymentsMigration',
						task: 'Creazione e conferma dei pagamenti',
						result: 'Pagamenti migrati: `createPayment` e 3D Secure passano da Adyen.',
						tools: [
							readTool('server/payments/stripe.ts', { ms: 300 }),
							readTool('src/checkout/submitOrder.ts', { ms: 300 }),
							webTool('docs.adyen.com/api-explorer/Checkout/71/post/payments', { ms: 400 }),
							editTool('server/payments/createPayment.ts', [46, 38], { ms: 400 }),
							runTool('pnpm test payments', '14 superati', { ms: 600 })
						]
					},
					{
						name: 'RefundsMigration',
						task: 'Rimborsi totali e parziali',
						result: 'Rimborsi migrati, i parziali seguono la tua scelta.',
						ask: {
							after: 2,
							questions: [qRimborsi]
						},
						tools: [
							readTool('server/payments/refund.ts', { ms: 300 }),
							grepTool('refunds.create', 'server/ · 4 risultati', { ms: 300 }),
							webTool('docs.adyen.com/online-payments/refund', { ms: 400 }),
							editTool('server/payments/refund.ts', [41, 33], { ms: 400 }),
							runTool('pnpm test refunds', '9 superati', { ms: 600 })
						]
					},
					{
						name: 'WebhooksMigration',
						task: 'Notifiche e firma HMAC',
						result: 'Webhook migrati, con verifica HMAC su ogni notifica.',
						tools: [
							readTool('server/routes/webhooks.ts', { ms: 300 }),
							webTool('docs.adyen.com/development-resources/webhooks/verify-hmac-signatures', { ms: 400 }),
							editTool('server/routes/webhooks.ts', [52, 47], { ms: 400 }),
							runTool('pnpm test webhooks', '11 superati', { ms: 600 })
						]
					}
				]
			},
			{ type: 'step', index: 2 },
			{
				type: 'text',
				text: 'I tre moduli sono migrati e i loro test passano. Prima di aggiornare il resto dei test ho bisogno di sapere come vuoi rilasciare il cambio.'
			},
			{ type: 'ask', questions: [qRilascio, qStripe] },
			{ type: 'step', index: 3 },
			{
				type: 'tools',
				tools: [
					editTool('tests/e2e/checkout.spec.ts', [22, 19]),
					editTool('tests/fixtures/adyen.ts', [61, 0], { par: true }),
					editTool('server/flags.ts', [7, 0], { par: true }),
					runTool('pnpm test', '431 superati', { ms: 900 }),
					runTool('pnpm typecheck', 'nessun errore', { par: true, ms: 500 })
				]
			},
			{ type: 'step', index: 4 },
			{
				type: 'text',
				text: (a: BenchAnswers) => {
					const rChoice = a.rilascio?.choices[0] ?? 0;
					const rLabel = qRilascio.options[rChoice]?.label;
					const sChoice = a.stripe?.choices[0] ?? 0;
					const sLabel = qStripe.options[sChoice]?.label;

					return `La migrazione da Stripe ad Adyen è completa e tutti i 431 test passano.

## Riepilogo

- **Rilascio**: impostato con **${rLabel}**.
- **Gestione Stripe**: configurato per **${sLabel}**.
- Webhook verificati con firma HMAC su endpoint protetto.
- Tutti i moduli sono pronti per il deploy.`;
				}
			}
		]
	},

	{
		key: '7',
		name: 'Storico lungo (~1000 entry)',
		hint: 'Carica 1000 voci storiche nel transcript per verificare le prestazioni della finestra di rendering e il bottone Carica precedenti.',
		prompt: 'Mostra un riassunto dei lavori svolti finora',
		preloadHistoryCount: 1000,
		parts: [
			{
				type: 'tools',
				tools: [
					readTool('docs/summary.md', { ms: 300 }),
					runTool('git log --oneline -n 20', '20 commit trovati', { ms: 400 }),
					thinkTool('Aggregazione dello storico della sessione', 500)
				]
			},
			{
				type: 'text',
				text: `Ho esaminato lo storico completo della conversazione (oltre 1.000 eventi registrati).

Tutte le operazioni precedenti sono state eseguite correttamente:
1. Impostazione della struttura base
2. Ottimizzazione delle query
3. Configurazione della pipeline di rilascio
4. Verifica delle prestazioni e benchmark completati.`
			},
			{
				type: 'notice',
				level: 'info',
				message: 'Storico di 1000 elementi caricato correttamente nella sessione'
			}
		]
	},

	{
		key: '8',
		name: 'Registrazione RPC: ask-real.ndjson',
		hint: 'Replay esatto della sequenza RPC registrata su omp 18.4.1 (domande ask e risposta interattiva)',
		prompt: 'Please immediately call the ask tool with two questions...',
		parts: [],
		ndjsonRaw: askRealRaw
	},

	{
		key: '9',
		name: 'Registrazione RPC: tools-real.ndjson',
		hint: 'Replay esatto della sequenza RPC multi-tool registrata su omp 18.4.1 (read, grep, bash, edit)',
		prompt: 'Perform these exact steps in order: read, grep, bash, edit...',
		parts: [],
		ndjsonRaw: toolsRealRaw
	}
];
