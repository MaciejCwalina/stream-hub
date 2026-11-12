"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useDragEdgeScroll;
var _util = require("@rc-component/util");
var React = _interopRequireWildcard(require("react"));
var _useScrollDrag = require("./useScrollDrag");
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
/**
 * The mouse-drag path in `useScrollDrag` runs on `mousemove`, which the browser
 * does not fire during a native HTML5 drag — and it deliberately skips
 * draggable targets so it never fights the native drag. So when a consumer
 * (e.g. a draggable Tree) drags a node toward the edge of a virtual list, the
 * container is `overflow: hidden`, the browser's native drag-to-edge autoscroll
 * is disabled, and nothing scrolls.
 *
 * Drive the edge scrolling from the native drag events instead. `dragover` only
 * fires while a drag is in progress, so no extra "is dragging" flag is needed:
 * the listeners can stay mounted and simply do nothing until a drag happens.
 */
function useDragEdgeScroll(inVirtual, componentRef, height, itemHeight, onScrollOffset) {
  const onScrollOffsetRef = React.useRef(onScrollOffset);
  onScrollOffsetRef.current = onScrollOffset;
  React.useEffect(() => {
    const ele = componentRef.current;
    if (!inVirtual || !ele || !height) {
      return;
    }

    // `height / 4` caps each band so the top and bottom never overlap on short
    // containers (an idle zone always remains in the middle); `itemHeight * 1.2`
    // keeps a roughly one-row band otherwise.
    const edgeThreshold = Math.min(itemHeight * 1.2, height / 4);
    let rafId = null;
    let offset = 0;
    const stopScroll = () => {
      if (rafId !== null) {
        _util.raf.cancel(rafId);
        rafId = null;
      }
      offset = 0;
    };
    const scrollFrame = () => {
      onScrollOffsetRef.current(offset);
      rafId = (0, _util.raf)(scrollFrame);
    };
    const continueScroll = () => {
      // `0` happens when the pointer sits exactly on the band boundary; spinning
      // the loop for a no-op would fire a scroll callback on every frame.
      if (offset === 0) {
        stopScroll();
        return;
      }
      if (rafId === null) {
        rafId = (0, _util.raf)(scrollFrame);
      }
    };
    const onDragOver = e => {
      // Skip if a nested virtual List already handled this event, the same way
      // `useScrollDrag` does on `mousedown`: a nested List's `dragover` bubbles
      // to both holders and only the innermost one should scroll.
      const event = e;
      if (event._virtualHandled) {
        // A nested list took this event over. Stop our own loop first: it may
        // already be running from an earlier `dragover` near our edge, and
        // `dragleave` will not fire while the pointer stays inside our element.
        stopScroll();
        return;
      }
      // `dragover` keeps firing while the drag lasts, so mark each event: the
      // innermost holder sees it first and the outer ones bail out above.
      event._virtualHandled = true;
      const {
        top,
        bottom
      } = ele.getBoundingClientRect();
      const {
        clientY
      } = e;
      if (clientY <= top + edgeThreshold) {
        offset = -(0, _useScrollDrag.smoothScrollOffset)(top + edgeThreshold - clientY);
        continueScroll();
      } else if (clientY >= bottom - edgeThreshold) {
        offset = (0, _useScrollDrag.smoothScrollOffset)(clientY - (bottom - edgeThreshold));
        continueScroll();
      } else {
        stopScroll();
      }
    };
    const onDragLeave = e => {
      const related = e.relatedTarget;
      if (!related || !ele.contains(related)) {
        stopScroll();
      }
    };
    const ownerDocument = ele.ownerDocument;

    // `dragover` / `dragleave` need the container rect, so listen on it.
    // `drop` / `dragend` are listened on the document in the CAPTURE phase: a
    // consumer's node may stop their propagation in the bubble phase (rc-tree's
    // `TreeNode` does), so capture is the only reliable place to see the drag
    // ending.
    ele.addEventListener('dragover', onDragOver);
    ele.addEventListener('dragleave', onDragLeave);
    ownerDocument.addEventListener('drop', stopScroll, true);
    ownerDocument.addEventListener('dragend', stopScroll, true);
    return () => {
      stopScroll();
      ele.removeEventListener('dragover', onDragOver);
      ele.removeEventListener('dragleave', onDragLeave);
      ownerDocument.removeEventListener('drop', stopScroll, true);
      ownerDocument.removeEventListener('dragend', stopScroll, true);
    };
  }, [inVirtual, height, itemHeight]);
}