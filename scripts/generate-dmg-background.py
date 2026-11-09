"""Sfondo della finestra del DMG macOS: il pi monumentale in caratteri ASCII fini,
il resto della foto con resa da pellicola (alone sulle luci, vignettatura, grana).

Sorgenti in assets/dmg/: rovina.png (foto) e rovina-mask.png (maschera del pi, ricavata
con Vision di macOS). Esce src-tauri/dmg/background.tiff con le due risoluzioni
(800x440 e 1600x880): Finder sceglie da solo quella giusta per lo schermo.

La foto e' allungata a destra (16:9) perche' Finder mostra le barre di scorrimento se
un'icona sta a meno di circa 170 punti dal bordo destro: la cartella Applicazioni sta
a x 630 e il pi resta a sinistra.

Uso (solo macOS: serve il font Menlo e tiffutil):
    python3 scripts/generate-dmg-background.py
Richiede numpy e Pillow.
"""
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "dmg"
OUT = ROOT / "src-tauri" / "dmg" / "background.tiff"

# Sfondo a 2x; la finestra e' 800x440 punti di contenuto. bundle.macOS.dmg.windowSize
# vale 800x472: i 32 punti in piu' sono la barra del titolo di Finder.
W, H = 1600, 880
# Il cubo staccato sotto il pilastro corto fa parte del pi ma Vision non lo include:
# riquadro misurato a mano sulla foto ritagliata a W x H.
CUBE = (459, 588, 617, 688)
GLYPH_CELL = 6  # pixel per carattere alla risoluzione 2x
RAMP = " .:-=+*#%@"


def arr(im):
    return np.asarray(im, dtype=np.float32) / 255


def img(a):
    return Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))


def blur(a, r):
    return arr(img(a).filter(ImageFilter.GaussianBlur(r)))


def cover(path):
    """Ritaglio centrato al rapporto della finestra, poi scala a W x H."""
    im = Image.open(path).convert("RGB")
    w, h = im.size
    if w / h > W / H:
        nw = int(h * W / H)
        im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = int(w * H / W)
        im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    return im.resize((W, H), Image.LANCZOS)


def subject_mask(a):
    m = arr(cover(SRC / "rovina-mask.png").convert("L").filter(ImageFilter.GaussianBlur(1.5)))
    x0, y0, x1, y1 = CUBE
    cube = np.zeros((H, W), dtype=np.float32)
    cube[y0:y1, x0:x1] = 1
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    cube[(g > r * 1.04) & (g > b * 1.15)] = 0  # l'erba ai bordi del riquadro resta fuori
    return np.maximum(m, blur(cube, 1.5))


def cells(t, c):
    h, w = t.shape[0] // c, t.shape[1] // c
    return t[: h * c, : w * c].reshape(h, c, w, c).mean(axis=(1, 3))


def ascii_mask(t, c):
    font = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", int(c * 1.45), index=1)
    m = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(m)
    tc = cells(t, c)
    for j in range(tc.shape[0]):
        for i in range(tc.shape[1]):
            ch = RAMP[min(len(RAMP) - 1, int(tc[j, i] * len(RAMP)))]
            if ch != " ":
                d.text((i * c + c / 2, j * c + c / 2), ch, fill=255, font=font, anchor="mm")
    return np.asarray(m, dtype=np.float32) / 255


def glyphs(a, region, c, dark=0.55):
    """Caratteri luminosi col colore della foto sopra la foto scurita. I livelli si
    calcolano sulla sola zona del pi: su tutta la foto il marmo cadrebbe su un solo carattere."""
    g = arr(img(a).convert("L"))
    sel = g[region > 0.5]
    lo, hi = np.percentile(sel, 2), np.percentile(sel, 98)
    t = np.clip((g - lo) / max(hi - lo, 1e-3), 0, 1)
    t = t * t * (3 - 2 * t)
    m = np.clip(ascii_mask(t, c) * (0.5 + 1.1 * blur(t, 3)), 0, 1)[..., None]
    col = blur(a, 1.5)
    col = np.maximum(col / np.maximum(col.max(axis=2, keepdims=True), 0.05) * 0.98, a)
    return a * dark * (1 - m) + col * m


def film(a):
    """Alone sulle luci e vignettatura, come una stampa da pellicola."""
    a = blur(a, 0.8)
    hi = np.clip((a - 0.7) / 0.3, 0, 1)
    a = 1 - (1 - a) * (1 - blur(hi, 18) * 0.6)
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    d = ((x / W - 0.5) ** 2 + (y / H - 0.5) ** 2) ** 0.5 / 0.707
    return a * (1 - 0.35 * d[..., None] ** 2)


def grain(a, amt=0.08, chroma=0.3):
    rng = np.random.default_rng(7)  # seme fisso: rigenerare non cambia l'immagine
    n = rng.normal(0, 1, (H, W, 1)).astype(np.float32)
    c = rng.normal(0, 1, (H, W, 3)).astype(np.float32)
    return a + amt * ((1 - chroma) * n + chroma * c)


def mist(a):
    """Foschia chiara sul prato in basso: Finder scrive le etichette delle icone in nero
    (tema chiaro) e senza schiarire il prato scuro non si leggono. Le icone stanno a
    y 235 punti, con le etichette fra 303 e 320: la foschia parte da 275 ed e' piena da 325.
    Icone cosi' alte perche' Finder puo' mostrare barra dei pannelli e barra del percorso,
    che tolgono circa 70 punti: senza margine compaiono le barre di scorrimento."""
    y = np.arange(H, dtype=np.float32)[:, None, None] / 2  # in punti
    k = np.clip((y - 275) / 50, 0, 1)
    k = k * k * (3 - 2 * k) * 0.62
    return a * (1 - k) + np.array([0.93, 0.92, 0.88], dtype=np.float32) * k


def main():
    a = arr(cover(SRC / "rovina.png"))
    s = subject_mask(a)
    m = s[..., None]
    out = img(grain(mist(film(a) * (1 - m) + glyphs(a, s, GLYPH_CELL) * m)))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        hi = Path(tmp) / "background@2x.png"
        lo = Path(tmp) / "background.png"
        out.save(hi)
        out.resize((W // 2, H // 2), Image.LANCZOS).save(lo)
        # 72 e 144 dpi: e' cosi' che Finder riconosce la versione per schermi Retina
        subprocess.run(["sips", "-s", "dpiWidth", "144", "-s", "dpiHeight", "144", str(hi)], check=True, capture_output=True)
        subprocess.run(["tiffutil", "-cathidpicheck", str(lo), str(hi), "-out", str(OUT)], check=True, capture_output=True)
    print(OUT.relative_to(ROOT))


if __name__ == "__main__":
    main()
