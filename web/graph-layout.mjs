/*! @license
Graph layout and interactions adapted from mindmap/graph.html
https://github.com/yibie/claude-best-practices-zh/blob/37648288e962ad9e88c54086d4d55f3f46862b69/mindmap/graph.html

MIT License

Copyright (c) 2026 yibie

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

D3 and the bundled force, shape, selection, transition and zoom modules
(including d3-path, Copyright 2015-2026 Mike Bostock).
Copyright 2010-2026 Mike Bostock

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.

d3-ease
Copyright 2010-2026 Mike Bostock
Copyright 2001 Robert Penner
All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the author nor the names of contributors may be used to
  endorse or promote products derived from this software without specific prior
  written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
import { curveCatmullRomClosed, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, line, polygonHull } from 'd3';

const collator = new Intl.Collator('zh-CN', { numeric: true });
const categoryInk = ['#7C9CF5', '#E8B33C', '#5FC9A3', '#E0795C', '#B48EAD', '#63C5DA',
  '#F2A65A', '#9DBF6E', '#C0A6F0', '#5E8B7E', '#D98E73'];
const contour = line().curve(curveCatmullRomClosed.alpha(0.6));

export function categoryColor(category, categories) {
  return categoryInk[Math.max(0, categories.indexOf(category)) % categoryInk.length];
}

export function buildGraphLayout(data) {
  const nodes = (data?.nodes || []).map(n => ({ ...n, category: n.categories?.[0] || '未分类', count: 0 }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  const adjacent = new Map(nodes.map(n => [n.id, []]));
  const sources = new Map(nodes.map(n => [n.id, new Set()]));
  const edges = (data?.edges || []).filter(e => e.source !== e.target && byId.has(e.source) && byId.has(e.target));
  for (const edge of edges) {
    adjacent.get(edge.source).push(edge);
    adjacent.get(edge.target).push(edge);
    sources.get(edge.target).add(edge.source);
  }
  let maxCount = 0;
  for (const node of nodes) {
    node.count = sources.get(node.id).size;
    maxCount = Math.max(maxCount, node.count);
  }
  // Reference counts span many articles. On a small citation scale, keep the same
  // visual hierarchy without changing the displayed source counts or D3 forces.
  const sparse = maxCount > 0 && maxCount < 8;
  const coreThreshold = sparse ? Math.ceil(3 * maxCount / 4) : 8;
  const labelThreshold = sparse ? Math.ceil(maxCount / 2) : 4;
  const bigThreshold = sparse ? coreThreshold : 12;
  for (const node of nodes) {
    node.radius = 4 + 13 * Math.sqrt(node.count / (maxCount || 1));
    node.big = node.count >= bigThreshold;
  }
  const categories = [...new Set(nodes.map(n => n.category))].sort(collator.compare);
  return { nodes, edges, byId, adjacent, categories, coreThreshold, labelThreshold };
}

// D3 mutates its inputs. The reader and browser history keep stable string endpoints.
export function createGraphSimulation(layout, width, height) {
  const nodes = layout.nodes.map(n => ({ ...n }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  const directions = new Map(nodes.map(n => [n.id, new Set()]));
  for (const edge of layout.edges) directions.get(edge.source).add(edge.target);
  const links = layout.edges.map(edge => ({ edge, source: byId.get(edge.source), target: byId.get(edge.target),
    sameCategory: byId.get(edge.source).category === byId.get(edge.target).category,
    reciprocal: directions.get(edge.target).has(edge.source), weight: edge.occurrences?.length || 1 }));
  const groups = new Map(layout.categories.map((category, index) => {
    const angle = index / layout.categories.length * Math.PI * 2 - Math.PI / 2;
    return [category, { category, x: Math.cos(angle), y: Math.sin(angle), members: [],
      color: categoryColor(category, layout.categories) }];
  }));
  for (const node of nodes) groups.get(node.category).members.push(node);
  const anchorStrength = d => d.count >= 12 ? 0.30 : 0.22;
  const sim = forceSimulation(nodes).stop()
    .force('link', forceLink(links).id(d => d.id)
      .distance(l => l.sameCategory ? 44 : 170).strength(l => l.sameCategory ? 0.40 : 0.015))
    .force('charge', forceManyBody().strength(-90).distanceMax(230))
    .force('collide', forceCollide(d => d.radius + 17).iterations(2))
    .alphaDecay(0.026);
  function resize(w, h) {
    width = w;
    height = h;
    const radius = Math.min(w, h) * 0.335;
    sim.force('x', forceX(n => groups.get(n.category).x * radius).strength(anchorStrength));
    sim.force('y', forceY(n => groups.get(n.category).y * radius).strength(anchorStrength));
  }
  function snapshot() {
    return {
      width, height, alpha: sim.alpha(),
      nodes: nodes.map(({ id, category, x, y, vx, vy }) => ({ id, category, x, y, vx, vy })),
      edges: layout.edges.map(({ source, target }) => [source, target]),
    };
  }
  function restore(saved) {
    if (!saved || saved.width !== width || saved.height !== height || saved.nodes.length !== nodes.length ||
      saved.edges.length !== links.length || !saved.nodes.every(n => byId.get(n.id)?.category === n.category) ||
      !saved.edges.every(([source, target]) => directions.get(source)?.has(target))) return false;
    for (const { id, x, y, vx, vy } of saved.nodes) Object.assign(byId.get(id), { x, y, vx, vy });
    sim.alpha(saved.alpha);
    return true;
  }
  resize(width, height);
  return { sim, nodes, links, groups, byId, resize, snapshot, restore };
}

export function clusterOutline(members) {
  if (!members.length) return '';
  const points = [];
  for (const d of members) {
    const p = d.radius + 16;
    points.push([d.x - p, d.y], [d.x + p, d.y], [d.x, d.y - p], [d.x, d.y + p]);
  }
  const hull = polygonHull(points);
  return hull ? contour(hull) + 'Z' : '';
}

// Separate A → B and B → A so each can receive focus and a pointer independently.
export function lineEndpoints(link) {
  const { source, target } = link;
  const dx = target.x - source.x, dy = target.y - source.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length, uy = dy / length;
  const offset = link.reciprocal ? 3 : 0;
  const start = Math.sqrt(Math.max(0, source.radius ** 2 - offset ** 2));
  const end = Math.sqrt(Math.max(0, target.radius ** 2 - offset ** 2)) + 1;
  const x1 = source.x + ux * start - uy * offset, y1 = source.y + uy * start + ux * offset;
  const x2 = target.x - ux * end - uy * offset, y2 = target.y - uy * end + ux * offset;
  // Each direction needs its own word, even when the line is shorter than its label.
  const at = link.reciprocal ? 0.36 : 0.5;
  const labelGap = link.reciprocal ? 11 : 0;
  return { x1, y1, x2, y2, labelX: x1 + (x2 - x1) * at - uy * labelGap,
    labelY: y1 + (y2 - y1) * at + ux * labelGap - 3 };
}
