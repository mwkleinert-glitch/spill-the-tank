#!/usr/bin/env python3
"""Draw the board icon and share image. No operator name and no prices."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
NAVY = (30, 58, 138)
CREAM = (248, 250, 252)
AMBER = (245, 158, 11)
VALVE = (226, 232, 240)
LEG = (203, 213, 225)
INTER_BOLD = "/usr/share/fonts/truetype/macos/Inter-Bold.ttf"
INTER = "/usr/share/fonts/truetype/macos/Inter-Regular.ttf"
DEJAVU_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
DEJAVU = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def font(path, fallback, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.truetype(fallback, size)


def draw_tank(target, box):
    draw = ImageDraw.Draw(target)
    left, top, right, bottom = box
    height = bottom - top
    radius = height / 2
    draw.rounded_rectangle(box, radius=radius, fill=CREAM)
    band_width = max(4, int((right - left) * 0.08))
    center = (left + right) / 2
    draw.rectangle([center - band_width / 2, top, center + band_width / 2, bottom], fill=AMBER)
    valve_width = max(4, int((right - left) * 0.07))
    valve_height = int(height * 0.55)
    draw.rounded_rectangle(
        [center - valve_width / 2, top - valve_height, center + valve_width / 2, top + 2],
        radius=max(2, valve_width / 4),
        fill=VALVE,
    )
    leg_width = max(3, int((right - left) * 0.045))
    leg_height = int(height * 0.38)
    for offset in (-0.28, 0.28):
        leg_x = center + (right - left) * offset
        draw.rectangle(
            [leg_x - leg_width / 2, bottom - 2, leg_x + leg_width / 2, bottom + leg_height],
            fill=LEG,
        )


def icon(size):
    canvas = Image.new("RGB", (size, size), NAVY)
    margin = int(size * 0.16)
    body_top = int(size * 0.40)
    body_height = int(size * 0.22)
    draw_tank(canvas, (margin, body_top, size - margin, body_top + body_height))
    return canvas


def share_image():
    image = Image.new("RGB", (1200, 630), NAVY)
    draw = ImageDraw.Draw(image)
    scale = Image.new("RGB", (520, 520), NAVY)
    draw_tank(scale, (40, 210, 480, 330))
    image.paste(scale.crop((0, 80, 520, 460)), (40, 120))
    title = font(INTER_BOLD, DEJAVU_BOLD, 72)
    sub = font(INTER, DEJAVU, 36)
    detail = font(INTER, DEJAVU, 28)
    draw.text((560, 180), "Spill the Tank", font=title, fill=(255, 255, 255))
    draw.rectangle([560, 280, 760, 288], fill=AMBER)
    draw.text((560, 320), "Anonymous propane prices", font=sub, fill=(219, 234, 254))
    draw.text((560, 390), "Town or ZIP only. No account.", font=detail, fill=(191, 219, 254))
    return image


def main():
    ASSETS.mkdir(exist_ok=True)
    icon(64).save(ASSETS / "favicon.png")
    icon(48).save(ASSETS / "icon-48.png")
    icon(192).save(ASSETS / "icon-192.png")
    icon(512).save(ASSETS / "icon-512.png")
    share_image().save(ASSETS / "og.png", optimize=True)


if __name__ == "__main__":
    main()
