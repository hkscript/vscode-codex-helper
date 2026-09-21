#!/usr/bin/env python3
"""Regenerates resources/icon.png (the Marketplace icon).

The glyph deliberately matches resources/codex.svg — a chat bubble holding a
`>` prompt and an accent bar — so the activity-bar icon and the listing icon
read as the same mark. Drawn at 8x and downsampled for clean edges.

    pip install pillow && python3 resources/icon.gen.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

S, N = 8, 128  # supersample factor, final size
W = N * S


def s(v: float) -> int:
    """Scale a coordinate from the 128px design space into the render space."""
    return round(v * S)


ACCENT = (16, 163, 127, 255)  # OpenAI green
FG = (255, 255, 255, 255)
INK = (20, 23, 28, 255)  # glyph colour inside the bubble
TOP, BOT = (38, 42, 50), (12, 14, 17)  # background gradient

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
d.rounded_rectangle([s(22), s(26), s(106), s(86)], radius=s(12), fill=FG)
d.polygon([(s(32), s(78)), (s(58), s(78)), (s(33), s(103))], fill=FG)

# prompt glyph: `>` knocked into the bubble, accent bar as the cursor
d.line([(s(45), s(44)), (s(58), s(56)), (s(45), s(68))], fill=INK, width=s(9), joint="curve")
for x, y in [(45, 44), (58, 56), (45, 68)]:
    d.ellipse([s(x - 4.5), s(y - 4.5), s(x + 4.5), s(y + 4.5)], fill=INK)
d.rounded_rectangle([s(66.5), s(63.5), s(88), s(72.5)], radius=s(4.5), fill=ACCENT)

target = Path(__file__).with_name("icon.png")
img.resize((N, N), Image.LANCZOS).save(target)
print(f"wrote {target}")
