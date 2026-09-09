export interface ExecutableContract {
  page?: {
    roots?: Array<{ path?: unknown }>;
  };
}

export function executablePageRoots(document: ExecutableContract): string[] {
  const declaredRoots = document.page?.roots ?? [];
  const roots = declaredRoots
    .map((entry) => entry.path)
    .filter(
      (value): value is string =>
        typeof value === "string" && /^[a-z0-9][a-z0-9_-]*$/.test(value) && !value.includes("/"),
    );
  if (roots.length === 0 || roots.length !== declaredRoots.length) {
    throw new Error("contract page.roots must contain only non-empty top-level relative paths");
  }
  return [...new Set(roots)];
}

export function isExecutablePagePath(vaultRelativePath: string, pageRoots: string[]): boolean {
  const root = vaultRelativePath.split("/")[0];
  return root !== undefined && pageRoots.includes(root);
}
