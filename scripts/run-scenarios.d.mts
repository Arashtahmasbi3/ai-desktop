/** One runtime regression scenario. `invariant` names a line verify-ui prints; null means not implemented yet. */
export interface Scenario {
  id: string
  bug: string
  invariant: string | null
  skip?: string
}

export const SCENARIOS: Scenario[]

/** True when verify-ui printed a PASS line for this scenario's invariant. */
export function scenarioPassed(scenario: Scenario, output: string): boolean