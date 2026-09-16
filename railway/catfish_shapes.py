from manim import *

def fish(color=BLUE, scale=1.0, label=None):
    """A simple side-view fish: body ellipse + triangular tail."""
    body = Ellipse(width=1.6, height=0.7, color=color, fill_opacity=0.6)
    tail = Triangle(color=color, fill_opacity=0.6).scale(0.35).rotate(PI/2).next_to(body, LEFT, buff=-0.1)
    eye = Dot(point=body.get_center() + RIGHT * 0.45 + UP * 0.12, radius=0.05, color=WHITE)
    group = VGroup(body, tail, eye).scale(scale)
    if label:
        group.add(Text(label, font_size=20).next_to(group, DOWN, buff=0.2))
    return group


def proportion_circles(big_pct, small_pct, big_label, small_label):
    """Two circles whose areas reflect the given percentages."""
    big = Circle(radius=1.4, color=TEAL, fill_opacity=0.6)
    small = Circle(radius=1.4 * (small_pct / big_pct) ** 0.5, color=GREY, fill_opacity=0.6)
    small.next_to(big, RIGHT, buff=1.0)
    big_t = Text(f"{big_pct}% {big_label}", font_size=24).next_to(big, UP, buff=0.3)
    small_t = Text(f"{small_pct}% {small_label}", font_size=24).next_to(small, DOWN, buff=0.3)
    return VGroup(big, small, big_t, small_t)


def labeled_bars(items):
    """items = [(label, value), ...] — bars scaled to the largest value."""
    max_v = max(v for _, v in items)
    bars = VGroup()
    for label, v in items:
        bar = Rectangle(width=0.8, height=3.0 * v / max_v, color=BLUE, fill_opacity=0.5)
        t = Text(label, font_size=20).next_to(bar, DOWN, buff=0.2)
        bars.add(VGroup(bar, t))
    bars.arrange(RIGHT, buff=1.0, aligned_edge=DOWN)
    return bars


def timeline(start_label, end_label, width=8.0):
    line = Line(LEFT * width/2, RIGHT * width/2, color=WHITE)
    a = Text(start_label, font_size=20).next_to(line, LEFT, buff=0.3)
    b = Text(end_label, font_size=20).next_to(line, RIGHT, buff=0.3)
    dot = Dot(line.get_start(), color=BLUE)
    return VGroup(line, a, b), dot
