/**
 * The mind map of the part being read.
 *
 * The drawing is radial: the topic sits in the middle, the branches are
 * placed on a circle around it, and the points of a branch sit on an outer
 * arc inside the sector that the branch owns. A branch on the right half of
 * the circle keeps its points on the right, a branch on the left half keeps
 * them on the left, so the map reads like the classic mind map instead of a
 * tree that happens to be round.
 *
 * The layout is a pure function: the same tree always draws the same map.
 * That keeps it testable without a browser and keeps the map from moving
 * around while the learner reads it.
 */
import { createElement as h, useEffect, useMemo, useState } from 'react';
import { Modal } from './library.js';

/** The plugin id; the host removes the stylesheet together with the plugin. */
const PLUGIN_ID = '@local/english-reader';

/**
 * The stylesheet of this module.
 *
 * The plugin keeps one stylesheet for the whole reader, and that file belongs
 * to the other parts of the reader as well. The mind map therefore brings its
 * own rules, under its own prefix, so that nothing here can change the look
 * of the rest of the reader.
 */
const STYLE = `
.er-mm{display:flex;flex-direction:column;gap:10px;min-width:0}
.er-mm-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.er-mm-scope{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.er-mm-actions{margin-left:auto;display:flex;gap:8px}
.er-mm-status{display:inline-flex;align-items:center;gap:8px;align-self:flex-start;font-size:12px;color:var(--dsw-alias-label-secondary)}
.er-mm-status.is-loading::before{content:'';width:11px;height:11px;flex:none;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-state-business-primary);animation:er-mm-spin .9s linear infinite}
@keyframes er-mm-spin{to{transform:rotate(360deg)}}
.er-mm-error{display:flex;flex-direction:column;gap:3px;padding:8px 11px;border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.5}
.er-mm-error-title{font-weight:600}
.er-mm-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:190px;padding:24px;text-align:center;color:var(--dsw-alias-label-tertiary)}
.er-mm-empty-title{font-size:14px;color:var(--dsw-alias-label-secondary)}
.er-mm-empty-hint{font-size:12px;max-width:420px;line-height:1.7}
.er-mm-canvas{display:block;width:100%;height:auto;max-height:62vh}
.er-mm-link{fill:none;stroke:var(--dsw-alias-border-l2);stroke-width:1.5;stroke-linecap:round}
.er-mm-box{stroke-width:1}
.er-mm-node.is-root .er-mm-box{fill:var(--dsw-alias-state-business-primary);stroke:none}
.er-mm-node.is-branch .er-mm-box{fill:var(--dsw-alias-bg-layer-2);stroke:var(--dsw-alias-border-l1)}
.er-mm-node.is-item .er-mm-box{fill:var(--dsw-alias-bg-layer-1);stroke:var(--dsw-alias-border-l2)}
.er-mm-label{fill:var(--dsw-alias-label-primary);font-family:var(--dsw-font,inherit);text-anchor:middle}
.er-mm-node.is-root .er-mm-label{fill:var(--dsw-alias-bg-base);font-size:14px;font-weight:600}
.er-mm-node.is-branch .er-mm-label{font-size:13px}
.er-mm-node.is-item .er-mm-label{fill:var(--dsw-alias-label-secondary);font-size:12px}
/* The switch between the layouts; it sits in the head of the panel. */
.er-mm-switch{display:inline-flex;gap:2px;padding:2px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2)}
.er-mm-switch-item{appearance:none;border:0;border-radius:calc(var(--dsw-radius-md,8px) - 2px);padding:5px 12px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;white-space:nowrap;cursor:pointer}
.er-mm-switch-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.er-mm-switch-item.is-active{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:500}
.er-mm-switch-item:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
/* A node can be picked, so it says so with the pointer and the keyboard. */
.er-mm-node{cursor:pointer}
.er-mm-node:focus{outline:none}
.er-mm-node:focus-visible .er-mm-box{stroke:var(--dsw-alias-state-business-primary);stroke-width:2}
.er-mm-node.is-selected .er-mm-box{stroke:var(--dsw-alias-state-business-primary);stroke-width:2}
/* The bar at the foot of the panel; it stays there while the map scrolls. */
.er-mm-bar{position:sticky;bottom:0;z-index:2;display:flex;align-items:center;gap:10px;margin-top:4px;padding:10px 0 2px;background:var(--dsw-alias-bg-layer-1);border-top:1px solid var(--dsw-alias-border-l1)}
.er-mm-bar-label{font-size:12.5px;font-weight:500;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:42%}
.er-mm-bar-quote{margin-left:2px;font-size:11.5px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.er-mm-bar-hint{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.er-mm-bar .er-btn{margin-left:auto;flex:none}
`;

/**
 * Install the stylesheet of this module.
 *
 * The style element carries the plugin id, so the host takes it away together
 * with the plugin and no rule of the mind map outlives it.
 *
 * @returns {() => void} the cleanup
 */
function installStyles() {
  const style = document.createElement('style');
  style.setAttribute('data-plugin', PLUGIN_ID);
  style.textContent = STYLE;
  document.head.appendChild(style);
  return () => { style.remove(); };
}

/** The font size of every kind of node. */
export const MIND_MAP_FONT_SIZE = { root: 14, branch: 13, item: 12 };

/**
 * The layouts the map can be drawn in.
 *
 * The radial map is the mind map itself; the two trees show the same
 * structure as a list, which is easier to read for a long chapter.
 */
export const MIND_MAP_LAYOUTS = ['radial', 'tree', 'vertical'];

/** The widest a box of a node may become. */
const MAX_WIDTH = { root: 240, branch: 200, item: 190 };

/** The room inside a box, around the text. */
const PADDING_X = 12;
const PADDING_Y = 9;

/** The height of one line of text, as a factor of the font size. */
const LINE_HEIGHT_RATIO = 1.35;

/** The room between two boxes that must not touch. */
const NODE_GAP = 18;

/** The room between the drawing and the edge of the canvas. */
const CANVAS_MARGIN = 28;

/** The smallest angle a branch may own, in degrees. */
const MIN_SECTOR = 24;

/** The room a branch keeps at the borders of its sector, in degrees. */
const SECTOR_INSET = 10;

/** The room between two levels of the tree, in pixels. */
const LEVEL_GAP = 48;

/** The room between two points of one branch, in pixels. */
const ITEM_GAP = 10;

/** The room between the blocks of two branches, in pixels. */
const BLOCK_GAP = 16;

/**
 * How far the lines of a tree bend away from the straight line.
 *
 * The wheel of the radial map is drawn with long, swinging lines; a tree is
 * a list, and its lines stay close to the boxes they join.
 */
const TREE_SWING = 0.06;

/** The most branches and the most points one map may show. */
const MAX_BRANCHES = 8;
const MAX_ITEMS = 6;

/** The longest note a point may carry. */
const MAX_NOTE_LENGTH = 200;

/** The most lines a label is wrapped into. */
const MAX_LABEL_LINES = 2;

/** The conversion between degrees and radians. */
const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

/**
 * The width one character takes on a line.
 *
 * A full width character (Chinese, Japanese, Korean) takes a whole em, a
 * latin letter about half of it. The label is written by a model, so the
 * estimate only has to be good enough to size the box.
 *
 * @param {string} ch - one character
 * @param {number} fontSize - the font size in pixels
 * @returns {number} the width in pixels
 */
function charWidth(ch, fontSize) {
  const code = ch.codePointAt(0) ?? 0;
  return code > 0x2e80 ? fontSize : fontSize * 0.55;
}

/**
 * The width of a piece of text.
 *
 * @param {string} text - the text
 * @param {number} fontSize - the font size in pixels
 * @returns {number} the width in pixels
 */
function textWidth(text, fontSize) {
  let width = 0;
  for (const ch of String(text ?? '')) width += charWidth(ch, fontSize);
  return width;
}

/**
 * Cut a text short enough to fit the box.
 *
 * @param {string} text - the text
 * @param {number} maxWidth - the width the text may use
 * @param {number} fontSize - the font size in pixels
 * @returns {string} the shortened text
 */
function ellipsize(text, maxWidth, fontSize) {
  const chars = Array.from(String(text ?? ''));
  let kept = '';
  for (const ch of chars) {
    if (textWidth(`${kept}${ch}…`, fontSize) > maxWidth) break;
    kept += ch;
  }
  return kept === '' ? '…' : `${kept}…`;
}

/**
 * Wrap a label into the lines that fit the box.
 *
 * A label becomes at most two lines. A word that is longer than the box is
 * cut at the edge, and text that does not fit is marked with an ellipsis, so
 * that a wordy label from the model can never blow the drawing up.
 *
 * @param {string} text - the label
 * @param {number} maxWidth - the width the text may use
 * @param {number} fontSize - the font size in pixels
 * @returns {string[]} the lines, from the first to the last
 */
function wrapLabel(text, maxWidth, fontSize) {
  const source = String(text ?? '').trim();
  if (source === '') return [];
  const chars = Array.from(source);
  const lines = [];
  let line = '';
  let width = 0;
  let spaceAt = -1;
  let cut = false;
  for (let index = 0; index < chars.length; index += 1) {
    const ch = chars[index];
    const chWidth = charWidth(ch, fontSize);
    if (line !== '' && width + chWidth > maxWidth) {
      // The line is full: it breaks at the last space when there is one, so
      // that the word is not split in the middle.
      if (spaceAt > 0) {
        lines.push(line.slice(0, spaceAt).trimEnd());
        line = line.slice(spaceAt + 1);
        width = textWidth(line, fontSize);
        spaceAt = line.lastIndexOf(' ');
      } else {
        lines.push(line);
        line = '';
        width = 0;
        spaceAt = -1;
      }
      if (lines.length === MAX_LABEL_LINES) {
        cut = true;
        break;
      }
    }
    line += ch;
    width += chWidth;
    if (ch === ' ') spaceAt = line.length - 1;
  }
  if (!cut && line !== '') lines.push(line);
  if (cut) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = ellipsize(last, maxWidth, fontSize);
  }
  return lines;
}

/**
 * Measure the box of one node.
 *
 * The height of the box follows the number of lines, so a label that wraps
 * gets the room it needs.
 *
 * @param {string} label - the label of the node
 * @param {'root'|'branch'|'item'} kind - the kind of the node
 * @returns {{ lines: string[], width: number, height: number }} the box
 */
function measureBox(label, kind) {
  const fontSize = MIND_MAP_FONT_SIZE[kind];
  const maxWidth = MAX_WIDTH[kind];
  const lines = wrapLabel(label, maxWidth - 2 * PADDING_X, fontSize);
  const content = lines.reduce((max, line) => Math.max(max, textWidth(line, fontSize)), 0);
  const width = Math.min(maxWidth, Math.max(content + 2 * PADDING_X, 48));
  const height = 2 * PADDING_Y + lines.length * fontSize * LINE_HEIGHT_RATIO;
  return { lines, width, height };
}

/**
 * Read the branches of a tree, dropping what the map cannot show.
 *
 * A point without a text is no point at all, and a note that is longer than
 * the map can carry is cut. Both limits keep one bad answer from breaking
 * the drawing.
 *
 * @param {any} data - the tree the model returned
 * @param {number} maxBranches - the most branches to keep
 * @param {number} maxItems - the most points to keep in one branch
 * @returns {{ label: string, items: { label: string, note: string }[] }[]} the branches
 */
function normalizeBranches(data, maxBranches, maxItems) {
  const raw = Array.isArray(data?.branches) ? data.branches : [];
  const branches = [];
  for (const branch of raw.slice(0, maxBranches)) {
    const label = String(branch?.label ?? '').trim();
    const items = [];
    const rawItems = Array.isArray(branch?.items) ? branch.items : [];
    for (const item of rawItems) {
      const itemLabel = String(item?.label ?? '').trim();
      if (itemLabel === '') continue;
      items.push({
        label: itemLabel,
        note: String(item?.note ?? '').trim().slice(0, MAX_NOTE_LENGTH),
        // The place the point was found in the book, and the sentence it
        // came from. The host fills them in; a point without a place cannot
        // be jumped to.
        quote: typeof item?.quote === 'string' ? item.quote : '',
        target: typeof item?.target === 'number' ? item.target : -1,
      });
      if (items.length === maxItems) break;
    }
    if (label === '' && items.length === 0) continue;
    branches.push({ label, items });
  }
  return branches;
}

/**
 * Give every branch of one half of the circle a piece of it.
 *
 * The piece grows with the number of points the branch carries, because a
 * branch with six points needs more room than a branch with one. A branch
 * without points still gets the smallest piece, so that it is never lost.
 *
 * @param {object[]} group - the branches of one half
 * @param {number} axis - the horizontal direction of the half, 0 or 180
 * @returns {{ from: number, to: number }[]} the sectors, in degrees
 */
function allocateSectors(group, axis) {
  const weights = group.map((branch) => Math.max(1, branch.items.length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const room = 180 - group.length * MIN_SECTOR;
  let cursor = axis - 90;
  return group.map((branch, index) => {
    const span = MIN_SECTOR + (total === 0 ? 0 : room * (weights[index] / total));
    const sector = { from: cursor, to: cursor + span };
    cursor += span;
    return sector;
  });
}

/**
 * The point on the edge of a box that faces a target.
 *
 * A link has to start and end on the edge of the boxes it joins, otherwise
 * the line runs through the labels.
 *
 * @param {object} node - the box
 * @param {number} targetX - the x of the target
 * @param {number} targetY - the y of the target
 * @returns {{ x: number, y: number }} the point on the edge
 */
function edgePoint(node, targetX, targetY) {
  const centerX = node.x + node.w / 2;
  const centerY = node.y + node.h / 2;
  const dx = targetX - centerX;
  const dy = targetY - centerY;
  if (dx === 0 && dy === 0) return { x: centerX, y: centerY };
  const scaleX = dx === 0 ? Infinity : (node.w / 2) / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : (node.h / 2) / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: centerX + dx * scale, y: centerY + dy * scale };
}

/**
 * Round a number to a number of decimals.
 *
 * @param {number} value - the number
 * @param {number} [digits] - the decimals to keep
 * @returns {number} the rounded number
 */
function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * The curve that joins a parent to a child.
 *
 * The curve leaves the parent on the edge that faces the child and reaches
 * the child on the edge that faces the parent. The two control points are
 * pushed to one side, so the line bends instead of running straight.
 *
 * @param {object} parent - the parent box
 * @param {object} child - the child box
 * @param {number} [swing] - how far the curve bends away from the line
 * @returns {string} the path of the curve
 */
function linkPath(parent, child, swing = 0.3) {
  const start = edgePoint(parent, child.x + child.w / 2, child.y + child.h / 2);
  const end = edgePoint(child, parent.x + parent.w / 2, parent.y + parent.h / 2);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / distance;
  const uy = dy / distance;
  const bend = distance * 0.45;
  // The normal of the line; both control points use it, so the curve bends
  // towards the same side all the way.
  const nx = -uy * bend * swing;
  const ny = ux * bend * swing;
  const first = { x: start.x + ux * bend + nx, y: start.y + uy * bend + ny };
  const second = { x: end.x - ux * bend + nx, y: end.y - uy * bend + ny };
  return `M ${round(start.x)} ${round(start.y)} C ${round(first.x)} ${round(first.y)} ${round(second.x)} ${round(second.y)} ${round(end.x)} ${round(end.y)}`;
}

/**
 * Move the points apart so that no two boxes touch.
 *
 * The points of a branch stand in a column beside their branch; when the
 * branch owns a narrow sector, the column would overlap itself, so the
 * points are moved until they fit.
 *
 * @param {object[]} nodes - the points, in any order
 * @param {number} share - the part of the room the box above gives way
 */
function spreadVertical(nodes, share) {
  const gap = 8;
  const sorted = [...nodes].sort((a, b) => a.y - b.y);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    const needed = (previous.h + current.h) / 2 + gap;
    const deficit = needed - (current.y - previous.y);
    if (deficit <= 0) continue;
    // The room is shared: the column of a branch grows the way the arc goes,
    // while the map as a whole stays around its middle.
    previous.y -= deficit * share;
    current.y += deficit * (1 - share);
  }
}

/**
 * Count the pairs of boxes that overlap.
 *
 * The map uses the count to find out whether it needs more room: a map with
 * many points needs a wider ring than a map with few.
 *
 * @param {object[]} nodes - the boxes
 * @returns {number} the number of overlapping pairs
 */
function countCollisions(nodes) {
  let collisions = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const first = nodes[i];
      const second = nodes[j];
      const overlapX = Math.min(first.x + first.w, second.x + second.w) - Math.max(first.x, second.x);
      const overlapY = Math.min(first.y + first.h, second.y + second.h) - Math.max(first.y, second.y);
      if (overlapX > 1 && overlapY > 1) collisions += 1;
    }
  }
  return collisions;
}

/**
 * Draw a mind map.
 *
 * The tree is measured once, and the drawing follows: the radial map puts
 * the root in the middle of a circle, the tree puts it on the left with the
 * branches opening to the right, and the vertical tree puts it on top with
 * the branches opening downwards.
 *
 * @param {any} data - the tree: `{ title, branches: [{ label, items: [{ label, note }] }] }`
 * @param {object} [options] - the drawing options
 * @param {'radial'|'tree'|'vertical'} [options.layout] - the layout of the drawing
 * @param {number} [options.margin] - the room around the drawing, in pixels
 * @param {number} [options.maxBranches] - the most branches to draw
 * @param {number} [options.maxItems] - the most points in one branch
 * @returns {{ width: number, height: number, nodes: object[], links: object[] }} the drawing
 */
export function layoutMindMap(data, options = {}) {
  const margin = Number(options.margin ?? CANVAS_MARGIN);
  const maxBranches = Number(options.maxBranches ?? MAX_BRANCHES);
  const maxItems = Number(options.maxItems ?? MAX_ITEMS);
  const mode = MIND_MAP_LAYOUTS.includes(options.layout) ? options.layout : 'radial';
  const branches = normalizeBranches(data, maxBranches, maxItems);
  if (branches.length === 0) return { width: 0, height: 0, nodes: [], links: [] };

  const rootLabel = String(data?.title ?? '').trim();
  const model = {
    rootLabel,
    rootBox: measureBox(rootLabel, 'root'),
    branches,
    branchBoxes: branches.map((branch) => measureBox(branch.label, 'branch')),
    itemBoxes: branches.map((branch) => branch.items.map((item) => measureBox(item.label, 'item'))),
  };
  if (mode === 'radial') return layoutRadial(model, margin);
  return layoutTree(model, margin, mode === 'vertical' ? 'down' : 'right');
}

/**
 * Draw the map as a circle.
 *
 * The root sits in the middle of the canvas. The branches are placed on a
 * circle around it, and every branch owns a sector of that circle whose size
 * follows the number of points it carries. The points of a branch sit on an
 * outer arc inside that sector, on the side of the branch they belong to.
 *
 * The canvas is centred on the root and grows until the whole drawing fits
 * inside it with a margin.
 *
 * @param {object} model - the measured tree
 * @param {number} margin - the room around the drawing, in pixels
 * @returns {{ width: number, height: number, nodes: object[], links: object[] }} the drawing
 */
function layoutRadial(model, margin) {
  const { rootLabel, rootBox, branches, branchBoxes, itemBoxes } = model;

  // The two rings of the map: a branch stands outside the root, a point
  // stands outside its own branch. The outer ring leaves room for the width
  // of a branch as well, because a point that stands right above its branch
  // would otherwise touch it.
  const rootHalf = rootBox.width / 2;
  const branchHalf = branchBoxes.reduce((max, box) => Math.max(max, box.width / 2), 0);
  const itemHalf = itemBoxes
    .flat()
    .reduce((max, box) => Math.max(max, box.width / 2), 0);
  const baseBranch = rootHalf + branchHalf + NODE_GAP;
  const baseItem = baseBranch + branchHalf + itemHalf + NODE_GAP;

  // The branches are split over the two halves of the circle. The first half
  // of the branches keeps the right side, the rest keeps the left one, so
  // the order of the model is still the order around the circle.
  const half = Math.ceil(branches.length / 2);
  const groups = [
    { branch: branches.slice(0, half), axis: 0, side: 'right' },
    { branch: branches.slice(half), axis: 180, side: 'left' },
  ];

  /**
   * Put every box of the map on the two rings.
   *
   * @param {number} scale - how far the rings are moved outwards
   * @returns {{ nodes: object[], branchNodes: object[], itemGroups: object[], collisions: number }} the boxes
   */
  function place(scale) {
    const ringBranch = baseBranch * scale;
    const ringItem = baseItem * scale;
    // A point may only use the angles where the outer ring stands further
    // from the middle than the branch does, so that every point stays beyond
    // the branch it belongs to. The limit keeps the box of a point away from
    // the middle of the map, where it would cross into the other half.
    const limit = Math.acos(Math.min(1, (itemHalf + NODE_GAP) / ringItem)) * DEG;

    const nodes = [];
    const branchNodes = [];
    const itemGroups = [];
    let index = 0;
    for (const group of groups) {
      if (group.branch.length === 0) continue;
      const sectors = allocateSectors(group.branch, group.axis);
      group.branch.forEach((branch, position) => {
        const sector = sectors[position];
        const theta = (sector.from + sector.to) / 2;
        const box = branchBoxes[index];
        const centerX = ringBranch * Math.cos(theta * RAD);
        const centerY = ringBranch * Math.sin(theta * RAD);
        const branchNode = {
          id: `branch-${index}`,
          label: branch.label,
          note: '',
          kind: 'branch',
          x: centerX - box.width / 2,
          y: centerY - box.height / 2,
          w: box.width,
          h: box.height,
          side: group.side,
          lines: box.lines,
          quote: '',
          target: -1,
        };
        nodes.push(branchNode);
        branchNodes.push(branchNode);

        // The points of a branch live on the arc of the sector, but they keep
        // a little distance to the borders of the sector, so that the last
        // point of one branch and the first point of the next one do not land
        // on the same spot.
        const phi = theta - group.axis;
        const cone = Math.acos(Math.min(1, (1.1 * ringBranch / ringItem) * Math.cos(phi * RAD))) * DEG;
        const inset = Math.min(SECTOR_INSET, (sector.to - sector.from) * 0.12);
        let from = Math.max(sector.from - group.axis + inset, -cone, -limit);
        let to = Math.min(sector.to - group.axis - inset, cone, limit);
        if (from > to) {
          from = to = Math.max(-limit, Math.min(limit, phi));
        }
        const count = branch.items.length;
        const items = branch.items.map((item, itemIndex) => {
          const share = count === 1 ? 0.5 : itemIndex / (count - 1);
          const angle = (group.axis + from + (to - from) * share) * RAD;
          const itemBox = itemBoxes[index][itemIndex];
          return {
            id: `item-${index}-${itemIndex}`,
            label: item.label,
            note: item.note,
            kind: 'item',
            x: ringItem * Math.cos(angle) - itemBox.width / 2,
            y: ringItem * Math.sin(angle) - itemBox.height / 2,
            w: itemBox.width,
            h: itemBox.height,
            side: group.side,
            lines: itemBox.lines,
            quote: item.quote,
            target: item.target,
          };
        });
        // The points of a branch stand in a column beside their branch; the
        // column grows with the arc, so it never leaves the sector far
        // behind.
        spreadVertical(items, 0);
        items.forEach((item) => { nodes.push(item); });
        itemGroups.push({ branch: branchNode, items });
        index += 1;
      });
    }

    // Two branches may still reach into the same room when their sectors are
    // narrow. The points are swept from the top to the bottom once more, so
    // that no two boxes of the whole map touch.
    const points = nodes.filter((node) => node.kind === 'item');
    for (let round = 0; round < 3; round += 1) spreadVertical(points, 0.5);
    return { nodes, branchNodes, itemGroups, collisions: countCollisions(nodes) };
  }

  // A map with many points needs more room than a map with few, so the rings
  // are moved outwards until every box has found its place.
  let scale = 1;
  let placed = place(scale);
  for (let attempt = 0; attempt < 12 && placed.collisions > 0; attempt += 1) {
    scale *= 1.22;
    placed = place(scale);
  }
  const { nodes, branchNodes, itemGroups } = placed;

  const links = [];
  const root = {
    id: 'root',
    label: rootLabel,
    note: '',
    kind: 'root',
    x: -rootBox.width / 2,
    y: -rootBox.height / 2,
    w: rootBox.width,
    h: rootBox.height,
    side: null,
    lines: rootBox.lines,
    quote: '',
    target: -1,
  };
  nodes.unshift(root);

  // The canvas is centred on the root and grows until the whole drawing fits
  // inside it with a margin.
  let right = rootBox.width;
  let left = -rootBox.width;
  let bottom = rootBox.height;
  let top = -rootBox.height;
  for (const node of nodes) {
    right = Math.max(right, node.x + node.w);
    left = Math.min(left, node.x);
    bottom = Math.max(bottom, node.y + node.h);
    top = Math.min(top, node.y);
  }
  const halfWidth = Math.ceil(Math.max(right, -left) + margin);
  const halfHeight = Math.ceil(Math.max(bottom, -top) + margin);
  for (const node of nodes) {
    node.x = round(node.x + halfWidth, 2);
    node.y = round(node.y + halfHeight, 2);
  }

  // The links are drawn last, because the points may have moved and because
  // the canvas is only known once every box has found its place.
  for (const branchNode of branchNodes) {
    links.push({ from: root.id, to: branchNode.id, path: linkPath(root, branchNode) });
  }
  for (const group of itemGroups) {
    for (const item of group.items) {
      links.push({ from: group.branch.id, to: item.id, path: linkPath(group.branch, item) });
    }
  }

  return { width: halfWidth * 2, height: halfHeight * 2, nodes, links };
}

/**
 * Draw the map as a tree.
 *
 * The tree grows to the right or downwards. Every branch stands over the
 * points it owns, so that a branch always sits between the root and its
 * points, and the root stands in the middle of its branches.
 *
 * The canvas is built around the root: the root stands in the middle of the
 * cross axis, so a tree that opens downwards has its root in the middle of
 * the picture.
 *
 * @param {object} model - the measured tree
 * @param {number} margin - the room around the drawing, in pixels
 * @param {'right'|'down'} direction - where the tree grows
 * @returns {{ width: number, height: number, nodes: object[], links: object[] }} the drawing
 */
function layoutTree(model, margin, direction) {
  const { rootLabel, rootBox, branches, branchBoxes, itemBoxes } = model;
  const horizontal = direction === 'right';

  // The axis of the tree: every level stands at its own distance from the
  // root, and the widest box of a level decides that distance.
  const rootSize = horizontal ? rootBox.width : rootBox.height;
  const branchSize = branchBoxes.reduce(
    (max, box) => Math.max(max, horizontal ? box.width : box.height),
    0,
  );
  const branchOffset = rootSize + LEVEL_GAP;
  const itemOffset = branchOffset + branchSize + LEVEL_GAP;

  // The cross axis: the points of a branch stand in a block, and the branch
  // stands over its own block. A block is at least as big as the branch
  // itself, so two branches never reach into each other.
  const blocks = [];
  let cursor = 0;
  branches.forEach((branch, index) => {
    const boxes = itemBoxes[index];
    const pointsSize = boxes.reduce(
      (sum, box) => sum + (horizontal ? box.height : box.width),
      0,
    ) + Math.max(0, boxes.length - 1) * ITEM_GAP;
    const branchSizeCross = horizontal ? branchBoxes[index].height : branchBoxes[index].width;
    const blockSize = Math.max(branchSizeCross, pointsSize);
    blocks.push({
      cross: cursor + blockSize / 2,
      start: cursor + (blockSize - pointsSize) / 2,
    });
    cursor += blockSize + BLOCK_GAP;
  });
  const span = Math.max(0, cursor - BLOCK_GAP);

  const nodes = [];
  const links = [];

  /**
   * Put one box on the drawing.
   *
   * @param {object} node - the box
   * @param {number} axis - the place along the direction the tree grows
   * @param {number} cross - the place across it
   */
  const place = (node, axis, cross) => {
    if (horizontal) {
      node.x = axis;
      node.y = cross - node.h / 2;
    } else {
      node.y = axis;
      node.x = cross - node.w / 2;
    }
  };

  const root = {
    id: 'root',
    label: rootLabel,
    note: '',
    kind: 'root',
    x: 0,
    y: 0,
    w: rootBox.width,
    h: rootBox.height,
    side: null,
    lines: rootBox.lines,
    quote: '',
    target: -1,
  };
  // The root stands in the middle of the cross axis, so the drawing is
  // balanced around it.
  place(root, 0, span / 2);
  nodes.push(root);

  branches.forEach((branch, index) => {
    const box = branchBoxes[index];
    const branchNode = {
      id: `branch-${index}`,
      label: branch.label,
      note: '',
      kind: 'branch',
      x: 0,
      y: 0,
      w: box.width,
      h: box.height,
      side: horizontal ? 'right' : null,
      lines: box.lines,
      quote: '',
      target: -1,
    };
    place(branchNode, branchOffset, blocks[index].cross);
    nodes.push(branchNode);
    links.push({ from: root.id, to: branchNode.id, path: linkPath(root, branchNode, TREE_SWING) });

    let cross = blocks[index].start;
    branch.items.forEach((item, itemIndex) => {
      const itemBox = itemBoxes[index][itemIndex];
      const itemNode = {
        id: `item-${index}-${itemIndex}`,
        label: item.label,
        note: item.note,
        kind: 'item',
        x: 0,
        y: 0,
        w: itemBox.width,
        h: itemBox.height,
        side: horizontal ? 'right' : null,
        lines: itemBox.lines,
        quote: item.quote,
        target: item.target,
      };
      const itemCross = horizontal ? itemBox.height : itemBox.width;
      place(itemNode, itemOffset, cross + itemCross / 2);
      cross += itemCross + ITEM_GAP;
      nodes.push(itemNode);
      links.push({ from: branchNode.id, to: itemNode.id, path: linkPath(branchNode, itemNode, TREE_SWING) });
    });
  });

  // The canvas holds the whole tree. The cross axis is built around the
  // root, so the root stands exactly in the middle of it.
  let axisEnd = 0;
  let crossLow = span / 2;
  let crossHigh = span / 2;
  for (const node of nodes) {
    const axisStart = horizontal ? node.x : node.y;
    const axisSize = horizontal ? node.w : node.h;
    axisEnd = Math.max(axisEnd, axisStart + axisSize);
    const crossStart = horizontal ? node.y + node.h / 2 : node.x + node.w / 2;
    const crossEnd = horizontal ? node.y - node.h / 2 : node.x - node.w / 2;
    crossLow = Math.min(crossLow, crossEnd);
    crossHigh = Math.max(crossHigh, crossStart);
  }
  const crossMiddle = span / 2;
  const crossHalf = Math.max(crossMiddle - crossLow, crossHigh - crossMiddle);
  const axisSize = Math.ceil(axisEnd + margin * 2);
  const crossSize = Math.ceil(crossHalf * 2 + margin * 2);

  // The drawing moves into the canvas: the axis starts at the margin, and
  // the cross axis is built around the root.
  const shiftCross = margin + crossHalf - crossMiddle;
  for (const node of nodes) {
    if (horizontal) {
      node.x = round(node.x + margin, 2);
      node.y = round(node.y + shiftCross, 2);
    } else {
      node.y = round(node.y + margin, 2);
      node.x = round(node.x + shiftCross, 2);
    }
  }
  return {
    width: horizontal ? axisSize : crossSize,
    height: horizontal ? crossSize : axisSize,
    nodes,
    links,
  };
}

/**
 * The baseline of every line of a node.
 *
 * The view needs the same numbers as the layout, otherwise the text and the
 * box would drift apart.
 *
 * @param {object} node - a node of the layout
 * @returns {number[]} the baselines, from the first line to the last
 */
export function nodeBaselines(node) {
  const fontSize = MIND_MAP_FONT_SIZE[node.kind] ?? MIND_MAP_FONT_SIZE.item;
  const lineHeight = fontSize * LINE_HEIGHT_RATIO;
  const lines = node.lines ?? [];
  const top = node.y + (node.h - lines.length * lineHeight) / 2;
  return lines.map((line, index) => top + index * lineHeight + (lineHeight + fontSize * 0.72) / 2);
}

/**
 * The mind map panel.
 *
 * The map is shown in a wide modal, because a drawing needs more room than
 * the panels of the reader. While a new map is being made the old one stays
 * on the screen, so that the learner does not lose the picture he was
 * reading, and a failure is reported next to the map instead of over it.
 *
 * The learner can change the layout of the map without asking the model for
 * a new one: the same tree is drawn as a circle, as a tree or as a vertical
 * tree. Picking a node opens the bar at the foot of the panel, which can
 * take the learner back to the passage the node came from.
 *
 * @param {object} props
 * @param {Function} props.t - translator
 * @param {string} props.scope - what the map covers
 * @param {object|null} props.data - the tree the model returned
 * @param {boolean} props.loading - a new map is being made
 * @param {string} props.error - the reason the last attempt failed
 * @param {Function} props.onClose - close the panel
 * @param {Function} props.onRegenerate - ask for a new map
 * @param {Function} [props.onJump] - take the learner back to the passage of a node
 * @returns {any} the element tree
 */
export function MindMapView({ t, scope, data, loading, error, onClose, onRegenerate, onJump }) {
  useEffect(() => installStyles(), []);
  // The layout the learner picked; the map is only redrawn, never asked for
  // again, when it changes.
  const [mode, setMode] = useState('radial');
  // The node the learner picked. It lives in the panel, because only the
  // panel knows what is on the map.
  const [selectedId, setSelectedId] = useState(null);
  // A new map leaves the old pick behind: that node is not on the map any
  // more.
  useEffect(() => { setSelectedId(null); }, [data]);
  const layout = useMemo(() => layoutMindMap(data, { layout: mode }), [data, mode]);
  const selected = selectedId === null
    ? null
    : layout.nodes.find((node) => node.id === selectedId) ?? null;
  // A point can only be jumped to when the host found it in the book and
  // the host can jump.
  const canJump = typeof onJump === 'function'
    && selected !== null
    && typeof selected.target === 'number'
    && selected.target >= 0;

  const head = h(
    'div',
    { className: 'er-mm-head' },
    h(
      'span',
      { className: 'er-mm-scope' },
      scope === '' || scope === undefined || scope === null
        ? t('mindmap.scope')
        : `${t('mindmap.scope')}: ${scope}`,
    ),
    h(
      'div',
      { className: 'er-mm-switch', role: 'group', 'aria-label': t('mindmap.layout') },
      MIND_MAP_LAYOUTS.map((entry) => h(
        'button',
        {
          key: entry,
          type: 'button',
          className: `er-mm-switch-item${mode === entry ? ' is-active' : ''}`,
          'aria-pressed': mode === entry,
          onClick: () => { setMode(entry); },
        },
        t(`mindmap.layout${entry.charAt(0).toUpperCase()}${entry.slice(1)}`),
      )),
    ),
    h(
      'div',
      { className: 'er-mm-actions' },
      h(
        'button',
        { type: 'button', className: 'er-btn', onClick: () => { onRegenerate?.(); } },
        t('mindmap.generate'),
      ),
    ),
  );

  const failure = error
    ? h(
      'div',
      { className: 'er-mm-error', role: 'alert' },
      h('span', { className: 'er-mm-error-title' }, t('mindmap.error')),
      h('span', {}, error),
    )
    : null;

  const status = loading
    ? h('div', { className: 'er-mm-status is-loading', role: 'status' }, t('mindmap.generating'))
    : null;

  const drawing = layout.nodes.length === 0
    ? h(
      'div',
      { className: 'er-mm-empty' },
      h('div', { className: 'er-mm-empty-title' }, t('mindmap.empty')),
      h('div', { className: 'er-mm-empty-hint' }, t('mindmap.emptyHint')),
    )
    : h(
      'svg',
      {
        className: 'er-mm-canvas',
        viewBox: `0 0 ${layout.width} ${layout.height}`,
        role: 'img',
        'aria-label': t('mindmap.title'),
      },
      h(
        'g',
        { className: 'er-mm-links' },
        layout.links.map((link) => h('path', {
          key: `${link.from}>${link.to}`,
          className: 'er-mm-link',
          d: link.path,
        })),
      ),
      layout.nodes.map((node) => {
        const baselines = nodeBaselines(node);
        const isSelected = selectedId === node.id;
        return h(
          'g',
          {
            key: node.id,
            className: `er-mm-node is-${node.kind}${isSelected ? ' is-selected' : ''}`,
            role: 'button',
            tabIndex: 0,
            'aria-pressed': isSelected,
            onClick: () => { setSelectedId(node.id); },
            onKeyDown: (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              setSelectedId(node.id);
            },
          },
          h(
            'rect',
            {
              className: 'er-mm-box',
              x: node.x,
              y: node.y,
              width: node.w,
              height: node.h,
              rx: 10,
              ry: 10,
            },
            node.note === '' ? null : h('title', {}, node.note),
          ),
          (node.lines ?? []).map((line, lineIndex) => h(
            'text',
            {
              key: lineIndex,
              className: 'er-mm-label',
              x: node.x + node.w / 2,
              y: baselines[lineIndex],
              // The drawing carries its own size and anchor, so that it still
              // reads well before the stylesheet of the module is in place.
              fontSize: MIND_MAP_FONT_SIZE[node.kind] ?? MIND_MAP_FONT_SIZE.item,
              fontWeight: node.kind === 'root' ? 600 : 'normal',
              textAnchor: 'middle',
              style: { pointerEvents: 'none' },
            },
            line,
          )),
        );
      }),
    );

  const bar = h(
    'div',
    { className: 'er-mm-bar' },
    selected === null
      ? h('span', { className: 'er-mm-bar-hint' }, t('mindmap.jumpHint'))
      : h(
        'span',
        { className: 'er-mm-bar-label' },
        selected.label,
        selected.quote ? h('span', { className: 'er-mm-bar-quote' }, selected.quote) : null,
      ),
    canJump
      ? h(
        'button',
        {
          type: 'button',
          className: 'er-btn er-btn-primary',
          onClick: () => { onJump(selected); },
        },
        t('mindmap.jump'),
      )
      : selected === null
        ? null
        : h('span', { className: 'er-mm-bar-hint' }, t('mindmap.jumpMissing')),
  );

  return h(
    Modal,
    { title: t('mindmap.title'), onClose, size: 'wide' },
    h('div', { className: 'er-mm' }, head, failure, status, drawing, bar),
  );
}
