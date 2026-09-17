# -*- coding: utf-8 -*-
"""纯标准库生成 iOS 主屏图标（不依赖 Pillow）。
用法：python make_icons.py
输出：breakfast-shop/icons/icon-{180,192,512,1024}.png

构图（侧视）：暖奶油底 → 粥碗（碗身+碗足）→ 粥面 → 茶叶蛋 → 碗口亮环 → 三道蒸汽 → 投影
所有坐标以 180 为设计基准做归一化，保证任意尺寸视觉一致。
"""
import os, zlib, struct, math

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'icons')

CREAM = (251, 246, 236)
CREAM2 = (243, 233, 213)
AMBER = (200, 135, 27)
AMBER_D = (140, 89, 10)
AMBER_L = (231, 183, 96)
PORRIDGE = (253, 248, 238)
EGG = (217, 188, 133)
EGG_HL = (238, 217, 178)
EGG_D = (172, 138, 90)
STEAM = (214, 175, 112)
SHADOW = (214, 197, 166)

BASE = 180.0


def blend(dst, src, a):
    a = 0.0 if a < 0 else (1.0 if a > 1 else a)
    return (int(dst[0] + (src[0] - dst[0]) * a + .5),
            int(dst[1] + (src[1] - dst[1]) * a + .5),
            int(dst[2] + (src[2] - dst[2]) * a + .5))


class Canvas:
    def __init__(self, size):
        self.S = size
        self.buf = bytearray(size * size * 3)

    def put(self, x, y, color):
        S = self.S
        if 0 <= x < S and 0 <= y < S:
            i = (y * S + x) * 3
            self.buf[i] = color[0]; self.buf[i + 1] = color[1]; self.buf[i + 2] = color[2]

    def get(self, x, y):
        S = self.S
        i = (y * S + x) * 3
        return (self.buf[i], self.buf[i + 1], self.buf[i + 2])

    def px(self, u, v):
        """归一化坐标 → 像素坐标"""
        return int(u * self.S), int(v * self.S)

    def blend_at(self, x, y, color, a):
        S = self.S
        if 0 <= x < S and 0 <= y < S and a > 0:
            self.put(x, y, blend(self.get(x, y), color, a))

    def ellipse(self, cu, cv, ru, rv, color, y_min=None, y_max=None, shade=None):
        """填充椭圆（归一化）。y_min/y_max 以归一化给出，用于只画上半/下半。
           shade=(上色,下色) 时按纵向着色。"""
        S = self.S
        cx, cy = cu * S, cv * S
        rx, ry = ru * S, rv * S
        y0 = int(max(0, cy - ry - 2))
        y1 = int(min(S, cy + ry + 3))
        for y in range(y0, y1):
            v = y / S
            if y_min is not None and v < y_min: continue
            if y_max is not None and v > y_max: continue
            ny = (y - cy) / ry
            if abs(ny) > 1: continue
            half = rx * math.sqrt(max(0.0, 1 - ny * ny))
            x0 = int(max(0, cx - half))
            x1 = int(min(S - 1, cx + half))
            if x1 < x0: continue
            if shade:
                t = (y - (cy - ry)) / (2 * ry)
                col = blend(shade[0], shade[1], t)
            else:
                col = color
            for x in range(x0, x1 + 1):
                self.put(x, y, col)

    def ring(self, cu, cv, ru, rv, thick_u, color, a=1.0):
        """椭圆环（归一化），thick_u 为粗细（以 u 计）"""
        S = self.S
        cx, cy = cu * S, cv * S
        rx, ry = ru * S, rv * S
        th = thick_u * S
        x0 = int(max(0, cx - rx - th - 2)); x1 = int(min(S - 1, cx + rx + th + 2))
        y0 = int(max(0, cy - ry - th - 2)); y1 = int(min(S - 1, cy + ry + th + 2))
        # 内外两个椭圆之间即为环
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                dx, dy = x - cx, y - cy
                # 用椭圆距离场近似
                do = math.hypot(dx / (rx + th), dy / (ry + th))
                di = math.hypot(dx / rx, dy / ry)
                if do <= 1.0 and di >= 1.0:
                    # 边缘抗锯齿
                    eo = 1.0 - do
                    ei = di - 1.0
                    cov = min(1.0, min(eo, ei) * max(rx, ry) / max(1.0, th * 0.5) / 2.0 + 0.55)
                    self.blend_at(x, y, color, a * max(0.0, min(1.0, cov)))

    def disc(self, cu, cv, r, color, shade=None, hl=None):
        S = self.S
        cx, cy = cu * S, cv * S
        rr = r * S
        for y in range(int(max(0, cy - rr - 1)), int(min(S, cy + rr + 2))):
            for x in range(int(max(0, cx - rr - 1)), int(min(S, cx + rr + 2))):
                d = math.hypot(x - cx, y - cy)
                if d <= rr:
                    cov = min(1.0, (rr - d) * 1.6 + 0.5)
                    col = color
                    if shade:
                        t = (y - (cy - rr)) / (2 * rr)
                        col = blend(shade[0], shade[1], t)
                    if hl:
                        hd = math.hypot(x - hl[0] * S, y - hl[1] * S)
                        if hd < hl[2] * S:
                            col = hl[3]
                    self.blend_at(x, y, col, max(0.0, min(1.0, cov)))


def render(S):
    c = Canvas(S)

    # ---- 1. 背景：底部暖光 + 顶部奶油 ----
    for y in range(S):
        v = y / S
        t = min(1.0, max(0.0, (v - 0.20) / 0.80))
        col = blend(CREAM, CREAM2, t ** 1.25)
        for x in range(S):
            c.put(x, y, col)
    # 底部中心一团暖光
    for y in range(S):
        for x in range(S):
            d = math.hypot((x - S * .5) / (S * .62), (y - S * .82) / (S * .42))
            if d < 1.0:
                c.blend_at(x, y, AMBER_L, 0.10 * (1 - d) ** 2)

    # ---- 2. 投影：宽而软的椭圆，贴近碗足 ----
    for y in range(int(S * .74), int(S * .90)):
        for x in range(int(S * .12), int(S * .88)):
            d = math.hypot((x - S * .5) / (S * .325), (y - S * .800) / (S * .062))
            if d < 1.0:
                c.blend_at(x, y, SHADOW, 0.30 * (1 - d) ** 1.9)

    # ---- 3. 碗身：碗口即最宽处，向下收成半椭圆 ----
    BOWL_TOP = 0.545
    c.ellipse(0.5, BOWL_TOP, 0.335, 0.245, None, y_min=BOWL_TOP,
              shade=(AMBER_L, AMBER_D))
    # 碗足（底部小台阶）
    c.ellipse(0.5, 0.788, 0.138, 0.030, AMBER_D)
    c.ellipse(0.5, 0.783, 0.138, 0.026, blend(AMBER_D, (0, 0, 0), 0.12))

    # ---- 4. 粥面 ----
    c.ellipse(0.5, 0.552, 0.315, 0.072, PORRIDGE)

    # ---- 5. 茶叶蛋（放在右侧，给左侧蒸汽让位）----
    c.disc(0.605, 0.5435, 0.062, EGG,
           shade=(EGG_HL, EGG_D),
           hl=(0.586, 0.522, 0.021, (242, 226, 192)))

    # ---- 6. 碗口亮环（压在粥面与蛋之上，形成碗沿）----
    c.ring(0.5, BOWL_TOP, 0.315, 0.072, 0.032, AMBER_L, a=1.0)
    c.ring(0.5, BOWL_TOP, 0.335, 0.086, 0.014, AMBER, a=0.85)

    # ---- 7. 三道蒸汽：单 S 曲线上升，顶端完全淡出 ----
    for idx, (cu, amp, thick, tall, lean) in enumerate([
            (0.330, 0.030, 0.030, 0.78, -0.030),
            (0.420, 0.036, 0.036, 0.96, 0.012),
            (0.505, 0.030, 0.030, 0.80, 0.034)]):
        x0 = cu * S
        y_bot = (BOWL_TOP + 0.010) * S           # 起点落在碗沿内侧，避免悬空
        h = 0.270 * tall * S
        steps = int(h * 1.6) + 1
        for i in range(steps):
            t = i / max(1, steps - 1)
            y = y_bot - t * h
            # 经典蒸气象：半个正弦（先向一侧偏，再回正），叠加轻微飘移
            x = x0 + math.sin(t * math.pi) * amp * S + lean * S * t
            r = thick * S * 0.5 * (1.0 - 0.72 * t ** 1.3)
            a = 0.50 * (1.0 - t) ** 0.75         # 顶端归零，无断头
            if r <= 0.3 or a <= 0.01:
                continue
            ri = int(math.ceil(r))
            for dy in range(-ri, ri + 1):
                for dx in range(-ri, ri + 1):
                    d = math.sqrt(dx * dx + dy * dy)
                    if d > r: continue
                    cov = (1.0 - d / r) ** 0.65   # 柔边，读起来像雾不像条
                    c.blend_at(int(x + dx), int(y + dy), STEAM, a * cov)

    return c.buf


def write_png(path, size, rgb):
    raw = bytearray()
    stride = size * 3
    for y in range(size):
        raw.append(0)
        raw.extend(rgb[y * stride:(y + 1) * stride])
    comp = zlib.compress(bytes(raw), 9)

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', comp)
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
    return len(png)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    big = render(1024)
    for s in (180, 192, 512, 1024):
        if s == 1024:
            rgb = big
        else:
            rgb = bytearray(s * s * 3)
            for y in range(s):
                sy = int(y * 1024 / s)
                for x in range(s):
                    si = (sy * 1024 + int(x * 1024 / s)) * 3
                    di = (y * s + x) * 3
                    rgb[di:di + 3] = big[si:si + 3]
        p = os.path.join(OUT, 'icon-%d.png' % s)
        n = write_png(p, s, rgb)
        print('  %-44s %d x %d   %s bytes' % (os.path.basename(p), s, s, format(n, ',')))
    print('图标生成完成 ->', OUT)
