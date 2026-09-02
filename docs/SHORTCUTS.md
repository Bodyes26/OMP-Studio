# Scorciatoie da tastiera

OMP Studio delega l'intero blocco di tasti e scorciatoie convenzionali (incluse quelle con `Ctrl` e `Alt`) al terminale PTY, tranne quando il fuoco e' nell'editor Monaco. In quel caso le scorciatoie di gestione file agiscono solo sul file attivo, senza intercettare input del terminale.

Le scorciatoie globali catturate dall'app vivono dietro il modificatore **`Ctrl+Alt`** e la guida di aiuto **`Alt+H` / `Alt+K` / `F1`**, che non collidono con le combinazioni primarie di `omp`.

| Scorciatoia | Contesto | Azione |
|---|---|---|
| `Alt+H` / `Alt+K` / `F1` | Globale | Apre la guida alle scorciatoie da tastiera con layout a 2 colonne e filtro |
| `Ctrl+Alt+N` | Globale | Nuovo progetto (apre selettore cartella) |
| `Ctrl+Alt+S` | Globale | Apre una chat Scratchpad (temporanea, `--no-session`) |
| `Ctrl+Alt+U` | Globale | Apre e chiude il pannello consumi (quote) |
| `Ctrl+Alt+,` | Globale | Apre le impostazioni di Studio (Generale, Barra progetti, Editor & Terminale, Task & Agenti, Modelli) |
| `Ctrl+Alt+M` | Globale | Apre le impostazioni direttamente sulla sezione Modelli (Ruoli, Catalogo, Provider) |
| `Ctrl+Alt+T` | Globale | Apre e chiude la vista aggregata dei task in attesa su tutti i progetti |
| `Ctrl+Alt+A` | Globale | Passa tra la superficie TERMINAL e la superficie GUI conservando la sessione |
| `Ctrl+Alt+Freccia Destra` | Globale | Passa al progetto aperto successivo, nell'ordine mostrato in barra |
| `Ctrl+Alt+Freccia Sinistra` | Globale | Passa al progetto aperto precedente, nell'ordine mostrato in barra |
| `Ctrl+Alt+Maiusc+Freccia` | Globale | Sposta la tessera del progetto attivo a destra o a sinistra (ordinamento manuale) |
| `Ctrl+P` | Superficie GUI | Cicla sequenzialmente tra i ruoli configurati (`default` → `plan` → `smol`...) |
| `Alt+R` | Superficie GUI | Apre il menu rapido di selezione del ruolo con filtro e navigazione |
| `Alt+P` | Superficie GUI | Apre il catalogo modelli con filtro rapido e navigazione tastiera |
| `Alt+M` | Superficie GUI | Apre il menu di selezione del livello di thinking (ragionamento) |
| `Alt+T` | Superficie GUI | Cicla direttamente il livello di thinking (`off` → `max`) |
| `Alt+Q` | Superficie GUI | Apre le impostazioni della coda (steering, follow-up, interruzione) |
| `Alt+S` | Superficie GUI | Alterna rapidamente la modalità steering (`one-at-a-time` / `all`) |
| `Alt+C` | Superficie GUI | Interrompe la risposta in corso o cancella il testo scritto |
| `Ctrl+C` | Superficie GUI | Interrompe la risposta in streaming (quando non c'è testo evidenziato) |
| `Alt+E` | Superficie GUI | Mette a fuoco il campo di scrittura del Composer |
| `Alt+N` | Superficie GUI | Apre una nuova chat nel progetto attivo |
| `/` | Composer GUI | Apre la palette dei comandi slash disponibili |
| `Alt+1` … `Alt+6` | Composer GUI | Precompila il composer con il suggerimento in quella posizione (non invia) |
| `Invio` | Composer GUI | Invia; con la palette aperta seleziona il comando evidenziato |
| `Maiusc+Invio` / `Ctrl+Invio` | Composer GUI | Inserisce una nuova riga |
| `Esc` | Composer GUI | Chiude palette/menu/modale aiuto; durante lo streaming interrompe la risposta |
| `Ctrl+0` | Diagramma a fuoco | Adatta il diagramma alla finestra |
| `Ctrl+S` | Editor | Salva il file corrente e lo notifica |
| `Ctrl+W` | Editor | Chiude il file corrente |
| `Ctrl+F4` | Editor | Chiude il file corrente |
| `Click destro` / `Menu` / `Shift+F10` | Tessera progetto | Apre il pannello del progetto e lo tiene fissato (al posto del menu della WebView) |
| `Click destro` / `Menu` / `Shift+F10` | Campi di testo / Input | Apre il menu contestuale di modifica (Annulla, Ripeti, Taglia, Copia, Incolla, Seleziona tutto) |
| `Click destro` / `Menu` / `Shift+F10` | Editor di codice | Apre il menu contestuale Monaco (Annulla, Ripeti, Taglia, Copia, Incolla, Seleziona tutto, Salva, Diff) |
| `Click destro` / `Menu` / `Shift+F10` | Schede aperte (Tab) | Apre il menu della scheda (Salva, Diff, Copia percorso, Mostra in Esplora file/Finder, Chiudi, Chiudi gli altri) |
| `Click destro` / `Menu` / `Shift+F10` | Albero dei file (File/Cartella/Radice) | Apre il menu del file o della cartella (Nuovo file/cartella, Aggiorna, Apri nel terminale, Mostra nel file manager, Rinomina, Sposta nel Cestino) |
| `Click destro` / `Menu` / `Shift+F10` | Terminale PTY | Apre il menu contestuale del terminale (Copia, Incolla, Seleziona tutto, Pulisci visualizzazione) |
| `Freccia Giù` / `Freccia Su` / `Home` / `End` | Menu contestuale aperto | Naviga ciclicamente tra le voci del menu contestuale |
| `Invio` / `Spazio` | Menu contestuale aperto | Esegue la voce di menu selezionata |
| `Esc` | Popover / Dialog | Chiude la finestra modale aperta |
*Nota: all'interno del terminale `Ctrl+S`, `Ctrl+W` e `Ctrl+F4` non gestiscono i file dell'editor: vengono inviati all'agente se supportati, o restano soggetti al comportamento del terminale nativo.*

*Nota sui suggerimenti di prompt: la numerazione `Alt+1` … `Alt+6` e' posizionale: i suggerimenti fissi occupano le prime posizioni, quelli generati dal modello si accodano, e nessuna chip a schermo cambia numero quando arrivano i nuovi suggerimenti dinamici.*
