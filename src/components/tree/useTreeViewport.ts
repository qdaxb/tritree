import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState
} from "react";
import type { OptionBranchLayout } from "./types";

type UseTreeViewportArgs = {
  branchLayout: OptionBranchLayout;
  canvasWidth: number;
  isCompactTreeOverview: boolean;
  isMobileLayout: boolean;
  nodeId: string | null;
  onOpenTree?: () => void;
  pendingBranchNodeId?: string | null;
};

export function useTreeCanvasMeasurement() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(760);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    setCanvasWidth(element.clientWidth || 760);
    if (typeof ResizeObserver === "undefined") return;

    const resizeObserver = new ResizeObserver(([entry]) => {
      setCanvasWidth(entry.contentRect.width);
    });
    resizeObserver.observe(element);

    return () => resizeObserver.disconnect();
  }, []);

  return { canvasWidth, containerRef };
}

export function useTreeViewport({
  branchLayout,
  canvasWidth,
  isCompactTreeOverview,
  isMobileLayout,
  nodeId,
  onOpenTree,
  pendingBranchNodeId
}: UseTreeViewportArgs) {
  const treeViewportRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    captured: boolean;
    didDrag: boolean;
    pointerId: number;
    scrollLeft: number;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressNextClickRef = useRef(false);
  const [isDraggingTree, setIsDraggingTree] = useState(false);
  const isTreeScrollable = branchLayout.width > canvasWidth + 1;
  const shouldShowTreeScrollControls = !isCompactTreeOverview && isTreeScrollable;

  useEffect(() => {
    if (isCompactTreeOverview) return;

    if (isMobileLayout) {
      scrollTreeToRoot("auto");
      return;
    }

    scrollTreeToLatest("auto");
  }, [branchLayout.height, branchLayout.width, isCompactTreeOverview, isMobileLayout, nodeId, pendingBranchNodeId]);

  function scrollTreeToRoot(behavior: ScrollBehavior = "smooth") {
    const viewport = treeViewportRef.current;
    if (!viewport) return;

    const top = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2);
    if (typeof viewport.scrollTo === "function") {
      viewport.scrollTo({ behavior, left: 0, top });
      return;
    }

    viewport.scrollLeft = 0;
    viewport.scrollTop = top;
  }

  function scrollTreeToLatest(behavior: ScrollBehavior = "smooth") {
    const viewport = treeViewportRef.current;
    if (!viewport) return;

    const left = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const top = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2);
    if (typeof viewport.scrollTo === "function") {
      viewport.scrollTo({ behavior, left, top });
      return;
    }

    viewport.scrollLeft = left;
    viewport.scrollTop = top;
  }

  function scrollTreeBy(deltaX: number, deltaY: number) {
    const viewport = treeViewportRef.current;
    if (!viewport) return;

    if (typeof viewport.scrollBy === "function") {
      viewport.scrollBy({ behavior: "smooth", left: deltaX, top: deltaY });
      return;
    }

    viewport.scrollLeft += deltaX;
    viewport.scrollTop += deltaY;
  }

  function handleTreeViewportKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (isCompactTreeOverview) return;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      scrollTreeBy(-180, 0);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      scrollTreeBy(180, 0);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      treeViewportRef.current?.scrollTo({ behavior: "smooth", left: 0 });
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      scrollTreeToLatest();
    }
  }

  function handleTreeViewportPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (isCompactTreeOverview) return;

    const viewport = treeViewportRef.current;
    if (!viewport || event.button !== 0) return;
    if (isClickableTreePointerTarget(event.target)) return;

    dragStateRef.current = {
      captured: false,
      didDrag: false,
      pointerId: event.pointerId,
      scrollLeft: viewport.scrollLeft,
      startX: event.clientX,
      startY: event.clientY
    };
  }

  function handleTreeViewportPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const viewport = treeViewportRef.current;
    const dragState = dragStateRef.current;
    if (!viewport || !dragState || dragState.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    if (!dragState.didDrag) {
      if (absX <= 3 && absY <= 3) return;
      if (absY > absX) {
        dragStateRef.current = null;
        setIsDraggingTree(false);
        return;
      }
      dragState.didDrag = true;
      setIsDraggingTree(true);
      if (!dragState.captured && typeof event.currentTarget.setPointerCapture === "function") {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragState.captured = true;
      }
    }
    viewport.scrollLeft = dragState.scrollLeft - deltaX;
    event.preventDefault();
  }

  function finishTreeViewportDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    suppressNextClickRef.current = dragState.didDrag;
    dragStateRef.current = null;
    setIsDraggingTree(false);
    if (dragState.captured && typeof event.currentTarget.releasePointerCapture === "function") {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleTreeViewportClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
    if (!suppressNextClickRef.current) return;
    suppressNextClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  function handleTreeViewportClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!isCompactTreeOverview || !onOpenTree) return;
    event.preventDefault();
    event.stopPropagation();
    onOpenTree();
  }

  return {
    finishTreeViewportDrag,
    handleTreeViewportClick,
    handleTreeViewportClickCapture,
    handleTreeViewportKeyDown,
    handleTreeViewportPointerDown,
    handleTreeViewportPointerMove,
    isDraggingTree,
    scrollTreeBy,
    scrollTreeToLatest,
    shouldShowTreeScrollControls,
    treeViewportRef
  };
}

function isClickableTreePointerTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(".tree-node--clickable"));
}
