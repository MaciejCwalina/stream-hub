import * as React from 'react';
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
export default function useDragEdgeScroll(inVirtual: boolean, componentRef: React.RefObject<HTMLElement>, height: number, itemHeight: number, onScrollOffset: (offset: number) => void): void;
