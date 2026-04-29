import type { ConversationNode } from "@/lib/domain";

export type MastraConversationMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export function buildMastraMessagesFromPath(path: ConversationNode[]): MastraConversationMessage[] {
  return path.map((node) => ({
    role: node.role,
    content: node.content
  }));
}

export function latestConversationNodeId(nodes: ConversationNode[]) {
  return nodes.at(-1)?.id ?? null;
}
