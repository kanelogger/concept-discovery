import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraphLayout, categoryColor, clusterOutline, createGraphSimulation, lineEndpoints } from '../../web/graph-layout.mjs';

const card = (id, ...categories) => ({ id, title: id, categories });
const ref = (source, target, count = 1) => ({
  source, target, occurrences: Array.from({ length: count }, (_, i) => ({ anchor: source + i, excerpt: target })),
});

test('only real citations affect incoming size, with primary category independent of card relationships', () => {
  const nodes = [card('hub', '心理学', '研究'), card('a', '研究'), card('b', '研究'), card('solo')];
  const edges = [ref('a', 'hub', 5), ref('b', 'hub'), ref('hub', 'a'), ref('hub', 'missing'), ref('hub', 'hub')];
  const layout = buildGraphLayout({ nodes, edges });
  assert.equal(layout.byId.get('hub').count, 2);
  assert.equal(layout.byId.get('hub').radius, 17);
  assert.equal(layout.byId.get('hub').category, '心理学');
  assert.equal(layout.byId.get('a').count, 1);
  assert.equal(layout.byId.get('solo').radius, 4);
  assert.equal(layout.byId.get('solo').category, '未分类');
  assert.deepEqual(layout.adjacent.get('hub'), edges.slice(0, 3));
  assert.equal(layout.edges.length, 3);
  assert.equal(layout.coreThreshold, 2);
  const reversed = buildGraphLayout({ nodes: nodes.toReversed(), edges });
  assert.deepEqual(layout.categories, reversed.categories);
  assert.equal(categoryColor(layout.categories[0], layout.categories), '#7C9CF5');
  assert.equal(categoryColor('研究', layout.categories), categoryColor('研究', reversed.categories));
});

test('empty and isolated libraries have finite node sizes without qualifying as core; defaults cap at eight and four', () => {
  const empty = buildGraphLayout({});
  assert.equal(empty.nodes.length, 0);
  assert.equal(clusterOutline([]), '');
  const nodes = Array.from({ length: 15 }, (_, i) => card(String(i)));
  const isolated = buildGraphLayout({ nodes });
  assert.ok(isolated.nodes.every(n => n.radius === 4 && n.count < isolated.coreThreshold));
  const popular = buildGraphLayout({ nodes, edges: nodes.slice(1).map(n => ref(n.id, '0')) });
  assert.equal(popular.coreThreshold, 8);
  assert.equal(popular.labelThreshold, 4);
  assert.equal(popular.byId.get('0').big, true);
  assert.ok(isolated.nodes.every(n => !n.big));
});

test('an overview with 62 cards, 74 citations and four sources at most retains two readable title sizes', () => {
  const counts = [22, 12, 23, 4, 1].flatMap((number, count) => Array(number).fill(count));
  const nodes = counts.map((_, i) => card(String(i)));
  const edges = counts.flatMap((count, i) => Array.from({ length: count }, (_, j) =>
    ref(nodes[(i + j + 1) % nodes.length].id, nodes[i].id)));
  const layout = buildGraphLayout({ nodes, edges });
  assert.equal(edges.length, 74);
  assert.equal(layout.nodes.filter(n => n.count >= layout.labelThreshold).length, 28);
  assert.equal(layout.nodes.filter(n => n.big).length, 5);
  assert.equal(layout.coreThreshold, 3);
  assert.deepEqual(layout.nodes.map(n => n.count), counts);
});

test('D3 groups follow the measured ring, run the reference forces and never mutate reader endpoints', () => {
  const nodes = [card('a', '甲'), card('b', '甲'), card('c', '乙')];
  const edges = [ref('a', 'b'), ref('a', 'c')];
  const layout = buildGraphLayout({ nodes, edges });
  const { sim, byId, groups, links, resize } = createGraphSimulation(layout, 1200, 640);
  assert.equal(sim.force('charge').strength()(), -90);
  assert.equal(sim.force('charge').distanceMax(), 230);
  assert.equal(sim.force('collide').iterations(), 2);
  const linkForce = sim.force('link');
  assert.deepEqual(links.map(linkForce.distance()), [44, 170]);
  assert.deepEqual(links.map(linkForce.strength()), [0.4, 0.015]);
  assert.equal(sim.alphaDecay(), 0.026);
  sim.tick(130);
  const a = byId.get('a'), b = byId.get('b'), c = byId.get('c');
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < Math.hypot(a.x - c.x, a.y - c.y));
  assert.match(clusterOutline(groups.get('甲').members), /^M.*C.*Z$/);
  assert.ok(Number.isFinite(a.x) && Number.isFinite(c.y));
  assert.equal(layout.byId.get('a').x, undefined);
  assert.deepEqual(layout.edges.map(e => e.target), ['b', 'c']);
  const yBefore = Math.abs(sim.force('y').y()(a));
  resize(600, 400);
  assert.ok(Math.abs(yBefore - 640 * 0.335) < 1e-8);
  assert.ok(Math.abs(Math.abs(sim.force('y').y()(a)) - 400 * 0.335) < 1e-8);
});

test('reciprocal citations are separately selectable parallel lines, meeting the correct node circles', () => {
  const layout = buildGraphLayout({ nodes: [card('a'), card('b')], edges: [ref('a', 'b'), ref('b', 'a')] });
  const { links, byId } = createGraphSimulation(layout, 900, 600);
  Object.assign(byId.get('a'), { x: 0, y: 0 });
  Object.assign(byId.get('b'), { x: 100, y: 0 });
  const [forward, reverse] = links.map(lineEndpoints);
  assert.ok(forward.y1 > 0 && reverse.y1 < 0);
  assert.equal(forward.y1, forward.y2);
  assert.ok(Math.abs(forward.labelY - reverse.labelY) >= 22);
  assert.ok(forward.labelX < reverse.labelX);
  assert.ok(forward.x1 < forward.x2 && reverse.x1 > reverse.x2);
  assert.ok(Math.abs(Math.hypot(forward.x1, forward.y1) - byId.get('a').radius) < 1e-8);
});

test('returning from a card restores the last simulation only for the same viewport and graph topology', () => {
  const data = { nodes: [card('a', '理科'), card('b', '文科'), card('c')], edges: [ref('a', 'b')] };
  const scene = graph => createGraphSimulation(buildGraphLayout(graph), 900, 640);
  const previous = scene(data);
  previous.sim.tick(40);
  Object.assign(previous.byId.get('b'), { x: 98, y: -73, vx: 0.05, vy: -0.12 });
  const saved = previous.snapshot();
  const current = scene({ nodes: data.nodes.toReversed(), edges: data.edges });
  assert.equal(current.restore(saved), true);
  const { x, y, vx, vy } = current.byId.get('b');
  assert.deepEqual({ x, y, vx, vy }, { x: 98, y: -73, vx: 0.05, vy: -0.12 });
  assert.equal(current.sim.alpha(), previous.sim.alpha());
  current.resize(390, 640);
  assert.equal(current.restore(saved), false);
  assert.equal(scene({ ...data, edges: [ref('b', 'a')] }).restore(saved), false);
  assert.equal(scene({ ...data, nodes: [card('a'), ...data.nodes.slice(1)] }).restore(saved), false);
  assert.equal(scene({ ...data, nodes: [...data.nodes, card('new')] }).restore(saved), false);
});
