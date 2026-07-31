# Decisioni Architetturali e Gate

Qui documentiamo gli esiti dei "gate" previsti dal piano di lavoro: scelte bloccanti su cui dovevamo avere certezza pratica prima di costruire.

---

## Gate R1: Finestra senza decorazioni vs Barra nativa

**Data:** 2026-07-29  
**Esito:** FALLITO  
**Decisione:** Usare `"decorations": true` e mantenere la barra nativa di Windows.

**Motivazione:**  
Durante la Fase 1 abbiamo testato la configurazione `"decorations": false` combinata con le API manuali (`getCurrentWindow().startDragging()` / `minimize()` / `toggleMaximize()`). Come documentato nell'issue `tauri #8519`, l'integrazione su Windows 11 manca di comportamenti nativi fondamentali quando le decorazioni vengono nascoste a livello di OS:
1. Lo snap di Windows (Win+Frecce) e lo snap layout trascinando la finestra ai bordi non scattano correttamente.
2. Il resize diagonale dai bordi non funziona sempre come atteso.

Dato il principio in `PRODUCT.md` che "una finestra che non si ridimensiona o non fa snap è rotta" e che lo strumento vive nel desktop per ore, l'affidabilità delle API di windowing di Windows 11 prevale sull'estetica di una top bar unificata.

La top bar dei progetti è stata spostata appena sotto la barra nativa e l'attributo `data-tauri-drag-region` è stato rimosso per delegare tutto al sistema operativo.
