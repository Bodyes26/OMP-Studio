# Idee — parcheggio

Questo file esiste per una sola ragione: **impedire che una buona idea diventi un ritardo.**

Regola: qualunque cosa venga in mente durante le fasi 0-6 e non sia già nel piano, si scrive qui e si va avanti. Si valuta dopo la Fase 6, quando l'app è in uso reale e si sa quali di queste idee servono davvero.

Il rischio R7 in `ARCHITECTURE.md` non è teorico: la deriva verso "un IDE" ha ucciso più progetti simili di qualsiasi problema tecnico.

---

## Formato

```
### <titolo breve>
Problema reale che risolve: <o "nessuno, mi piaceva">
Costo stimato: <ore o giorni>
Dipende da: <fase o feature>
```

---

## Candidati già emersi durante la progettazione

### Anteprima di una sessione storica senza riprenderla
Problema reale che risolve: capire se una sessione è quella giusta prima di pagare un cache miss riaprendola.
Costo stimato: 1 giorno.
Dipende da: Fase 5. `omp --export <file>` produce già HTML, quindi la strada esiste.

### Tema chiaro
Problema reale che risolve: nessuno noto. La scena in `DESIGN.md` §1 dice che il tema scuro è una conseguenza funzionale del terminale, non una preferenza.
Costo stimato: 2-3 giorni, più il raddoppio di ogni verifica di contrasto.
Dipende da: niente. Da rivalutare solo se cambia l'ambiente di lavoro.

### Colore identità del progetto scelto a mano
Problema reale che risolve: l'hash del path può assegnare due tinte vicine a due progetti aperti insieme.
Costo stimato: mezza giornata.
Dipende da: Fase 3. Da fare solo se il problema si presenta davvero con i progetti reali.

### Ricerca globale sulle sessioni di tutti i progetti
Problema reale che risolve: "dove avevo risolto quella cosa?" senza ricordare il progetto.
Costo stimato: 1 giorno.
Dipende da: Fase 5. L'indice FTS5 di `history.db` copre già tutti i `cwd`, quindi è quasi solo interfaccia.

### Vista costi per progetto nel tempo
Problema reale che risolve: nessuno immediato. `stats.db` ha i dati e la tentazione di farne un dashboard è forte.
Costo stimato: 2 giorni.
Dipende da: Fase 5. `PRODUCT.md` è esplicito: l'usage non è un prodotto di data-viz.

### Più tab di terminale per progetto
Problema reale che risolve: far girare due sessioni `omp` sullo stesso progetto, o tenere una shell accanto all'agente.
Costo stimato: 1-2 giorni.
Dipende da: Fase 3. Il `PtyManager` è già indicizzato per progetto con più sessioni, quindi il backend regge; è lavoro di interfaccia.
