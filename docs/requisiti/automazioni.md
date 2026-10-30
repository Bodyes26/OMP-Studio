# Automazioni — registro dei requisiti

## Stato del documento

Implementazione completata e integrata il 2026-10-29 in conformità con la specifica approvata e il contratto condiviso. Motore nativo autoritativo Rust con persistenza SQLite transazionale (AUT-106), runner comandi multipiattaforma (AUT-033, AUT-035, AUT-081), scheduler al minuto e trigger di calendario (AUT-009, AUT-020, AUT-037–040), osservatore nativo file e Git (AUT-004, AUT-008, AUT-013, AUT-016–019), runtime AI dedicato con confinamento fail-closed (AUT-021, AUT-025–028, AUT-041–044, AUT-086), quote aggregate multi-account (AUT-029–032, AUT-076–080), interfaccia utente completa con indicatore, popover, vista master-detail ed editor a 5 passi (AUT-049–053, AUT-096–105), presenza desktop e system tray nativa (AUT-045, AUT-054–058, AUT-084). Verifica di compilazione e test di suite superati (npm run check 0 errori, cargo check 0 errori, npm run check:commands 0 errori, npm test 319/319 superati).
## Origine e confini

- AUT-000 — Fonte: utente, 2026-10-29, «controllo aggiornamenti, git fetch e indici [...] lo toglierei proprio dalla visione dell'utente». Stato attivo. Tali operazioni continuano internamente, fuori da Automazioni e senza comandi ordinari di pausa/interruzione. Titoli AI visibili e configurabili. Scenario: l'utente vede un titolo AI in attesa ma non una riga per la manutenzione dell'indice. Migrazione: mantenere le operazioni, spostarle fuori dalla gestione utente; non rimuoverne le capacità.
- AUT-000A — Fonte: utente, 2026-10-29, «questo lavoro [...] condensalo in un'unica richiesta e schedulalo per eseguirlo ogni settimana». Stato attivo. Un agente di progetto può proporre una nuova automazione mediante un'integrazione supportata da Studio, con revisione guidata, non mediante modifica arbitraria dei file interni. Scenario: dalla chat nasce una bozza già compilata e revisionabile.

## Decisioni approvate

| ID | Fonte approvata | Requisito | Scenario concreto |
|---|---|---|---|
| AUT-001 | Q1: «Prompt oppure comando/script» | Una singola azione per automazione; niente workflow misti gestiti da Studio. | Uno script può contenere più comandi; Studio esegue una sola azione. |
| AUT-002 | Q2: «Bozza e conferma nella UI» | L'agente prepara bozze; attivazione e modifiche sostanziali richiedono revisione UI. | Una richiesta in chat non attiva silenziosamente una ricorrenza. |
| AUT-003 | Q3: risposta libera dell'utente | Destinatari anche singoli/multipli progetti, Studio o nessun progetto; selezioni dinamiche. | Eseguire ogni sera uno script sui progetti modificati nel giorno. |
| AUT-004 | Q4: «Anche eventi del progetto» | Manuale e calendario più eventi Git, file, agente e lifecycle, nei limiti specificati sotto. | Una modifica su un percorso filtrato attiva una regola. |
| AUT-005 | Q5: «Entrambe, scelta esplicita» | Esecuzione per destinatario con esiti separati, oppure unica sull'insieme. | npm test per progetto oppure report unico su tutti. |
| AUT-006 | Q6: «Aperti o registrati, a scelta» | Insieme di partenza esplicito, inclusioni/esclusioni; nessuna scoperta implicita nel disco. | Una regola include anche progetti registrati non aperti. |
| AUT-007 | Q7: «Filtri distinti ed espliciti» | Dirty attuale, attività locale rilevata e commit nel periodo sono filtri diversi; limiti di osservazione dichiarati. | Il lavoro già committato non scompare da un filtro attività. |
| AUT-008 | Q8: quattro famiglie selezionate | Git, file, agente, Studio/progetti; esclusi trigger su esito di altre automazioni. | Una regola non concatena automaticamente un'altra tramite esito. |
| AUT-009 | Q9: «Configurabile, default segnala» | Scadenze perse: segnala senza avviare di default; alternative ignora o recupera una sola entro ritardo massimo. | Riaprire dopo pranzo non pubblica automaticamente il lavoro delle 13:10. |
| AUT-010 | Q10: «Attende entro un limite» | Progetto occupato: attende, non interrompe, poi salta se scade. | Un agente interattivo mantiene la precedenza. |
| AUT-011 | Q11: «Configurabile, default raggruppa» | Una attiva e al massimo una successiva pendente; alternativa scarta nuove; nessuna sovrapposizione. | Molti eventi durante un lavoro non creano una coda illimitata. |
| AUT-012 | Q12: «No, avanzamento indipendente» | In modalità per destinatario i progetti avanzano indipendentemente. | Un progetto occupato non trattiene quelli disponibili. |
| AUT-013 | Q13: quattro eventi Git selezionati | Commit locale, cambio branch, transizioni pulito/modificato e modificato/pulito; escluse novità remote. | Un commit locale attiva la regola filtrata. |
| AUT-014 | Q14: tre eventi agente selezionati | Fine effettiva del lavoro, blocco quota, errore tecnico; esclusi richiesta risposta e avvio lavoro. | La fine di un turno con subagenti attivi non equivale a fine lavoro. |
| AUT-015 | Q15: «Avvio Studio e apertura progetto» | Nessun trigger di chiusura app/progetto. | Aprire un progetto può attivare la regola; chiuderlo no. |
| AUT-016 | Q16: «Progetti e cartelle locali scelte» | Watcher su percorsi locali espliciti con filtri; escluse cartelle di rete come sorgenti. | Una cartella esterna al repository può generare eventi. |
| AUT-017 | Q17: «Escludi effetti automatici e riallinea» | Lavori AI automatici esclusi dai trigger agente; regole Git/file interessate assorbono effetti durante esecuzione e riallineano senza trigger. Compromesso dichiarato su modifiche manuali contemporanee. | Uno script non si riattiva all'infinito sul proprio output. |
| AUT-018 | Q18: «Sì, configurabili in avanzate» | Eventi file: quiete 2s, attesa massima30s, configurabili. Non si applica a calendario/agente. | Salvataggi e formatter producono una sola attivazione raggruppata. |
| AUT-019 | Q19: «Sì, conserva tutti i motivi» | Deduplica pendenti per automazione/destinatario; unica sull'insieme deduplica per automazione; conserva trigger originari. | Commit e ritorno clean non producono due pendenti identiche. |
| AUT-020 | Q20: «Fuso esplicito per automazione» | Fuso precompilato dal sistema alla creazione, poi stabile e visibile. | Viaggiare non sposta silenziosamente le 13:10 italiane. |
| AUT-021 | Q21: «Sì, runtime dedicato senza focus» | Può eseguire sui registrati chiusi, con controllo/stato/stop visibili; AI dedicata, nessun omp per comandi. | Il progetto chiuso viene elaborato senza selezionarlo nella UI. |
| AUT-022 | Q22: «Principale, con vincolo branch opzionale» | Working tree principale, nessun checkout automatico; branch richiesto opzionale, incompatibilità in attesa limitata. | Non pubblica da un branch diverso da quello richiesto. |
| AUT-023 | Q23: «Dati e operazioni supportate» | Ambito Studio con dati e strumenti gestionali espliciti; nessun privilegio sui file interni o attivazione automatica di altre regole. | Un report può usare il catalogo progetti. |
| AUT-024 | Q24: «Sì, obbligatoria e visibile» | Directory di lavoro esplicita per azioni senza singolo progetto o uniche sull'insieme. | Il comando non eredita la cwd casuale del processo Studio. |
| AUT-025 | Q25: «Nuova sessione dedicata ogni volta» | Ogni esecuzione AI ha transcript proprio; nessuna chat interattiva o cronologia precedente implicita. | La ricorrenza settimanale non accumula la conversazione precedente. |
| AUT-026 | Q26: «Ruolo o modello per automazione» | Ruolo dinamico o modello fissato, risoluzione visibile; proposta iniziale default del progetto, selezione esplicita senza progetto. | Un cambio ruolo si riflette nel modello mostrato. |
| AUT-027 | Q27: «Conferme esistenti, nessuna deroga» | Attivare autorizza l'avvio, non future operazioni sensibili; nessun bypass delle regole. | Una pubblicazione che richiede conferma si ferma per l'utente. |
| AUT-028 | Q28: «Sessione dedicata e attenzione Studio» | Domande gestite con stato Chiede risposta, notifica e accesso alla sessione dalle superfici attenzione. | L'utente risponde e riprende la stessa esecuzione. |
| AUT-029 | Q29: «Separate, con override per automazione» | Politica riserva titoli separata dai default personali; override per regola personale. | Un lavoro personale non eredita la riserva dei titoli. |
| AUT-030 | Q30: «Capacità complessiva per finestra» | Quota aggregata normalizzata/pesata su capacità note, più account realmente utilizzabile e instradamento coerente; ignota se non calcolabile. | Account equivalenti24% e90% valgono57%, non minimo24% né114%. |
| AUT-031 | Q31: «Titoli30/30; personali10/10» | Riserve residue breve/settimanale distinte: titoli30%/30%, personali10%/10%, modificabili. Altre finestre non ignorate. | La UI distingue quale finestra protegge la riserva. |
| AUT-032 | Q32: «Aggiorna, poi attende se ignota» | Refresh prima dell'avvio; se riserva non verificabile attende entro limite. API a consumo distinte. | Dati mancanti non diventano100% disponibile. |
| AUT-033 | Q33: «Shell, eseguibile, file script» | Tre modalità comando esplicite, con argomenti/interprete/cwd visibili. | Eseguibile con argomenti non viene trasformato implicitamente in shell libera. |
| AUT-034 | Q34: «Piattaforme esplicite e varianti» | OS supportati e varianti dichiarati, niente traduzioni automatiche. | Una regola Windows-only non viene tentata su macOS. |
| AUT-035 | Q35: «No, non interattivi e con timeout» | Input chiuso, output consultabile, nessuna password automatica o terminale esterno nascosto. | Un login richiesto non rimane appeso senza limite. |
| AUT-036 | Q36: «Scelta, default nuova conferma» | Script cambiato richiede revisione di default; opzione segui file. Dipendenze non certificate; file di definizione sorvegliati esplicitamente. | Una modifica dello script autorizzato non viene approvata silenziosamente. |
| AUT-037 | Q37: «Fisso oppure dopo la fine» | Intervallo fisso e intervallo dalla fine sono modalità distinte. | Un lavoro lungo non genera pendenti nella seconda modalità. |
| AUT-038 | Q38: «Sì, salta e non duplica» | DST: orario inesistente saltato; ripetuto eseguito solo alla prima occorrenza. | Nessuna doppia pubblicazione nel cambio d'ora. |
| AUT-039 | Q39: «Al minuto, minimo un minuto» | Calendario al minuto, intervallo minimo1min; non real-time, ritardi di sistema trattati come scadenze perse. | Le13:10 sono un tentativo in quel minuto se ammissibile. |
| AUT-040 | Q40: «Sì,60min/15min» | Default attesa60min e recupero opzionale15min, configurabili; deduplica non rinnova la scadenza originale. | Eventi continui non tengono viva una pendente per sempre. |
| AUT-041 | Q41: «Una AI e un comando»; revisione titoli 2026-10-30 via ask: «Titoli fuori dal cap agenti» | Default un'automazione AI e un comando globali, configurabili; AI entro cap generale. Interattivo prioritario sulle automazioni, niente preemption. Titoli seriali a bassa priorita' rispetto alle automazioni AI personali, ma **non** attendono gli agenti interattivi: prima della revisione con due corsie al lavoro il titolo restava «in attesa» finche' una non si fermava. | Venti progetti non avviano venti agenti contemporaneamente. Con due corsie al lavoro, un task salvato dalla Companion riceve il titolo dopo la quiete di AUT-093. |
| AUT-042 | Q42: «Sì, esclusione per progetto» | Mutua esclusione lavoro Studio/comandi/AI sul progetto; azione unica acquisisce insieme completo senza lock parziali prolungati. Nessun controllo sui processi esterni. | Un test automatico non scrive mentre l'agente modifica lo stesso progetto. |
| AUT-043 | Q43: «Sì,30min comandi/60min AI» | Timeout obbligatori configurabili, AI tempo attivo; stop processi gestiti, output/esito, nessun retry automatico. | Un timeout di pubblicazione non causa una seconda pubblicazione automatica. |
| AUT-044 | Q44: «60min, progetto occupato» | Risposta umana60min configurabile: trattiene progetto, libera slot AI, riacquisizione alla ripresa; proroga esplicita; timeout conserva transcript. | L'attesa risposta non consuma uno slot attivo ma non permette modifiche concorrenti. |
| AUT-045 | Q45: «Conferma: resta o interrompi e chiudi» | Uscita effettiva con attivi mostra elenco e scelta; arresto controllato poi forzato dei processi gestiti, nessun rollback o continuazione nascosta. | Esci non lascia volutamente l'automazione attiva fuori da Studio. |
| AUT-046 | Q46: «Esito non verificato e sospendi regola» | Crash/uscita anomala con esito ignoto sospende la regola fino a revisione; nessun replay o ricorrenza successiva automatica. | Un effetto esterno forse già avvenuto non viene duplicato alla cieca. |
| AUT-047 | Q47: «Solo con consenso per automazione» | API a consumo default vietate; consenso esplicito per regola, revisione se ruolo cambia verso consumo non autorizzato; nessun tetto di spesa implicito. | Cambio modello del ruolo non autorizza silenziosamente una fattura API. |
| AUT-048 | Q48: «Variabili e segreti nel portachiavi OS» | Ambiente ereditato e override; segreti per riferimento nel vault OS, mai valori esportati; mascheratura output best effort. | Un export della regola non contiene il token. |
| AUT-049 | Q49: «Vista dedicata con elenco e dettaglio» | Gruppi Le tue/Titoli AI, filtri progetto/stato e apertura contestuale; impostazioni solo default comuni. | Dal progetto si apre la stessa vista filtrata, non un secondo editor. |
| AUT-050 | Q50: «Nome e stato prioritario esplicito» | Barra: Automazioni e stato attenzione→in corso→attesa; nessun numero nudo; popover riepilogo. Disabilitate non sono avvisi. | Un numero in barra dice sempre cosa conta. |
| AUT-051 | Q51: percorso5passi più nota utente | Editor: obiettivo/destinatari, azione, trigger, condizioni/permessi, riepilogo; modifiche aprono passo interessato e riconfermano. Crea con AI dedicato. | Bozza agente e creazione manuale usano lo stesso schema e revisione. |
| AUT-052 | Q52: «Dettaglio occorrenza integrato» | Trigger, destinatari, tempi, attese, output/exit code comandi e risultato/transcript AI, esiti parziali espliciti. | Un gruppo parzialmente fallito non appare interamente riuscito. |
| AUT-053 | Q53: «Problemi e interventi, successi opzionali» | Notifiche raggruppate per problemi/interventi; successi opzionali per regola; niente focus rubato, UI fonte consultabile. | Una regola ogni minuto non produce notifiche di successo continue. |
| AUT-054 | Q54: «Chiedi alla prima chiusura» | Prima chiusura propone uscita o permanenza nell'area di sistema, preferenza memorizzabile; minimizzazione distinta, Esci termina. | La X non cambia significato senza spiegazione. |
| AUT-055 | Q55: «Tutti i lavori normalmente» | Nascosto: continuano lavori e programmazioni con stesse garanzie; niente focus o chiusura implicita Companion. | Nascondere la principale non interrompe una chat in corso. |
| AUT-056 | Q56: «Sì, opzione separata disattivata» | Autostart al login opzionale, off iniziale, visibile o nascosto; niente servizio pre-login; recuperi invariati. | Riavvio PC non esegue tutte le scadenze perse. |
| AUT-057 | Q57: menu essenziale scelto | Stato, apri Studio, Automazioni, attenzione, Esci; nessuna pausa globale aggiuntiva o gestione manutenzione. | L'icona non duplica l'intero pannello. |
| AUT-058 | Q58: «Menu-only quando nascosto» | macOS nascosto solo menu bar; ripristino normale app da definire; Windows system tray. | Studio nascosto non resta anche nel Dock. |
| AUT-059 | Q59: «Ambito selezionato e contesto esplicito» | Assistente legge ambito selezionato e dati Studio necessari; chat origine via sintesi/messaggi selezionati, niente valori segreti o cronologia indiscriminata. | Propone npm test dopo aver verificato gli script del progetto. |
| AUT-060 | Q60: «Impostazione dedicata, iniziale smol» | Modello assistente dedicato, ruolo o modello selezionabile, iniziale smol; risoluzione visibile, cap e consenso costi, non riserva titoli. | Cambiare il modello dell'automazione non cambia per caso il suo assistente di creazione. |
| AUT-061 | Q61: «Sola lettura, scrittura/prova separate» | Assistente propone senza eseguire o modificare; script salvato solo confermando percorso/contenuto; prova reale distinta e autorizzata. | Generare una bozza di pubblicazione non la pubblica. |
| AUT-062 | Q62: «Sì, bozze riprendibili e modifiche» | Bozza e conversazione persistenti; modifica su copia, attiva invariata fino a conferma con diff sostanziale. | Chiudere a metà intervista non perde le risposte né attiva una regola incompleta. |
| AUT-063 | Q63: «Locali a Studio, export/import espliciti» | Archivio locale per regole/bozze/stato, nessuna sincronizzazione automatica o attivazione da Git. | Due macchine non eseguono la stessa regola per semplice sincronizzazione. |
| AUT-064 | Q64: «Sì, nuova revisione locale» | Import come bozza disattivata, revisione mapping/OS/modello/costi/segreti; export ordinario senza valori segreti, storico o conversazioni. | Una regola importata non avvia un comando prima della conferma. |
| AUT-065 | Q65: «90giorni,10MiB/run,200MiB totali» | Limiti configurabili; output progressivo e troncamento dichiarato senza bloccare il processo; attenzione non persa prima di revisione. Transcript AI con conservazione sessioni. | Un comando molto verboso non esaurisce memoria o disco senza limite. |
| AUT-066 | Q66: «Archiviazione ordinaria, elimina separato» | Archivia disattiva e conserva; eliminazione definitiva con conferma e scelta storico locale; nessuna rimozione implicita di effetti esterni o segreti condivisi. | Archiviare una pubblicazione non cancella il suo output esterno. |
| AUT-067 | Q67: «Versione attiva immutata, annulla pendenti» | Snapshot della versione avviata, pendenti annullate come superate; nuova configurazione per attivazioni future, senza partenza immediata. | Un prompt già attivo non cambia a metà quando si modifica la regola. |
| AUT-068 | Q68: «Sì, effetti distinti e visibili» | Disattiva annulla futuri/pendenti senza fermare attiva; stop selezionato non elimina ricorrenza; archivia disattiva ma attiva resta visibile. Riattivazione senza recupero periodo disattivato. | Disattivare non nasconde un processo ancora in corso. |
| AUT-069 | Q69: «Sì, stessi controlli» | Avvia ora sostituisce solo il trigger: controlli e raggruppamento invariati, calendario non spostato. | L'avvio manuale non aggira una riserva quota richiesta. |
| AUT-070 | Q70: «Nuovo tentativo manuale selettivo» | Propone falliti/saltati, non riusciti; esiti ignoti con revisione/conferma specifica; configurazione corrente e differenze visibili. | Riprovare un gruppo non ripubblica i destinatari già riusciti. |
| AUT-071 | Q71: «Continua dopo errore ordinario» | Intervallo dalla fine riparte dopo riuscita o errore ordinario; stop manuale, timeout o esito ignoto sospendono questa ricorrenza fino a revisione. | Un timeout non produce una nuova esecuzione non presidiata dopo l'intervallo. |
| AUT-072 | Proposta Q72 approvata | Destinatari dinamici risolti al trigger e congelati per occorrenza; prima dell'avvio solo ricontrolli, senza sostituzioni implicite. | Durante l'attesa non entrano progetti nuovi nell'esecuzione delle18:00. |
| AUT-073 | Proposta Q73 approvata | Periodi riferiti all'istante originario nel fuso della regola; oggi distinto da ultime24h; commit con timestamp committer e autore filtrabile; attività con copertura dichiarata. | Un avvio dopo mezzanotte non cambia il giorno selezionato dalla scadenza originaria. |
| AUT-074 | Proposta Q74 approvata | Contesto automatico solo metadati strutturati: trigger, tempi, ID, progetti/percorsi/file, commit/branch; niente contenuti/chat/segreti o interpolazione shell impliciti. | Un nome file con caratteri shell viene passato come dato, non eseguito. |
| AUT-075 | Proposta Q75 approvata | Eventi esterni inclusi dove osservati a Studio attivo/tray; baseline all'avvio e nessun replay eventi a Studio terminato, errori monitoraggio dichiarati. | Un salvataggio da altro editor puo' attivare la regola. |
| AUT-076 | Proposta Q76 approvata | Capacita' fisiche confrontabili se disponibili, altrimenti account equivalenti dichiarati; modello e pool corretti, niente duplicati o pesi inventati. | I due account Gemini possono superare la riserva complessiva anche se uno e' al24%. |
| AUT-077 | Proposta Q77 approvata | Tutte le finestre applicabili protette con riserva propria; finestre aggiuntive default30%titoli/10%personali; limiti estranei esclusi. | Un limite Claude condiviso non blocca Gemini se non gli si applica. |
| AUT-078 | Proposta Q78 approvata | Riserva controllata prima di avvio/ripresa, avviso durante run, niente stop automatico per solo attraversamento; nessuna garanzia di consumo massimo. | Un consumo concorrente non interrompe alla cieca una pubblicazione gia' partita. |
| AUT-079 | Proposta Q79 approvata | Nessun fallback modello/provider deciso da Studio; attesa e alternative esplicite. Configurazione nativa compatibile con permessi e costo autorizzato, modello effettivo nello storico. | Un blocco abbonamento non causa una chiamata API a consumo non autorizzata. |
| AUT-080 | Proposta Q80 approvata | Limite costo API per esecuzione opzionale, senza importo inventato; dove supportato limita ulteriori richieste, non quelle in volo o costi esterni/periodici. | La UI non presenta il limite nativo come tetto contabile rigido. |
| AUT-081 | Proposta Q81 approvata | Default Windowscmd/Unixsh, alternative installate esplicite; eseguibili separati; niente installazioni automatiche. PowerShell vietato sulla workstation corrente anche indirettamente. | Un interprete assente produce incompatibilita', non installazione nascosta. |
| AUT-082 | Proposta Q82 approvata | Ambiente Studio piu' override, niente profili shell caricati automaticamente; diagnostica percorsi/interprete/cwd senza valori segreti. | Un npm non risolto su macOS viene segnalato con correzione ambiente richiesta. |
| AUT-083 | Proposta Q83 approvata | Permessi/vault insufficienti bloccano con intervento manuale; niente elevazione automatica o fallback in chiaro. | Un portachiavi Linux assente non salva token in JSON. |
| AUT-084 | Proposta Q84 approvata | Niente nascondimento senza accesso di ripristino; fallback finestra/taskbar/Dock. Tray solo Windows/macOS; Linux gestione ordinaria. macOS riaperto torna nel Dock. | Un errore dell'icona non rende Studio irraggiungibile. |
| AUT-085 | Proposta Q85 approvata | Nessuna prevenzione standby/risveglio/pre-login; funziona da sveglio anche a sessione bloccata. Logout/shutdown non garantiscono dialogo, recupero secondo policy. | Un PC sospeso non pubblica fino al successivo recupero autorizzato. |
| AUT-086 | Q86: dati, coda, apertura/chiusura selezionati | Capacita' Studio incluse: consultazione dati selezionati, gestione coda, apertura/chiusura progetti. Escluse modifiche impostazioni. Altre automazioni solo bozze con conferma. | Un'automazione puo' predisporre task senza cambiare impostazioni globali. |
| AUT-087 | Proposta Q87 approvata | Insieme vuoto chiude senza eseguire e senza errore/notifica, ricorrenza prosegue; normale attesa scaduta non disabilita la regola. | Nessun progetto modificato non avvia una chiamata AI inutile. |
| AUT-088 | Proposta Q88 approvata | Esiti tecnici distinti dal risultato: comando exit0 completato, altro errore; AI terminata senza dedurre successo dal testo. Gruppi totali/parziali/nessuna esecuzione. | Una risposta AI rassicurante non certifica una pubblicazione riuscita. |
| AUT-089 | Proposta Q89 approvata | Output al limite troncato senza bloccare processo; stato operativo non salvabile blocca nuovi avvii. Esito finale non registrabile dichiarato non verificato. | Disco pieno non avvia nuove azioni prive di record durevole. |
| AUT-090 | Q90: conferma dedicata trasferimento completo | Rimossi controlli utente fetch/indice/aggiornamenti, operazioni mantenute. Preferenze/modelli/riserve titoli conservati; vecchio globale off diventa titoli off, non manutenzione off; task one-shot/reset invariati, non duplicati. | L'aggiornamento conserva titoli disabilitati e non duplica un task gia' programmato. |
| AUT-091 | Proposta Q91 approvata | Chiusura automatica progetti solo inattivi e autorizzati; occupati richiedono intervento, proprio progetto differito dopo esito salvato e ricontrollo; niente focus rubato. | L'automazione non termina il lavoro di un altro agente per chiudere una scheda. |
| AUT-092 | Proposta Q92 approvata | Chiusura manuale scheda con automazione chiede continua in background o interrompi; stato/output/stop restano accessibili. Chat normali non convertite in lavori autonomi. | Chiudere la scheda non lascia consumi nascosti senza spiegazione. |
| AUT-093 | Proposta Q93 approvata | Titoli task dopo salvataggio e2s quiete configurabile; rigenera al testo rilevante solo se automatico, preserva manuali, seriale e quota. | Modificare un titolo manuale non viene annullato dall'AI. |
| AUT-094 | Proposta Q94 approvata | Sessioni nuove dopo primo messaggio; storico solo Genera titoli mancanti con anteprima e quota. Sessioni automazioni gia' nominate regola/data senza AI aggiuntiva. | Abilitare titoli non scatena un recupero massivo dello storico. |
| AUT-095 | Proposta Q95 approvata | Watcher ricorsivo nell'ambito; preset .git/node_modules esclusi, visibili e modificabili, niente blacklist build/dist nascosta; collegamenti esterni non ampliano scope. | Un output dist puo' essere osservato se selezionato. |
| AUT-096 | Q96: disposizione A | Elenco e dettaglio affiancati, struttura stabile, filtri e selezione mantenuta. | Cambiare regola non richiede aprire una nuova finestra per l'esito. |
| AUT-097 | Q97: bottom bar e menu progetto | Vista completa globale o filtrata, nessuna nuova voce permanente nella sidebar. La sidebar nel prototipo e' illustrativa. | Dal progetto si apre direttamente il suo filtro. |
| AUT-098 | Q98 e precisazione successiva cron | Simbolo dedicato al job schedulato, non ingranaggio o play circolare; forma definitiva AUT-100. | L'icona richiama un job e non soltanto le impostazioni. |
| AUT-099 | Proposta Q99 approvata | Conversazione AI iniziale poi wizard compilato, passaggio ai campi possibile, bozza unica, nessuna sovrascrittura silenziosa di edit manuali, riepilogo finale. | L'utente interrompe l'intervista e completa i campi senza perdere dati. |
| AUT-100 | Q100 riformulata: «A — Terminale + orologio» | Icona finale terminale con orologio, anche per prompt; stato nel testo, spinner in attivita' e attenzione quando necessaria. | L'icona resta distinguibile alla dimensione della bottom bar. |
| AUT-101 | Proposta Q101 approvata | Contatore per occorrenze, non regole o processi OS; gruppo una volta, titoli singolarmente; stato unico attenzione>attiva>attesa, unita' esplicita nel tooltip/popover. | Dieci destinatari di un'occorrenza non vengono contati due volte come gruppo e figli. |
| AUT-102 | Proposta Q102 approvata | Preso visione per esiti conclusi senza convertirli in successo; domande/revisioni/esiti ignoti richiedono gestione effettiva. Scadenze segnalate/attese scadute in attenzione, vuoti/annullamenti intenzionali no. Notifiche maxuna/regola/5min con ripetizioni raggruppate. | Aprire il pannello non risolve automaticamente un esito non verificato. |
| AUT-103 | Proposta Q103 approvata | Fra ammesse, prima scadenza/evento piu' vecchio, niente priorita' per regola o salto coda Avvia ora. Interattivo prima, titoli ultimi; blocchi indipendenti saltati. | Una regola frequente non monopolizza la coda per il suo nome o tipo. |
| AUT-104 | Proposta Q104 approvata | Trigger alternativi, condizioni tutte necessarie, valori ammessi multipli dentro il singolo filtro; niente espressioni annidate o finestre orarie implicite. | Un evento agente non e' limitato al venerdi' solo perche' la stessa regola ha anche una scadenza venerdi'. |
| AUT-105 | Proposta Q105 approvata | AI unica sull'insieme con istruzioni applicabili di tutti i destinatari, ruolo/modello unico esplicito; conflitti richiedono intervento, nessun cambio modalita' automatico. | I vincoli del progettoY non spariscono perche' la cwd e' nel progettoX. |
| AUT-106 | Proposta Q106 approvata | Autorita' nativa unica Rust, SQLite locale transazionale per versioni/bozze/occorrenze/stato, output limitato separato e segreti nel vault; UI proiezione/conferme, runtime AI integrati, nessun servizio esterno. | Nascosta la UI o aperta Companion, la stessa scadenza non viene assegnata due volte. |

## Vincoli tecnici e prove disponibili

- Analisi read-only del 2026-10-29: scheduler corrente orientato ai progetti aperti e scadenze singole; supporto a registrati chiusi/ricorrenze da implementare. Riferimenti: `src/lib/stores/scheduleRunner.svelte.ts`, `src/lib/lanes/autoDispatchArbiter.ts`, `src/lib/quota/scheduleQueue.ts`, `src/routes/+page.svelte`; GateR35 in `docs/DECISIONS.md`.
- Analisi read-only: chiusura principale distrugge le sessioni ed esce, nessun tray configurato nei punti esaminati; alcuni poller si arrestano con finestra nascosta. Riferimenti: `src-tauri/src/lib.rs:414-427,459-461,490-506`, `src-tauri/Cargo.toml:21`, `src/lib/utils/windowActivity.svelte.ts:60-63`.
- Analisi read-only: runner differenti hanno garanzie diverse su cwd/cancellazione/albero figli. Automazioni richiede una gestione esplicita e verificata per piattaforma, non il riuso cieco del runner titoli. Riferimenti: `src-tauri/src/directives_ops.rs`, `src-tauri/src/process_tree.rs`, `src-tauri/src/pty/mod.rs`, `src-tauri/src/rpc/mod.rs`.
- Smoke diagnostico eseguito il 2026-10-29 sulla funzione reale `evaluateQuotaGate`, senza modifiche e con report sintetici: A settimana24%/breve80% + B90%/80% produce `paused:true,remainingPct:24`; B da solo produce `paused:false,remainingPct:80`. Dimostra il comportamento del gate attuale, non la correzione o le quote degli abbonamenti reali.
- Lettura reale non mutante `omp usage --json`, 2026-10-29: due report Gemini con residui settimanali56,50763%/23,616107% e5h100%/96,94481%; metadata senza piano/capacita' fisiche. Aggregato nativo: settimana0,80123737 account equivalenti su2 e5h1,9694481su2. Dati al momento della lettura, non previsioni o verifica del nuovo gate. Nessuna identita' o credenziale registrata.
- `omp --help` letto il2026-10-29: espone `--max-cost`, con avviso di possibili richieste in volo oltre limite, e `dry-balance`; non dimostra l'instradamento effettivo dei nuovi runtime. Il caso account limitato+account disponibile resta un criterio di accettazione da esercitare.
- Prototipo UI locale non esecutivo `proto/automazioni-specifica-prototype.html`: strutturaA approvata, schede di revisione e cornice sidebar non sono navigazione di produzione; icona definitiva da `proto/automazioni-cron-icone-prototype.html`, varianteA. `proto/automazioni-icona-prototype.html` conserva alternative non scelte. Prototipi non versionati, non codice di produzione.
- Smoke browser2026-10-29 del prototipo: tre layout selezionabili, wizard/assistente illustrativo/popover/menu illustrativo; a1200x800 e1024x640 niente overflow orizzontale, barra inferiore entro viewport. Prototipo icone selezioneA/B/C funzionante. Non e' prova di tray nativo, agenti, shell o nuova funzione.
- Nessuna esecuzione della nuova funzione, nessuna prova tray/macOS/Linux effettuata. Su questa workstation non avviare PowerShell, nemmeno indirettamente; non avviare una seconda istanza desktop di Studio.

## Conferma finale

Il 2026-10-29 l'utente conferma tramite ask: «Confermo la specifica, senza implementare». Conferma complessiva acquisita per AUT-000, AUT-000A, AUT-001–AUT-106, contratto operativo e matrice di accettazione. Progettazione conclusa; implementazione e verifiche della nuova funzione restano da eseguire dopo un'autorizzazione separata. La conferma non autorizza commit o pubblicazione.

## Contratto operativo consolidato

### Confine della funzione

Automazioni comprende regole personali e titoli AI. La manutenzione interna continua fuori dalla vista e dai comandi ordinari dell'utente. Non e' un gestore di tutti i processi del sistema.

Azioni personali: un prompt AI oppure un comando shell/eseguibile/script. Destinatari statici o dinamici: uno/piu' progetti, Studio, ambito senza progetto. Una esecuzione per destinatario oppure una sola sull'insieme. Un insieme vuoto non avvia processi.

Avvii: manuale, data/ora singola, intervallo fisso, intervallo dalla conclusione, giornaliero, settimanale e gli eventi approvati. Non sono inclusi cron testuale/calendari avanzati, webhook, workflow multiazione, concatenazioni tra automazioni o regole logiche annidate. L'icona cron non aggiunge implicitamente un interprete di espressioni cron.

### Oggetti e stati

- **Definizione:** identita' stabile, versione, nome, origine, azione, destinatari, trigger, filtri, fuso, limiti, politica quota/costi/OS/segreti. La revisione approvata e' distinta dalla bozza.
- **Occorrenza:** un'attivazione con istante originario, motivi raggruppati, versione immutabile e snapshot dei destinatari. Il gruppo non viene ricontato insieme ai suoi figli.
- **Esecuzione per destinatario:** ammissione e risultato individuali; per azione unica sull'insieme c'e' una sola esecuzione con acquisizione di tutti i progetti.
- **Evidenza:** output/codice uscita o risultato/transcript AI, tempi, modello effettivo, blocchi, interruzioni e gestione dell'attenzione. Nessun esito funzionale inferito dal testo AI.

Regola: bozza, abilitata, disabilitata, sospesa per revisione, archiviata. Una regola disabilitata o archiviata puo' ancora avere un'esecuzione avviata da mostrare e controllare.

Occorrenza: programmata, in attesa con motivo, in esecuzione, chiede risposta, conclusa tecnicamente, errore, timeout, interrotta, saltata/annullata con motivo, esito non verificato. Un gruppo espone anche risultati parziali. Preso visione e' separato dall'esito e dalla riabilitazione.

### Percorso di esecuzione

1. Il coordinatore osserva scadenza/evento e applica trigger, filtri e protezioni anti-ciclo. Salva l'occorrenza e la sua identita' prima di produrre effetti.
2. Risolve i destinatari al trigger, nel periodo/fuso originario; conserva motivi raggruppati e limite temporale iniziale, senza rinnovi infiniti.
3. Per ogni ammissione ricontrolla versione/autorizzazione, percorsi, interprete/file, piattaforma, branch, conflitti, slot e quota/costo pertinenti. Informazioni indisponibili non diventano permesso o quota inventati.
4. Usa esclusione per progetto e limiti globali; per azione unica non trattiene un sottoinsieme di lock mentre aspetta gli altri. I lavori interattivi hanno precedenza sulle automazioni; i titoli hanno bassa priorita' rispetto alle automazioni ma non attendono gli agenti interattivi (AUT-041, revisione 2026-10-30).
5. Registra la transizione di avvio e assegna un runtime gestito. AI in sessione dedicata con strumenti Studio ammessi e conferme esistenti; comando con cwd/interprete/argomenti/ambiente espliciti e input non interattivo.
6. Raccoglie progressivamente output/stato e gestisce timeout/stop sull'albero di processi controllato. Un progetto chiuso ha un runtime dedicato accessibile da Automazioni, non una scheda aperta con focus rubato.
7. Una domanda umana mantiene il progetto occupato e libera lo slot AI; la risposta riacquisisce lo slot e ricontrolla l'ammissione prima di riprendere.
8. Salva esito e riferimenti, libera risorse, aggiorna ricorrenza/attenzione/notifiche. Errori ordinari non sono retry immediati. Un arresto dall'esito ignoto sospende la regola e non viene riprodotto.

Se un percorso e' spostato o irraggiungibile si richiede correzione esplicita; niente sostituzione con una cartella dal nome simile. Le definizioni non devono perdere la destinazione per la sola rimozione della scheda o la gestione della lista dei progetti recenti.

### UI definitiva

- Bottom bar: icona **terminale+orologio**, nome Automazioni e stato prioritario con numero di occorrenze. Tooltip esplicita l'unita' e tutti i conteggi.
- Popover: cosa sta succedendo, attenzione/attese motivate, prossime scadenze e accesso alla gestione; niente configuratore completo.
- Vista dedicata: elenco a sinistra e dettaglio a destra, gruppi Le tue/Titoli AI, ricerca/filtri progetto e stato, accesso dal menu progetto gia' filtrato. Nessuna sidebar permanente aggiunta.
- Dettaglio regola: configurazione approvata, eventuale bozza, prossime scadenze, esecuzioni e azioni distinte Avvia ora/Disattiva/Interrompi/Archivia/Elimina.
- Dettaglio occorrenza: motivi, versione, selezione effettiva, tempi/attese, singoli destinatari, esiti, output/exit code o risultato/transcript; azioni di risposta, presa visione o nuovo tentativo selettivo.
- Editor cinque passi: obiettivo/destinatari; azione; calendario/eventi; condizioni/permessi; riepilogo. Bozza agente e creazione manuale usano gli stessi dati e validazioni.
- Crea con AI: conversazione dedicata inizialmente su smol, ambito di lettura selezionato e campi compilati senza sovrascritture manuali nascoste. Si passa al wizard in qualsiasi momento. File e prove reali richiedono gesti separati.
- Prima attivazione/modifica sostanziale: riepilogo leggibile di azione, destinatari, tempi/fuso, effetti, piattaforme, quote/costi, ritardi e conferme; nessuna attivazione da semplice import o salvataggio bozza.
- Aspetto e accessibilita': DESIGN/PRODUCT esistenti, temi dell'app, italiano/inglese, tastiera, focus visibile, nomi accessibili, stato non affidato al solo colore e movimento ridotto. Il prototipo non sostituisce i componenti Svelte di produzione.

### Impatto tecnico su Studio

1. **Coordinatore Rust:** unica autorita' di calendario/eventi, deduplica, occorrenze, ammissione e lifecycle; non dipende da timer di una finestra visibile. SQLite locale con transazioni per definizioni/versioni/bozze e registri. Nessun servizio esterno.
2. **Ammissione e runtime:** integra le garanzie dell'arbitro esistente senza duplicarne i permessi; runtime AI dedicati anche per registrati chiusi; runner comandi con cwd/ambiente/output/exit code/timeout e gestione figli per piattaforma. Stato di risorse indisponibile significa attesa, non bypass.
3. **Eventi:** ponte strutturato dai lifecycle Studio/agente e osservazione Git/file locale nel perimetro selezionato; baseline e copertura esplicite; origine automatica gestita per evitare auto-attivazioni.
4. **Quote:** risoluzione effettiva ruolo/modello e pool pertinenti; finestre separate, totale normalizzato e account realmente utilizzabile; integrazione con il comportamento di account di omp, da provare sul percorso effettivo. Non basta correggere una funzione di visualizzazione.
5. **Integrazione agenti:** strumenti strutturati per leggere stato/esiti nell'ambito e proporre creazione/modifica di bozze; revisione aperta in Studio. Nessun potere di attivazione/modifica sostanziale senza il gesto UI approvato. Il configuratore AI ha strumenti di lettura, non semplici istruzioni verbali a non scrivere.
6. **Frontend Svelte:** proiezione dello stato nativo, comandi/conferme e superfici definite sopra; una Companion non crea un secondo scheduler. L'assistente di configurazione e' interattivo, non un'esecuzione ricorrente.
7. **Presenza OS:** tray Windows, menu-only macOS quando nascosto e Dock ripristinato alla riapertura; autostart separato e off iniziale, scelta prima chiusura, fallback raggiungibile. Esci/aggiornamento con riavvio applicano l'uscita effettiva, non il nascondimento; annullare l'uscita non deve gia' aver ucciso lavori.
8. **Cutover:** manutenzione interna mantenuta e controlli rimossi secondo AUT-090; preferenze titoli conservate e storico non recuperato automaticamente; task one-shot/reset esistenti non convertiti o duplicati.

Sono responsabilita' da implementare, non dichiarazioni di funzionalita' gia' disponibili. Non si copiano i prototipi HTML come implementazione, non si modifica omp fuori da questo repository alla cieca e non si aggirano dipendenze native mancanti con account/modelli/stati fittizi.

### Limiti e rischi esplicitamente accettabili solo entro questo contratto

| Rischio | Limite/risposta prevista |
|---|---|
| Quota consumata da altri lavori o da richieste in volo | Riserva di ammissione, non budget garantito; account/pool corretti e avviso, limite reale del provider sempre valido. |
| Account-equivalenti vs piani diversi | Unita' dichiarata, niente promessa di capacita' fisica non comunicata dal provider. |
| Effetti esterni e crash | Niente exactly-once o rollback garantito; esito non verificato e revisione, nessun replay cieco. |
| Script con permessi dell'utente | Nessuna sandbox o elevazione; rete/file/DB possono essere modificati. Una prova e' un'esecuzione reale, non un dry-run inventato. |
| Segreti incollati in prompt/script/file | Il vault protegge i valori gestiti da Studio, non rende privo di segreti il contenuto arbitrario; export/output/contesto vanno revisionati, mascheratura best effort. |
| Modifiche di script/dipendenze e processi esterni | Controllo file autorizzati non certifica l'intero grafo o l'assenza di modifiche concorrenti esterne; niente isolamento del filesystem promesso. |
| Figli/processi distaccati o servizi remoti | Stop agisce sui processi effettivamente gestiti. Detach intenzionale e servizi indipendenti non diventano controllabili per magia; nessuna garanzia universale su processi che sfuggono al contenimento OS. |
| Windows | Wrapper corretto per cmd/bat/npm.cmd, quoting, PATH e albero processi; antivirus/policy possono bloccare. Su questa workstation PowerShell non si esegue neppure indirettamente. |
| macOS | PATH da GUI, autorizzazioni cartelle/Keychain, menu/Dock e background da provare nativamente; nessuna equivalenza automatica con la shell login. |
| Linux | Shell/permessi e vault desktop possono mancare; niente tray promesso, fallback normale e blocco esplicito dei segreti indisponibili. |
| Standby/logout/aggiornamento/crash | Nessuna esecuzione a computer sospeso o app terminata; politica ritardi e riconciliazione, normale dialogo non garantito durante shutdown forzato. |
| Tanti destinatari con slot limitati | Il limite di attesa include la coda: un gruppo grande puo' avere destinatari saltati. Il riepilogo mostra limiti, l'utente puo' dimensionarli. |
| Anti-ciclo durante lavori automatici | Il riallineamento puo' assorbire modifiche manuali contemporanee; compromesso dichiarato, non attribuzione perfetta dei cambiamenti. |
| Dati non persistibili o output enorme | Nuovi avvii bloccati senza record operativo, output troncato dichiaratamente; non si certificano esiti non salvati. |

## Matrice di accettazione da esercitare dopo l'implementazione

**Stato di tutte le righe: non eseguita.** Usare progetti/record/script di prova e operazioni senza effetti esterni; mai pubblicazioni reali o scritture sul DB di produzione come smoke implicito. Ogni verifica dovra' riportare data, piattaforma, risultato ed evidenza. Build, test unitari o wiring non sostituiscono lo scenario reale.

| Caso | Requisiti principali | Scenario e risultato richiesto |
|---|---|---|
| ACC-01 | AUT-001,002,051,061,099 | Dalla chat condensare un lavoro in regola settimanale: bozza completa/revisionabile, zero avvii prima della conferma. |
| ACC-02 | AUT-059,060,061,062 | Crea con AI legge un progetto di prova, riconosce uno script gia' presente, fa solo domande mancanti, non esegue/scrive; bozza e conversazione riprendibili. |
| ACC-03 | AUT-033,035,081,082 | npm test su fixture reale senza avviare omp, cwd/interprete corretti, output ed exit code osservati su piattaforma. |
| ACC-04 | AUT-005,012,042,052 | Gruppo con un destinatario occupato: l'altro procede, risultato parziale trasparente e nessun doppio conteggio. |
| ACC-05 | AUT-003,006,007,021,072,073 | A scadenza seleziona i registrati coerenti coi filtri; chiusi eseguibili senza focus, insieme congelato e tempo originario preservato. |
| ACC-06 | AUT-004,008,013,014,015,075 | Esercitare ciascun trigger approvato, incluso esterno dove osservabile; fine turno con background vivo non genera fine lavoro. |
| ACC-07 | AUT-016,018,019,095 | Raffica salvataggi in fixture locale: una pendente, motivi conservati, quiete/max attesa corretti, esclusioni e link esterni rispettati. |
| ACC-08 | AUT-017 | File/commit/fine agente prodotti da automazione non creano ciclo; riallineamento e compromesso manuale documentati. |
| ACC-09 | AUT-009,020,037,038,039,040,085 | Data singola, giornaliera, settimanale e due intervalli, DST, cambio fuso, standby e riapertura: niente duplicati e recuperi solo secondo politica. |
| ACC-10 | AUT-010,011,040,041,103 | Attese, slot, raggruppamento/scarto e ordine fra ammesse: nessuna starvation da tipo fisso o rinnovo infinito dell'occorrenza. |
| ACC-11 | AUT-022,024,074,104 | Branch errato/percorsi con caratteri shell/condizioni non soddisfatte: blocco corretto, dati non eseguiti come shell, trigger alternativi senza condizioni implicite. |
| ACC-12 | AUT-025,026,027,028,044,105 | Prompt prova in sessione nuova rispetta istruzioni; chiede conferma, libera slot ma mantiene progetto, ripresa con ri-verifica. Aggregato conflittuale non decide precedenze da solo. |
| ACC-13 | AUT-029,030,031,032,076 | Due abbonamenti di cui uno sotto30% e totale sopra riserva: titoli ammessi ed account utilizzabile effettivamente usato, non solo badge corretto. |
| ACC-14 | AUT-030,077 | A settimanale disponibile/breve esaurita e B inverso: niente account virtuale; pool condivisi deduplicati e limiti modello corretti. |
| ACC-15 | AUT-032,078,079,080 | Dati quota ignoti, calo in corsa, modello bloccato e budget opzionale: nessun100% inventato, no cambio provider/costi non autorizzato, limiti nativi espliciti. |
| ACC-16 | AUT-034,036 | OS non supportato, interprete assente e script modificato: nessun tentativo tradotto o contenuto nuovo approvato silenziosamente. |
| ACC-17 | AUT-035,043,045 | Comando con figli ordinari e output abbondante: timeout/stop controllano albero gestito, niente pipe bloccate; UI conserva il motivo. |
| ACC-18 | AUT-045,046,055,084,106 | Nascondere non ferma lavori; annullare Esci non uccide processi; Esci confermato interrompe; crash riconcilia senza replay e sospende ignoti. |
| ACC-19 | AUT-047,048,063,064,083 | Ruolo che passa a consumo, vault assente/bloccato, export/import altra macchina: consenso e mapping richiesti, niente valori vault esportati/fallback in chiaro. |
| ACC-20 | AUT-065,066,089 | Superare cap output/spazio, retention e rimozione: troncamento esplicito, stato prima di avvio, esiti non falsificati, archiviazione e delete distinti. |
| ACC-21 | AUT-067,068,069,070,071 | Edit/disattiva/stop mentre attiva o pendente, avvio manuale e nuovo tentativo parziale: snapshot invariati, nessun retry di riusciti/ignoti senza consenso. |
| ACC-22 | AUT-049,050,052,053,096,097,098,100,101,102 | UI reale: filtri, dettagli, conteggi per occorrenza, presa visione, stati e notifiche raggruppate; nessun badge processi/regole ambiguo. |
| ACC-23 | AUT-054,055,056,057,058,084,085 | Windows tray/macOS menu-only nativi: prima chiusura, autostart off/on, ripristino/Dock, icona indisponibile, sleep/logout. Linux senza nascondimento irraggiungibile. |
| ACC-24 | AUT-000,090,093,094 | Migrare preferenze reali di prova: manutenzione continua e invisibile, titoli off/modelli/soglie conservati, manuali non sovrascritti, storico solo su richiesta, nessun duplicato one-shot/reset. |
| ACC-25 | AUT-087,088,091,092 | Nessun destinatario, chiusura progetto da AI, propria chiusura differita e chiusura manuale durante run: nessuna interruzione altrui o successo funzionale fittizio. |
| ACC-26 | AUT-051,096,099 e DESIGN | UI nativa a1024x640 e dimensioni usuali, temi supportati, IT/EN, tastiera/focus/lettore schermo/movimento ridotto; prototipi non spacciati per prova nativa. |
| ACC-27 | AUT-023,086,091,104,106 | Strumenti Studio effettivi: dati/coda/apertura/chiusura ammessi; impostazioni e attivazione automazioni senza UI negati; Companion non duplica l'assegnazione. |

### Regola di arresto prima/durante lo sviluppo

Qualsiasi impossibilita' del runtime omp, vincolo OS o caso con effetti utente non coperto da questo contratto riapre una decisione con l'utente. Non autorizza a ridurre il perimetro, aggiungere fallback, saltare verifiche o dichiarare una garanzia non dimostrata. Nomi privati e dettagli interni restano scelte ingegneristiche entro il contratto, non possono cambiare comportamento, costi, permessi o UI approvati.
