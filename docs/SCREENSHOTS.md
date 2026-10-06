# Screenshot del README

Le immagini del README stanno in `assets/screenshots/` e vanno rifatte quando
l'interfaccia cambia in modo visibile (ultima richiesta: rilascio 1.7.0).
Non si possono produrre in cloud: serve l'app desktop vera. Il prompt qui sotto
è pensato per un agente locale (omp o Claude Code) sulla workstation Windows.

## Prompt per l'agente locale

````text
Obiettivo: produrre gli screenshot del README di OMP Studio e salvarli nel repo.

REGOLE (vincolanti):
- MAI PowerShell/pwsh/.ps1, nemmeno indiretto (Sophos termina la sessione). Usa Python
  (ctypes/user32, Pillow, mss, pyautogui) e cmd.exe.
- NON avviare una seconda istanza di OMP Studio (né `npm run tauri -- dev`, né l'exe):
  usa la finestra di OMP Studio già aperta. Se non è aperta, fermati e chiedimelo.
- Gli screenshot finiscono in un repo PUBBLICO: usa solo il progetto demo descritto sotto.
  Nessun nome di cliente, server, percorso personale, token, email o progetto aziendale.
  Se un'immagine mostra dati sensibili, rifalla.
- Non committare nulla: lascia i file nel working tree e mostrami `git status --short`.

PREPARAZIONE
1. Crea un progetto demo in C:\demo\omp-demo-app (git init, un piccolo progetto
   Svelte/TS o Node con 8-15 file, un paio di commit) e aprilo in Studio.
2. Tema scuro, lingua inglese (Impostazioni → Generale), finestra massimizzata
   a 1920x1080 con scala Windows al 100% (se la scala è diversa, ridimensiona poi
   alle misure indicate mantenendo le proporzioni).
3. Fai fare all'agente un compito vero ma breve sul progetto demo (es. "aggiungi una
   funzione di validazione email con test"), così la chat ha messaggi, gruppi di tool,
   diff e una TODO list.

CATTURA: cattura SOLO il rettangolo della finestra di Studio (GetWindowRect via
ctypes) o l'area indicata, senza bordo del desktop né barra delle applicazioni.
Formato PNG. Dopo la cattura ottimizza (Pillow optimize=True; se c'è pngquant/oxipng
usali) restando sotto i 400 KB per immagine.

FILE DA PRODURRE (cartella assets/screenshots/ del repo):
1. screen_hero.png    ~1920x1030  Finestra intera: barra progetti in alto con il
                                   progetto demo e almeno una corsia aperta, albero
                                   file a sinistra, chat al centro con risposta e
                                   gruppi di tool, colonna destra visibile.
2. screen_gui.png     ~780x980    Solo la colonna della chat: messaggi, un gruppo di
                                   tool espanso, composer in basso con un badge @file.
3. screen_tui.png     ~780x980    Stessa area ma in modalità terminale (omp TUI attivo).
4. screen_editor.png  ~820x980    Editor Monaco con un file del demo e una diff visibile.
5. screen_task.png    ~1920x1024  Task Editor aperto (modello, slider thinking) con la
                                   coda task che contiene 2-3 task.
6. screen_lanes.png   ~1920x1030  NUOVO: barra delle corsie con 2 corsie e la finestra
                                   "Revisiona e integra" aperta su una corsia con modifiche.
7. screen_github.png  ~1200x800   NUOVO: Impostazioni → GitHub (account demo o stato
                                   "non collegato", MAI un token visibile) oppure pannello
                                   Git con lo stato del repo demo.
8. screen_doctor.png  ~1200x800   NUOVO: Impostazioni → Studio Doctor dopo un controllo.

Sostituisci i file 1-5 esistenti con lo stesso nome; crea 6-8.

CONSEGNA: elenco dei file con dimensioni in pixel e KB, `git status --short`, e per
ogni immagine una riga su cosa mostra. Segnala qualsiasi schermata non ottenuta.
````
