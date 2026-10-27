#!/usr/bin/env python3
"""生成 yagent 品牌图标 / logo 多版本。

输出（apps/desktop/build/）：
  圆形粒子：
    icon.png / .icns / .ico     彩色应用图标
    logo-black / logo-white     透明底黑白 logo（.png + .svg）
    icon-black / icon-white     有底方标
  方块粒子（同图案，格子改方）：
    logo-square-black / logo-square-white
    icon-square / icon-square-black / icon-square-white
"""

from __future__ import annotations

import math
import os
import subprocess
import sys
from typing import Literal

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'build')

Shape = Literal['circle', 'square']

# 官网 index：数学斜体 𝑥
CELLS = [
    '0-1-3-0',
    '0-1-3-1',
    '0-1-3-2',
    '0-1-3-3',
    '0-2-3-3',
    '0-3-3-0',
    '1-1-0-2',
    '1-1-0-3',
    '1-2-0-2',
    '1-2-0-3',
    '1-3-0-0',
    '1-1-1-3',
    '1-2-1-1',
    '1-1-2-3',
    '1-2-2-0',
    '1-2-2-1',
    '1-1-3-3',
    '1-2-3-0',
    '2-1-0-3',
    '2-2-0-0',
    '2-1-1-2',
    '2-2-1-0',
    '2-2-1-1',
    '2-1-2-2',
    '2-2-2-0',
    '2-2-2-1',
    '2-0-3-3',
    '2-1-3-0',
    '2-1-3-1',
    '2-2-3-0',
    '2-2-3-1',
    '2-2-3-2',
    '2-2-3-3',
    '3-0-0-3',
    '3-1-0-0',
    '3-2-0-1',
    '3-2-0-2',
]

# 右下角笔画半透明
GHOST = {
    '2-2-1-0',
    '2-2-1-1',
    '2-2-2-0',
    '2-2-2-1',
    '2-2-3-0',
    '2-2-3-1',
    '2-2-3-2',
    '2-2-3-3',
    '3-2-0-1',
    '3-2-0-2',
}

FROM = (255, 138, 92)
TO = (92, 138, 255)
BG_DARK = (13, 13, 15, 255)
BG_LIGHT = (255, 255, 255, 255)
BLACK = (18, 18, 20, 255)
WHITE = (242, 242, 240, 255)


def lerp(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))  # type: ignore[return-value]


def units(size: int, pad_ratio: float = 0.14):
    """每个选中格：中心、半径(圆)、方块 bbox、径向 t、是否 ghost。"""
    pad = size * pad_ratio
    cell = (size - pad * 2) / 16
    r = cell * 0.42
    inset = cell * 0.1  # 方块之间留缝，类似官网 grid
    for cid in CELLS:
        br, bc, sr, sc = map(int, cid.split('-'))
        row, col = br * 4 + sr, bc * 4 + sc
        t = math.hypot(row - 7.5, col - 7.5) / math.hypot(7.5, 7.5)
        x0 = pad + col * cell
        y0 = pad + row * cell
        cx = x0 + cell / 2
        cy = y0 + cell / 2
        box = (x0 + inset, y0 + inset, x0 + cell - inset, y0 + cell - inset)
        yield cx, cy, r, box, t, cid in GHOST


def make(
    size: int,
    *,
    shape: Shape = 'circle',
    bg: tuple[int, int, int, int] | None,
    ink: tuple[int, int, int, int] | None = None,
    gradient: bool = False,
    pad_ratio: float = 0.14,
) -> Image.Image:
    img = Image.new('RGBA', (size, size), bg if bg is not None else (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for cx, cy, r, box, t, ghost in units(size, pad_ratio):
        alpha = 26 if ghost else 255  # ≈ 0.10
        if gradient:
            rgb = lerp(FROM, TO, t)
            color = rgb + (alpha,)
        else:
            assert ink is not None
            color = (ink[0], ink[1], ink[2], alpha)
        if shape == 'circle':
            draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
        else:
            draw.rectangle(list(box), fill=color)
    return img


def make_mac_icon(
    size: int,
    *,
    shape: Shape = 'circle',
    plate: tuple[int, int, int, int] = BG_DARK,
    ink: tuple[int, int, int, int] | None = None,
    gradient: bool = False,
) -> Image.Image:
    """macOS Dock 用：透明外沿 + 圆角底板，避免整块直角黑方。"""
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    # 略内缩，和系统图标一样不顶满格子
    margin = max(1, int(size * 0.05))
    radius = max(2, int((size - 2 * margin) * 0.225))
    plate_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(plate_img).rounded_rectangle(
        [margin, margin, size - margin - 1, size - margin - 1],
        radius=radius,
        fill=plate,
    )
    # logo 再内缩一点，别贴圆角
    logo = make(
        size,
        shape=shape,
        bg=None,
        ink=ink,
        gradient=gradient,
        pad_ratio=0.20,
    )
    return Image.alpha_composite(plate_img, logo)


def write_svg(
    path: str,
    fill: str,
    *,
    shape: Shape = 'circle',
    size: int = 1024,
    pad_ratio: float = 0.14,
) -> None:
    parts: list[str] = []
    for cx, cy, r, box, _t, ghost in units(size, pad_ratio):
        opacity = ' opacity="0.10"' if ghost else ''
        if shape == 'circle':
            parts.append(f'<circle cx="{cx:.3f}" cy="{cy:.3f}" r="{r:.3f}"{opacity}/>')
        else:
            x, y, x2, y2 = box
            parts.append(
                f'<rect x="{x:.3f}" y="{y:.3f}" width="{x2 - x:.3f}" height="{y2 - y:.3f}"{opacity}/>'
            )
    body = '\n  '.join(parts)
    svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" fill="{fill}" role="img" aria-label="yagent">
  {body}
</svg>
'''
    with open(path, 'w', encoding='utf-8') as f:
        f.write(svg)


def write_iconset(img_fn, iset: str) -> None:
    os.makedirs(iset, exist_ok=True)
    for f in os.listdir(iset):
        os.remove(os.path.join(iset, f))
    for name, s in [
        ('icon_16x16.png', 16),
        ('icon_16x16@2x.png', 32),
        ('icon_32x32.png', 32),
        ('icon_32x32@2x.png', 64),
        ('icon_128x128.png', 128),
        ('icon_128x128@2x.png', 256),
        ('icon_256x256.png', 256),
        ('icon_256x256@2x.png', 512),
        ('icon_512x512.png', 512),
        ('icon_512x512@2x.png', 1024),
    ]:
        img_fn(s).save(os.path.join(iset, name))


def main() -> None:
    os.makedirs(OUT, exist_ok=True)

    # —— 圆形 · 彩色应用图标（mac 圆角底板 + 透明外沿）——
    color = lambda s: make_mac_icon(s, shape='circle', plate=BG_DARK, gradient=True)
    color(1024).save(os.path.join(OUT, 'icon.png'))
    write_iconset(color, os.path.join(OUT, 'icon.iconset'))
    color(256).save(
        os.path.join(OUT, 'icon.ico'),
        format='ICO',
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    try:
        subprocess.run(
            ['iconutil', '-c', 'icns', os.path.join(OUT, 'icon.iconset'), '-o', os.path.join(OUT, 'icon.icns')],
            check=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError) as e:
        print('iconutil skipped:', e, file=sys.stderr)

    # —— 圆形 · 黑白 logo（透明底，无底板）/ 方标（mac 圆角）——
    make(1024, shape='circle', bg=None, ink=BLACK, pad_ratio=0.08).save(
        os.path.join(OUT, 'logo-black.png')
    )
    make(1024, shape='circle', bg=None, ink=WHITE, pad_ratio=0.08).save(
        os.path.join(OUT, 'logo-white.png')
    )
    write_svg(os.path.join(OUT, 'logo-black.svg'), '#121214', shape='circle', pad_ratio=0.08)
    write_svg(os.path.join(OUT, 'logo-white.svg'), '#f2f2f0', shape='circle', pad_ratio=0.08)
    make_mac_icon(1024, shape='circle', plate=BG_DARK, ink=WHITE).save(
        os.path.join(OUT, 'icon-black.png')
    )
    make_mac_icon(1024, shape='circle', plate=BG_LIGHT, ink=BLACK).save(
        os.path.join(OUT, 'icon-white.png')
    )

    # —— 方块粒子 · 彩色 / 黑白 ——
    make_mac_icon(1024, shape='square', plate=BG_DARK, gradient=True).save(
        os.path.join(OUT, 'icon-square.png')
    )
    make(1024, shape='square', bg=None, ink=BLACK, pad_ratio=0.08).save(
        os.path.join(OUT, 'logo-square-black.png')
    )
    make(1024, shape='square', bg=None, ink=WHITE, pad_ratio=0.08).save(
        os.path.join(OUT, 'logo-square-white.png')
    )
    write_svg(
        os.path.join(OUT, 'logo-square-black.svg'), '#121214', shape='square', pad_ratio=0.08
    )
    write_svg(
        os.path.join(OUT, 'logo-square-white.svg'), '#f2f2f0', shape='square', pad_ratio=0.08
    )
    make_mac_icon(1024, shape='square', plate=BG_DARK, ink=WHITE).save(
        os.path.join(OUT, 'icon-square-black.png')
    )
    make_mac_icon(1024, shape='square', plate=BG_LIGHT, ink=BLACK).save(
        os.path.join(OUT, 'icon-square-white.png')
    )

    print('wrote', OUT)
    for name in sorted(os.listdir(OUT)):
        if name.endswith(('.png', '.svg', '.icns', '.ico')):
            p = os.path.join(OUT, name)
            print(f'  {name:24} {os.path.getsize(p):7d} B')


if __name__ == '__main__':
    main()
