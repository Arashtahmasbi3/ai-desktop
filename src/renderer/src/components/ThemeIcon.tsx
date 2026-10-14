import { Monitor, Moon, Sun } from 'lucide-react'
import type { ThemePreference } from '../lib/theme'

/**
 * The icon for a theme preference (v2.7.0), shared by the titlebar menu and the
 * Settings radio group so the two never disagree about what "dark" looks like.
 */
export default function ThemeIcon({
  preference,
  className
}: {
  preference: ThemePreference
  className?: string
}): JSX.Element {
  if (preference === 'dark') return <Moon className={className} />
  if (preference === 'system') return <Monitor className={className} />
  return <Sun className={className} />
}
