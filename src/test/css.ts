import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const CSS_IMPORT_PATTERN = /^@import\s+(?:url\()?["'](?<path>[^"']+)["']\)?;[ \t]*(?:\r?\n)?/gm;

export function readGlobalCss() {
  return readCssWithImports(resolve(process.cwd(), "src/app/globals.css"), new Set<string>());
}

function readCssWithImports(filePath: string, seen: Set<string>): string {
  const resolvedPath = resolve(filePath);

  if (seen.has(resolvedPath)) {
    return "";
  }

  seen.add(resolvedPath);

  return readFileSync(resolvedPath, "utf8").replace(CSS_IMPORT_PATTERN, (statement, importPath: string) => {
    if (!importPath.startsWith(".")) {
      return statement;
    }

    return readCssWithImports(resolve(dirname(resolvedPath), importPath), seen);
  });
}
