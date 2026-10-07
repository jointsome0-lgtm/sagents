// The map of a world, with no page and no file in it: where the places of a world file stand in a drawing, where
// everyone is at a moment, and the drawing itself as a tree of SVG elements that the page turns into nodes and a
// script into a file. Plain functions over what `mapOf` of the data module gives of a world file and over the moves
// that `moveOf` of the core module reads from the events.
// Nothing here is random or asks the browser for a size: a name is as wide as its signs are many, and the arithmetic
// is sums, products, quotients and square roots alone, which every engine computes to the same last bit. So one
// world file gives one drawing.

const PACE = 80, USUAL = 5;
const root = Math.sqrt, far = (dx, dy) => root(dx * dx + dy * dy);
const signs = text => [...String(text)].length;
// A distance that overflows, including its square in the layout, is no coordinate way.
const distanceOf = (a, b, pace) => {
  if (!a || !b) return null;
  const minutes = far(a[0] - b[0], a[1] - b[1]) / pace;
  return Number.isFinite(minutes * minutes) ? minutes : null;
};

// ---- The ways. The way between two places is counted as `travelSeconds` of the engine counts it: the `minutesTo`
// of either place for the pair, else the straight line between two `at` at the world's pace, else the world's
// `travelMinutes`. `known` says that it was one of the first two, and not the world's usual way.
export const waysOf = world => {
  const places = world.places, pace = world.walkMetresPerMinute > 0 ? world.walkMetresPerMinute : PACE, usual = world.travelMinutes ?? USUAL, kept = new Map();
  const listed = (a, b) => Object.hasOwn(a.minutesTo, b.id) ? a.minutesTo[b.id] : null;
  const way = (i, j) => {
    const key = i < j ? i * places.length + j : j * places.length + i;
    if (kept.has(key)) return kept.get(key);
    const a = places[i], b = places[j], said = listed(a, b) ?? listed(b, a), line = distanceOf(a.at, b.at, pace);
    const walked = line === null ? null : line > 10 ? Math.round(line) : Math.round(line * 10) / 10;
    const found = { seconds: Math.max(1, Math.round((said ?? walked ?? usual) * 60)), known: said !== null || walked !== null };
    kept.set(key, found);
    return found;
  };
  return { pace, seconds: (i, j) => way(i, j).seconds, known: (i, j) => way(i, j).known };
};
// The seconds from the place `id` to every other place of the world, the nearest first.
export const waysFrom = (world, id) => {
  const ways = waysOf(world), from = world.places.findIndex(place => place.id === id);
  return from === -1 ? [] : world.places.map((place, at) => ({ id: place.id, seconds: at === from ? 0 : ways.seconds(from, at), at })).filter(way => way.at !== from)
    .sort((one, other) => one.seconds - other.seconds || one.at - other.at).map(({ id, seconds }) => ({ id, seconds }));
};

// ---- The groups. The places are joined into one tree by the shortest ways (every pair by its seconds, and where
// those are equal by the order of the world file; a way is taken when it joins two parts not joined yet). Then the
// ways of that tree are looked at from the longest down, each within the part of the tree it still holds together:
// one that is `APART` seconds or longer, and `JUMP` times the middle one of the other ways of its part or longer, is
// a link between groups and no longer holds its part together. What the ways that are left join is a group. So the
// rooms of a house and a town a quarter of an hour away are two groups, and four towns twenty minutes from each
// other are one: far is what is far beside the ways around it.
const JUMP = 3, APART = 300;
const groupsOf = (world, ways) => {
  const n = world.places.length, pairs = [], head = world.places.map((_, at) => at), tree = [];
  const top = at => { while (head[at] !== at) at = head[at] = head[head[at]]; return at; };
  for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) pairs.push([ways.seconds(i, j), i, j]);
  pairs.sort((one, other) => one[0] - other[0] || one[1] - other[1] || one[2] - other[2]);
  for (const pair of pairs) { const a = top(pair[1]), b = top(pair[2]); if (a !== b) { head[a] = b; tree.push(pair); } }
  const held = tree.map(() => true);
  // The places that the ways still holding join, each under the first place of its part.
  const parts = () => { head.forEach((_, at) => { head[at] = at; }); tree.forEach(([, i, j], at) => { if (held[at]) { const a = top(i), b = top(j); head[Math.max(a, b)] = Math.min(a, b); } }); };
  for (let at = tree.length - 1; at >= 0; at -= 1) {
    parts();
    const part = top(tree[at][1]), others = tree.filter(([, i], other) => other !== at && held[other] && top(i) === part).map(([seconds]) => seconds);
    if (others.length && tree[at][0] >= APART && tree[at][0] >= JUMP * others[others.length >> 1]) held[at] = false;
  }
  parts();
  const groups = [], of = new Map();
  for (let at = 0; at < n; at += 1) { const key = top(at); if (!of.has(key)) { of.set(key, groups.length); groups.push([]); } groups[of.get(key)].push(at); }
  const links = tree.filter((_, at) => !held[at]).map(([seconds, i, j]) => ({ a: of.get(top(i)), b: of.get(top(j)), seconds, usual: !ways.known(i, j) }));
  return { groups, links, cut: links.length ? links[0].seconds : null };
};

// ---- A place as a box: its name, in two lines when it is long, the people of the place whom nobody plays under
// it, and room for the marks of everyone who may stand there.
const NAME = 7.8, SMALL = 6.3, MARK = 14, LONG = 18;
const linesOf = name => {
  const text = String(name), words = text.split(' ');
  if (signs(text) <= LONG || words.length < 2) return [text];
  let best = 1, least = Infinity;
  for (let at = 1; at < words.length; at += 1) { const wide = Math.max(signs(words.slice(0, at).join(' ')), signs(words.slice(at).join(' '))); if (wide < least) { least = wide; best = at; } }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
};
const boxOf = (place, people) => {
  const lines = linesOf(place.name), figures = place.figures.map(figure => String(figure.name));
  const w = Math.ceil(Math.max(56, people ? 12 + MARK * Math.min(people, 4) : 0, ...lines.map(line => signs(line) * NAME + 20), ...figures.map(name => signs(name) * SMALL + 20)));
  const per = Math.max(1, Math.floor((w - 12) / MARK)), rows = Math.ceil(people / per);
  return { lines, figures, w, h: 8 + lines.length * 16 + figures.length * 13 + (rows ? rows * MARK + 2 : 0) + 4, per, marks: 8 + lines.length * 16 + figures.length * 13 + 2 + MARK / 2 };
};

// ---- One group in a plane of its own. In minutes first: a place that says where it lies stands there, at the
// world's pace, and of several that name one point the first does; every other place starts beside those it has a
// known way to and is then moved, `SWEEPS` times over, to where its ways to all the others of the group are kept
// best (each way pulls with a weight that falls with the square of its length, and a way that is only the world's
// usual one a tenth as hard). A group with no place that says where it lies starts from two of its own: the first of
// the world file and the one farthest from it, with every other where its ways to those two put it.
// Then to the screen: a minute is as many pixels as put the loneliest place of the group `NEAR` pixels from its
// nearest one, and no more than keep the group within `most`. The boxes are then set down one by one, those that
// say where they lie first and each kind in the order of the world file: a box whose spot is free, with `GAP` pixels
// around it, stands on it, and any other on the free spot nearest to its own, looked for in steps of `STEP` pixels.
// So a house whose rooms name one point is spread around that point, what was not crowded stays where its minutes
// or its metres put it, and no box lies on another. `shift` is how far the box moved most was moved.
const SWEEPS = 300, NEAR = 130, GAP = 14, STEP = 6, REACH = 80;
// The steps away from a spot, the nearest first, and of two as near the one higher up and then further left.
const NEARBY = [];
for (let dy = -REACH; dy <= REACH; dy += 1) for (let dx = -REACH; dx <= REACH; dx += 1) NEARBY.push([dx * STEP, dy * STEP]);
NEARBY.sort((one, other) => one[0] * one[0] + one[1] * one[1] - other[0] * other[0] - other[1] * other[1] || one[1] - other[1] || one[0] - other[0]);
const layGroup = (members, world, ways, boxes, most) => {
  const n = members.length, x = new Array(n).fill(0), y = new Array(n).fill(0), set = new Array(n).fill(false), fixed = new Array(n).fill(false);
  const minutes = (a, b) => Math.max(ways.seconds(members[a], members[b]) / 60, 0.02), known = (a, b) => ways.known(members[a], members[b]);
  // A start a little off for each place that is to be moved, so that no two begin on one point or all on one line.
  let moved = 0;
  const nudge = at => { moved += 1; x[at] += 0.02 * moved * (moved % 2 ? 1 : -1); y[at] += 0.017 * moved * ((moved >> 1) % 2 ? 1 : -1); set[at] = true; };
  const points = new Set(), origin = members.map(index => world.places[index].at).find(Boolean);
  members.forEach((index, at) => {
    const where = world.places[index].at;
    if (distanceOf(where, origin, ways.pace) === null || members.some((index, other) => fixed[other] && distanceOf(where, world.places[index].at, ways.pace) === null)) return;
    x[at] = (where[0] - origin[0]) / ways.pace; y[at] = -(where[1] - origin[1]) / ways.pace;
    const key = `${where[0]} ${where[1]}`;
    if (points.has(key)) nudge(at); else { points.add(key); fixed[at] = set[at] = true; }
  });
  if (!points.size && n > 1) {
    let end = 1;
    for (let at = 2; at < n; at += 1) if (minutes(0, at) > minutes(0, end)) end = at;
    const span = minutes(0, end);
    for (let at = 1; at < n; at += 1) {
      const a = minutes(0, at), b = at === end ? 0 : minutes(end, at);
      x[at] = (a * a + span * span - b * b) / (2 * span);
      y[at] = at === end ? 0 : root(Math.max(0, a * a - x[at] * x[at])) * (at % 2 ? 1 : -1);
      if (at === end) set[at] = true; else nudge(at);
    }
    set[0] = true;
  } else {
    for (let left = true; left;) {
      left = false;
      for (let at = 0; at < n; at += 1) {
        if (set[at]) continue;
        const near = [];
        for (let other = 0; other < n; other += 1) if (set[other] && known(at, other)) near.push(other);
        if (!near.length) continue;
        x[at] = near.reduce((sum, other) => sum + x[other], 0) / near.length; y[at] = near.reduce((sum, other) => sum + y[other], 0) / near.length;
        nudge(at); left = true;
      }
    }
    // A place with no known way to any other of the group: in the middle of those that have one.
    const placed = set.map((on, at) => on ? at : -1).filter(at => at !== -1);
    for (let at = 0; at < n; at += 1) if (!set[at]) { x[at] = placed.reduce((sum, other) => sum + x[other], 0) / Math.max(1, placed.length); y[at] = placed.reduce((sum, other) => sum + y[other], 0) / Math.max(1, placed.length); nudge(at); }
  }
  for (let sweep = 0; sweep < SWEEPS; sweep += 1) for (let at = 0; at < n; at += 1) {
    if (fixed[at]) continue;
    let weights = 0, sx = 0, sy = 0;
    for (let other = 0; other < n; other += 1) {
      if (other === at) continue;
      const want = minutes(at, other), weight = (known(at, other) ? 1 : 0.1) / (want * want), dx = x[at] - x[other], dy = y[at] - y[other], is = far(dx, dy);
      sx += weight * (x[other] + (is < 1e-9 ? (at < other ? -want : want) : want * dx / is)); sy += weight * (y[other] + (is < 1e-9 ? 0 : want * dy / is));
      weights += weight;
    }
    if (weights > 0) { x[at] = sx / weights; y[at] = sy / weights; }
  }
  // From minutes to pixels.
  let lonely = 0;
  for (let at = 0; at < n; at += 1) { let least = Infinity; for (let other = 0; other < n; other += 1) { const is = other === at ? 0 : far(x[at] - x[other], y[at] - y[other]); if (is > 1e-6 && is < least) least = is; } if (least < Infinity && least > lonely) lonely = least; }
  const left = Math.min(...x), up = Math.min(...y), wide = Math.max(...x) - left, tall = Math.max(...y) - up;
  const scale = Math.min(lonely > 0 ? NEAR / lonely : 1, wide > 0 ? most.w / wide : Infinity, tall > 0 ? most.h / tall : Infinity);
  const px = x.map(value => Math.round((value - left) * scale)), py = y.map(value => Math.round((value - up) * scale)), put = [];
  let shift = 0;
  for (const at of [...members.keys()].sort((one, other) => Number(fixed[other]) - Number(fixed[one]) || one - other)) {
    const box = boxes[members[at]], free = (cx, cy) => put.every(other => Math.abs(cx - px[other]) >= (box.w + boxes[members[other]].w) / 2 + GAP || Math.abs(cy - py[other]) >= (box.h + boxes[members[other]].h) / 2 + GAP);
    let spot = null;
    for (let by = 1; by <= 64 && spot === null; by *= 2) {
      const near = NEARBY.find(([ox, oy]) => free(px[at] + ox * by, py[at] + oy * by));
      if (near) spot = near.map(value => value * by);
    }
    const [dx, dy] = spot ?? [Math.max(...put.map(other => px[other] + boxes[members[other]].w / 2)) + GAP + box.w / 2 - px[at], 0];
    px[at] += dx; py[at] += dy; put.push(at);
    shift = Math.max(shift, far(dx, dy));
  }
  return { px, py, scale, shift };
};

// ---- The whole drawing. Every group is laid out by itself and framed, and the frames stand apart: the group with
// the most places first, and each group it is linked to beside it, in the direction the metres give when both say
// where they lie and else in the first free one of east, west, south, north and the four between (south and north
// first with `tall`, for a narrow window), as near as leaves `AISLE` pixels between two frames. A link is drawn
// from frame to frame with its minutes on it, and is not to scale.
// Gives `{ width, height, cut, places, groups, links, doors }`, all in pixels: a place `{ id, name, lines, figures,
// open, group, x, y, w, h, per, marks }` with `x, y` its top left corner, `per` how many marks of people one row
// holds and `marks` how far under its top the first row is; a group `{ x, y, w, h, places, scale, shift }`, where
// `scale` is its pixels for a minute, or null for a group of one place, and `shift` how far the box moved most was
// moved off its spot; a link `{ a, b, seconds, usual, x1, y1, x2, y2 }` between the groups `a` and `b`; a door
// `{ a, b, x1, y1, x2, y2 }` between two places that are next door to each other; and `cut`, the seconds of the
// shortest link, or null when the world is one group. `people` is how many characters a place makes room for:
// those of the world file when it is not given.
const AISLE = 104, FRAME = 14, FOOT = 18, EDGE = 16, DIAGONAL = 0.7071;
const COMPASS = [[1, 0], [-1, 0], [0, 1], [0, -1], [DIAGONAL, DIAGONAL], [-DIAGONAL, DIAGONAL], [DIAGONAL, -DIAGONAL], [-DIAGONAL, -DIAGONAL]];
const TALL = [[0, 1], [0, -1], [1, 0], [-1, 0], ...COMPASS.slice(4)];
// Where the line from the middle of a box towards a point leaves the box.
const edgeOf = (box, tx, ty) => {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2, dx = tx - cx, dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const part = Math.min(dx === 0 ? Infinity : box.w / 2 / Math.abs(dx), dy === 0 ? Infinity : box.h / 2 / Math.abs(dy), 1);
  return [cx + dx * part, cy + dy * part];
};
const between = (one, other) => {
  const [x1, y1] = edgeOf(one, other.x + other.w / 2, other.y + other.h / 2), [x2, y2] = edgeOf(other, one.x + one.w / 2, one.y + one.h / 2);
  return { x1: Math.round(x1), y1: Math.round(y1), x2: Math.round(x2), y2: Math.round(y2) };
};
export const layoutOf = (world, { tall = false, people = world.characters.length } = {}) => {
  const ways = waysOf(world), { groups: members, links, cut } = groupsOf(world, ways), boxes = world.places.map(place => boxOf(place, people));
  const most = tall ? { w: 340, h: 520 } : { w: 620, h: 420 };
  const groups = members.map(list => {
    const { px, py, scale, shift } = layGroup(list, world, ways, boxes, most);
    const left = Math.min(...list.map((index, at) => px[at] - boxes[index].w / 2)), up = Math.min(...list.map((index, at) => py[at] - boxes[index].h / 2));
    const right = Math.max(...list.map((index, at) => px[at] + boxes[index].w / 2)), down = Math.max(...list.map((index, at) => py[at] + boxes[index].h / 2));
    const spots = list.map((index, at) => ({ index, x: Math.round(px[at] - boxes[index].w / 2 - left) + FRAME, y: Math.round(py[at] - boxes[index].h / 2 - up) + FRAME }));
    const at = list.map(index => world.places[index].at).filter(Boolean);
    return { list, spots, w: Math.ceil(right - left) + 2 * FRAME, h: Math.ceil(down - up) + 2 * FRAME + (list.length > 1 ? FOOT : 0), scale: list.length > 1 ? scale : null, shift, x: 0, y: 0, put: false,
      east: at.length ? at.reduce((sum, point) => sum + point[0] / at.length, 0) : null, north: at.length ? at.reduce((sum, point) => sum + point[1] / at.length, 0) : null };
  });
  // The frames, from the largest group outwards along the links.
  if (groups.length) {
    const first = groups.reduce((best, group, at) => group.list.length > groups[best].list.length ? at : best, 0), queue = [[first, null]], rose = tall ? TALL : COMPASS;
    groups[first].put = true;
    const used = groups.map(() => []);
    for (let at = 0; at < queue.length; at += 1) {
      const [from, back] = queue[at], parent = groups[from];
      if (back) used[from].push(back);
      const next = links.filter(link => link.a === from || link.b === from).map(link => ({ link, to: link.a === from ? link.b : link.a })).filter(({ to }) => !groups[to].put)
        .sort((one, other) => one.link.seconds - other.link.seconds || one.to - other.to);
      for (const { to } of next) {
        const child = groups[to], near = (dx, dy) => used[from].reduce((worst, [ux, uy]) => Math.max(worst, ux * dx + uy * dy), -1);
        let dx = 0, dy = 0;
        if (parent.east !== null && child.east !== null && Number.isFinite(far(child.east - parent.east, child.north - parent.north)) && far(child.east - parent.east, child.north - parent.north) > 0) {
          const is = far(child.east - parent.east, child.north - parent.north);
          dx = (child.east - parent.east) / is; dy = -(child.north - parent.north) / is;
        } else {
          // Onwards from where this group was reached, when that way is free, and else the first free one.
          const tries = back ? [[-back[0], -back[1]], ...rose] : rose;
          [dx, dy] = tries.find(([tx, ty]) => near(tx, ty) < 0.8) ?? tries.reduce((best, one) => near(one[0], one[1]) < near(best[0], best[1]) ? one : best);
        }
        used[from].push([dx, dy]);
        const cx = parent.x + parent.w / 2, cy = parent.y + parent.h / 2;
        let out = Math.min(dx === 0 ? Infinity : ((parent.w + child.w) / 2 + AISLE) / Math.abs(dx), dy === 0 ? Infinity : ((parent.h + child.h) / 2 + AISLE) / Math.abs(dy));
        const clear = () => groups.every(other => !other.put || other === child || child.x >= other.x + other.w + AISLE / 2 || other.x >= child.x + child.w + AISLE / 2 || child.y >= other.y + other.h + AISLE / 2 || other.y >= child.y + child.h + AISLE / 2);
        for (let tries = 0; tries < 400; tries += 1, out += 24) { child.x = Math.round(cx + dx * out - child.w / 2); child.y = Math.round(cy + dy * out - child.h / 2); if (clear()) break; }
        if (!clear()) { child.x = Math.max(...groups.filter(group => group.put).map(group => group.x + group.w)) + AISLE; child.y = parent.y; }
        child.put = true;
        queue.push([to, [-dx, -dy]]);
      }
    }
    const left = Math.min(...groups.map(group => group.x)), up = Math.min(...groups.map(group => group.y));
    for (const group of groups) { group.x += EDGE - left; group.y += EDGE - up; }
  }
  const places = new Array(world.places.length);
  groups.forEach((group, at) => { for (const spot of group.spots) { const place = world.places[spot.index], box = boxes[spot.index];
    places[spot.index] = { id: place.id, name: String(place.name), lines: box.lines, figures: box.figures, open: place.open === true, group: at, x: group.x + spot.x, y: group.y + spot.y, w: box.w, h: box.h, per: box.per, marks: box.marks }; } });
  const doors = [];
  world.places.forEach((place, a) => world.places.forEach((other, b) => { if (a < b && (place.nextDoor.includes(other.id) || other.nextDoor.includes(place.id))) doors.push({ a: place.id, b: other.id, ...between(places[a], places[b]) }); }));
  return { width: Math.max(0, ...groups.map(group => group.x + group.w)) + EDGE, height: Math.max(0, ...groups.map(group => group.y + group.h)) + EDGE, cut, places,
    groups: groups.map(({ x, y, w, h, list, scale, shift }) => ({ x, y, w, h, places: list.map(index => world.places[index].id), scale, shift })),
    links: links.map(link => ({ ...link, ...between(groups[link.a], groups[link.b]) })), doors };
};

// ---- Which of the two drawings of a world a pane shows, and how large. A drawing is shown whole when the pane
// takes it, made smaller down to `LEAST` of its size, and is scrolled beyond that, at its own size where the
// pane's width allows. `wide` and `tall` are the two
// layouts of one world, `width` and `height` the pixels the pane has for a drawing. The one that needs no scrolling
// sideways is taken; when both need none, the wide one in a pane of `NARROW` pixels or more and the tall one in a
// narrower; when both need it, the narrower of the two as the pane would show them. Gives `{ layout, tall, by }`,
// `by` the size it is shown at, from `LEAST` to 1.
const LEAST = 0.8, NARROW = 700;
export const fitOf = (wide, tall, width, height) => {
  // What cannot be whole in the pane even at its smallest is as large as the pane's width takes it, and scrolled down.
  const across = layout => Math.max(LEAST, Math.min(1, width / layout.width)), whole = layout => Math.min(1, width / layout.width, height / layout.height);
  const by = layout => !(width > 0 && height > 0) ? 1 : whole(layout) >= LEAST ? whole(layout) : across(layout);
  const shown = layout => layout.width * by(layout), fits = layout => !(width > 0) || shown(layout) <= width;
  const narrow = fits(wide) === fits(tall) ? fits(wide) ? width > 0 && width < NARROW : shown(tall) < shown(wide) : fits(tall);
  return narrow ? { layout: tall, tall: true, by: by(tall) } : { layout: wide, tall: false, by: by(wide) };
};

// ---- Where everyone is at the story second `T`. `characters` are those of the world file, each with the `place` it
// starts in; `moves` are those of every stretch, in the played order. A character is where its last move at or
// before `T` put it. Before its first move it is where it starts, if `started` says the run is seen from its start and
// that first move finds it there. Otherwise it is `unknown` until its first move: a second of zero does not prove a
// start, since a run stopped within its first second is continued from zero, and whoever is first met elsewhere had
// moved unseen. Each is `{ place, to, since, until, share, asleep, unknown }`, where on the
// way `place` is what it left, `to` where it goes, `until` when it is due and `share` how much of the way lies
// behind it, from 0 to 1; it is on the way until a move says that it is somewhere. Someone the moves name whom the
// world file does not is where they say, from its first move on. Gives a map by id, in the order of `characters`.
export const whereAt = (characters, moves, T, started = true) => {
  const first = new Map();
  for (const move of moves) if (!first.has(move.who)) first.set(move.who, move.place);
  const where = new Map(characters.map(character => {
    const there = started && (character.place == null || (first.get(character.id) ?? character.place) === character.place);
    return [character.id, { place: there ? character.place ?? null : null, to: null, since: null, until: null, share: 0, asleep: false, unknown: !there }];
  }));
  for (const move of moves) {
    if (move.T > T) continue;
    const spent = move.seconds > 0 ? move.seconds : 0;
    where.set(move.who, { place: move.place, to: move.kind === 'go' ? move.to : null, since: move.T, until: move.kind === 'at' ? null : move.T + spent,
      share: move.kind === 'go' ? spent > 0 ? Math.min(1, (T - move.T) / spent) : 1 : 0, asleep: move.kind === 'sleep', unknown: false });
  }
  return where;
};
// The moments at which someone moved, fell asleep or woke, each once and in order: what the map steps by.
export const momentsOf = moves => [...new Set(moves.map(move => move.T))].sort((one, other) => one - other);

// ---- The drawing as a tree: an element is `[tag, attributes, ...children]` and a child is an element or a text.
// `sceneOf` is what stays while the moment changes: the frames of the groups with a rule of their scale, the links
// with their minutes, the doors, and the places, each a `g` with `data-id` and in it an empty text for the minutes
// from a place pointed at. A place under a roof is a box and one under the open sky a rounded one with a dashed
// edge. `words.span` writes so many seconds.
// The minutes a rule under a group may stand for.
const RULES = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 240];
// The time of a link, written in the middle of it on a ground of its own.
const pillOf = (link, words) => {
  const mx = (link.x1 + link.x2) / 2, my = (link.y1 + link.y2) / 2, label = words.span(link.seconds), wide = signs(label) * SMALL + 14;
  return { label, mx: Math.round(mx), my: Math.round(my), x: Math.round(mx - wide / 2), y: Math.round(my - 10), w: Math.round(wide), h: 20 };
};
export const sceneOf = (layout, words) => {
  const out = [];
  for (const link of layout.links) {
    const pill = pillOf(link, words);
    out.push(['g', { class: link.usual ? 'mp-link usual' : 'mp-link' }, ['line', { x1: link.x1, y1: link.y1, x2: link.x2, y2: link.y2 }],
      ['rect', { x: pill.x, y: pill.y, width: pill.w, height: pill.h, rx: 10 }], ['text', { x: pill.mx, y: pill.my + 4, 'text-anchor': 'middle' }, pill.label]]);
  }
  for (const group of layout.groups) {
    out.push(['rect', { class: 'mp-group', x: group.x, y: group.y, width: group.w, height: group.h, rx: 10 }]);
    if (group.scale === null) continue;
    const span = [...RULES].reverse().find(minutes => minutes * group.scale <= 90 && Math.max(4, Math.round(minutes * group.scale)) + 5 + signs(words.span(minutes * 60)) * SMALL <= group.w - 2 * FRAME);
    if (span === undefined) continue;
    const long = Math.max(4, Math.round(span * group.scale)), x = group.x + FRAME, y = group.y + group.h - 9;
    out.push(['g', { class: 'mp-rule' }, ['path', { d: `M${x} ${y - 3}V${y}H${x + long}V${y - 3}` }], ['text', { x: x + long + 5, y: y + 2 }, words.span(span * 60)]]);
  }
  for (const door of layout.doors) out.push(['line', { class: 'mp-door', x1: door.x1, y1: door.y1, x2: door.x2, y2: door.y2 }]);
  for (const place of layout.places) {
    const cx = place.x + place.w / 2;
    out.push(['g', { class: place.open ? 'mp-place open' : 'mp-place', 'data-id': place.id },
      ['rect', { x: place.x, y: place.y, width: place.w, height: place.h, rx: place.open ? Math.min(18, place.h / 2) : 3 }],
      ...place.lines.map((line, at) => ['text', { class: 'mp-name', x: cx, y: place.y + 20 + at * 16, 'text-anchor': 'middle' }, line]),
      ...place.figures.map((name, at) => ['text', { class: 'mp-figure', x: cx, y: place.y + 8 + place.lines.length * 16 + 10 + at * 13, 'text-anchor': 'middle' }, name]),
      ['text', { class: 'mp-way', x: cx, y: place.y - 4, 'text-anchor': 'middle' }]]);
  }
  return ['g', {}, ...out];
};
// The people at a moment, as `whereAt` gives them: a mark of its colour for each in the place where it is, a ring
// for someone asleep; and for someone on the way a mark on a dashed line between the two places, as far along as
// the way is behind it, with where it goes and when it is due. Each direction has its own side; beyond `TRAVELLERS`
// the rest share a mark and their count. `tones` gives the class of a character's colour, `names` its name,
// `words.due` the text beside a traveller, `words.many` a count and `words.span` the time on a link. Someone in a place
// that the map does not have is left to the list beside the map.
// A traveller's text stands at a corner of its mark: right and up, right and down, left and up or left and down,
// the first of these at which it lies on no place, on no time of a link, on no text put before it and wholly in
// the drawing, and when it lies on something at each, the one at which it lies on the least. How wide a text is
// comes from the count of its signs, as a place's width does.
const CORNERS = [[1, -1], [1, 1], [-1, -1], [-1, 1]];
const overlap = (one, other) => Math.max(0, Math.min(one.x + one.w, other.x + other.w) - Math.max(one.x, other.x)) * Math.max(0, Math.min(one.y + one.h, other.y + other.h) - Math.max(one.y, other.y));
const TRAVELLERS = 6;
const tripsOf = (layout, where, words) => {
  const places = new Map(layout.places.map(place => [place.id, place])), routes = new Map(), trips = [];
  for (const [id, is] of where) {
    if (is.to === null || !places.has(is.place) || !places.has(is.to)) continue;
    const key = JSON.stringify([is.place, is.to]);
    if (!routes.has(key)) routes.set(key, []);
    routes.get(key).push([id, is]);
  }
  for (const route of routes.values()) {
    const from = places.get(route[0][1].place), to = places.get(route[0][1].to), line = between(from, to), long = far(line.x2 - line.x1, line.y2 - line.y1) || 1;
    const rows = route.slice(0, TRAVELLERS).map(one => [one]);
    if (route.length > TRAVELLERS) rows.push(route.slice(TRAVELLERS));
    rows.forEach((row, lane) => {
      const off = (lane + 1) * 12, nx = -(line.y2 - line.y1) / long * off, ny = (line.x2 - line.x1) / long * off;
      const share = row.reduce((sum, [, is]) => sum + is.share / row.length, 0);
      trips.push({ ids: row.map(([id]) => id), line: { x1: Math.round(line.x1 + nx), y1: Math.round(line.y1 + ny), x2: Math.round(line.x2 + nx), y2: Math.round(line.y2 + ny) },
        x: Math.round(line.x1 + (line.x2 - line.x1) * share + nx), y: Math.round(line.y1 + (line.y2 - line.y1) * share + ny),
        text: lane < TRAVELLERS ? words.due(to.name, row[0][1].until) : words.many(row.length) });
    });
  }
  return trips;
};
// Room for the travellers' lanes and for at least one corner of each label. The places stay where they were;
// the page uses this rectangle for the drawing's viewBox and its size.
export const roomFor = (layout, where, words) => {
  let x = 0, y = 0, right = layout.width, down = layout.height;
  for (const trip of tripsOf(layout, where, words)) {
    x = Math.min(x, trip.line.x1 - 2, trip.line.x2 - 2, trip.x - 7);
    y = Math.min(y, trip.line.y1 - 2, trip.line.y2 - 2, trip.y - 21);
    right = Math.max(right, trip.line.x1 + 2, trip.line.x2 + 2, trip.x + 10 + Math.ceil(signs(trip.text) * SMALL));
    down = Math.max(down, trip.line.y1 + 2, trip.line.y2 + 2, trip.y + 7);
  }
  return { x, y, w: right - x, h: down - y };
};
export const peopleOf = (layout, where, { tones, names, words }) => {
  const places = new Map(layout.places.map(place => [place.id, place])), held = new Map(), out = [];
  const taken = [...layout.places, ...layout.links.map(link => pillOf(link, words))], whole = roomFor(layout, where, words);
  for (const { ids, line, x, y, text } of tripsOf(layout, where, words)) {
    const w = Math.ceil(signs(text) * SMALL), spots = CORNERS.map(([side, down]) => {
      const box = { x: side > 0 ? x + 8 : x - 8 - w, y: down > 0 ? y + 7 : y - 19, w, h: 14 };
      return { side, box, on: taken.reduce((sum, other) => sum + overlap(box, other), 0) };
    }).filter(({ box }) => box.x >= whole.x + 2 && box.y >= whole.y + 2 && box.x + box.w <= whole.x + whole.w - 2 && box.y + box.h <= whole.y + whole.h - 2);
    const spot = spots.reduce((best, one) => one.on < best.on ? one : best);
    taken.push(spot.box);
    out.push(['g', { class: `mp-trip ${ids.length === 1 ? tones(ids[0]) : ''}` }, ['line', line],
      ['circle', { class: 'mp-mark', cx: x, cy: y, r: 5 }, ['title', {}, ids.map(names).join(', ')]],
      ['text', { x: spot.side > 0 ? spot.box.x : spot.box.x + w, y: spot.box.y + 11, ...(spot.side > 0 ? {} : { 'text-anchor': 'end' }) }, text]]);
  }
  for (const [id, is] of where) {
    const from = places.get(is.place), title = ['title', {}, names(id)];
    if (!from || is.to !== null) continue;
    const at = held.get(is.place) ?? 0;
    held.set(is.place, at + 1);
    out.push(['circle', { class: `mp-mark ${tones(id)}${is.asleep ? ' asleep' : ''}`, cx: from.x + 6 + MARK / 2 + (at % from.per) * MARK, cy: from.y + from.marks + Math.floor(at / from.per) * MARK, r: is.asleep ? 4 : 5 }, title]);
  }
  return ['g', {}, ...out];
};
