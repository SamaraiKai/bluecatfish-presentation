"""Ready-made Manim pieces for the Blue Catfish lesson.

Two kinds of helpers:
  * shape helpers return a VGroup (fish, crab, bars, ...) that a scene animates
  * animate_* helpers take the scene and play a whole, finished animation in one
    call. Generated scenes should prefer these: they are tested, fit the frame,
    and only need the step's words and numbers.

Everything stays inside x -6..6, y -3.5..3.5 and uses Text (no LaTeX).
Every animate_* helper accepts duration=seconds and fits its animation to it.
"""
import textwrap

from manim import *

FISH_BLUE = "#4A90C2"
NATIVE_GREEN = "#6FBF73"
CRAB_ORANGE = "#E8833A"
WARN_RED = "#E05A5A"
SAND = "#C8B27A"
WATER = "#2E6F9E"


def _fit(mob, max_width=11.5, max_height=6.5):
    """Scale a group down (never up) so it fits the frame."""
    if mob.width > max_width:
        mob.scale_to_fit_width(max_width)
    if mob.height > max_height:
        mob.scale_to_fit_height(max_height)
    return mob


def _label(text, size=24, color=WHITE):
    return Text(str(text), font_size=size, color=color)


def _wrap(text, chars=18):
    """Break long text onto lines instead of shrinking it to unreadable."""
    return "\n".join(textwrap.wrap(str(text), chars)) or str(text)


# =============================================================================
# CREATURES AND PEOPLE
# =============================================================================

def fish(color=FISH_BLUE, scale=1.0, label=None, facing=RIGHT, whiskers=True):
    """A side-view catfish: body, tail, dorsal fin, eye and whisker barbels.
    The tail's point joins the body, so it reads as a fish, not an arrow.
    facing=RIGHT (default) or LEFT."""
    body = Ellipse(width=1.6, height=0.7, color=color, fill_opacity=0.75)
    # Triangle points up by default; -PI/2 turns its tip RIGHT, into the body,
    # with the wide end out behind the fish like a real tail
    tail = Triangle(color=color, fill_opacity=0.75).scale(0.38).rotate(-PI / 2)
    tail.next_to(body, LEFT, buff=-0.14)
    fin = Triangle(color=color, fill_opacity=0.75).scale(0.2).stretch(1.5, 0)
    fin.next_to(body, UP, buff=-0.1).shift(LEFT * 0.15)
    eye = Dot(body.get_center() + RIGHT * 0.5 + UP * 0.1, radius=0.05, color=WHITE)
    parts = VGroup(tail, body, fin, eye)
    if whiskers:
        mouth = body.get_center() + RIGHT * 0.74 + DOWN * 0.06
        parts.add(
            Line(mouth, mouth + RIGHT * 0.38 + DOWN * 0.22, color=color, stroke_width=2),
            Line(mouth, mouth + RIGHT * 0.42 + DOWN * 0.02, color=color, stroke_width=2),
        )
    if np.array_equal(np.array(facing), np.array(LEFT)):
        parts.flip(UP)
    parts.scale(scale)
    group = VGroup(parts)
    if label:
        group.add(_label(label, 20).next_to(parts, DOWN, buff=0.2))
    return group


def small_fish(color=NATIVE_GREEN, scale=0.5, facing=RIGHT):
    """A plain little fish (no whiskers), for prey, native fish, or a school."""
    return fish(color=color, scale=scale, facing=facing, whiskers=False)


def crab(color=CRAB_ORANGE, scale=1.0, label=None):
    """A blue-crab-style crab: shell, claws, legs and eye stalks."""
    shell = Ellipse(width=1.4, height=0.7, color=color, fill_opacity=0.75)
    legs = VGroup()
    for side in (LEFT, RIGHT):
        for k in range(3):
            start = shell.get_center() + side * 0.5 + DOWN * (0.05 + 0.1 * k)
            legs.add(Line(start, start + side * 0.45 + DOWN * (0.25 + 0.05 * k), color=color, stroke_width=3))
    claws = VGroup()
    for side in (LEFT, RIGHT):
        arm_start = shell.get_center() + side * 0.55 + UP * 0.1
        arm_end = arm_start + side * 0.35 + UP * 0.35
        claws.add(Line(arm_start, arm_end, color=color, stroke_width=3))
        claws.add(Circle(radius=0.14, color=color, fill_opacity=0.75).move_to(arm_end + UP * 0.1))
    eyes = VGroup(*[
        VGroup(Line(shell.get_top() + s * 0.15, shell.get_top() + s * 0.15 + UP * 0.2, color=color),
               Dot(shell.get_top() + s * 0.15 + UP * 0.22, radius=0.05, color=WHITE))
        for s in (LEFT, RIGHT)
    ])
    parts = VGroup(legs, claws, shell, eyes).scale(scale)
    group = VGroup(parts)
    if label:
        group.add(_label(label, 20).next_to(parts, DOWN, buff=0.2))
    return group


def kid(height=1.6, color=WHITE, label=None):
    """A simple standing person, height in scene units (for size comparisons)."""
    head = Circle(radius=0.16, color=color, fill_opacity=0.9)
    torso = RoundedRectangle(width=0.45, height=0.62, corner_radius=0.12, color=color, fill_opacity=0.9)
    torso.next_to(head, DOWN, buff=0.04)
    legs = VGroup(
        Line(torso.get_bottom() + LEFT * 0.1, torso.get_bottom() + LEFT * 0.12 + DOWN * 0.55, color=color, stroke_width=6),
        Line(torso.get_bottom() + RIGHT * 0.1, torso.get_bottom() + RIGHT * 0.12 + DOWN * 0.55, color=color, stroke_width=6),
    )
    person = VGroup(head, torso, legs)
    person.scale_to_fit_height(height)
    group = VGroup(person)
    if label:
        group.add(_label(label, 20).next_to(person, DOWN, buff=0.2))
    return group


def school_of_fish(count=12, color=NATIVE_GREEN, rows=3, scale=0.35):
    """A tidy grid of small fish (a population, a catch, a school)."""
    count = max(1, min(int(count), 60))
    fishes = VGroup(*[small_fish(color=color, scale=scale) for _ in range(count)])
    fishes.arrange_in_grid(rows=min(rows, count), buff=0.25)
    return _fit(fishes)


# =============================================================================
# PLACES AND OBJECTS
# =============================================================================

def water_scene():
    """Background: a wavy water surface near the top and a sandy bottom."""
    surface = FunctionGraph(lambda x: 2.9 + 0.08 * np.sin(2.2 * x), x_range=[-7, 7], color=WATER, stroke_width=4)
    bottom = Rectangle(width=14.5, height=0.5, color=SAND, fill_opacity=0.6, stroke_width=0).to_edge(DOWN, buff=0)
    return VGroup(surface, bottom)


def river(labels=None, color=WATER):
    """A winding river from left to right with labeled places along it.
    Returns (river_group, points) — points are the place positions, in order,
    so a fish or dots can travel or spread along them."""
    path = VMobject(color=color, stroke_width=14)
    path.set_points_smoothly([
        np.array([-6, -1.2, 0]), np.array([-3.5, 0.6, 0]), np.array([-1, -0.6, 0]),
        np.array([1.5, 0.8, 0]), np.array([4, -0.4, 0]), np.array([6, 0.6, 0]),
    ])
    group = VGroup(path)
    points = []
    labels = labels or []
    for k, text in enumerate(labels):
        alpha = (k + 1) / (len(labels) + 1)
        p = path.point_from_proportion(alpha)
        points.append(p)
        marker = Dot(p, radius=0.08, color=WHITE)
        name = _label(text, 20).next_to(marker, UP if k % 2 == 0 else DOWN, buff=0.3)
        group.add(marker, name)
    return group, points


def fishing_hook(color=GREY_B):
    """A fishing line with a hook, hanging from the top of the frame."""
    line = Line(UP * 3.5, UP * 0.4, color=color, stroke_width=2)
    hook = Arc(radius=0.25, start_angle=PI, angle=PI * 1.2, color=color, stroke_width=4).next_to(line, DOWN, buff=0)
    return VGroup(line, hook)


def plate_with_fish(label=None):
    """A dinner plate with a fish fillet on it (eating blue catfish)."""
    plate = Circle(radius=1.3, color=WHITE, fill_opacity=0.15)
    rim = Circle(radius=1.0, color=WHITE, stroke_width=2)
    fillet = Ellipse(width=1.3, height=0.55, color="#F2D6B3", fill_opacity=0.9).rotate(0.2)
    group = VGroup(plate, rim, fillet)
    if label:
        group.add(_label(label, 24).next_to(plate, DOWN, buff=0.3))
    return group


def warning_sign(text="Invasive!", color=WARN_RED):
    """A triangular warning sign with a short message under it."""
    tri = Triangle(color=color, fill_opacity=0.25, stroke_width=6).scale(1.1)
    mark = _label("!", 72, color).move_to(tri.get_center() + DOWN * 0.15)
    return VGroup(tri, mark, _label(text, 30).next_to(tri, DOWN, buff=0.3))


def fact_card(title, text, color=FISH_BLUE):
    """A rounded card with a bold title and one short line (a key fact)."""
    t = _label(title, 32, color)
    body = Text(_wrap(text, 40), font_size=26, line_spacing=0.8)
    if body.width > 9:
        body.scale_to_fit_width(9)
    content = VGroup(t, body).arrange(DOWN, buff=0.35)
    card = RoundedRectangle(width=content.width + 1, height=content.height + 0.8, corner_radius=0.3, color=color)
    return VGroup(card, content)


# =============================================================================
# CHARTS AND DIAGRAMS (shape helpers — animate them yourself)
# =============================================================================

def proportion_circles(big_pct, small_pct, big_label, small_label):
    """Two circles whose areas reflect the given percentages."""
    big = Circle(radius=1.4, color=TEAL, fill_opacity=0.6)
    small = Circle(radius=1.4 * (small_pct / big_pct) ** 0.5, color=GREY, fill_opacity=0.6)
    small.next_to(big, RIGHT, buff=1.0)
    big_t = Text(f"{big_pct}% {big_label}", font_size=24).next_to(big, UP, buff=0.3)
    small_t = Text(f"{small_pct}% {small_label}", font_size=24).next_to(small, DOWN, buff=0.3)
    return VGroup(big, small, big_t, small_t)


def labeled_bars(items, color=BLUE, show_values=False):
    """items = [(label, value), ...] — bars scaled to the largest value."""
    max_v = max(v for _, v in items) or 1
    bars = VGroup()
    for label, v in items:
        bar = Rectangle(width=0.8, height=max(0.05, 3.0 * v / max_v), color=color, fill_opacity=0.5)
        t = Text(str(label), font_size=20).next_to(bar, DOWN, buff=0.2)
        group = VGroup(bar, t)
        if show_values:
            group.add(Text(str(v), font_size=20).next_to(bar, UP, buff=0.15))
        bars.add(group)
    bars.arrange(RIGHT, buff=1.0, aligned_edge=DOWN)
    return _fit(bars)


def timeline(start_label, end_label, width=8.0):
    line = Line(LEFT * width / 2, RIGHT * width / 2, color=WHITE)
    a = Text(start_label, font_size=20).next_to(line, LEFT, buff=0.3)
    b = Text(end_label, font_size=20).next_to(line, RIGHT, buff=0.3)
    dot = Dot(line.get_start(), color=BLUE)
    return VGroup(line, a, b), dot


def big_number(value, label, color=TEAL):
    """One striking figure, displayed large with its caption. The fallback
    for any stat that doesn't fit a chart."""
    num = Text(str(value), font_size=96, color=color)
    cap = Text(label, font_size=28).next_to(num, DOWN, buff=0.4)
    return _fit(VGroup(num, cap).move_to(ORIGIN))


def flow_chain(labels, color=BLUE):
    """Left-to-right cause chain: [box] -> [box] -> [box]."""
    boxes = VGroup()
    for text in labels:
        t = Text(_wrap(text, 16), font_size=20, line_spacing=0.8)
        box = Rectangle(width=max(1.8, t.width + 0.5), height=max(1.0, t.height + 0.4), color=color)
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


def percent_bar(pct, label, color=TEAL, width=8.0):
    """A horizontal bar filled to pct percent. Returns (frame_group, fill) —
    animate GrowFromEdge(fill, LEFT)."""
    pct = max(0.0, min(100.0, float(pct)))
    outline = Rectangle(width=width, height=0.7, color=WHITE)
    fill = Rectangle(width=max(0.01, width * pct / 100), height=0.7, color=color, fill_opacity=0.8, stroke_width=0)
    fill.align_to(outline, LEFT)
    title = _label(label, 26).next_to(outline, UP, buff=0.35)
    value = _label(f"{pct:g}%", 30, color).next_to(outline, DOWN, buff=0.35)
    return VGroup(outline, title, value), fill


def pie_share(pct, label, color=TEAL):
    """A circle with a pct-percent slice highlighted. Returns (base_group, slice)."""
    pct = max(0.0, min(100.0, float(pct)))
    base = Circle(radius=1.6, color=GREY, fill_opacity=0.3)
    wedge = Sector(radius=1.6, angle=TAU * pct / 100, start_angle=PI / 2, color=color, fill_opacity=0.85)
    text = _label(f"{pct:g}% {label}", 28).next_to(base, DOWN, buff=0.4)
    return VGroup(base, text), wedge


def dot_grid(total, highlighted, label="", color=WARN_RED, cols=10):
    """total dots in a grid, the first `highlighted` of them colored
    ("45 out of 100"). Returns (grid, highlighted_dots)."""
    total = max(1, min(int(total), 200))
    highlighted = max(0, min(int(highlighted), total))
    dots = VGroup(*[Dot(radius=0.12, color=GREY_B) for _ in range(total)])
    dots.arrange_in_grid(cols=min(cols, total), buff=0.22)
    hot = VGroup(*[dots[k].copy().set_color(color) for k in range(highlighted)])
    group = VGroup(dots)
    if label:
        group.add(_label(label, 26).next_to(dots, DOWN, buff=0.4))
    _fit(group, max_height=5.5)
    for k in range(highlighted):
        hot[k].move_to(dots[k])
        hot[k].match_height(dots[k])
    return group, hot


def compare_columns(left_title, left_items, right_title, right_items,
                    left_color=FISH_BLUE, right_color=NATIVE_GREEN):
    """Two side-by-side lists under titles (this vs that)."""
    def column(title, items, color):
        t = _label(title, 30, color)
        rows = VGroup(*[Text(_wrap(f"• {x}", 24), font_size=22, line_spacing=0.8) for x in items]).arrange(DOWN, aligned_edge=LEFT, buff=0.3)
        return VGroup(t, rows).arrange(DOWN, buff=0.45)
    left = column(left_title, left_items, left_color)
    right = column(right_title, right_items, right_color)
    divider = Line(UP * 2.5, DOWN * 2.5, color=GREY)
    cols = VGroup(left, divider, right).arrange(RIGHT, buff=1.0)
    return _fit(cols)


def cycle_diagram(labels, color=TEAL, radius=2.3):
    """Labels around a circle with arrows between them (a loop or life cycle).
    Returns (nodes, arrows)."""
    n = len(labels)
    nodes = VGroup()
    for k, text in enumerate(labels):
        angle = PI / 2 - TAU * k / n
        pos = radius * np.array([np.cos(angle), np.sin(angle), 0])
        t = Text(_wrap(text, 16), font_size=22, line_spacing=0.8)
        box = RoundedRectangle(width=max(1.6, t.width + 0.4), height=max(0.8, t.height + 0.3), corner_radius=0.2, color=color)
        nodes.add(VGroup(box, t).move_to(pos))
    arrows = VGroup(*[
        CurvedArrow(nodes[k].get_center(), nodes[(k + 1) % n].get_center(), angle=-TAU / (n + 2), color=WHITE)
        .scale(0.55)
        for k in range(n)
    ])
    return nodes, arrows


def radial_web(center_label, outer_labels, color=TEAL):
    """A center item with arrows out to several others (a food web, what
    depends on what). Returns (center, outer, arrows)."""
    center = fish(color=color, scale=1.1, label=center_label)
    n = len(outer_labels)
    outer = VGroup()
    for k, text in enumerate(outer_labels):
        angle = PI / 2 - TAU * k / n
        outer.add(Text(str(text), font_size=22).move_to(2.8 * np.array([1.4 * np.cos(angle), np.sin(angle), 0])))
    arrows = VGroup(*[
        Arrow(center.get_center(), o.get_center(), buff=0.9, color=WHITE, stroke_width=3) for o in outer
    ])
    return center, outer, arrows


def checklist(items):
    """A to-do list with empty boxes. Returns (rows, ticks) — Create each tick
    to check it off."""
    rows = VGroup()
    ticks = VGroup()
    for text in items:
        box = Square(side_length=0.45, color=WHITE)
        t = Text(_wrap(text, 36), font_size=26, line_spacing=0.8).next_to(box, RIGHT, buff=0.3)
        rows.add(VGroup(box, t))
    rows.arrange(DOWN, aligned_edge=LEFT, buff=0.45)
    _fit(rows)
    for row in rows:
        box = row[0]
        ticks.add(VMobject(color=NATIVE_GREEN, stroke_width=6).set_points_as_corners([
            box.get_center() + LEFT * 0.14, box.get_center() + DOWN * 0.14, box.get_center() + RIGHT * 0.2 + UP * 0.2,
        ]))
    return rows, ticks


def balance_scale(heavy_label, light_label):
    """A seesaw tipped toward the heavier side. Returns (stand, beam_group)
    — the beam group is built level so it can be rotated to tip."""
    stand = Triangle(color=GREY_B, fill_opacity=0.6).scale(0.5).move_to(DOWN * 1.3)
    beam = Line(LEFT * 3.5, RIGHT * 3.5, color=WHITE, stroke_width=6).next_to(stand, UP, buff=0)
    heavy = RoundedRectangle(width=1.8, height=0.9, corner_radius=0.15, color=WARN_RED, fill_opacity=0.5)
    heavy.next_to(beam.get_left(), UP, buff=0).shift(RIGHT * 0.9)
    light = RoundedRectangle(width=1.4, height=0.6, corner_radius=0.15, color=NATIVE_GREEN, fill_opacity=0.5)
    light.next_to(beam.get_right(), UP, buff=0).shift(LEFT * 0.7)
    heavy.add(_label(heavy_label, 20).move_to(heavy))
    light.add(_label(light_label, 20).move_to(light))
    return stand, VGroup(beam, heavy, light)


def trend_arrow(direction="up", label="", color=None):
    """A big arrow going up (increase) or down (decrease) with a caption."""
    up = direction == "up"
    color = color or (WARN_RED if up else NATIVE_GREEN)
    arrow = Arrow(DOWN * 1.5 + LEFT * 1.5, UP * 1.5 + RIGHT * 1.5, color=color, stroke_width=12,
                  max_tip_length_to_length_ratio=0.2)
    if not up:
        arrow.flip(RIGHT)
    group = VGroup(arrow)
    if label:
        group.add(_label(label, 28).next_to(arrow, DOWN, buff=0.4))
    return group


# =============================================================================
# FULL ANIMATIONS (one call plays the whole thing — prefer these)
# =============================================================================

def animate_count_up(scene, end_value, label="", start_value=0, prefix="", suffix="", duration=6, color=TEAL):
    """A number counts up from start_value to end_value, then its caption appears.
    Use for one striking quantity ("100 million fish", "143 pounds")."""
    tracker = ValueTracker(float(start_value))
    whole = float(end_value).is_integer() and float(start_value).is_integer()

    def fmt(v):
        n = int(round(v)) if whole else round(v, 1)
        return f"{prefix}{n:,}{suffix}" if whole else f"{prefix}{n}{suffix}"

    number = always_redraw(lambda: _fit(Text(fmt(tracker.get_value()), font_size=90, color=color)).move_to(UP * 0.4))
    scene.add(number)
    scene.play(tracker.animate.set_value(float(end_value)), run_time=max(1.0, duration * 0.55), rate_func=rate_functions.ease_out_cubic)
    if label:
        cap = _fit(_label(label, 30)).next_to(number, DOWN, buff=0.5)
        scene.play(FadeIn(cap, shift=UP * 0.2), run_time=0.8)
    scene.play(Circumscribe(number, color=color), run_time=1.0)
    scene.wait(max(0.3, duration * 0.45 - 1.8))


def animate_big_number(scene, value, label, duration=5, color=TEAL):
    """A big figure (any text, e.g. "8-9%") grows in, then its caption. Use when
    the value isn't a plain number to count up to."""
    num = _fit(Text(str(value), font_size=96, color=color)).move_to(UP * 0.4)
    cap = _fit(_label(label, 30)).next_to(num, DOWN, buff=0.5)
    scene.play(GrowFromCenter(num), run_time=1.2)
    scene.play(FadeIn(cap, shift=UP * 0.2), run_time=0.8)
    scene.play(Indicate(num, color=WHITE), run_time=1.0)
    scene.wait(max(0.3, duration - 3.0))


def animate_population_boom(scene, before_count, after_count, before_label="", after_label="",
                            color=FISH_BLUE, duration=8):
    """A few fish become many: before_count fish, then after_count (drawn up to
    40; the labels carry the real numbers). Use for population growth or spread."""
    before = school_of_fish(max(1, min(int(before_count), 40)), color=color, rows=1, scale=0.45)
    b_label = _label(before_label, 26).next_to(before, DOWN, buff=0.4)
    scene.play(LaggedStart(*[FadeIn(f, scale=0.5) for f in before], lag_ratio=0.2), run_time=1.2)
    if before_label:
        scene.play(FadeIn(b_label), run_time=0.5)
    scene.wait(duration * 0.12)
    after = school_of_fish(max(1, min(int(after_count), 40)), color=color, rows=4, scale=0.35).move_to(UP * 0.3)
    a_label = _fit(_label(after_label, 30, WARN_RED)).next_to(after, DOWN, buff=0.4)
    scene.play(FadeOut(b_label), ReplacementTransform(before, after[:len(before)]), run_time=1.0)
    scene.play(LaggedStart(*[FadeIn(f, scale=0.3) for f in after[len(before):]], lag_ratio=0.05),
               run_time=max(1.0, duration * 0.3))
    if after_label:
        scene.play(Write(a_label), run_time=0.8)
    scene.wait(max(0.3, duration * 0.58 - 3.5))


def animate_size_compare(scene, items, duration=6):
    """Side-by-side creatures grow to their relative sizes.
    items = [(label, relative_size, kind), ...] where kind is "fish", "crab",
    "kid" or "small_fish"; the largest relative_size fills the height.
    e.g. [("Blue catfish", 5, "fish"), ("Native catfish", 1.5, "small_fish")]"""
    biggest = max(size for _, size, *_ in items) or 1
    makers = {"fish": fish, "small_fish": small_fish, "crab": crab, "kid": None}
    shapes = VGroup()
    for label, size, *rest in items:
        kind = rest[0] if rest else "fish"
        h = 3.0 * size / biggest
        if kind == "kid":
            shape = kid(height=h)
        else:
            shape = makers.get(kind, fish)()
            shape.scale_to_fit_height(max(0.25, h * (0.55 if kind in ("fish", "small_fish") else 0.8)))
        shapes.add(VGroup(shape, _label(label, 22).next_to(shape, DOWN, buff=0.25)))
    shapes.arrange(RIGHT, buff=1.0, aligned_edge=DOWN)
    _fit(shapes).move_to(DOWN * 0.2)
    for s in shapes:
        scene.play(GrowFromEdge(s[0], DOWN), FadeIn(s[1]), run_time=max(0.8, duration * 0.5 / len(shapes)))
    scene.play(Indicate(shapes[0][0]), run_time=1.0)
    scene.wait(max(0.3, duration * 0.5 - 1.0))


def animate_bars(scene, items, title="", duration=6, color=TEAL):
    """Bars grow up one by one to their values, then the tallest is highlighted.
    items = [(label, value), ...]"""
    bars = labeled_bars(items, color=color, show_values=True).move_to(DOWN * 0.3)
    if title:
        scene.play(Write(_fit(_label(title, 30)).to_edge(UP, buff=0.6)), run_time=0.8)
    for group in bars:
        scene.play(GrowFromEdge(group[0], DOWN), FadeIn(group[1:]), run_time=max(0.6, duration * 0.5 / len(bars)))
    tallest = max(range(len(items)), key=lambda k: items[k][1])
    scene.play(Indicate(bars[tallest][0], color=WHITE), run_time=1.0)
    scene.wait(max(0.3, duration * 0.5 - 1.8))


def animate_percent(scene, pct, label, duration=5, color=TEAL, style="bar"):
    """A share of a whole: a bar fills to pct% (style="bar") or a pie slice
    sweeps in (style="pie")."""
    if style == "pie":
        base, wedge = pie_share(pct, label, color=color)
        scene.play(FadeIn(base[0]), run_time=0.6)
        scene.play(Create(wedge), run_time=max(1.0, duration * 0.4))
        scene.play(Write(base[1]), run_time=0.8)
    else:
        frame, fill = percent_bar(pct, label, color=color)
        scene.play(Create(frame[0]), Write(frame[1]), run_time=0.8)
        scene.play(GrowFromEdge(fill, LEFT), run_time=max(1.0, duration * 0.4))
        scene.play(Write(frame[2]), run_time=0.6)
    scene.wait(max(0.3, duration * 0.6 - 1.4))


def animate_out_of(scene, total, highlighted, label="", duration=6, color=WARN_RED):
    """ "highlighted out of total": a grid of dots appears, then the matching
    number light up. Use for ratios like "3 out of 4" or "45 of every 100"."""
    group, hot = dot_grid(total, highlighted, label, color=color)
    scene.play(FadeIn(group[0], lag_ratio=0.02), run_time=1.0)
    scene.play(LaggedStart(*[FadeIn(d, scale=1.5) for d in hot], lag_ratio=0.03), run_time=max(1.0, duration * 0.45))
    if label:
        scene.play(Write(group[1]), run_time=0.8)
    scene.wait(max(0.3, duration * 0.55 - 1.8))


def animate_spread(scene, place_labels, duration=8, color=FISH_BLUE):
    """A fish swims along a river from place to place, leaving a marker at each
    one (spread of an invasive species). place_labels in the order reached."""
    riv, points = river(place_labels)
    scene.play(Create(riv[0]), run_time=1.0)
    swimmer = fish(color=color, scale=0.45, whiskers=True)
    swimmer.move_to(riv[0].get_start())
    scene.add(swimmer)
    per = max(0.6, (duration - 2.0) / max(1, len(points)))
    for k, p in enumerate(points):
        marker, name = riv[1 + 2 * k], riv[2 + 2 * k]
        scene.play(swimmer.animate.move_to(p), run_time=per * 0.7)
        scene.play(FadeIn(marker, scale=2), Write(name), Flash(p, color=WARN_RED), run_time=per * 0.3)
    scene.wait(0.5)


def animate_food_web(scene, predator_label, prey_labels, duration=7):
    """The catfish in the middle with arrows shooting out to everything it eats."""
    center, outer, arrows = radial_web(predator_label, prey_labels)
    scene.play(FadeIn(center, scale=0.6), run_time=0.8)
    per = max(0.5, (duration - 2.0) / max(1, len(outer)))
    for o, a in zip(outer, arrows):
        scene.play(GrowArrow(a), FadeIn(o, shift=a.get_unit_vector() * 0.3), run_time=per)
    scene.play(Indicate(center), run_time=1.0)


def animate_eats(scene, predator_label, prey_labels, duration=7):
    """The catfish on the left, prey listed on the right, arrows appear one by
    one, then the prey fade (they got eaten)."""
    diagram = eats(predator_label, prey_labels)
    pred, prey, arrows = diagram
    scene.play(FadeIn(pred, shift=RIGHT * 0.5), run_time=0.8)
    scene.play(LaggedStart(*[FadeIn(p) for p in prey], lag_ratio=0.2), run_time=1.0)
    per = max(0.4, (duration - 3.5) / max(1, len(arrows)))
    for a in arrows:
        scene.play(GrowArrow(a), run_time=per)
    scene.play(prey.animate.set_opacity(0.25), run_time=1.0)
    scene.wait(0.5)


def animate_chain(scene, labels, duration=7, color=BLUE):
    """Cause and effect: boxes appear left to right, each arrow drawn before
    the next box ("more catfish → fewer crabs → ...")."""
    diagram = flow_chain(labels, color=color)
    boxes, arrows = diagram
    per = max(0.5, duration / (2 * len(labels)))
    scene.play(FadeIn(boxes[0], shift=RIGHT * 0.3), run_time=per)
    for k in range(1, len(boxes)):
        scene.play(GrowArrow(arrows[k - 1]), run_time=per * 0.6)
        scene.play(FadeIn(boxes[k], shift=RIGHT * 0.3), run_time=per)
    scene.play(Indicate(boxes[-1], color=WARN_RED), run_time=0.8)


def animate_timeline(scene, events, duration=8):
    """Dated events appear along a line, a dot moving between them.
    events = [(when, what), ...] in order, e.g. [("1970s", "Stocked for fishing"), ("2011", "Found across the Bay")]"""
    n = len(events)
    line = Line(LEFT * 5.5, RIGHT * 5.5, color=WHITE)
    scene.play(Create(line), run_time=0.8)
    dot = Dot(line.get_start(), color=TEAL, radius=0.12)
    scene.add(dot)
    per = max(0.6, (duration - 1.5) / max(1, n))
    for k, (when, what) in enumerate(events):
        x = -5.5 + 11 * (k + 0.5) / n
        tick = Line(UP * 0.15, DOWN * 0.15, color=WHITE).move_to([x, 0, 0])
        top = _label(when, 24, TEAL).next_to(tick, UP, buff=0.3)
        bottom = Text(_wrap(what, max(8, int(26 / n * 2.2))), font_size=20, line_spacing=0.8)
        if bottom.width > 11 / n - 0.2:
            bottom.scale_to_fit_width(11 / n - 0.2)
        bottom.next_to(tick, DOWN, buff=0.3 if k % 2 == 0 else 0.9)
        scene.play(dot.animate.move_to(tick), run_time=per * 0.5)
        scene.play(Create(tick), Write(top), FadeIn(bottom), run_time=per * 0.5)
    scene.wait(0.5)


def animate_compare(scene, left_title, left_items, right_title, right_items, duration=7):
    """Two columns (this vs that) fill in item by item, alternating sides."""
    cols = compare_columns(left_title, left_items, right_title, right_items)
    left, divider, right = cols
    scene.play(Write(left[0]), Write(right[0]), Create(divider), run_time=1.0)
    rows = []
    for k in range(max(len(left_items), len(right_items))):
        if k < len(left_items):
            rows.append(left[1][k])
        if k < len(right_items):
            rows.append(right[1][k])
    per = max(0.4, (duration - 1.5) / max(1, len(rows)))
    for r in rows:
        scene.play(FadeIn(r, shift=UP * 0.15), run_time=per)
    scene.wait(0.5)


def animate_cycle(scene, labels, duration=7):
    """Stages around a loop, each arrow drawn to the next (a life cycle or a
    feedback loop)."""
    nodes, arrows = cycle_diagram(labels)
    per = max(0.5, duration / (2 * len(labels)))
    for k in range(len(labels)):
        scene.play(FadeIn(nodes[k], scale=0.7), run_time=per)
        scene.play(Create(arrows[k]), run_time=per * 0.6)
    scene.wait(0.4)


def animate_checklist(scene, items, title="", duration=7):
    """A to-do list appears, then each item is checked off (ways to help)."""
    rows, ticks = checklist(items)
    content = VGroup(rows, ticks)
    if title:
        head = _fit(_label(title, 32, TEAL))
        VGroup(head, content).arrange(DOWN, buff=0.5)
        scene.play(Write(head), run_time=0.8)
    scene.play(LaggedStart(*[FadeIn(r, shift=RIGHT * 0.2) for r in rows], lag_ratio=0.2), run_time=1.2)
    per = max(0.4, (duration - 2.5) / max(1, len(items)))
    for t in ticks:
        scene.play(Create(t), run_time=per)
    scene.wait(0.4)


def animate_before_after(scene, before_label, before_value, after_label, after_value,
                         title="", duration=6, color=TEAL):
    """Two bars: 'before' appears, then 'after' grows beside it so the change is
    obvious. Values are numbers; the labels say what and when."""
    items = [(before_label, float(before_value)), (after_label, float(after_value))]
    bars = labeled_bars(items, color=color, show_values=False)
    for group, (_, v) in zip(bars, items):
        group.add(_label(f"{v:g}", 22).next_to(group[0], UP, buff=0.15))
    bars.move_to(DOWN * 0.3)
    if title:
        scene.play(Write(_fit(_label(title, 30)).to_edge(UP, buff=0.6)), run_time=0.8)
    scene.play(GrowFromEdge(bars[0][0], DOWN), FadeIn(bars[0][1:]), run_time=1.0)
    scene.wait(duration * 0.15)
    scene.play(GrowFromEdge(bars[1][0], DOWN), FadeIn(bars[1][1:]), run_time=max(1.0, duration * 0.3))
    arrow = Arrow(bars[0][0].get_top(), bars[1][0].get_top(), buff=0.2, color=WARN_RED)
    scene.play(GrowArrow(arrow), run_time=0.8)
    scene.wait(max(0.3, duration * 0.55 - 2.6))


def animate_trend(scene, direction, label, duration=4):
    """A big arrow shoots up (rising) or down (falling) with a caption."""
    group = trend_arrow(direction, label)
    scene.play(GrowArrow(group[0]), run_time=1.2)
    if len(group) > 1:
        scene.play(Write(group[1]), run_time=0.8)
    scene.wait(max(0.3, duration - 2.0))


def animate_heavier(scene, heavy_label, light_label, duration=5):
    """A balance scale starts level, then tips toward the heavier side."""
    stand, beam = balance_scale(heavy_label, light_label)
    scene.play(FadeIn(stand), Create(beam[0]), run_time=0.8)
    scene.play(FadeIn(beam[1]), FadeIn(beam[2]), run_time=0.8)
    scene.play(Rotate(beam, angle=0.25, about_point=beam[0].get_center()), run_time=1.2, rate_func=rate_functions.ease_out_bounce)
    scene.wait(max(0.3, duration - 2.8))


def animate_catch_and_cook(scene, catch_label="Catch it", cook_label="Cook it", duration=7):
    """The solution in two beats: a fish is hooked and pulled up, then appears
    on a dinner plate ("eat them to help the Bay")."""
    bg = water_scene()
    scene.add(bg)
    swimmer = fish(scale=0.8).move_to(LEFT * 3 + DOWN * 0.8)
    hook = fishing_hook().move_to(RIGHT * 1.5 + UP * 1.3)
    scene.play(FadeIn(swimmer), Create(hook), run_time=1.0)
    scene.play(swimmer.animate.move_to(hook[1].get_center() + DOWN * 0.2), run_time=1.2)
    caught = VGroup(swimmer, hook)
    scene.play(caught.animate.shift(UP * 4.5), Write(_label(catch_label, 30).to_edge(UP, buff=0.5)), run_time=1.2)
    scene.play(FadeOut(bg), FadeOut(caught), *[FadeOut(m) for m in scene.mobjects if m not in (bg, caught)], run_time=0.6)
    plate = plate_with_fish(cook_label)
    scene.play(FadeIn(plate, scale=0.8), run_time=1.0)
    scene.wait(max(0.3, duration - 5.0))


def animate_fact(scene, title, text, duration=5, warning=False):
    """Fallback for a key idea with no numbers to chart: a warning sign or a
    fact card pops in with its words."""
    card = warning_sign(title) if warning else fact_card(title, text)
    _fit(card)
    scene.play(FadeIn(card, scale=0.85), run_time=1.0)
    if warning and text:
        line = _fit(Text(_wrap(text, 44), font_size=24, line_spacing=0.8)).next_to(card, DOWN, buff=0.4)
        scene.play(Write(line), run_time=1.0)
    scene.play(Indicate(card[0]), run_time=1.0)
    scene.wait(max(0.3, duration - 3.0))
