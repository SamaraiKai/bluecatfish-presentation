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

def big_number(value, label, color=TEAL):
    """One striking figure, displayed large with its caption. The fallback
    for any stat that doesn't fit a chart."""
    num = Text(str(value), font_size=96, color=color)
    cap = Text(label, font_size=28).next_to(num, DOWN, buff=0.4)
    return VGroup(num, cap).move_to(ORIGIN)


def flow_chain(labels, color=BLUE):
    """Left-to-right cause chain: [box] -> [box] -> [box]."""
    boxes = VGroup()
    for text in labels:
        t = Text(text, font_size=20)
        box = Rectangle(width=max(1.8, t.width + 0.5), height=1.0, color=color)
        boxes.add(VGroup(box, t.move_to(box.get_center())))
    boxes.arrange(RIGHT, buff=1.0)

    arrows = VGroup(*[
        Arrow(boxes[i].get_right(), boxes[i + 1].get_left(), buff=0.1, color=WHITE)
        for i in range(len(labels) - 1)
    ])
    return VGroup(boxes, arrows).scale_to_fit_width(12)


def eats(predator_label, prey_labels, color=TEAL):
    """One fish with arrows pointing to several prey items."""
    pred = fish(color=color, scale=1.2, label=predator_label).to_edge(LEFT, buff=1.0)
    prey = VGroup(*[
        Text(p, font_size=20) for p in prey_labels
    ]).arrange(DOWN, buff=0.6).to_edge(RIGHT, buff=1.5)

    arrows = VGroup(*[
        Arrow(pred.get_right(), p.get_left(), buff=0.3, color=WHITE, stroke_width=3)
        for p in prey
    ])
    return VGroup(pred, prey, arrows)


def growth_curve(start_label, end_label, color=TEAL):
    """A rising line — returns (axes_group, line) so you can animate Create(line)."""
    base = Line(LEFT * 4 + DOWN * 2, RIGHT * 4 + DOWN * 2, color=WHITE)
    side = Line(LEFT * 4 + DOWN * 2, LEFT * 4 + UP * 2, color=WHITE)
    curve = Line(LEFT * 4 + DOWN * 2, RIGHT * 3.5 + UP * 1.5, color=color, stroke_width=6)
    a = Text(start_label, font_size=20).next_to(base, DOWN, buff=0.2).align_to(base, LEFT)
    b = Text(end_label, font_size=20).next_to(base, DOWN, buff=0.2).align_to(base, RIGHT)
    return VGroup(base, side, a, b), curve
