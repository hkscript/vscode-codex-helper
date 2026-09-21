#!/usr/bin/env python3
"""Regenerates resources/icon.png (the Marketplace icon).

The mark is the chat bubble from resources/codex.svg, opened up to hold the
`> codex` prompt so the listing icon carries the name while still reading as
the same shape as the activity-bar icon. Drawn at 8x and downsampled so the
type and the chevron stay clean at Marketplace thumbnail sizes.

    pip install pillow && python3 resources/icon.gen.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

S, N = 8, 128  # supersample factor, final size
W = N * S


def s(v: float) -> int:
    """Scale a coordinate from the 128px design space into the render space."""
    return round(v * S)


ACCENT = (16, 163, 127, 255)  # OpenAI green
FG = (255, 255, 255, 255)
INK = (20, 23, 28, 255)  # wordmark colour inside the bubble
TOP, BOT = (38, 42, 50), (12, 14, 17)  # background gradient

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
]
FONT_PATH = next((p for p in FONT_CANDIDATES if Path(p).exists()), None)
if FONT_PATH is None:
    raise SystemExit(f"no bold sans font found, tried: {', '.join(FONT_CANDIDATES)}")

# background: vertical gradient clipped to a rounded square
grad = Image.new("RGB", (1, W))
for y in range(W):
    t = y / (W - 1)
    grad.putpixel((0, y), tuple(round(TOP[i] + (BOT[i] - TOP[i]) * t) for i in range(3)))
mask = Image.new("L", (W, W), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, W - 1], radius=s(26), fill=255)

img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
img.paste(grad.resize((W, W)).convert("RGBA"), (0, 0), mask)
d = ImageDraw.Draw(img)

# speech bubble: rounded body + tail at the bottom-left
BL, BT, BR, BB = 14, 25, 114, 85
d.rounded_rectangle([s(BL), s(BT), s(BR), s(BB)], radius=s(13), fill=FG)
d.polygon([(s(24), s(77)), (s(50), s(77)), (s(25), s(104))], fill=FG)

# `> codex`, sized to a target width rather than a hard-coded point size so a
# font substitution changes the face without breaking the layout
TEXT, TARGET = "codex", 68
size = 10
while ImageFont.truetype(FONT_PATH, s(size + 1)).getlength(TEXT) <= s(TARGET):
    size += 1
font = ImageFont.truetype(FONT_PATH, s(size))
x0, y0, x1, y1 = font.getbbox(TEXT)
text_w, text_h = x1 - x0, y1 - y0

chev_w, gap = s(10), s(9)
left = s((BL + BR) / 2) - (chev_w + gap + text_w) // 2
cy = s((BT + BB) / 2)

corners = [(left, cy - s(10)), (left + chev_w, cy), (left, cy + s(10))]
d.line(corners, fill=ACCENT, width=s(6), joint="curve")
for px, py in corners:  # round the joints the way the SVG's stroke-linecap does
    d.ellipse([px - s(3), py - s(3), px + s(3), py + s(3)], fill=ACCENT)
d.text((left + chev_w + gap - x0, cy - text_h // 2 - y0), TEXT, font=font, fill=INK)

target = Path(__file__).with_name("icon.png")
img.resize((N, N), Image.LANCZOS).save(target)
print(f"wrote {target} ({FONT_PATH}, {size}px)")
