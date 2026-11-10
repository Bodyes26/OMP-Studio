"""Immagini del riquadro sinistro dell'installer grafico Windows (src-tauri/installer).

Stessa foto e stessa maschera dello sfondo del DMG (assets/dmg/), nella stessa
inquadratura di generate-dmg-background.py, ritagliate attorno al pi al rapporto del
riquadro. L'effetto ASCII non si calcola qui: lo disegna il canvas dell'installer
(ui/ruin.js), che lo anima. Qui servono solo la foto e la maschera del soggetto,
cubo staccato compreso.

Uso (qualsiasi sistema: serve solo la parte numpy/Pillow dello script del DMG):
    python scripts/generate-installer-art.py
"""
import importlib.util
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src-tauri" / "installer" / "ui" / "assets"

# Riquadro della rovina nell'installer: 460x540 punti (ui/style.css, --hero-w e altezza
# della finestra in src/main.rs).
ASPECT = 460 / 540

# Importare lo script del DMG non deve lasciare __pycache__ tra i sorgenti.
sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("dmg", ROOT / "scripts" / "generate-dmg-background.py")
dmg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dmg)


def main():
    a = dmg.arr(dmg.cover(dmg.SRC / "rovina.png"))
    s = dmg.subject_mask(a)
    ys, xs = np.nonzero(s > 0.5)
    cx = (xs.min() + xs.max()) / 2
    w = round(dmg.H * ASPECT)
    x0 = int(min(max(cx - w / 2, 0), dmg.W - w))
    OUT.mkdir(parents=True, exist_ok=True)
    dmg.img(a[:, x0 : x0 + w]).save(OUT / "ruin.webp", quality=88, method=6)
    dmg.img(s[:, x0 : x0 + w]).convert("L").save(OUT / "ruin-mask.png", optimize=True)
    for name in ("ruin.webp", "ruin-mask.png"):
        p = OUT / name
        print(p.relative_to(ROOT), p.stat().st_size, "byte")


if __name__ == "__main__":
    main()
