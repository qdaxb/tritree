import { Maximize2 } from "lucide-react";

export function TreeZoomTrigger() {
  return (
    <div
      aria-hidden="true"
      className="tree-zoom-trigger"
    >
      <Maximize2 aria-hidden="true" size={15} strokeWidth={2.35} />
      <span>点击展开树图</span>
    </div>
  );
}
