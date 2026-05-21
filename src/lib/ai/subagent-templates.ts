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
    description: "Quickly find usable material, source URLs, and factual support points for the assigned topic.",
    expectedOutput:
      "A material list. Every source-backed item should include source, source_url, key point, usable angle, credibility note, and advice on how the main agent can use it. Preserve original URLs so the main agent can pass them to show_process_data items[].url.",
    prompt:
      "You are the material-search subagent. Focus on the task topic and find information leads that can be verified, cited, and transformed into content material. Output a material list and usage advice. Every source-backed item must include the source name and original source_url, not only source names or URLs hidden inside prose. Make each item easy for the main agent to map into show_process_data, with the summary as items[].subtitle and the original source_url as items[].url. If you cannot find a URL for a claim, label it as a clue/open item rather than a sourced item. Leave decisions about whether to continue, generate, rewrite, or close the task to the main agent."
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
