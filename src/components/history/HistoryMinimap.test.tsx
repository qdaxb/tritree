import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SessionState } from "@/lib/domain";
import { HistoryMinimap } from "./HistoryMinimap";

const state: SessionState = {
  rootMemory: {
    id: "root-1",
    preferences: {
      seed: "A seed idea",
      domains: ["AI"],
      tones: ["clear"],
      styles: ["visual"],
      personas: ["builder"]
    },
    summary: "AI builder",
    learnedSummary: "Learns from choices",
    createdAt: "2026-04-25T00:00:00.000Z",
    updatedAt: "2026-04-25T00:00:00.000Z"
  },
  session: {
    id: "session-1",
    title: "Treeable session",
    status: "active",
    currentNodeId: "node-1",
    createdAt: "2026-04-25T00:00:00.000Z",
    updatedAt: "2026-04-25T00:00:00.000Z"
  },
  currentNode: null,
  currentDraft: null,
  nodeDrafts: [],
  selectedPath: [
    {
      id: "node-1",
      sessionId: "session-1",
      parentId: null,
      roundIndex: 1,
      roundIntent: "Choose a direction",
      options: [],
      selectedOptionId: null,
      foldedOptions: [],
      createdAt: "2026-04-25T00:00:00.000Z"
    }
  ],
  foldedBranches: [
    {
      id: "branch-1",
      nodeId: "node-1",
      option: {
        id: "b",
        label: "Other branch",
        description: "A folded path",
        impact: "Kept for later",
        kind: "reframe"
      },
      createdAt: "2026-04-25T00:00:00.000Z"
    }
  ],
  publishPackage: null
};

describe("HistoryMinimap", () => {
  it("renders selected rounds and folded branches", () => {
    render(<HistoryMinimap state={state} />);

    expect(screen.getByText("第 1 轮")).toBeInTheDocument();
    expect(screen.getByText("Other branch")).toBeInTheDocument();
  });
});
