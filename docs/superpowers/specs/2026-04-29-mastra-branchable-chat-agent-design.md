# Mastra Branchable Chat Agent Design

## Goal

Tritree should become a normal writing-agent conversation first, with tree navigation and three-option suggestions as additive capabilities. A user should be able to ignore suggestions entirely and still use the product like a standard writing assistant. When suggestions are enabled, picking one should be equivalent to typing that text as the next user message.

## Core Model

The primary conversation is a branchable chat transcript:

- `system` messages define Tritree and writing-agent behavior.
- `user` messages represent typed input, selected suggestions, custom directions, and accepted user edits.
- `assistant` messages represent the Writing Agent's replies.
- `tool` messages represent tool or MCP results when the framework exposes them as messages.

The tree is a projection of this transcript. A node can point to any previous user or assistant state. Branching from a previous state means rebuilding the message prefix from the root to that state and appending a new user message. Sibling branches are not included in the rebuilt prefix.

Three-option suggestions are not part of the main transcript. They are metadata attached to the latest assistant node until the user picks one. Only the picked suggestion becomes a real `user` message.

## Agent Architecture

Tritree will use Mastra as the execution framework with two agents:

### Writing Agent

The Writing Agent is the primary flow. It responds to real user messages and owns content generation.

Responsibilities:

- Continue, rewrite, polish, explain, or structure writing based on the user's message.
- Use enabled skills as writing behavior and style guidance.
- Use long-term memory for user preferences, recurring topics, and style habits.
- Call execution tools and MCP tools when the user's request requires external data or transformation.
- Produce the assistant reply that is saved into the main conversation tree.

The Writing Agent may use read-only and execution tools, including MCP tools, subject to the product's permission model.

### Suggestion Agent

The Suggestion Agent is an input-assistance layer. It generates three possible next user messages after a Writing Agent reply.

Responsibilities:

- Read the same conversation prefix as the Writing Agent plus the latest assistant reply.
- Read enabled skill summaries, available skill summaries, long-term memory summaries, and available tool/MCP capability summaries.
- Generate three distinct next-step user messages that the user can click directly.
- Keep suggestions at the level of user intent, not assistant output.

The Suggestion Agent must not generate draft content, update memory, call tools with side effects, or mutate conversation state. It may use read-only context tools such as listing skills, retrieving skill summaries, searching memory summaries, and listing available tool descriptions. In many runs, the Context Builder can inject this information directly so the Suggestion Agent does not need tools at all.

## Shared Context

Both agents receive a shared context snapshot built by Tritree. The snapshot is explicit and does not depend on automatic short-term memory.

The shared context includes:

- Product identity and current workspace/session identifiers.
- Root memory and learned memory summary.
- Retrieved long-term memory relevant to the current conversation prefix.
- Enabled skills, including title, description, and prompt.
- Available but inactive skill summaries when useful for suggestions.
- Available tool and MCP capability summaries.
- Current branch path from root to target node.
- Current output mode and task-specific constraints.

The agents share common product context but not the same complete system prompt. Common context is reused, while task instructions are separate:

- Writing instructions tell the agent to respond to the user's request.
- Suggestion instructions tell the agent to generate candidate next user messages.

This prevents suggestions from being written as assistant replies and prevents assistant replies from becoming menus.

## Main Message Replay

When calling the Writing Agent from a target node:

1. Tritree resolves the path from the transcript root to the target node.
2. Tritree converts each persisted conversation event into a Mastra-compatible message.
3. Tritree prepends the shared system and context messages.
4. Tritree appends the pending user message.
5. Mastra streams the Writing Agent result.
6. Tritree saves the assistant result as a child of the pending user message.
7. Tritree optionally calls the Suggestion Agent and saves suggestions as metadata on the assistant node.

The rebuilt path is authoritative. Mastra's persistent memory must not be used as the source of branch path history, because the same session can have multiple valid futures. Long-term memory may still be retrieved and injected separately.

## Conversation Events

The persisted event model should be general enough for a normal chat assistant:

```ts
type ConversationRole = "system" | "user" | "assistant" | "tool";

type ConversationNode = {
  id: string;
  parentId: string | null;
  sessionId: string;
  role: ConversationRole;
  content: ConversationContent;
  metadata: ConversationMetadata;
  createdAt: string;
};

type ConversationMetadata = {
  source:
    | "system"
    | "user_typed"
    | "suggestion_pick"
    | "custom_direction"
    | "user_edit"
    | "ai_reply"
    | "tool_result";
  toolCalls?: ToolCallRecord[];
  toolResults?: ToolResultRecord[];
  skillsUsed?: string[];
  suggestions?: SuggestedUserMove[];
  targetNodeId?: string;
};

type SuggestedUserMove = {
  id: "a" | "b" | "c";
  label: string;
  message: string;
  rationale?: string;
};
```

`ConversationContent` can start as plain text plus structured metadata for edits and tool results. The model should not require every assistant reply to be a draft object or every assistant node to contain three options.

## User Input Cases

### Typed Input

Typed input is saved as a normal user node:

```text
role: user
source: user_typed
content: 今天天气不错
```

The Writing Agent receives the rebuilt prefix plus this message and returns a normal assistant reply.

### Suggestion Pick

A suggestion pick is saved as a normal user node with provenance:

```text
role: user
source: suggestion_pick
content: 代入实际天气
metadata:
  suggestionId: b
```

The Writing Agent should treat it the same as typed text. If the selected message implies external data, such as actual weather, the Writing Agent may call the relevant skill or MCP tool.

### Custom Direction

A custom direction is also a normal user node:

```text
role: user
source: custom_direction
content: 换成更像朋友圈的语气
```

It is not a separate generation path. It is simply the next user message in the branch.

### User Edit

A user edit is represented as a user message that establishes an edited assistant text as authoritative:

```text
role: user
source: user_edit
content:
  我把上一版改成以下版本，请以后面的内容为准继续：

  ---
  edited text
  ---
```

The Writing Agent should preserve the edited text unless the user later asks to change it. If the edit is saved as a new branch state without requiring an immediate assistant reply, Tritree can still call the Suggestion Agent to attach next-step suggestions to the edited state.

### Tool Use

Tool use belongs to the Writing Agent. When the framework exposes tool calls and results, Tritree should persist them either as separate `tool` nodes or as assistant metadata. The choice should follow Mastra's stream/message format and keep replay deterministic.

The Suggestion Agent can mention a tool-backed next step, such as "查询实际天气后代入这段", but it should not perform the query itself. The query only happens if the user selects or types that instruction and the Writing Agent decides to call the tool.

## Suggestion Output

The Suggestion Agent returns structured metadata only:

```ts
type SuggestionOutput = {
  suggestions: [
    SuggestedUserMove,
    SuggestedUserMove,
    SuggestedUserMove
  ];
};
```

Each suggestion must be directly usable as a next user message. Labels are compact UI text; `message` is the actual user input that will be appended if selected.

Example:

```json
{
  "suggestions": [
    {
      "id": "a",
      "label": "继续补写氛围",
      "message": "继续补写这个天气带来的心情和画面。"
    },
    {
      "id": "b",
      "label": "代入实际天气",
      "message": "查询并代入我所在地的实际天气。"
    },
    {
      "id": "c",
      "label": "改成朋友圈语气",
      "message": "把这段改得更像一条自然的朋友圈。"
    }
  ]
}
```

## Mastra Integration

Mastra should replace the current direct provider fetch layer.

Initial Mastra components:

- `writingAgent`: primary writing conversation agent.
- `suggestionAgent`: next-user-message suggestion agent.
- `contextBuilder`: Tritree-owned adapter that builds shared context and replay messages.
- `toolsetProvider`: prepares Writing Agent tools and Suggestion Agent read-only tools.
- `memoryProvider`: retrieves long-term memory summaries and later connects to Mastra memory storage.

Both agents can use Mastra structured output:

- Writing Agent can begin with plain streaming text for chat replies, then later support structured artifacts where useful.
- Suggestion Agent should use a Zod structured output schema for exactly three suggestions.

If the current UI still expects draft and option concepts during migration, adapters can map assistant text and suggestion metadata back into the existing UI. The target architecture should not require assistant replies to produce options.

## Memory And Skills

Path history and long-term memory are separate:

- Path history is rebuilt from the conversation tree.
- Long-term memory stores durable user preferences, recurring topics, personal facts, and style habits.

Skills should be available to both agents as context:

- Writing Agent receives full enabled skill prompts and can apply them while generating content.
- Suggestion Agent receives enabled skill summaries and selected prompt details when needed to propose useful next moves.
- Available but inactive skills can be summarized for Suggestion Agent so it can suggest enabling or applying a style, but the Writing Agent should only apply skills that are enabled or explicitly requested by the user.

## Error Handling

If the Writing Agent fails, Tritree should preserve the current branch state and show a retryable error. No assistant node should be saved unless a valid assistant response was produced.

If the Suggestion Agent fails, Tritree should still save and display the Writing Agent reply. Suggestions are additive metadata, so failure to generate them must not block the main writing flow.

If tool execution fails inside the Writing Agent, the final assistant reply should explain the failure when possible. Tool failures should be persisted in metadata or tool nodes so replay and debugging remain possible.

## Testing Strategy

Tests should cover:

- Rebuilding a message prefix from root to any user or assistant node.
- Excluding sibling branch messages from replay.
- Treating typed input, suggestion picks, custom directions, and user edits as normal user turns.
- Saving suggestions as assistant metadata rather than transcript messages.
- Converting a picked suggestion into a real user message.
- Keeping Writing Agent failure from creating partial assistant nodes.
- Keeping Suggestion Agent failure from blocking the assistant reply.
- Passing enabled skill context to both agents with different task instructions.
- Making execution tools available only to Writing Agent and read-only context tools available to Suggestion Agent.

## Rollout

The migration should be incremental:

1. Introduce Mastra dependencies and agent definitions behind the current AI boundary.
2. Add a general conversation node/message replay model while preserving existing draft data.
3. Replace direct provider calls for assistant replies with `writingAgent`.
4. Add `suggestionAgent` and persist suggestions as metadata.
5. Convert current three-option UI to submit selected suggestions as normal user messages.
6. Add MCP toolsets and read-only context tools.
7. Expand memory from current root/learned summaries to durable long-term memory.

The first implementation should favor correctness of the conversation model over feature breadth. Three-option suggestions should remain removable without degrading the writing-agent flow.
