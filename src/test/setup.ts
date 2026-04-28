import "@testing-library/jest-dom/vitest";

if (typeof Range !== "undefined") {
  Range.prototype.getClientRects ??= function getClientRects() {
    return [] as unknown as DOMRectList;
  };

  Range.prototype.getBoundingClientRect ??= function getBoundingClientRect() {
    return new DOMRect(0, 0, 0, 0);
  };
}
