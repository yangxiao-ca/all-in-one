#!/usr/bin/env python3
"""生成学习架的 PWA 图标。纯标准库，无第三方依赖。

用法：python3 scripts/make-icons.py
产物：icons/icon-192.png、icons/icon-512.png、icons/icon-maskable-512.png、icons/apple-touch-icon.png
"""

from __future__ import annotations

import pathlib
import struct
import zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "icons"

# 与 styles.css 的设计变量保持一致
BG_FROM = (0x27, 0x37, 0x2F)  # 侧边栏渐变起点
BG_TO = (0x16, 0x20, 0x1C)    # 侧边栏渐变终点
GLYPH = (0xCB, 0xDF, 0x67)    # --lime

# 归一化几何（对照最初的 SVG 手稿）
RADIUS = 115 / 512
VBAR = (150 / 512, 120 / 512, 220 / 512, 392 / 512)
HBAR = (150 / 512, 322 / 512, 362 / 512, 392 / 512)
BAR_RADIUS = 35 / 512


def _inside_rounded_rect(px, py, x0, y0, x1, y1, r):
    """判断点是否落在圆角矩形内。"""
    if px < x0 or px > x1 or py < y0 or py > y1:
        return False
    cx = min(max(px, x0 + r), x1 - r)
    cy = min(max(py, y0 + r), y1 - r)
    dx, dy = px - cx, py - cy
    return dx * dx + dy * dy <= r * r


def _gradient(px, py):
    t = (px + py) / 2.0
    return tuple(round(a + (b - a) * t) for a, b in zip(BG_FROM, BG_TO))


def render(size: int, maskable: bool, ss: int = 2) -> list[bytearray]:
    """渲染一张 size×size 的 RGBA 图。

    ss 为每个像素的超采样倍数，用于抗锯齿。
    maskable=True 时满幅铺底并把字形缩到安全区内（Android 会自行裁切）。
    """
    scale = 0.62 if maskable else 1.0
    offset = (1.0 - scale) / 2.0

    def glyph_point(px, py):
        gx = (px - offset) / scale
        gy = (py - offset) / scale
        if _inside_rounded_rect(gx, gy, *VBAR, BAR_RADIUS):
            return True
        return _inside_rounded_rect(gx, gy, *HBAR, BAR_RADIUS)

    rows: list[bytearray] = []
    total = ss * ss
    for y in range(size):
        row = bytearray()
        for x in range(size):
            sr = sg = sb = 0
            covered = 0
            for sy in range(ss):
                py = (y + (sy + 0.5) / ss) / size
                for sx in range(ss):
                    px = (x + (sx + 0.5) / ss) / size
                    if not maskable and not _inside_rounded_rect(px, py, 0.0, 0.0, 1.0, 1.0, RADIUS):
                        continue  # 圆角外完全透明，不计入颜色
                    covered += 1
                    color = GLYPH if glyph_point(px, py) else _gradient(px, py)
                    sr += color[0]
                    sg += color[1]
                    sb += color[2]
            if covered == 0:
                row += bytes((0, 0, 0, 0))
            else:
                row += bytes((
                    round(sr / covered),
                    round(sg / covered),
                    round(sb / covered),
                    round(255 * covered / total),
                ))
        rows.append(row)
    return rows


def downsample(rows: list[bytearray], src: int, dst: int) -> list[bytearray]:
    """按整数倍做盒式滤波缩放（带 alpha 加权，避免边缘发黑）。"""
    if src == dst:
        return rows
    factor = src // dst
    out: list[bytearray] = []
    for y in range(dst):
        row = bytearray()
        for x in range(dst):
            ar = ag = ab = aa = 0
            for sy in range(factor):
                src_row = rows[y * factor + sy]
                for sx in range(factor):
                    i = (x * factor + sx) * 4
                    a = src_row[i + 3]
                    ar += src_row[i] * a
                    ag += src_row[i + 1] * a
                    ab += src_row[i + 2] * a
                    aa += a
            if aa == 0:
                row += bytes((0, 0, 0, 0))
            else:
                row += bytes((round(ar / aa), round(ag / aa), round(ab / aa), round(aa / (factor * factor))))
        out.append(row)
    return out


def write_png(path: pathlib.Path, size: int, rows: list[bytearray]) -> None:
    raw = b"".join(b"\x00" + bytes(row) for row in rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # 每个变体只渲染一次 1024，其余尺寸全部由它缩放得到
    for maskable, targets in ((False, (512, 192, 180)), (True, (512,))):
        hi = render(1024, maskable)
        for target in targets:
            rows = downsample(hi, 1024, target)
            name = "icon-maskable-512.png" if maskable else (
                "apple-touch-icon.png" if target == 180 else f"icon-{target}.png"
            )
            write_png(OUT_DIR / name, target, rows)
            print(f"生成 icons/{name}  ({target}×{target})")


if __name__ == "__main__":
    main()
