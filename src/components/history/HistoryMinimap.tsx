"use client";

import type { SessionState } from "@/lib/domain";

export function HistoryMinimap({ state }: { state: SessionState | null }) {
  return (
    <div className="history-minimap" aria-label="历史路径地图">
      <div className="minimap-title">历史路径</div>
      {state ? (
        <div className="minimap-track">
          {state.selectedPath.map((node) => (
            <div className="minimap-node" key={node.id}>
              <span className="minimap-dot" />
              <span>第 {node.roundIndex} 轮</span>
            </div>
          ))}
          {state.foldedBranches.length > 0 ? (
            <div className="folded-list">
              {state.foldedBranches.map((branch) => (
                <span key={branch.id}>{branch.option.label}</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <span className="minimap-empty">第一组三个方向出现后，你的选择路径会出现在这里。</span>
      )}
    </div>
  );
}
