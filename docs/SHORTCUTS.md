# Scorciatoie da tastiera

OMP Studio delega l'intero blocco di tasti e scorciatoie convenzionali (incluse quelle con `Ctrl` e `Alt`) al terminale PTY, in modo che la TUI di `omp` non perda nessuna combinazione e continui a funzionare esattamente come nel prompt di Windows.

Le uniche scorciatoie catturate dall'app vivono dietro il modificatore **`Ctrl+Alt`**, che non collide con le combinazioni primarie di `omp`.

| Scorciatoia | Contesto | Azione |
|---|---|---|
| `Ctrl+Alt+N` | Globale | Nuovo progetto (apre selettore cartella) |
| `Ctrl+Alt+S` | Globale | Apre una chat Scratchpad (temporanea, `--no-session`) |
| `Ctrl+Alt+Freccia Destra` | Globale | Passa al progetto aperto successivo |
| `Ctrl+Alt+Freccia Sinistra` | Globale | Passa al progetto aperto precedente |
| `Ctrl+S` | Editor | Salva il file corrente e lo notifica |
| `Esc` | Popover / Dialog | Chiude la finestra modale aperta |

*Nota: all'interno del terminale `Ctrl+S` non salva il file dell'editor, ma viene inviato all'agente se supportato, o congelato dal controllo di flusso del terminale nativo.*
