import { describe, it, expect } from 'vitest'
import {
  buildInstallCommands,
  getInstallRecipe,
  listInstallRecipes,
  requiresElevatedApproval
} from '@core/agent/install-recipes'

/**
 * Sprint v2.3.3 — Task C.3: installation recipes (approval happens in the UI).
 */
describe('install recipes (C.3)', () => {
  it('1. docker recipe requires sudo and maps to a reviewable plan', () => {
    const recipe = getInstallRecipe('docker')
    expect(recipe).toBeDefined()
    expect(recipe!.requiresSudo).toBe(true)
    expect(requiresElevatedApproval(recipe!)).toBe(true)
    const commands = buildInstallCommands(recipe!)
    expect(commands[0]).toBe('sudo apt-get update')
    expect(commands).toContain('sudo apt-get install -y docker.io')
  })

  it('2. pm2 recipe needs no sudo', () => {
    const recipe = getInstallRecipe('pm2')!
    expect(recipe.requiresSudo).toBe(false)
    expect(buildInstallCommands(recipe)).toEqual(['npm install -g pm2'])
  })

  it('3. unknown tool → no recipe (nothing to run)', () => {
    expect(getInstallRecipe('nope')).toBeUndefined()
  })

  it('4. every recipe has a preCheck and a verify command', () => {
    for (const recipe of listInstallRecipes()) {
      expect(recipe.preCheck.length).toBeGreaterThan(0)
      expect(recipe.verify.length).toBeGreaterThan(0)
      expect(recipe.commands.length).toBeGreaterThan(0)
    }
  })

  it('5. recipe ids match their lookup key', () => {
    for (const recipe of listInstallRecipes()) {
      expect(getInstallRecipe(recipe.id)).toBe(recipe)
    }
  })
})
