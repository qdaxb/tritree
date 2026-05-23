export function TreeOperationHint({
  isExpanded,
  onToggle
}: {
  isExpanded: boolean;
  onToggle: () => void;
}) {
  if (!isExpanded) {
    return (
      <div aria-label="树图说明" className="tree-operation-hint tree-operation-hint--collapsed" role="note">
        <button
          aria-expanded="false"
          aria-label="展开树图说明"
          className="tree-operation-hint__toggle"
          onClick={onToggle}
          type="button"
        >
          树图说明
        </button>
      </div>
    );
  }

  return (
    <div aria-label="树图说明" className="tree-operation-hint" role="note">
      <div className="tree-operation-hint__header">
        <strong className="tree-operation-hint__title">树图说明</strong>
        <button
          aria-expanded="true"
          aria-label="收起树图说明"
          className="tree-operation-hint__toggle"
          onClick={onToggle}
          type="button"
        >
          收起
        </button>
      </div>
      <div className="tree-operation-hint__body">
        <p>画布中每个节点代表创作过程中的快照。</p>
        <p>点击节点可以切换到对应的历史快照版本。</p>
        <p>拖动画布空白处可以查看前后的分支。</p>
      </div>
    </div>
  );
}
