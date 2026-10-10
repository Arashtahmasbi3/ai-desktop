/**
 * Installation recipes (v2.3.3, C.3).
 *
 * Declarative, reviewable command lists for tools the agent may offer to install
 * on a VPS. Nothing here executes: the chat renders the plan, the user approves,
 * and only then do the commands run through the guarded remote shell. Sudo
 * recipes are flagged so the UI can ask for a second confirmation.
 */

export interface InstallRecipe {
  id: string
  /** Human label shown in the approval card. */
  label: string
  /** Command that, if it exits 0, means the tool is already present. */
  preCheck: string
  commands: string[]
  requiresSudo: boolean
  /** Command that must exit 0 after install. */
  verify: string
}

export const INSTALL_RECIPES: Readonly<Record<string, InstallRecipe>> = {
  docker: {
    id: 'docker',
    label: 'Docker',
    preCheck: 'which docker',
    commands: [
      'apt-get update',
      'apt-get install -y docker.io',
      'systemctl enable docker',
      'systemctl start docker'
    ],
    requiresSudo: true,
    verify: 'docker --version'
  },
  pm2: {
    id: 'pm2',
    label: 'PM2',
    preCheck: 'which pm2',
    commands: ['npm install -g pm2'],
    requiresSudo: false,
    verify: 'pm2 --version'
  },
  git: {
    id: 'git',
    label: 'Git',
    preCheck: 'which git',
    commands: ['apt-get update', 'apt-get install -y git'],
    requiresSudo: true,
    verify: 'git --version'
  },
  node: {
    id: 'node',
    label: 'Node.js',
    preCheck: 'which node',
    commands: ['apt-get update', 'apt-get install -y nodejs npm'],
    requiresSudo: true,
    verify: 'node --version'
  }
}

export function getInstallRecipe(tool: string): InstallRecipe | undefined {
  return INSTALL_RECIPES[tool.toLowerCase()]
}

export function listInstallRecipes(): InstallRecipe[] {
  return Object.values(INSTALL_RECIPES)
}

/**
 * The exact commands to run, with `sudo` prefixed where the recipe needs root.
 * Returned as a reviewable list so the approval card can show every line.
 */
export function buildInstallCommands(recipe: InstallRecipe): string[] {
  return recipe.commands.map((command) => (recipe.requiresSudo ? `sudo ${command}` : command))
}

/** Whether the recipe needs an explicit second confirmation (sudo/root). */
export function requiresElevatedApproval(recipe: InstallRecipe): boolean {
  return recipe.requiresSudo
}
