// SVG layers and gestures adapted from yibie/claude-best-practices-zh/mindmap (MIT).
import React, { forwardRef, useId, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { drag, select, zoom, zoomIdentity, zoomTransform } from 'd3';
import { clusterOutline, createGraphSimulation, lineEndpoints } from './graph-layout.mjs';

const home = { x: 0, y: 0, k: 1 };
const sameCamera = (a, b) => a.k === b.k && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
const validCamera = c => c && Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.k) && c.k > 0;
const sameEdge = (a, b) => a === b || Boolean(a && b && a.source === b.source && a.target === b.target);

function createCanvas(element, tooltip, markerId, layout, positions, props) {
  const svg = select(element);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let width = element.clientWidth, height = element.clientHeight;
  const { sim, nodes, links, groups, byId, resize, snapshot, restore } = createGraphSimulation(layout, width, height);
  const clusters = [...groups.values()];
  const ink = d => groups.get(d.category).color;
  const world = svg.append('g').attr('class', 'graph-world');
  const regionLayer = world.append('g').attr('pointer-events', 'none');
  const edgeLayer = world.append('g');
  const labelLayer = world.append('g').attr('pointer-events', 'none');
  const nodeLayer = world.append('g');
  let view = props.current.view || {};
  const searchTarget = v => v.camera?.focusId === v.nodeId && v.popup === false && !v.edge && byId.has(v.nodeId) ? v.nodeId : null;
  let hovered = null, disposed = false, restoring = false, flight = null, following = searchTarget(view);
  let returningFocus = false;
  let hidden = new Set(view.hiddenCategories || []);
  let activeDrags = 0;

  const region = regionLayer.selectAll('path').data(clusters).join('path')
    .attr('class', 'graph-region').attr('data-category', d => d.category)
    .attr('stroke', d => d.color).attr('fill', d => d.color).attr('fill-opacity', 0.05).attr('stroke-opacity', 0.22);
  const regionLabel = regionLayer.selectAll('text').data(clusters).join('text')
    .attr('class', 'graph-region-label').attr('fill', 'var(--graph-muted, #776c62)')
    .attr('font-size', 12.5).attr('font-weight', 600).attr('letter-spacing', '.08em')
    .attr('text-anchor', d => d.x > 0.35 ? 'start' : d.x < -0.35 ? 'end' : 'middle').text(d => d.category);
  regionLabel.each(function (group) { group.labelWidth = this.getComputedTextLength(); });

  const edge = edgeLayer.selectAll('g').data(links).join('g')
    .attr('class', 'graph-edge').attr('tabindex', 0).attr('role', 'button').attr('cursor', 'pointer')
    .attr('data-source', d => d.source.id).attr('data-target', d => d.target.id)
    .attr('aria-label', d => d.source.title + ' 引用 ' + d.target.title);
  const edgeHit = edge.append('line').attr('class', 'graph-edge-hit').attr('stroke', 'transparent')
    .attr('stroke-width', d => d.reciprocal ? 6 : 12).attr('pointer-events', 'stroke');
  const edgeLine = edge.append('line').attr('class', 'graph-edge-line')
    .attr('pointer-events', 'none').attr('stroke-linecap', 'round');
  const linkLabel = edgeLayer.selectAll('text').data(links).join('text')
    .attr('class', 'graph-link-label').attr('pointer-events', 'none').attr('text-anchor', 'middle')
    .attr('font-size', 9.5).attr('fill', 'var(--graph-muted, #776c62)').attr('paint-order', 'stroke')
    .attr('stroke', 'var(--graph-paper, #fcfaf7)').attr('stroke-width', 2.5).text('引用');

  const node = nodeLayer.selectAll('g').data(nodes).join('g')
    .attr('class', 'graph-node').attr('role', 'button').attr('tabindex', 0).attr('cursor', 'pointer')
    .attr('data-node-id', d => d.id).attr('data-category', d => d.category)
    .attr('aria-label', d => d.title);
  node.append('circle').attr('class', 'halo').attr('r', d => d.radius + 4)
    .attr('fill', 'none').attr('stroke', ink).attr('stroke-opacity', 0.28);
  const disc = node.append('circle').attr('class', 'graph-node-disc').attr('r', d => d.radius)
    .attr('fill', ink).attr('fill-opacity', 0.2).attr('stroke', ink);
  const label = labelLayer.selectAll('text').data(nodes).join('text')
    .attr('class', d => 'graph-node-label' + (d.big ? ' big' : ''))
    .attr('text-anchor', 'middle').attr('font-size', d => d.big ? 13 : 11)
    .attr('font-weight', d => d.big ? 600 : 400).attr('fill', 'var(--graph-ink, #29251f)')
    .attr('paint-order', 'stroke').attr('stroke', 'var(--graph-paper, #fcfaf7)')
    .attr('stroke-width', 2.6).attr('stroke-linejoin', 'round').text(d => d.title);

  function selectedPoint() {
    const anchor = byId.get(view.nodeId);
    const source = byId.get(view.edge?.source), target = byId.get(view.edge?.target);
    const at = source && target ? [(source.x + target.x) / 2, (source.y + target.y) / 2]
      : anchor ? [anchor.x, anchor.y] : null;
    if (!at) return;
    const [x, y] = zoomTransform(element).apply(at);
    props.current.onPoint?.({ x, y });
  }
  function drawRegions(outlines = region, captions = regionLabel) {
    outlines.attr('d', group => clusterOutline(group.visible));
    captions.each(function (g) {
      if (!g.visible.length) return;
      let cx = 0, cy = 0, extent = 0;
      for (const d of g.visible) { cx += d.x; cy += d.y; }
      cx /= g.visible.length;
      cy /= g.visible.length;
      for (const d of g.visible) extent = Math.max(extent, Math.hypot(d.x - cx, d.y - cy) + d.radius);
      let x = cx + g.x * (extent + 24), y = cy + g.y * (extent + 24);
      if (width >= 550) {
        // Keep long discipline names on the home map, clear of the app header.
        const leftInk = g.x > 0.35 ? 0 : g.x < -0.35 ? g.labelWidth : g.labelWidth / 2;
        x = Math.max(-width / 2 + leftInk + 5, Math.min(x, width / 2 - (g.labelWidth - leftInk) - 5));
        y = Math.max(-height / 2 + 16, Math.min(y, height / 2 - 6));
      }
      select(this).attr('x', x).attr('y', y);
    });
  }
  function tick() {
    for (const link of links) link.ends = lineEndpoints(link);
    for (const selection of [edgeLine, edgeHit]) {
      selection.attr('x1', d => d.ends.x1).attr('y1', d => d.ends.y1)
        .attr('x2', d => d.ends.x2).attr('y2', d => d.ends.y2);
    }
    linkLabel.attr('x', d => d.ends.labelX).attr('y', d => d.ends.labelY);
    node.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
    label.attr('x', d => d.x).attr('y', d => d.y - d.radius - 6);
    drawRegions();
    // Keep the searched node at the viewport center as the layout
    // settles, including after history navigation. User gestures clear this intent.
    if (following && !flight) {
      const camera = cameraForNode(following);
      if (!sameCamera(camera, readCamera())) moveCamera(camera);
    }
    selectedPoint();
  }

  let neighbors = new Set();
  function scaleLabels(k) {
    label.attr('opacity', d => k < 1.15 && d.count < layout.labelThreshold && !neighbors.has(d.id) ? 0
      : neighbors.size && !neighbors.has(d.id) ? 0.13 : 1);
    regionLabel.attr('opacity', k < 0.55 ? 0.4 : 0.9);
  }
  function focus() {
    const chosenEdge = hovered ? null : view.edge;
    const activeId = hovered || view.nodeId;
    neighbors = new Set();
    if (chosenEdge) {
      neighbors.add(chosenEdge.source);
      neighbors.add(chosenEdge.target);
    } else if (activeId) {
      neighbors.add(activeId);
      for (const e of layout.adjacent.get(activeId) || []) {
        neighbors.add(e.source);
        neighbors.add(e.target);
      }
    }
    const muted = d => neighbors.size > 0 && !neighbors.has(d.id);
    const hot = l => chosenEdge ? sameEdge(l.edge, chosenEdge) : l.source.id === activeId || l.target.id === activeId;
    node.attr('data-emphasis', d => d.id === activeId ? 'current' : muted(d) ? 'muted' : neighbors.size ? 'neighbor' : 'normal')
      .attr('aria-pressed', d => d.id === view.nodeId).classed('pick', d => d.id === view.nodeId)
      .classed('dim', muted).attr('opacity', d => muted(d) ? 0.13 : 1);
    disc.attr('stroke-width', d => d.id === view.nodeId ? 2.6 : 1.2);
    edge.classed('hot', hot).classed('pick', l => sameEdge(l.edge, view.edge))
      .classed('dim', l => neighbors.size > 0 && !hot(l)).attr('aria-pressed', l => !!sameEdge(l.edge, view.edge))
      .attr('opacity', l => neighbors.size && !hot(l) ? 0.13 : 1);
    edgeLine.attr('stroke', l => hot(l) ? 'var(--graph-hot, #286653)' : l.sameCategory ? ink(l.source) : 'var(--graph-link-cross, #a49c91)')
      .attr('stroke-width', l => sameEdge(l.edge, chosenEdge) ? 2.5 : l.sameCategory ? Math.min(0.8 + l.weight * 0.45, 2.6) : Math.min(0.6 + l.weight * 0.3, 1.6))
      .attr('stroke-opacity', l => hot(l) ? 0.95 : l.sameCategory ? Math.min(0.16 + l.weight * 0.1, 0.5) : Math.min(0.08 + l.weight * 0.06, 0.28))
      .attr('stroke-dasharray', l => l.sameCategory || hot(l) ? null : '3 4')
      .attr('marker-end', l => hot(l) ? 'url(#' + markerId + ')' : null);
    label.classed('dim', muted);
    linkLabel.classed('show', l => hot(l) && view.showLabels !== false)
      .attr('opacity', l => hot(l) && view.showLabels !== false ? 0.95 : 0);
    scaleLabels(zoomTransform(element).k);
  }
  const visible = n => !hidden.has(n.category) && (!view.coreOnly || n.count >= layout.coreThreshold);
  function filter(redraw = false) {
    hidden = new Set(view.hiddenCategories || []);
    const hideNode = d => visible(d) ? null : 'none';
    const hideEdge = l => visible(l.source) && visible(l.target) ? null : 'none';
    node.attr('display', hideNode);
    label.attr('display', hideNode);
    edge.attr('display', hideEdge);
    linkLabel.attr('display', hideEdge);
    const changed = new Set();
    for (const group of clusters) {
      const members = group.members.filter(visible);
      if (members.length && members.length !== group.visible?.length) changed.add(group);
      group.visible = members;
    }
    region.attr('display', g => g.visible.length ? null : 'none');
    regionLabel.attr('display', g => g.visible.length ? null : 'none');
    if (redraw && changed.size) {
      drawRegions(region.filter(g => changed.has(g)), regionLabel.filter(g => changed.has(g)));
    }
  }
  const readCamera = () => {
    const t = zoomTransform(element);
    const [x, y] = t.invert([width / 2, height / 2]);
    return { x, y, k: t.k };
  };
  let previousScale = null;
  const behavior = zoom().scaleExtent([0.35, 3.5]).extent(() => [[0, 0], [width, height]])
    .on('start', e => { if (e.sourceEvent) following = null; })
    .on('zoom', e => {
      if (disposed) return;
      world.attr('transform', e.transform);
      if (previousScale !== e.transform.k) scaleLabels(e.transform.k);
      previousScale = e.transform.k;
      selectedPoint();
    })
    .on('end', e => {
      if (!disposed && e.sourceEvent) props.current.onCamera?.(readCamera());
    });
  svg.call(behavior).on('dblclick.zoom', null);

  function cancelFlight() {
    flight = null;
    svg.interrupt();
  }
  function stopForInput() {
    following = null;
    if (!flight) return;
    cancelFlight();
  }
  function moveCamera(camera, duration = 0, finish) {
    cancelFlight();
    const destination = zoomIdentity.translate(width / 2, height / 2).scale(camera.k).translate(-camera.x, -camera.y);
    if (!duration || reducedMotion.matches) {
      svg.call(behavior.transform, destination);
      finish?.();
      return;
    }
    flight = camera;
    svg.transition().duration(duration).call(behavior.transform, destination)
      .on('end.camera', () => { flight = null; finish?.(); })
      .on('interrupt.camera cancel.camera', () => { flight = null; });
  }

  function clearHover() {
    tooltip.hidden = true;
    if (hovered === null) return;
    hovered = null;
    props.current.onHover?.(null);
    focus();
  }
  function hover(event, n) {
    if (event.type === 'focus' && returningFocus) return;
    hovered = n.id;
    props.current.onHover?.(n.id);
    focus();
    if (event.type === 'focus') return;
    const tip = select(tooltip);
    tip.select('strong').text(n.title);
    tip.select('span').text(n.category + ' · 被 ' + n.count + ' 张卡引用');
    tooltip.hidden = false;
    positionTip(event);
  }
  function positionTip(e) {
    if (tooltip.hidden) return;
    const rect = element.getBoundingClientRect();
    tooltip.style.left = Math.max(0, Math.min(e.clientX - rect.left + 14, width - tooltip.offsetWidth - 6)) + 'px';
    tooltip.style.top = Math.max(0, Math.min(e.clientY - rect.top + 14, height - tooltip.offsetHeight - 6)) + 'px';
  }
  function pickNode(e, n) {
    e.stopPropagation();
    if (e.type === 'click' && e.detail > 1) return;
    stopForInput();
    clearHover();
    props.current.onPick?.(n.id);
  }
  function pickEdge(e, l) {
    e.stopPropagation();
    stopForInput();
    clearHover();
    props.current.onEdge?.(l.edge);
  }
  const keyPick = handler => (e, d) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler(e, d);
    }
  };
  node.on('mouseenter', hover).on('mousemove', positionTip).on('mouseleave', clearHover)
    .on('focus', hover).on('blur', clearHover)
    .on('click', pickNode).on('keydown', keyPick(pickNode))
    .on('dblclick', (e, d) => { e.stopPropagation(); clearHover(); props.current.onDoubleClick?.(d.id); })
    .call(drag().clickDistance(3)
      .on('start', (start, d) => {
        let moved = false;
        start.on('drag', e => {
          // D3 starts a drag on pointer-down, including an ordinary click. Only
          // restart the forces after crossing its click-distance threshold.
          if (!moved) {
            if (Math.hypot(e.x - start.x, e.y - start.y) * zoomTransform(element).k <= 3) return;
            moved = true;
            stopForInput();
            if (++activeDrags === 1) sim.alphaTarget(0.25).restart();
          }
          d.fx = e.x;
          d.fy = e.y;
        }).on('end', () => {
          if (!moved) return;
          if (--activeDrags === 0) sim.alphaTarget(0);
          d.fx = null;
          d.fy = null;
          props.current.onCamera?.(readCamera());
        });
      }));
  edge.on('click', pickEdge).on('keydown', keyPick(pickEdge));
  svg.on('click.canvas', () => { stopForInput(); clearHover(); props.current.onDismiss?.(); })
    .on('keydown.canvas', e => {
      const shifts = { ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] };
      const shift = shifts[e.key], scale = { '+': 1.25, '=': 1.25, '-': 0.8 }[e.key];
      if (!shift && !scale) return;
      e.preventDefault();
      following = null;
      cancelFlight();
      if (shift) svg.call(behavior.translateBy, shift[0] / readCamera().k, shift[1] / readCamera().k);
      if (scale) svg.call(behavior.scaleBy, scale);
      props.current.onCamera?.(readCamera());
    });

  function startLayout(alpha) {
    sim.alpha(alpha);
    // With reduced motion expose a stable map immediately. Bound startup work on large libraries.
    if (reducedMotion.matches) {
      sim.stop().tick(nodes.length > 300 ? 30 : 120);
      tick();
    } else sim.restart();
  }
  const resumed = (view.nodeId || validCamera(view.camera)) && restore(positions.snapshot);
  filter();
  svg.attr('viewBox', '0 0 ' + width + ' ' + height);
  moveCamera(following ? cameraForNode(following) : validCamera(view.camera) ? view.camera : home);
  focus();
  sim.on('tick', tick).on('end', () => {
    if (!flight && following) props.current.onCamera?.({ ...readCamera(), focusId: following });
  });
  // Reduced motion draws once after synchronous settling, before the first paint.
  if (resumed || !reducedMotion.matches) tick();
  if (!resumed) startLayout(0.9);
  else if (!reducedMotion.matches && sim.alpha() > sim.alphaMin()) sim.restart();
  const observer = new ResizeObserver(() => {
    const w = element.clientWidth, h = element.clientHeight;
    if (!w || !h || w === width && h === height) return;
    const camera = flight || readCamera();
    const interrupted = !!flight;
    width = w; height = h;
    svg.attr('viewBox', '0 0 ' + w + ' ' + h);
    resize(w, h);
    moveCamera(camera);
    if (interrupted) props.current.onCamera?.(following ? { ...readCamera(), focusId: following } : readCamera());
    startLayout(0.2);
  });
  observer.observe(element);
  function restoreHistory() {
    // The workspace can synchronously publish the restored entry before this
    // listener runs. Reapply its intent in either ordering, including equal cameras.
    restoring = true;
    cancelFlight();
    clearHover();
    following = searchTarget(view);
    const camera = following ? cameraForNode(following) : validCamera(view.camera) ? view.camera : home;
    if (!sameCamera(camera, readCamera())) moveCamera(camera);
  }
  window.addEventListener('popstate', restoreHistory, true);

  function cameraForNode(id) {
    const n = byId.get(id);
    return n ? { x: n.x, y: n.y, k: 1.5 } : null;
  }
  return {
    getCamera: readCamera, cameraForNode,
    dismissFocus(id, selectedEdge) {
      // Closing a dialog can itself focus the trigger, before our scheduled handback.
      returningFocus = true;
      clearHover();
      requestAnimationFrame(() => {
        if (disposed) return;
        const target = selectedEdge ? edge.filter(l => sameEdge(l.edge, selectedEdge)).node()
          : id ? node.filter(n => n.id === id).node() : null;
        target?.focus({ preventScroll: true });
        returningFocus = false;
      });
    },
    focusNode(id) {
      clearHover();
      const camera = cameraForNode(id);
      following = camera ? id : null;
      if (camera) moveCamera(camera, 600, () => {
        const settled = cameraForNode(id);
        if (!sameCamera(readCamera(), settled)) moveCamera(settled);
        props.current.onCamera?.({ ...readCamera(), focusId: id });
      });
      // Forward navigation can return to this entry even before its animation finishes.
      if (flight) props.current.onCamera?.({ ...camera, focusId: id });
    },
    reset() {
      clearHover();
      following = null;
      for (const d of nodes) { d.fx = null; d.fy = null; }
      startLayout(0.5);
      moveCamera(home, 500, () => props.current.onCamera?.(readCamera()));
      if (flight) props.current.onCamera?.(home);
    },
    update(next) {
      const old = view;
      view = next;
      const nextTarget = searchTarget(next);
      const targetChanged = nextTarget !== searchTarget(old);
      if (restoring || targetChanged) following = nextTarget;
      const coreChanged = Boolean(old.coreOnly) !== Boolean(next.coreOnly);
      const categories = next.hiddenCategories || [];
      const categoriesChanged = old.hiddenCategories !== next.hiddenCategories &&
        (categories.length !== hidden.size || categories.some(category => !hidden.has(category)));
      if (coreChanged || categoriesChanged) {
        filter(true);
        if (hovered && !visible(byId.get(hovered))) clearHover();
      }
      if (old.nodeId !== next.nodeId || !sameEdge(old.edge, next.edge) || old.showLabels !== next.showLabels) focus();
      const camera = validCamera(next.camera) ? next.camera : home;
      const previousCamera = validCamera(old.camera) ? old.camera : home;
      if ((restoring || targetChanged || !sameCamera(camera, previousCamera)) && !(flight && sameCamera(camera, flight))) {
        const destination = following ? cameraForNode(following) : camera;
        if (flight || !sameCamera(destination, readCamera())) moveCamera(destination);
      }
      restoring = false;
      selectedPoint();
    },
    destroy() {
      disposed = true;
      positions.save(snapshot);
      window.removeEventListener('popstate', restoreHistory, true);
      observer.disconnect();
      cancelFlight();
      sim.on('tick', null).on('end', null).stop();
      svg.on('.zoom', null).on('.canvas', null);
      node.on('.drag', null);
      world.remove();
      tooltip.hidden = true;
    },
  };
}

export const GraphCanvas = forwardRef(function GraphCanvas(props, ref) {
  const element = useRef(null), tooltip = useRef(null), controller = useRef(null), latest = useRef(props);
  const markerId = 'graph-arrow-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  latest.current = props;
  useImperativeHandle(ref, () => ({
    getCamera: () => controller.current?.getCamera(),
    dismissFocus: (id, edge) => controller.current?.dismissFocus(id, edge),
    cameraForNode: id => controller.current?.cameraForNode(id),
    focusNode: id => controller.current?.focusNode(id),
    reset: () => controller.current?.reset(),
  }), []);
  useLayoutEffect(() => {
    const scene = createCanvas(element.current, tooltip.current, markerId, props.layout, props.positions, latest);
    controller.current = scene;
    return () => { controller.current = null; scene.destroy(); };
  }, [props.layout, props.positions, markerId]);
  useLayoutEffect(() => { controller.current?.update(props.view || {}); }, [props.view]);
  return <>
    <svg ref={element} className="graph-canvas" role="group" aria-label="知识图谱画布" tabIndex={0}>
      <defs><marker id={markerId} viewBox="0 0 6 6" refX="5.5" refY="3" markerWidth="5" markerHeight="5" orient="auto">
        <path d="M0,0 L6,3 L0,6 Z" fill="var(--graph-hot, #286653)" />
      </marker></defs>
    </svg>
    <div className="graph-tooltip" ref={tooltip} role="tooltip" hidden><strong /><span /></div>
  </>;
});
