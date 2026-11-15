"""Immagini del README con la grafica del sito (site/): la rovina a pi della foto,
la stampa scura, i caratteri ASCII colorati come la pietra, l'ocra come unico accento.

Escono in assets/screenshots/:
- banner.en.jpg, banner.it.jpg: apertura del README, il pi in caratteri sopra la foto
  da pellicola con il titolo del sito (in inglese e in italiano);
- screen_hero.png, screen_lab.png: la finestra di Studio sopra la foto sciolta in caratteri;
- screen_remote.png: le tre schermate di Studio Remote sullo stesso fondo;
- demo_lanes.gif: la registrazione del flusso corsie sullo stesso fondo.

Le catture grezze stanno in ricerca/readme-media/ (fuori da git, vedi docs/SCREENSHOTS.md):
window-hero.png e window-lab.png (finestra con angoli trasparenti), remote-1..3.png
(schermate del telefono con angoli trasparenti), omp-studio-lanes.mp4 (finestra, 1440x770).
La foto e la maschera del pi sono quelle del DMG (assets/dmg/), i font quelli del sito.

Uso (macOS o Linux, servono ffmpeg e pngquant):
    python3 scripts/generate-readme-media.py
Richiede numpy e Pillow.
"""
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "ricerca" / "readme-media"
PHOTO = ROOT / "assets" / "dmg" / "rovina.png"
MASK = ROOT / "assets" / "dmg" / "rovina-mask.png"
FONTS = ROOT / "site" / "public" / "fonts"
OUT = ROOT / "assets" / "screenshots"

# Token di site/src/styles/global.css
GROUND = np.array([14, 14, 12], dtype=np.float32) / 255
STONE = (242, 240, 234)
SLATE = (163, 167, 170)
OCHRE = (227, 192, 106)
LINE = (242, 240, 234, 31)  # --line: pietra al 12%

# Il cubo staccato sotto il pilastro corto fa parte del pi ma la maschera di Vision non lo
# include: riquadro sulla foto originale (1672x941), lo stesso del DMG riportato in scala.
CUBE = (480, 625, 645, 730)
RAMP = " .:-=+*#%@"
MARGIN = 96  # fondo visibile attorno alle catture, a 1920 px circa

BANNER = {
    "en": ("Every project, its own agent,\none window.", "OMP Studio · a desktop workspace for omp"),
    "it": ("Ogni progetto, il suo agente,\nuna finestra.", "OMP Studio · un ambiente desktop per omp"),
}


def font(name, size):
    return ImageFont.truetype(str(FONTS / name), size)


def arr(im):
    return np.asarray(im, dtype=np.float32) / 255


def img(a):
    return Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))


def blur(a, r):
    return arr(img(a).filter(ImageFilter.GaussianBlur(r)))


def cover_box(w, h, W, H, focus_y=0.5):
    """Ritaglio della foto w x h al rapporto W:H; focus_y sceglie la fascia verticale."""
    if w / h > W / H:
        nw = h * W / H
        x0 = (w - nw) / 2
        return (x0, 0, x0 + nw, h)
    nh = w * H / W
    y0 = (h - nh) * focus_y
    return (0, y0, w, y0 + nh)


def cover(im, W, H, focus_y=0.5):
    box = cover_box(*im.size, W, H, focus_y)
    return im.resize((W, H), Image.LANCZOS, box=box), box


def pi_mask(W, H, focus_y):
    m = Image.open(MASK).convert("L")
    cube = Image.new("L", m.size, 0)
    ImageDraw.Draw(cube).rectangle(CUBE, fill=255)
    m, _ = cover(m, W, H, focus_y)
    c, _ = cover(cube, W, H, focus_y)
    return np.maximum(blur(arr(m), 1.5), blur(arr(c), 1.5))


def ascii_mask(t, c):
    """Caratteri della rampa scelti sulla luminosita' di ogni cella, disegnati in bianco."""
    H, W = t.shape
    f = font("GeistMono-Variable.woff2", int(c * 1.45))
    m = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(m)
    h, w = H // c, W // c
    tc = t[: h * c, : w * c].reshape(h, c, w, c).mean(axis=(1, 3))
    for j in range(h):
        for i in range(w):
            ch = RAMP[min(len(RAMP) - 1, int(tc[j, i] * len(RAMP)))]
            if ch != " ":
                d.text((i * c + c / 2, j * c + c / 2), ch, fill=255, font=f, anchor="mm")
    return arr(m)


def glyphs(a, region, c, dark):
    """Caratteri col colore della foto sopra la foto scurita, come la rovina del sito.
    I livelli si calcolano sulla zona scelta: su tutta la foto il marmo cadrebbe su un solo carattere."""
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
    """Alone sulle luci e vignettatura verso il fondo del sito."""
    H, W = a.shape[:2]
    a = blur(a, 0.8)
    hi = np.clip((a - 0.7) / 0.3, 0, 1)
    a = 1 - (1 - a) * (1 - blur(hi, 18) * 0.6)
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    d = (((x / W - 0.5) ** 2 + (y / H - 0.5) ** 2) ** 0.5 / 0.707)[..., None]
    k = np.clip((d - 0.45) / 0.55, 0, 1) ** 1.5 * 0.75
    return a * (1 - k) + GROUND * k


def grain(a, amt=0.03, chroma=0.3):
    H, W = a.shape[:2]
    rng = np.random.default_rng(7)  # seme fisso: rigenerare non cambia l'immagine
    n = rng.normal(0, 1, (H, W, 1)).astype(np.float32)
    c = rng.normal(0, 1, (H, W, 3)).astype(np.float32)
    return a + amt * ((1 - chroma) * n + chroma * c)


def backdrop(W, H, focus_y=0.35):
    """Fondo delle catture: la foto sciolta in caratteri color pietra sul fondo scuro del
    sito, senza la foto sotto: i colori della foto dietro la finestra sembrano sporco.
    La cella cresce con l'immagine, cosi' i caratteri restano leggibili alla dimensione mostrata."""
    g = arr(cover(Image.open(PHOTO).convert("L"), W, H, focus_y)[0])
    lo, hi = np.percentile(g, 2), np.percentile(g, 98)
    t = np.clip((g - lo) / max(hi - lo, 1e-3), 0, 1)
    c = max(6, round(W / 150))
    m = ascii_mask(t, c) * (0.10 + 0.32 * blur(t, c))
    col = np.array(STONE, dtype=np.float32) / 255
    a = GROUND * (1 - m[..., None]) + col * m[..., None]
    return img(grain(film(a)))


def rounded(w, h, r, ss=4):
    m = Image.new("L", (w * ss, h * ss), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, w * ss - 1, h * ss - 1), r * ss, fill=255)
    return m.resize((w, h), Image.LANCZOS)


def ring(w, h, r, ss=4):
    """Bordo di 1 px in --line attorno a una cattura, come lo screenshot del sito."""
    m = Image.new("L", (w * ss, h * ss), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, w * ss - 1, h * ss - 1), r * ss, outline=255, width=ss)
    o = Image.new("RGBA", (w, h), LINE[:3] + (0,))
    o.putalpha(m.resize((w, h), Image.LANCZOS).point(lambda v: v * LINE[3] // 255))
    return o


def shadow(canvas, boxes, r, blur_r, alpha):
    s = Image.new("L", canvas.size, 0)
    d = ImageDraw.Draw(s)
    for x0, y0, x1, y1 in boxes:
        d.rounded_rectangle((x0, y0 + blur_r // 2, x1, y1 + blur_r // 2), r, fill=alpha)
    s = s.filter(ImageFilter.GaussianBlur(blur_r))
    black = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    black.putalpha(s)
    canvas.alpha_composite(black)


def place(canvas, shots, r):
    """Catture (angoli gia' trasparenti) con ombra e bordo; shots = [(immagine, x, y)]."""
    shadow(canvas, [(x, y, x + s.width, y + s.height) for s, x, y in shots], r, 36, 170)
    for s, x, y in shots:
        canvas.alpha_composite(s, (x, y))
        canvas.alpha_composite(ring(s.width, s.height, r), (x, y))


def save_png(im, path):
    im.convert("RGB").save(path)
    # stessa compressione del giro precedente (docs/SCREENSHOTS.md)
    subprocess.run(["pngquant", "--quality=75-95", "--force", "--ext", ".png", "--skip-if-larger", str(path)], check=False)
    print(f"{path.relative_to(ROOT)} {im.width}x{im.height} {path.stat().st_size // 1024} KB")


def window_shot(name):
    win = Image.open(RAW / f"window-{name}.png").convert("RGBA")
    W, H = win.width + 2 * MARGIN, win.height + 2 * MARGIN
    canvas = backdrop(W, H).convert("RGBA")
    place(canvas, [(win, MARGIN, MARGIN)], 18)
    save_png(canvas, OUT / f"screen_{name}.png")


def remote_shot():
    phones = [Image.open(RAW / f"remote-{i}.png").convert("RGBA") for i in (1, 2, 3)]
    gap = 104
    pw, ph = phones[0].size
    W, H = 3 * pw + 2 * gap + 2 * MARGIN, ph + 2 * MARGIN
    canvas = backdrop(W, H).convert("RGBA")
    place(canvas, [(p, MARGIN + i * (pw + gap), MARGIN) for i, p in enumerate(phones)], 47)
    save_png(canvas, OUT / "screen_remote.png")


def banner(lang):
    """Apertura: il pi in caratteri sopra la foto da pellicola, titolo e sottotitolo del sito
    in basso a sinistra su una velatura scura (come og.jpg e l'apertura del sito)."""
    W, H = 1920, 800
    focus = 0.2  # sopra l'architrave resta cielo
    a = arr(cover(Image.open(PHOTO).convert("RGB"), W, H, focus)[0])
    s = pi_mask(W, H, focus)
    m = s[..., None]
    # cella di 12 px: il README mostra il banner a meno di meta' larghezza
    a = film(a) * 0.82 * (1 - m) + glyphs(a, s, 12, dark=0.45) * m
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    v = np.clip((y / H - 0.28) / 0.5, 0, 1)
    k = v * v * (3 - 2 * v) * np.clip(1.25 - x / W * 1.1, 0, 1) * 0.88
    a = a * (1 - k[..., None]) + GROUND * k[..., None]
    im = img(grain(a)).convert("RGBA")
    d = ImageDraw.Draw(im)
    title, sub = BANNER[lang]
    tf = font("GeistSerif-Regular.woff2", 92)
    d.multiline_text((96, H - 112), title, font=tf, fill=STONE, anchor="ld", spacing=4)
    d.text((98, H - 64), sub, font=font("GeistMono-Variable.woff2", 28), fill=OCHRE, anchor="ls")
    # e' una foto: in JPEG pesa un quinto del PNG
    p = OUT / f"banner.{lang}.jpg"
    im.convert("RGB").save(p, quality=86, optimize=True, progressive=True)
    print(f"{p.relative_to(ROOT)} {W}x{H} {p.stat().st_size // 1024} KB")


def lanes_gif():
    """Video 1440x770 scalato a 844 px sullo stesso fondo, poi palette a 256 colori."""
    vw, vh, r = 844, 451, 9
    m = 58
    W, H = vw + 2 * m, vh + 2 * m
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        canvas = backdrop(W, H).convert("RGBA")
        shadow(canvas, [(m, m, m + vw, m + vh)], r, 18, 170)
        canvas.convert("RGB").save(t / "bg.png")
        rounded(vw, vh, r).save(t / "mask.png")
        ring(vw, vh, r).save(t / "ring.png")
        dur = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(RAW / "omp-studio-lanes.mp4")],
            check=True, capture_output=True, text=True,
        ).stdout.strip()
        graph = (
            f"[0:v]fps=8,scale={vw}:{vh}:flags=lanczos,format=rgba[v];"
            "[1:v]format=gray[mk];[v][mk]alphamerge[vr];"
            f"[2:v][vr]overlay={m}:{m}[c];[c][3:v]overlay={m}:{m},split[a][b];"
            "[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4"
        )
        # le immagini fisse (-loop 1) vanno fermate alla durata del video, o ffmpeg non termina
        cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(RAW / "omp-studio-lanes.mp4")]
        for f in ("mask.png", "bg.png", "ring.png"):
            cmd += ["-loop", "1", "-t", dur, "-i", str(t / f)]
        cmd += ["-filter_complex", graph, "-loop", "0", str(OUT / "demo_lanes.gif")]
        subprocess.run(cmd, check=True)
    p = OUT / "demo_lanes.gif"
    print(f"{p.relative_to(ROOT)} {W}x{H} {p.stat().st_size // 1024} KB")


def main():
    for lang in BANNER:
        banner(lang)
    window_shot("hero")
    window_shot("lab")
    remote_shot()
    lanes_gif()


if __name__ == "__main__":
    main()
