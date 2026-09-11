export interface WorkspaceYaml {
  packages: string[];
  catalog: Record<string, string>;
}

export function parseWorkspaceYaml(text: string): WorkspaceYaml;

export function findWorkspacePackageDirs(workspaceYamlText: string): string[];

export function checkCatalogDiscipline(
  workspaceYamlText: string,
  packageDirs: string[],
  readPackageJson: (dir: string) => Record<string, unknown> | null,
): string[];

export function checkTsconfigStrictness(
  baseTsconfig: Record<string, unknown>,
  packageDirs: string[],
  readTsconfig: (dir: string) => Record<string, unknown> | null,
): string[];

export function readPackageJson(dir: string): Record<string, unknown> | null;

export function readTsconfig(dir: string): Record<string, unknown> | null;
