"""
Generates TripCalendar app icons at the four sizes Chrome requests.

Design:
- Cream rounded square background
- Bold ink "T" monogram (drawn geometrically — no font dependency)
- Coral underbar accent (echoes the trip bars in the product)

The monogram approach reads well at every size, including the 16px favicon
in browser toolbars. Replace these PNGs with a custom-designed icon any time;
the filenames and sizes are what the manifest references.
"""
import os
from PIL import Image, ImageDraw

# Palette (mirrors panel.css)
CORAL = (232, 90, 79, 255)
CREAM = (250, 247, 242, 255)
INK = (26, 26, 26, 255)

SIZES = [16, 32, 48, 128]


def make_icon(size: int) -> Image.Image:
    """Render the icon at the given square pixel size."""
    # Render at 8x and downscale for crisp anti-aliasing at small sizes.
    scale = 8
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    corner = int(s * 0.18)

    # Cream rounded square background
    draw.rounded_rectangle([(0, 0), (s - 1, s - 1)], radius=corner, fill=CREAM)

    # Geometric "T": horizontal crossbar at the top, vertical stem down the middle.
    cross_w = int(s * 0.62)
    cross_h = int(s * 0.13)
    cross_top = int(s * 0.24)
    cross_left = (s - cross_w) // 2
    draw.rounded_rectangle(
        [(cross_left, cross_top), (cross_left + cross_w, cross_top + cross_h)],
        radius=max(2, int(cross_h * 0.15)),
        fill=INK,
    )

    stem_w = int(s * 0.16)
    stem_left = (s - stem_w) // 2
    stem_top = cross_top + cross_h
    stem_bottom = int(s * 0.72)
    draw.rounded_rectangle(
        [(stem_left, stem_top), (stem_left + stem_w, stem_bottom)],
        radius=0,
        fill=INK,
    )

    # Coral accent bar at the base — the "trip" hint.
    bar_w = int(s * 0.50)
    bar_h = int(s * 0.10)
    bar_top = int(s * 0.78)
    bar_left = (s - bar_w) // 2
    bar_radius = max(2, int(bar_h * 0.35))
    draw.rounded_rectangle(
        [(bar_left, bar_top), (bar_left + bar_w, bar_top + bar_h)],
        radius=bar_radius,
        fill=CORAL,
    )

    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    out_dir = os.path.join(os.path.dirname(__file__), "src", "icons")
    os.makedirs(out_dir, exist_ok=True)
    for sz in SIZES:
        icon = make_icon(sz)
        path = os.path.join(out_dir, f"icon-{sz}.png")
        icon.save(path)
        print(f"wrote {path}")
