#!/usr/bin/env python3
"""以 Pillow 參數化繪製拳擊手企鵝的 18 張遊戲戰鬥幀。

執行：python tools/繪製企鵝.py

設計原則：
- 企鵝本體與職業裝備分層，之後可替換 GEAR 與裝備繪製器。
- 所有造型都是可重跑的向量式參數，不依賴手工修圖或生成式 API。
- 使用 4 倍尺寸繪製後縮圖，只讓邊緣反鋸齒；材質內部保持平塗色塊。
"""

from __future__ import annotations

from dataclasses import dataclass
from math import atan2, cos, pi, radians, sin, tan
from pathlib import Path
from typing import Iterable, Sequence

from PIL import Image, ImageDraw, ImageFont


CANVAS = 512
SUPERSAMPLE = 4
S = SUPERSAMPLE
GROUND_BBOX_BOTTOM = 460
TARGET_CENTER_X = 256
OUTLINE_WIDTH = 5

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "assets" / "frames_boxer"


# 本體調色盤：每種材質只有本色／暗部／亮部，沒有連續漸層。
PENGUIN = {
    "outline": "#2B160F",
    "body": {"base": "#2C2E32", "shadow": "#202226", "light": "#3A3C40"},
    "white": {"base": "#F5F1E8", "shadow": "#D8D3CC", "light": "#FFFDF8"},
    "beak": {"base": "#F2A24A", "shadow": "#C56C2C", "light": "#FFC56A"},
    "feet": {"base": "#E9A45D", "shadow": "#B96D38", "light": "#F7C27F"},
    "eye": {"base": "#21100B", "light": "#FFFFFF"},
}


# 職業裝備完全由資料描述；新增職業時不必改企鵝本體。
GEAR = {
    "boxer": {
        "headband": {
            "base": "#EA5560",
            "shadow": "#B93443",
            "light": "#FF7D78",
            "band_width": 25,
            "tail_length": 88,
        },
        "vest": {
            "base": "#E64F59",
            "shadow": "#B93442",
            "light": "#F67572",
        },
        # 手套比背心壓暗一階；袖口刻意變淺，保證 50 px 下仍能分離。
        "gloves": {
            "base": "#B83342",
            "shadow": "#872535",
            "light": "#D95760",
            "cuff": "#F39A88",
            "cuff_light": "#FFC0A6",
            "size": 1.0,
        },
    }
}


@dataclass(frozen=True)
class Pose:
    name: str
    body_bob: float = 0.0
    body_scale_x: float = 1.0
    body_scale_y: float = 1.0
    lean_deg: float = 0.0
    rear_hand: tuple[float, float] = (184, 292)
    front_hand: tuple[float, float] = (337, 282)
    rear_foot: tuple[float, float, float, float] = (207, 439, -8, 1.0)
    front_foot: tuple[float, float, float, float] = (307, 441, 8, 1.0)
    expression: str = "angry"
    ribbon: str = "idle"
    glove_scale: float = 1.0
    rotate_final: float = 0.0


POSES: tuple[Pose, ...] = (
    Pose("idle_1", rear_hand=(185, 292), front_hand=(337, 282), ribbon="idle"),
    Pose(
        "idle_2",
        body_bob=-4,
        body_scale_x=1.012,
        body_scale_y=0.985,
        rear_hand=(184, 286),
        front_hand=(337, 276),
        ribbon="idle_high",
    ),
    Pose(
        "walk_1",
        body_bob=-2,
        lean_deg=2,
        rear_hand=(181, 290),
        front_hand=(340, 274),
        rear_foot=(190, 439, -18, 1.02),
        front_foot=(322, 443, 17, 1.05),
        ribbon="back_small",
    ),
    Pose(
        "walk_2",
        body_bob=-8,
        lean_deg=3,
        rear_hand=(176, 278),
        front_hand=(344, 290),
        rear_foot=(216, 444, -4, 0.96),
        front_foot=(291, 434, 27, 0.86),
        ribbon="back_small",
    ),
    Pose(
        "walk_3",
        body_bob=-1,
        lean_deg=1,
        rear_hand=(188, 278),
        front_hand=(334, 290),
        rear_foot=(178, 443, -22, 1.07),
        front_foot=(315, 439, 7, 1.00),
        ribbon="idle",
    ),
    Pose(
        "walk_4",
        body_bob=-7,
        lean_deg=3,
        rear_hand=(184, 298),
        front_hand=(342, 272),
        rear_foot=(220, 434, -25, 0.86),
        front_foot=(303, 444, 6, 0.96),
        ribbon="back_small",
    ),
    Pose(
        "punch_1",
        body_bob=1,
        body_scale_x=1.035,
        body_scale_y=0.985,
        rear_hand=(181, 297),
        front_hand=(317, 210),
        lean_deg=-1,
        ribbon="idle",
        glove_scale=1.04,
    ),
    Pose(
        "punch_2",
        body_bob=3,
        body_scale_x=1.04,
        body_scale_y=0.97,
        rear_hand=(181, 302),
        front_hand=(411, 237),
        lean_deg=7,
        rear_foot=(196, 442, -12, 1.0),
        front_foot=(316, 442, 17, 1.03),
        ribbon="dash",
        glove_scale=1.10,
    ),
    Pose(
        "punch_3",
        body_bob=1,
        rear_hand=(184, 294),
        front_hand=(368, 245),
        lean_deg=3,
        ribbon="back_small",
        glove_scale=1.04,
    ),
    Pose(
        "grab_1",
        body_bob=1,
        lean_deg=4,
        rear_hand=(351, 294),
        front_hand=(397, 250),
        ribbon="back_small",
        glove_scale=1.02,
    ),
    Pose(
        "grab_2",
        body_bob=-2,
        lean_deg=6,
        rear_hand=(368, 266),
        front_hand=(410, 294),
        ribbon="back_small",
        glove_scale=1.06,
    ),
    Pose(
        "hurt_1",
        body_bob=2,
        body_scale_x=0.97,
        body_scale_y=1.01,
        lean_deg=-9,
        rear_hand=(206, 318),
        front_hand=(305, 321),
        expression="hurt",
        ribbon="forward",
    ),
    Pose(
        "hurt_2",
        body_bob=5,
        body_scale_x=0.95,
        body_scale_y=1.015,
        lean_deg=-13,
        rear_hand=(218, 337),
        front_hand=(315, 326),
        expression="hurt_wide",
        ribbon="forward_high",
    ),
    Pose(
        "dash_1",
        body_bob=4,
        body_scale_x=1.055,
        body_scale_y=0.965,
        lean_deg=12,
        rear_hand=(174, 322),
        front_hand=(350, 262),
        rear_foot=(190, 443, -17, 1.02),
        front_foot=(326, 440, 20, 1.02),
        ribbon="dash_long",
    ),
    Pose(
        "dash_2",
        body_bob=7,
        body_scale_x=1.07,
        body_scale_y=0.95,
        lean_deg=15,
        rear_hand=(168, 308),
        front_hand=(365, 274),
        rear_foot=(205, 442, -4, 0.95),
        front_foot=(329, 436, 31, 0.91),
        ribbon="dash_long",
    ),
    Pose(
        "ko_1",
        body_scale_x=0.98,
        body_scale_y=0.98,
        lean_deg=-2,
        rear_hand=(186, 316),
        front_hand=(330, 322),
        rear_foot=(199, 442, -10, 0.98),
        front_foot=(313, 442, 13, 0.98),
        expression="ko",
        ribbon="slack",
        rotate_final=72,
    ),
    Pose(
        "stance_1",
        body_bob=8,
        body_scale_x=1.06,
        body_scale_y=0.94,
        lean_deg=1,
        rear_hand=(207, 226),
        front_hand=(310, 204),
        rear_foot=(190, 444, -15, 1.04),
        front_foot=(320, 443, 15, 1.04),
        ribbon="idle",
        glove_scale=1.08,
    ),
    Pose(
        "stance_2",
        body_bob=4,
        body_scale_x=1.045,
        body_scale_y=0.955,
        lean_deg=2,
        rear_hand=(205, 222),
        front_hand=(313, 200),
        rear_foot=(192, 444, -14, 1.03),
        front_foot=(319, 443, 14, 1.03),
        ribbon="idle_high",
        glove_scale=1.08,
    ),
)


def sc(value: float) -> int:
    return round(value * S)


def scaled_points(points: Iterable[tuple[float, float]]) -> list[tuple[int, int]]:
    return [(sc(x), sc(y)) for x, y in points]


def sample_cubic(
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    p3: tuple[float, float],
    steps: int = 12,
) -> list[tuple[float, float]]:
    result: list[tuple[float, float]] = []
    for i in range(1, steps + 1):
        t = i / steps
        u = 1 - t
        result.append(
            (
                u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
                u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1],
            )
        )
    return result


def bezier_path(
    start: tuple[float, float],
    curves: Sequence[tuple[tuple[float, float], tuple[float, float], tuple[float, float]]],
) -> list[tuple[float, float]]:
    points = [start]
    current = start
    for control_1, control_2, end in curves:
        points.extend(sample_cubic(current, control_1, control_2, end))
        current = end
    return points


class CelCanvas:
    def __init__(self) -> None:
        self.image = Image.new("RGBA", (CANVAS * S, CANVAS * S), (0, 0, 0, 0))
        self.draw = ImageDraw.Draw(self.image)

    def polygon(
        self,
        points: Sequence[tuple[float, float]],
        fill: str,
        outline: str | None = None,
        width: float = OUTLINE_WIDTH,
    ) -> None:
        pts = scaled_points(points)
        self.draw.polygon(pts, fill=fill)
        if outline:
            self.draw.line(pts + [pts[0]], fill=outline, width=sc(width), joint="curve")

    def ellipse(
        self,
        box: tuple[float, float, float, float],
        fill: str,
        outline: str | None = None,
        width: float = OUTLINE_WIDTH,
    ) -> None:
        self.draw.ellipse(tuple(sc(v) for v in box), fill=fill, outline=outline, width=sc(width) if outline else 1)

    def line(
        self,
        points: Sequence[tuple[float, float]],
        fill: str,
        width: float,
        joint: str = "curve",
    ) -> None:
        self.draw.line(scaled_points(points), fill=fill, width=sc(width), joint=joint)

    def composite(self, other: "CelCanvas") -> None:
        self.image.alpha_composite(other.image)


class PenguinRenderer:
    BODY_PIVOT = (256.0, 421.0)

    def __init__(self, pose: Pose, gear_name: str = "boxer") -> None:
        self.pose = pose
        self.gear = GEAR[gear_name]

    def t(self, point: tuple[float, float], body_bob: bool = True) -> tuple[float, float]:
        """將本體座標套用呼吸、壓縮與前後傾；腳掌可關閉 body_bob。"""
        x, y = point
        px, py = self.BODY_PIVOT
        x = px + (x - px) * self.pose.body_scale_x
        y = py + (y - py) * self.pose.body_scale_y
        x += (py - y) * tan(radians(self.pose.lean_deg))
        if body_bob:
            y += self.pose.body_bob
        return x, y

    def path_t(
        self,
        start: tuple[float, float],
        curves: Sequence[tuple[tuple[float, float], tuple[float, float], tuple[float, float]]],
        body_bob: bool = True,
    ) -> list[tuple[float, float]]:
        return [self.t(p, body_bob) for p in bezier_path(start, curves)]

    @staticmethod
    def rotate_local(
        points: Iterable[tuple[float, float]],
        center: tuple[float, float],
        angle_deg: float,
        scale: float = 1.0,
    ) -> list[tuple[float, float]]:
        a = radians(angle_deg)
        ca, sa = cos(a), sin(a)
        cx, cy = center
        return [
            (cx + scale * (x * ca - y * sa), cy + scale * (x * sa + y * ca))
            for x, y in points
        ]

    def draw_capsule(
        self,
        canvas: CelCanvas,
        start: tuple[float, float],
        end: tuple[float, float],
        width: float,
        fill: str,
    ) -> None:
        outline = PENGUIN["outline"]
        p0, p1 = self.t(start), self.t(end)
        for color, stroke in ((outline, width + 2 * OUTLINE_WIDTH), (fill, width)):
            canvas.line([p0, p1], color, stroke)
            radius = stroke / 2
            for x, y in (p0, p1):
                canvas.ellipse((x - radius, y - radius, x + radius, y + radius), color)

    def draw_foot(
        self,
        canvas: CelCanvas,
        center_x: float,
        center_y: float,
        angle: float,
        scale: float,
        mirrored: bool,
    ) -> None:
        base = [
            (-28, -15),
            (-19, -24),
            (-4, -22),
            (5, -12),
            (14, -18),
            (29, -15),
            (31, -4),
            (41, -8),
            (54, -2),
            (52, 8),
            (47, 15),
            (31, 13),
            (23, 11),
            (18, 20),
            (4, 21),
            (-3, 13),
            (-12, 20),
            (-26, 15),
            (-31, 5),
        ]
        if mirrored:
            base = [(-x, y) for x, y in base]
        center = self.t((center_x, center_y), body_bob=False)
        points = self.rotate_local(base, center, angle, scale)
        canvas.polygon(points, PENGUIN["feet"]["base"], PENGUIN["outline"])

        # 一塊硬邊暗部與兩條粗趾線，縮到 50 px 仍看得見。
        shadow_local = [(6, 10), (22, 9), (38, 8), (45, 13), (28, 16), (14, 17)]
        if mirrored:
            shadow_local = [(-x, y) for x, y in shadow_local]
        canvas.polygon(
            self.rotate_local(shadow_local, center, angle, scale),
            PENGUIN["feet"]["shadow"],
        )
        for x in (10, 26):
            sign = -1 if mirrored else 1
            line = [(sign * (x - 2), 1), (sign * x, 10)]
            canvas.line(
                self.rotate_local(line, center, angle, scale),
                PENGUIN["outline"],
                3.2,
            )

    def draw_penguin_body(self) -> CelCanvas:
        """共用企鵝本體：不含頭帶、背心、袖口與拳套。"""
        c = CelCanvas()
        body = PENGUIN["body"]
        white = PENGUIN["white"]

        # 後腳先畫，前腳稍後蓋回，形成三／四分之三層次。
        rx, ry, ra, rs = self.pose.rear_foot
        fx, fy, fa, fs = self.pose.front_foot
        self.draw_foot(c, rx, ry, ra, rs, mirrored=True)

        # 兩支黑色鰭肢是本體；拳套由裝備層覆在末端。
        self.draw_capsule(c, (187, 265), self.pose.rear_hand, 34, body["base"])

        outer = self.path_t(
            (256, 53),
            (
                ((207, 48), (169, 80), (158, 137)),
                ((143, 206), (151, 285), (166, 350)),
                ((177, 405), (213, 434), (258, 437)),
                ((303, 439), (340, 412), (350, 353)),
                ((361, 291), (351, 214), (340, 145)),
                ((332, 88), (302, 57), (256, 53)),
            ),
        )
        c.polygon(outer, body["base"], PENGUIN["outline"], 6)

        # 左下黑羽暗面與右上亮面都是單一硬邊色塊。
        c.polygon(
            self.path_t(
                (161, 190),
                (
                    ((150, 258), (158, 347), (190, 397)),
                    ((207, 423), (224, 433), (244, 436)),
                    ((207, 398), (193, 343), (194, 288)),
                    ((190, 242), (181, 212), (161, 190)),
                ),
            ),
            body["shadow"],
        )
        c.polygon(
            self.path_t(
                (287, 66),
                (
                    ((319, 77), (335, 110), (340, 153)),
                    ((344, 180), (344, 197), (341, 214)),
                    ((329, 151), (309, 100), (287, 66)),
                ),
            ),
            body["light"],
        )

        # 白臉一路延伸到胸口，背心低領之後仍會露出一截白色辨識塊。
        face_chest = self.path_t(
            (255, 120),
            (
                ((232, 91), (193, 112), (187, 153)),
                ((183, 178), (188, 203), (199, 220)),
                ((182, 239), (195, 263), (221, 270)),
                ((219, 303), (225, 338), (244, 363)),
                ((259, 381), (285, 374), (297, 350)),
                ((313, 318), (309, 276), (303, 250)),
                ((325, 229), (333, 199), (326, 164)),
                ((319, 128), (285, 104), (255, 120)),
            ),
        )
        c.polygon(face_chest, white["base"], PENGUIN["outline"], 4.5)
        c.polygon(
            self.path_t(
                (199, 220),
                (
                    ((187, 239), (198, 260), (222, 269)),
                    ((226, 282), (226, 292), (225, 305)),
                    ((203, 291), (190, 264), (199, 220)),
                ),
            ),
            white["shadow"],
        )
        c.polygon(
            self.path_t(
                (286, 119),
                (
                    ((309, 125), (322, 145), (326, 166)),
                    ((311, 148), (300, 137), (286, 119)),
                ),
            ),
            white["light"],
        )

        self.draw_capsule(c, (324, 250), self.pose.front_hand, 37, body["base"])
        self.draw_foot(c, fx, fy, fa, fs, mirrored=False)
        self.draw_face(c)
        return c

    def draw_face(self, c: CelCanvas) -> None:
        eye = PENGUIN["eye"]
        outline = PENGUIN["outline"]

        if self.pose.expression.startswith("hurt"):
            offset = 4 if self.pose.expression == "hurt_wide" else 0
            c.line([self.t((211, 181 - offset)), self.t((234, 193)), self.t((211, 196 + offset))], outline, 7)
            c.line([self.t((313, 176 - offset)), self.t((287, 191)), self.t((315, 197 + offset))], outline, 7)
            c.line([self.t((208, 161)), self.t((242, 174))], outline, 9)
            c.line([self.t((318, 159)), self.t((281, 174))], outline, 9)
        elif self.pose.expression == "ko":
            self.draw_spiral_eye(c, self.t((229, 187)), 16)
            self.draw_spiral_eye(c, self.t((294, 184)), 17)
            c.line([self.t((208, 157)), self.t((244, 165))], outline, 7)
            c.line([self.t((316, 158)), self.t((281, 164))], outline, 7)
        else:
            # 眼框與粗眉直接接觸，保留定版設定稿的兇狠辨識特徵。
            lcx, lcy = self.t((230, 188))
            rcx, rcy = self.t((292, 185))
            c.ellipse((lcx - 15, lcy - 22, lcx + 15, lcy + 24), "#FFFDF8", outline, 4)
            c.ellipse((rcx - 17, rcy - 24, rcx + 17, rcy + 25), "#FFFDF8", outline, 4)
            c.ellipse((lcx - 6, lcy - 11, lcx + 8, lcy + 15), eye["base"])
            c.ellipse((rcx - 7, rcy - 13, rcx + 9, rcy + 15), eye["base"])
            c.ellipse((lcx - 2, lcy - 8, lcx + 3, lcy - 3), eye["light"])
            c.ellipse((rcx - 2, rcy - 10, rcx + 4, rcy - 4), eye["light"])
            c.line([self.t((208, 157)), self.t((246, 178))], outline, 10)
            c.line([self.t((317, 153)), self.t((279, 176))], outline, 10)

        bx, by = self.t((270, 218))
        beak = bezier_path(
            (bx - 20, by),
            (
                (((bx - 7, by - 14)), (bx + 4, by - 16), (bx + 22, by - 1)),
                (((bx + 10, by + 13)), (bx - 8, by + 14), (bx - 20, by)),
            ),
        )
        c.polygon(beak, PENGUIN["beak"]["base"], outline, 3.5)
        c.line([(bx - 16, by + 1), (bx + 18, by + 1)], PENGUIN["beak"]["shadow"], 3)
        c.polygon([(bx - 10, by - 3), (bx + 7, by - 8), (bx + 13, by - 2)], PENGUIN["beak"]["light"])

    def draw_spiral_eye(self, c: CelCanvas, center: tuple[float, float], radius: float) -> None:
        points: list[tuple[float, float]] = []
        cx, cy = center
        for i in range(44):
            t = i / 43 * 3.7 * pi
            r = radius * (1 - i / 50)
            points.append((cx + cos(t) * r, cy + sin(t) * r))
        c.line(points, PENGUIN["outline"], 4.5)

    def draw_boxer_gear(self) -> CelCanvas:
        """拳擊手裝備層：可由其他職業裝備繪製器整層替換。"""
        c = CelCanvas()
        self.draw_vest(c)

        # 後手先畫、前手後畫；淺色袖口明確切開深手套與紅背心。
        self.draw_glove(c, (187, 265), self.pose.rear_hand, self.pose.glove_scale * 0.96)
        self.draw_glove(c, (324, 250), self.pose.front_hand, self.pose.glove_scale)
        self.draw_headband(c)
        return c

    def draw_vest(self, c: CelCanvas) -> None:
        vest = self.gear["vest"]
        outline = PENGUIN["outline"]

        # 肩帶獨立於腹部；中央低開口讓白臉連到胸口。
        for points in (
            [(178, 218), (188, 250), (205, 286)],
            [(335, 215), (326, 249), (305, 286)],
        ):
            transformed = [self.t(p) for p in points]
            c.line(transformed, outline, 25)
            c.line(transformed, vest["base"], 16)

        belly = self.path_t(
            (200, 274),
            (
                ((224, 289), (285, 292), (311, 270)),
                ((332, 292), (339, 340), (327, 386)),
                ((315, 422), (289, 434), (257, 435)),
                ((222, 435), (190, 418), (180, 382)),
                ((168, 338), (179, 295), (200, 274)),
            ),
        )
        c.polygon(belly, vest["base"], outline, 5.5)
        c.polygon(
            self.path_t(
                (181, 314),
                (
                    ((172, 351), (184, 399), (217, 424)),
                    ((202, 386), (200, 348), (208, 291)),
                    ((194, 295), (187, 302), (181, 314)),
                ),
            ),
            vest["shadow"],
        )
        c.polygon(
            self.path_t(
                (301, 291),
                (
                    ((326, 316), (329, 351), (319, 377)),
                    ((315, 340), (309, 313), (301, 291)),
                ),
            ),
            vest["light"],
        )

        # 腹肌只保留三條粗折線，不使用會在小尺寸消失的細影線。
        ab = vest["shadow"]
        c.line([self.t((246, 326)), self.t((255, 337)), self.t((250, 351))], ab, 5)
        c.line([self.t((270, 327)), self.t((261, 338)), self.t((267, 351))], ab, 5)
        c.line([self.t((257, 362)), self.t((257, 383))], ab, 5)

    def draw_glove(
        self,
        c: CelCanvas,
        anchor: tuple[float, float],
        hand: tuple[float, float],
        scale: float,
    ) -> None:
        glove = self.gear["gloves"]
        a = self.t(anchor)
        center = self.t(hand)
        angle = atan2(center[1] - a[1], center[0] - a[0]) * 180 / pi
        ca, sa = cos(radians(angle)), sin(radians(angle))

        def along(distance: float) -> tuple[float, float]:
            return center[0] - ca * distance * scale, center[1] - sa * distance * scale

        cuff_center = along(30)
        cuff_local = [(-18, -22), (15, -22), (20, 22), (-18, 22)]
        c.polygon(
            self.rotate_local(cuff_local, cuff_center, angle, scale),
            glove["cuff"],
            PENGUIN["outline"],
            4.5,
        )
        c.line(
            self.rotate_local([(-8, -15), (11, -15)], cuff_center, angle, scale),
            glove["cuff_light"],
            5,
        )

        mitten = bezier_path(
            (-14, -24),
            (
                ((2, -34), (25, -28), (31, -10)),
                ((39, 10), (24, 28), (8, 29)),
                ((-2, 34), (-14, 27), (-18, 18)),
                ((-31, 23), (-39, 11), (-32, 1)),
                ((-27, -8), (-21, -10), (-17, -10)),
                ((-23, -18), (-20, -23), (-14, -24)),
            ),
        )
        c.polygon(
            self.rotate_local(mitten, center, angle, scale),
            glove["base"],
            PENGUIN["outline"],
            5.5,
        )
        highlight = [(-5, -20), (10, -23), (22, -14), (16, -8), (3, -10)]
        c.polygon(self.rotate_local(highlight, center, angle, scale), glove["light"])
        shadow = [(-27, 5), (-16, 17), (3, 23), (-6, 29), (-20, 24), (-31, 14)]
        c.polygon(self.rotate_local(shadow, center, angle, scale), glove["shadow"])
        crease = [(-22, 3), (-13, 7), (-6, 15)]
        c.line(
            self.rotate_local(crease, center, angle, scale),
            glove["shadow"],
            3.5,
        )

    def ribbon_paths(self) -> tuple[list[tuple[float, float]], list[tuple[float, float]]]:
        mode = self.pose.ribbon
        if mode == "dash_long":
            return (
                [(180, 118), (147, 93), (95, 78), (54, 87), (92, 103), (137, 115)],
                [(180, 127), (141, 126), (87, 143), (47, 165), (97, 159), (148, 145)],
            )
        if mode == "dash":
            return (
                [(180, 118), (151, 95), (108, 87), (79, 96), (112, 106), (151, 119)],
                [(180, 128), (146, 130), (101, 151), (75, 167), (116, 159), (153, 144)],
            )
        if mode in {"forward", "forward_high"}:
            lift = -18 if mode == "forward_high" else 0
            return (
                [(179, 116), (226, 77 + lift), (316, 65 + lift), (391, 92 + lift), (335, 98 + lift), (239, 108)],
                [(180, 128), (229, 119), (315, 125), (397, 154), (329, 148), (233, 136)],
            )
        if mode == "slack":
            return (
                [(181, 119), (153, 112), (122, 121), (107, 144), (138, 135), (163, 130)],
                [(181, 129), (158, 139), (143, 166), (147, 190), (164, 166), (177, 145)],
            )
        if mode == "back_small":
            return (
                [(180, 118), (149, 97), (114, 91), (91, 100), (121, 108), (153, 121)],
                [(180, 128), (151, 132), (113, 151), (94, 164), (128, 157), (158, 143)],
            )
        lift = -4 if mode == "idle_high" else 0
        return (
            [(180, 118), (154, 96 + lift), (125, 91 + lift), (104, 101 + lift), (131, 108 + lift), (157, 121)],
            [(180, 128), (154, 133), (126, 151), (111, 164), (139, 157), (161, 143)],
        )

    def draw_headband(self, c: CelCanvas) -> None:
        band = self.gear["headband"]
        outline = PENGUIN["outline"]
        upper, lower = self.ribbon_paths()
        for ribbon in (upper, lower):
            transformed = [self.t(p) for p in ribbon]
            c.polygon(transformed, band["base"], outline, 4.5)
            c.line(transformed[-3:], band["shadow"], 4)

        # 側邊打結。
        knot = [self.t(p) for p in ((169, 108), (190, 101), (204, 119), (188, 137), (167, 129))]
        c.polygon(knot, band["base"], outline, 4.5)
        c.polygon([self.t(p) for p in ((175, 111), (188, 107), (195, 117), (184, 120))], band["light"])

        # 繞額帶：上緣略拱、下緣硬邊，維持平塗。
        band_shape = self.path_t(
            (171, 119),
            (
                ((208, 105), (280, 104), (337, 119)),
                ((340, 127), (337, 138), (331, 142)),
                ((279, 129), (218, 130), (175, 141)),
                ((168, 137), (166, 127), (171, 119)),
            ),
        )
        c.polygon(band_shape, band["base"], outline, 5)
        c.line([self.t((180, 133)), self.t((250, 122)), self.t((327, 133))], band["shadow"], 5)
        c.line([self.t((184, 119)), self.t((251, 111)), self.t((324, 123))], band["light"], 4)

    def render(self) -> Image.Image:
        final = CelCanvas()
        # API 邊界：共用本體與職業裝備是兩張獨立 Alpha 圖層。
        final.composite(self.draw_penguin_body())
        final.composite(self.draw_boxer_gear())

        if self.pose.rotate_final:
            final.image = final.image.rotate(
                self.pose.rotate_final,
                resample=Image.Resampling.BICUBIC,
                center=(sc(256), sc(275)),
                expand=False,
            )

        down = final.image.resize((CANVAS, CANVAS), Image.Resampling.LANCZOS)
        return normalize_frame(down)


def normalize_frame(image: Image.Image) -> Image.Image:
    """把實際 Alpha bbox 對到 x=256、bbox bottom=460；不縮放、不改造型。"""
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        raise RuntimeError("繪製結果為空白")
    center_x = (bbox[0] + bbox[2]) / 2
    dx = round(TARGET_CENTER_X - center_x)
    dy = GROUND_BBOX_BOTTOM - bbox[3]
    shifted = Image.new("RGBA", image.size, (0, 0, 0, 0))
    shifted.alpha_composite(image, (dx, dy))
    return shifted


def load_font(size: int) -> ImageFont.ImageFont:
    candidates = (
        Path("C:/Windows/Fonts/arialbd.ttf"),
        Path("C:/Windows/Fonts/arial.ttf"),
    )
    for path in candidates:
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def make_contact_sheet(paths: Sequence[Path], destination: Path) -> None:
    cols = 5
    rows = (len(paths) + cols - 1) // cols
    cell_w, cell_h = 220, 235
    sheet = Image.new("RGBA", (cols * cell_w, rows * cell_h), "#E8E4DC")
    draw = ImageDraw.Draw(sheet)
    font = load_font(18)
    small = load_font(13)

    for index, path in enumerate(paths):
        row, col = divmod(index, cols)
        x0, y0 = col * cell_w, row * cell_h
        # 淡棋盤格讓透明邊界可直接人眼檢查。
        tile = 16
        for yy in range(y0, y0 + cell_h - 30, tile):
            for xx in range(x0, x0 + cell_w, tile):
                color = "#F7F5EF" if ((xx - x0) // tile + (yy - y0) // tile) % 2 == 0 else "#D7D4CD"
                draw.rectangle((xx, yy, min(xx + tile, x0 + cell_w), min(yy + tile, y0 + cell_h - 30)), fill=color)

        with Image.open(path) as frame:
            thumb = frame.convert("RGBA")
            thumb.thumbnail((205, 195), Image.Resampling.LANCZOS)
            px = x0 + (cell_w - thumb.width) // 2
            py = y0 + (cell_h - 30 - thumb.height) // 2
            sheet.alpha_composite(thumb, (px, py))
        draw.rectangle((x0, y0 + cell_h - 30, x0 + cell_w, y0 + cell_h), fill="#2B160F")
        draw.text((x0 + 10, y0 + cell_h - 26), path.stem, font=font, fill="#FFF8EA")
        draw.text((x0 + cell_w - 66, y0 + cell_h - 23), f"{index + 1:02d}/{len(paths):02d}", font=small, fill="#F39A88")

    destination.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(destination, "PNG", optimize=True)


def alpha_pixel_ratio(image: Image.Image) -> float:
    histogram = image.getchannel("A").histogram()
    opaque_or_partial = sum(histogram[1:])
    return opaque_or_partial / (image.width * image.height)


def self_check(frame_paths: Sequence[Path]) -> bool:
    print("\n=== 拳擊手企鵝幀自檢 ===")
    expected = {pose.name for pose in POSES}
    actual = {path.stem for path in OUTPUT_DIR.glob("*.png") if not path.name.startswith("_")}
    names_ok = actual == expected and len(frame_paths) == len(POSES)
    print(f"[{'PASS' if names_ok else 'FAIL'}] 幀數與檔名：{len(actual)}/{len(POSES)}（依工單表格固定檔名）")

    all_ok = names_ok
    for path in frame_paths:
        if not path.exists():
            print(f"[FAIL] {path.name}: 檔案不存在")
            all_ok = False
            continue
        with Image.open(path) as image:
            mode_ok = image.mode == "RGBA"
            size_ok = image.size == (CANVAS, CANVAS)
            bbox = image.getchannel("A").getbbox()
            if bbox is None:
                print(f"[FAIL] {path.name}: 全透明空白幀")
                all_ok = False
                continue
            center_x = (bbox[0] + bbox[2]) / 2
            center_ok = 244 <= center_x <= 268
            ground_ok = 452 <= bbox[3] <= 468
            ratio = alpha_pixel_ratio(image)
            ratio_ok = 0.055 <= ratio <= 0.46
            corners = [image.getpixel(point)[3] for point in ((0, 0), (511, 0), (0, 511), (511, 511))]
            alpha_ok = all(value == 0 for value in corners)
            passed = mode_ok and size_ok and center_ok and ground_ok and ratio_ok and alpha_ok
            all_ok &= passed
            width, height = bbox[2] - bbox[0], bbox[3] - bbox[1]
            print(
                f"[{'PASS' if passed else 'FAIL'}] {path.name:<13} "
                f"{image.mode} {image.width}x{image.height}  "
                f"bbox={bbox} 尺寸={width}x{height}  "
                f"中心x={center_x:.1f} 腳底/bbox底={bbox[3]}  "
                f"不透明像素比={ratio:.2%} 四角Alpha={corners}"
            )

    preview = OUTPUT_DIR / "_預覽.png"
    preview_ok = preview.exists()
    all_ok &= preview_ok
    print(f"[{'PASS' if preview_ok else 'FAIL'}] contact sheet：{preview.relative_to(ROOT)}")
    print(f"[{'PASS' if all_ok else 'FAIL'}] 總結：{'全部硬規格通過' if all_ok else '仍有項目未通過'}")
    return all_ok


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    for pose in POSES:
        destination = OUTPUT_DIR / f"{pose.name}.png"
        PenguinRenderer(pose).render().save(destination, "PNG", optimize=True)
        paths.append(destination)

    make_contact_sheet(paths, OUTPUT_DIR / "_預覽.png")
    return 0 if self_check(paths) else 1


if __name__ == "__main__":
    raise SystemExit(main())
