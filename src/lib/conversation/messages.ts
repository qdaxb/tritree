import type { ConversationNode } from "@/lib/domain";

export type MastraConversationMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export function buildMastraMessagesFromPath(path: ConversationNode[]): MastraConversationMessage[] {
  return path.flatMap((node) => {
    if (node.role === "tool") {
      return [];
    }

    return {
      role: node.role,
      content: node.content
    };
  });
}

export function latestConversationNodeId(nodes: ConversationNode[]) {
  return nodes.at(-1)?.id ?? null;
}
