#!/usr/bin/env python3
"""Regenerates resources/icon.png (the Marketplace icon).

The mark is the chat bubble from resources/codex.svg, opened up to hold the
`> codex` prompt so the listing icon carries the name while still reading as
the same shape as the activity-bar icon. The bubble body is 94x78 rather than
the old flat 100x60; the mark is drawn on a transparent background and the
body+tail group is centred in the 128px canvas with FIT_MARGIN of padding.
Drawn at 8x and downsampled so the type and the chevron stay clean at
Marketplace thumbnail sizes.

    pip install pillow && python3 resources/icon.gen.py
"""

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

S, N = 8, 128  # supersample factor, final size
W = N * S


def s(v: float) -> int:
    """Scale a coordinate from the 128px design space into the render space."""
    return round(v * S)


ACCENT = (16, 163, 127, 255)  # OpenAI green
FG = (255, 255, 255, 255)
INK = (20, 23, 28, 255)  # wordmark colour inside the bubble

# Mark geometry, in the 128px design space.
BUBBLE = (17, 17, 111, 95)  # bubble body: left, top, right, bottom (94x78)
BUBBLE_RADIUS = 18
TAIL = ((34, 86), (64, 86), (35, 116))  # tail: base left, base right, tip
WORD = "codex"
WORD_WIDTH = 62  # target ink width of the wordmark
CHEVRON_W, CHEVRON_H = 10, 12  # chevron ink box
CHEVRON_GAP = 8  # gap between the chevron and the wordmark
OUTLINE_W = 0  # ink line around the bubble, 0 = none (transparent, white fill)
FIT_MARGIN = 10  # transparent padding kept around the mark

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
]


def font_path() -> str:
    path = next((p for p in FONT_CANDIDATES if Path(p).exists()), None)
    if path is None:
        raise SystemExit(f"no bold sans font found, tried: {', '.join(FONT_CANDIDATES)}")
    return path


def fit(img: Image.Image, margin: int) -> Image.Image:
    """Centre the mark in the square canvas, leaving `margin` of transparency."""
    box = img.getchannel("A").getbbox()
    if box is None:
        return img
    mark = img.crop(box)
    room = N - 2 * margin
    scale = min(room / mark.width, room / mark.height)
    if scale != 1:
        mark = mark.resize(
            (round(mark.width * scale), round(mark.height * scale)), Image.LANCZOS
        )
    out = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    out.paste(mark, ((N - mark.width) // 2, (N - mark.height) // 2), mark)
    return out


def render(
    *,
    face: str | None = None,
    bubble: tuple[int, int, int, int] = BUBBLE,
    radius: int = BUBBLE_RADIUS,
    tail: tuple[tuple[int, int], ...] = TAIL,
    word: str = WORD,
    word_width: int = WORD_WIDTH,
    chevron: tuple[int, int] = (CHEVRON_W, CHEVRON_H),
    gap: int = CHEVRON_GAP,
    outline: float = OUTLINE_W,
    margin: int = FIT_MARGIN,
) -> Image.Image:
    """Render the mark at 128px from the design-space geometry."""
    face = face or font_path()
    bl, bt, br, bb = bubble

    # speech bubble: rounded body + tail at the bottom-left, built as a single
    # mask so an outline follows the merged silhouette instead of showing a
    # seam where the tail meets the body
    shape = Image.new("L", (W, W), 0)
    shape_draw = ImageDraw.Draw(shape)
    shape_draw.rounded_rectangle([s(bl), s(bt), s(br), s(bb)], radius=s(radius), fill=255)
    shape_draw.polygon([(s(x), s(y)) for x, y in tail], fill=255)

    # transparent canvas: the mark carries itself, no plate behind it
    img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    outer = shape.resize((N, N), Image.LANCZOS)
    if outline > 0:
        inner = outer
        for _ in range(round(outline)):  # erode: the ink line eats inwards
            inner = inner.filter(ImageFilter.MinFilter(3))
        img.paste(INK, (0, 0), ImageChops.subtract(outer, inner))
        img.paste(FG, (0, 0), inner)
    else:
        img.paste(FG, (0, 0), outer)

    # `> codex`, sized to a target width rather than a hard-coded point size so
    # a font substitution changes the face without breaking the layout
    size = 10
    while ImageFont.truetype(face, s(size + 1)).getlength(word) <= s(word_width):
        size += 1
    font = ImageFont.truetype(face, s(size))
    x0, y0, x1, y1 = font.getbbox(word)
    text_w, text_h = x1 - x0, y1 - y0

    chev_w, chev_h = s(chevron[0]), s(chevron[1])
    left = s((bl + br) / 2) - (chev_w + s(gap) + text_w) // 2
    cy = s((bt + bb) / 2)

    ink = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    ink_draw = ImageDraw.Draw(ink)
    corners = [(left, cy - chev_h), (left + chev_w, cy), (left, cy + chev_h)]
    ink_draw.line(corners, fill=ACCENT, width=s(6), joint="curve")
    for px, py in corners:  # round the joints the way the SVG's stroke-linecap does
        ink_draw.ellipse([px - s(3), py - s(3), px + s(3), py + s(3)], fill=ACCENT)
    ink_draw.text(
        (left + chev_w + s(gap) - x0, cy - text_h // 2 - y0), word, font=font, fill=INK
    )

    img.alpha_composite(ink.resize((N, N), Image.LANCZOS))
    return fit(img, margin)


def main() -> None:
    target = Path(__file__).with_name("icon.png")
    render().save(target)
    print(f"wrote {target} ({font_path()})")


if __name__ == "__main__":
    main()
