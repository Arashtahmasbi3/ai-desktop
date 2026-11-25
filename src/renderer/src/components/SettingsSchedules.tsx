import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarClock, Trash2 } from 'lucide-react'
import { createScheduleJob, summarizeRule, type ScheduleJob } from '@shared/schedule'
import { useStore } from '../store'

/**
 * Scheduled jobs (T16, the UI).
 *
 * The list and the form are deliberately plain: a job is a title, a prompt and a recurrence. Nothing here executes a job —
 * main offers a due one with a native dialog — and the panel says so, because a schedule that silently runs would be the
 * one thing this feature must not do.
 */
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]

function nextLabel(job: ScheduleJob): string {
  if (job.nextAt === null) return '—'
  return new Date(job.nextAt).toLocaleString()
}

export default function SettingsSchedules(): JSX.Element {
  const { t } = useTranslation()
  const schedules = useStore((state) => state.schedules)
  const loadSchedules = useStore((state) => state.loadSchedules)
  const saveSchedule = useStore((state) => state.saveSchedule)
  const removeSchedule = useStore((state) => state.removeSchedule)

  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [frequency, setFrequency] = useState<'DAILY' | 'WEEKLY'>('DAILY')
  const [hour, setHour] = useState(9)
  const [minute, setMinute] = useState(0)
  const [weekday, setWeekday] = useState(1)

  useEffect(() => {
    void loadSchedules()
  }, [loadSchedules])

  const canSave = useMemo(() => title.trim() !== '' && prompt.trim() !== '', [title, prompt])

  const create = async (): Promise<void> => {
    if (!canSave) return
    const job = createScheduleJob({
      title,
      prompt,
      now: Date.now(),
      rule: {
        frequency,
        hour,
        minute,
        ...(frequency === 'WEEKLY' ? { weekdays: [weekday] } : {})
      }
    })
    await saveSchedule(job)
    setTitle('')
    setPrompt('')
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="ui-label flex items-center gap-2">
        <CalendarClock className="h-3.5 w-3.5" />
        {t('settings.schedules.title')}
      </h3>

      <p className="text-2xs text-fg-muted">{t('settings.schedules.hint')}</p>

      <div className="ui-card flex flex-col gap-2 p-3">
        <p className="text-xs font-medium text-fg">{t('settings.schedules.newJob')}</p>
        <input
          data-testid="schedule-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t('settings.schedules.titlePlaceholder')}
          className="ui-inset px-2 py-1 text-xs text-fg"
        />
        <textarea
          data-testid="schedule-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={t('settings.schedules.promptPlaceholder')}
          rows={2}
          className="ui-inset px-2 py-1 text-xs text-fg"
        />
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg">
          <select
            data-testid="schedule-frequency"
            value={frequency}
            onChange={(event) => setFrequency(event.target.value as 'DAILY' | 'WEEKLY')}
            className="ui-inset px-2 py-1"
          >
            <option value="DAILY">{t('settings.schedules.daily')}</option>
            <option value="WEEKLY">{t('settings.schedules.weekly')}</option>
          </select>
          <input
            data-testid="schedule-hour"
            type="number"
            min={0}
            max={23}
            value={hour}
            onChange={(event) => setHour(Number(event.target.value))}
            className="ui-inset w-16 px-2 py-1"
          />
          <span>:</span>
          <input
            data-testid="schedule-minute"
            type="number"
            min={0}
            max={59}
            value={minute}
            onChange={(event) => setMinute(Number(event.target.value))}
            className="ui-inset w-16 px-2 py-1"
          />
          {frequency === 'WEEKLY' ? (
            <select
              data-testid="schedule-weekday"
              value={weekday}
              onChange={(event) => setWeekday(Number(event.target.value))}
              className="ui-inset px-2 py-1"
            >
              {WEEKDAYS.map((day) => (
                <option key={day} value={day}>
                  {t(`settings.schedules.weekday.${day}`)}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            data-testid="schedule-create"
            disabled={!canSave}
            onClick={() => void create()}
            className="ui-tab border-border-strong px-2.5 py-1.5"
          >
            {t('settings.schedules.add')}
          </button>
        </div>
      </div>

      <ul className="flex flex-col gap-2" data-testid="schedule-list">
        {schedules.map((job) => (
          <li key={job.id} className="ui-card flex items-center justify-between gap-2 p-2 text-xs">
            <div className="flex flex-col">
              <span className="font-medium text-fg">{job.title}</span>
              <span className="text-2xs text-fg-muted">
                {summarizeRule(job.rule)} · {nextLabel(job)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid={`schedule-toggle-${job.id}`}
                onClick={() => void saveSchedule({ ...job, enabled: !job.enabled })}
                className="ui-tab border-border-strong px-2 py-1"
              >
                {job.enabled ? t('settings.schedules.on') : t('settings.schedules.off')}
              </button>
              <button
                type="button"
                data-testid={`schedule-remove-${job.id}`}
                onClick={() => void removeSchedule(job.id)}
                aria-label={t('settings.schedules.remove')}
                className="ui-tab border-border-strong px-2 py-1"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
