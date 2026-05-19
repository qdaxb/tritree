export type SubagentTemplate = {
  id: string;
  title: string;
  description: string;
  expectedOutput: string;
  prompt: string;
};

export const DEFAULT_SUBAGENT_TEMPLATES: SubagentTemplate[] = [
  {
    id: "material-search",
    title: "搜索资料",
    description: "Quickly find usable material, source leads, and factual support points for the assigned topic.",
    expectedOutput:
      "A material list. Each item should include source, key point, usable angle, credibility note, and advice on how the main agent can use it.",
    prompt:
      "You are the material-search subagent. Focus on the task topic and find information leads that can be verified, cited, and transformed into content material. Output a material list and usage advice. Leave decisions about whether to continue, generate, rewrite, or close the task to the main agent."
  }
];

export function getSubagentTemplate(
  id: string,
  templates: SubagentTemplate[] = DEFAULT_SUBAGENT_TEMPLATES
) {
  return templates.find((template) => template.id === id);
}

export function formatSubagentTemplateSummaries(
  templates: SubagentTemplate[] = DEFAULT_SUBAGENT_TEMPLATES
) {
  return templates
    .map(
      (template) =>
        `${template.id} | ${template.title}: ${template.description} Expected output: ${template.expectedOutput}`
    )
    .join("\n");
}
