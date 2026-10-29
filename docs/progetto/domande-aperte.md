# Domande aperte

_Cio' che non e' deciso o non si e' trovato._

- I Gate da R2 a R8 non compaiono in `docs/DECISIONS.md` (si passa da R1 a R9): sono stati scartati, assorbiti altrove o mai scritti? [commit b997871]
- Il tag `v0.3.0` punta a un commit del 2026-07-30 rimasto fuori dallo storico pubblico, che riparte da `primo commit` il 2026-07-31: va tenuto, spostato o rimosso? [commit b997871]
- Perché l'interfaccia è diventata bilingue italiano/inglese: chi è il pubblico inglese previsto? Il commit c'è, il motivo non è scritto [commit 7333f06].
- Le decisioni prese dal 2026-10-07 in poi si ricostruiscono solo da commit e documenti: in `history.db` di questa macchina gli ultimi prompt del progetto sono del 2026-10-06 e non ci sono transcript di sessione per questa cartella (lavoro fatto dal Mac o da altre cartelle?).
- PRODUCT.md elenca la «dashboard di analytics» fra i non-obiettivi, ma il Gate R46 la rivede con le Statistiche: il non-obiettivo va aggiornato? [commit 7ffc4a7]
- Gate R35 (coda al reset della quota) e Gate R42 (Indica e disegna) risultano «da verificare» su Windows/macOS/Linux con omp reale: la verifica è stata fatta? [commit 4278971]
- Gate R47 (brief del Laboratorio): gli scenari completi del registro `docs/requisiti/laboratorio.md` restano da eseguire prima di dichiararlo superato [commit 7ffc4a7].

Automazioni e quote — proposta non ancora approvata: sostituire il contatore ambiguo dei processi con stati espliciti; distinguere lavori AI da manutenzione senza consumo AI; separare la riserva breve da quella settimanale e considerare più abbonamenti senza usare il minimo globale attuale. Da definire l’aggregazione delle capacità (percentuali non sommabili senza denominatore) e da verificare l’instradamento di omp verso un account effettivamente utilizzabile: oggi Studio passa il modello, non seleziona la credenziale nel lancio dei titoli. [sessione corrente]

Aggiornamento Automazioni (2026-10-29): le precedenti domande su pannello/quote e l’estensione a regole personali sono state affrontate nell’intervista. Registro canonico: docs/requisiti/automazioni.md, AUT-000/AUT-000A e AUT-001–106; 27 scenari di accettazione ancora non eseguiti. Scelte singole approvate, incluso motore Rust/SQLite, interfacciaA, icona terminale+orologio, Crea con AI e tray/menu bar. Resta soltanto la conferma finale della specifica complessiva; nessuna autorizzazione al codice o rilascio. Le prove finora sono diagnostica quota e prototipi browser, non prova della nuova funzione o delle integrazioni native. [sessione corrente]

Chiusura progettazione Automazioni (2026-10-29): conferma finale acquisita con «Confermo la specifica, senza implementare». Fa fede docs/requisiti/automazioni.md, stato approvato. Le precedenti proposte e domande della stessa sessione sono risolte dal registro; restano future attività di implementazione e verifica, non autorizzate ora. Qualsiasi nuovo vincolo che cambi comportamento/costi/permessi/perimetro richiede nuova decisione esplicita. [sessione corrente]
