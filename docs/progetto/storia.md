# Storia

_Tappe e svolte del progetto, comprese le strade abbandonate._

## Luglio 2026 — nascita

- 2026-07-30: prima versione 0.1.0, guscio desktop multi-progetto per `omp` con terminale, albero dei file, editor Monaco e pannello consumi; la barra nativa di Windows resta perché quella custom rompeva snap e ridimensionamento (Gate R1) [sessione 019fb1a4] [sessione 019fb2cf].
- 2026-07-31: pubblicazione su GitHub con storico azzerato in un unico commit e PR esterne chiuse in automatico [commit b997871] [commit dc30218].

## Agosto 2026 — da guscio a strumento completo

- 0.2–0.3 (2026-08-03): temi condivisi con `omp`, chiari e scuri; interfaccia più silenziosa, schede editor [commit 761920d] [commit c13dbf7].
- 0.3.1 (2026-08-13): supporto macOS [commit 4714dbd].
- 0.4–0.6 (2026-08-17/20): aggiornamenti dentro l'app, reset delle quote, gestione di provider, modelli e ruoli con suggerimenti [commit 80bbc96] [commit c67dd70] [commit b28c593] [commit 9d46931].
- 0.7–0.8 (2026-08-21): pannello Git con timeline, whiteboard per diagrammi e sandbox per prototipi [commit f37c49e].
- 0.9 (2026-08-24): coda dei task e release multipiattaforma [commit 1d36d01].
- 1.0 (2026-08-24): seconda superficie GUI sopra `omp --mode rpc-ui`, accanto alla TUI (Gate R10) [commit a8e414f].
- 1.1 (2026-08-24): canale Nightly accanto allo stabile [commit ba3354f].
- 1.2 (2026-08-26): barra progetti configurabile, primo avvio guidato, notifiche di sistema, hardening dell'updater [commit 15f249a].

## Settembre 2026 — più agenti in parallelo

- 1.3 (2026-09-01): build Linux, catalogo modelli con più account [commit 72911f0].
- 1.4 (2026-09-02): quote da sorgenti dichiarate dall'utente, modalità di accodamento all'invio [commit 5687bea].
- 1.5 (2026-09-08): Browser Studio dentro la colonna centrale, finestra Companion, layout verticale [commit b663e4e].
- 1.6 (2026-09-21): Laboratorio prototipi, interfaccia bilingue, righe unificate per todo e subagenti [commit 227f823].
- 2026-09-22/28: integrazione GitHub, corsie su worktree (Gate R27), Laboratorio come corsia (Gate R30), chat GUI 2.0 (Gate R32) [commit 5bafba1] [commit 550f804] [commit c5aff56] [commit 9725b17].

## Ottobre 2026 — maturità

- 1.7 (2026-10-07): corsie e design v2 in tutta l'app, nuovo logo, adozione delle funzioni RPC di omp 18.4–18.8 [commit a48f6c4] [commit e26569e] [commit 1e857b9].
- 2026-10-08: dieci lavori in parallelo uniti in un colpo (Piano, `/btw`, `/loop`, obiettivo guidato, heads-up, diario di progetto, Indica e disegna, coda al reset) e corsie guidate dall'agente [commit 4278971] [commit 2eea761].
- 1.8 (2026-10-20): controllo remoto con relay self-hosted e PWA (Gate R44), registro di vita `studio.log` [commit 7e2f519] [commit 85f61c3] [commit 1968acf].
- 1.9 (2026-10-27): riga corsie sempre presente, loghi dei provider, migrazione a SvelteKit 3, layout dei pannelli ricordati [commit 484607e] [commit f061541] [commit 0183c71].
- In corso (Unreleased): lavori in background unificati, statistiche da `stats.db`, brief approvati nel Laboratorio [commit 3b06bea] [commit 7ffc4a7].
