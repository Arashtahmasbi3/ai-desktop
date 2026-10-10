import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, MapPin, Save, Server, Trash2, X } from 'lucide-react'
import type { ProjectRecord } from '@shared/ui'
import { useStore } from '../store'
import {
  APPROVAL_REQUIREMENTS,
  POLICY_MODES,
  PROJECT_ENVIRONMENTS,
  formFromProject,
  hasErrors,
  validateProjectMetadataForm,
  type ProjectMetadataForm
} from '../lib/project-metadata-form'
import type { HostApprovalRequirement, HostPolicyMode } from '@shared/vps'

const MODE_KEY: Record<HostPolicyMode, string> = {
  'read-only': 'settings.hostPolicyReadOnly',
  staging: 'settings.hostPolicyStaging',
  production: 'settings.hostPolicyProduction'
}

const APPROVAL_KEY: Record<HostApprovalRequirement, string> = {
  never: 'settings.hostPolicyApprovalNever',
  destructive: 'settings.hostPolicyApprovalDestructive',
  always: 'settings.hostPolicyApprovalAlways'
}

const ENV_KEY: Record<string, string> = {
  development: 'settings.environmentDevelopment',
  staging: 'settings.environmentStaging',
  production: 'settings.environmentProduction'
}

const ERROR_KEY: Record<string, string> = {
  invalidEnvironment: 'settings.projectErrorInvalidEnvironment',
  invalidUrl: 'settings.projectErrorInvalidUrl',
  required: 'settings.projectErrorRequired',
  invalidPorts: 'settings.projectErrorInvalidPorts',
  invalidDomains: 'settings.projectErrorInvalidDomains',
  notKeyMaterial: 'settings.projectErrorNotKeyMaterial',
  invalidPolicy: 'settings.projectErrorInvalidPolicy',
  invalidPort: 'settings.projectErrorInvalidPort'
}

const ENV_DOT: Record<string, string> = {
  production: '🔴',
  staging: '🟡',
  development: '🟢'
}

const ENV_BADGE: Record<string, string> = {
  production: 'bg-red-500/15 text-red-300',
  staging: 'bg-amber-500/15 text-amber-300',
  development: 'bg-emerald-500/15 text-emerald-300'
}

const fieldClass =
  'w-full rounded border border-border bg-bg-primary px-2 py-1 text-xs text-neutral-200 outline-none focus:border-accent/50'
const labelClass = 'flex flex-col gap-1 text-[11px] text-neutral-400'

interface FieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  ltr?: boolean
  error?: string
  placeholder?: string
}

function Field({ label, value, onChange, ltr, error, placeholder }: FieldProps): JSX.Element {
  return (
    <label className={labelClass}>
      <span>{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        dir={ltr ? 'ltr' : undefined}
        placeholder={placeholder}
        className={`${fieldClass}${error ? ' border-red-500/60' : ''}${ltr ? ' font-mono' : ''}`}
      />
      {error ? <span className="text-[10px] text-red-400">{error}</span> : null}
    </label>
  )
}

/** One expandable project card in Settings → Projects (v2.3.2, C.1). */
export default function ProjectCard({ project }: { project: ProjectRecord }): JSX.Element {
  const { t } = useTranslation()
  const openProject = useStore((state) => state.openProject)
  const removeProject = useStore((state) => state.removeProject)
  const updateProjectMetadata = useStore((state) => state.updateProjectMetadata)
  const updateProjectPath = useStore((state) => state.updateProjectPath)
  const pushToast = useStore((state) => state.pushToast)

  const [expanded, setExpanded] = useState(false)
  const [form, setForm] = useState<ProjectMetadataForm>(() => formFromProject(project))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const set = (key: keyof ProjectMetadataForm) => (value: string): void =>
    setForm((current) => ({ ...current, [key]: value }))

  const environment = form.environment
  const isRemote = project.type === 'remote'
  const error = (key: string): string | undefined =>
    errors[key] ? t(ERROR_KEY[errors[key]] ?? `settings.projectError${errors[key]}`) : undefined

  const save = async (): Promise<void> => {
    const result = validateProjectMetadataForm(form, project.vpsId)
    setErrors(result.errors)
    if (hasErrors(result.errors)) return
    await updateProjectMetadata(project.id, result.patch)
    pushToast('success', t('settings.projectSaved', { name: project.name }))
    setExpanded(false)
  }

  const cancel = (): void => {
    setForm(formFromProject(project))
    setErrors({})
    setExpanded(false)
  }

  const locate = async (): Promise<void> => {
    const picked = await window.api.dialog.pickDirectory()
    if (picked) await updateProjectPath(project.id, picked)
  }

  return (
    <div className="border-b border-border bg-bg-primary last:border-b-0">
      <div className="flex items-center gap-2 px-3 py-2 text-xs">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-label={t('settings.projectDetails')}
          className="rounded p-0.5 text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-200"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>

        <button
          type="button"
          onClick={() => void openProject(project.id)}
          className="min-w-0 flex-1 text-left"
        >
          <span className="text-neutral-200">{project.name}</span>
          <span className="ml-2 font-mono text-[10px] text-neutral-500" dir="ltr">
            {project.path}
          </span>
        </button>

        {isRemote ? (
          <span className="inline-flex items-center gap-0.5 rounded bg-sky-500/15 px-1 py-0.5 text-[9px] text-sky-300">
            <Server className="h-2.5 w-2.5" />
            {t('settings.remoteBadge')}
          </span>
        ) : null}

        <span
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] ${
            ENV_BADGE[environment] ?? ENV_BADGE.development
          }`}
        >
          <span aria-hidden>{ENV_DOT[environment] ?? ENV_DOT.development}</span>
          {t(ENV_KEY[environment] ?? ENV_KEY.development)}
        </span>

        {project.exists === false ? (
          <button
            type="button"
            onClick={() => void locate()}
            title={t('sidebar.locate')}
            aria-label={t('settings.missingPath')}
            className="rounded p-1 text-amber-400 hover:bg-bg-tertiary"
          >
            <MapPin className="h-3.5 w-3.5" />
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          title={t('common.remove')}
          aria-label={t('common.remove')}
          className="rounded p-1 text-neutral-500 hover:bg-bg-tertiary hover:text-red-400"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {confirmingDelete ? (
        <div className="flex items-center justify-between gap-2 border-t border-border bg-red-500/5 px-3 py-2 text-[11px]">
          <span className="text-red-300">{t('settings.deleteProjectConfirm', { name: project.name })}</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                void removeProject(project.id)
                setConfirmingDelete(false)
              }}
              className="rounded bg-red-500/80 px-2 py-1 text-white hover:bg-red-500"
            >
              {t('common.delete')}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="rounded border border-border px-2 py-1 text-neutral-300 hover:bg-bg-tertiary"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {expanded ? (
        <div className="grid grid-cols-2 gap-3 border-t border-border px-3 py-3">
          <label className={labelClass}>
            <span>{t('settings.projectEnvironment')}</span>
            <select
              value={form.environment}
              onChange={(event) => set('environment')(event.target.value)}
              className={fieldClass}
            >
              {PROJECT_ENVIRONMENTS.map((option) => (
                <option key={option} value={option}>
                  {t(ENV_KEY[option] ?? ENV_KEY.development)}
                </option>
              ))}
            </select>
            {error('environment') ? (
              <span className="text-[10px] text-red-400">{error('environment')}</span>
            ) : null}
          </label>

          <Field
            label={t('settings.projectDocker')}
            value={form.dockerComposeProject}
            onChange={set('dockerComposeProject')}
            ltr
          />
          <Field
            label={`${t('settings.projectRepoUrl')}`}
            value={form.repositoryUrl}
            onChange={set('repositoryUrl')}
            ltr
            error={error('repositoryUrl')}
            placeholder="git@github.com:owner/repo.git"
          />
          <Field
            label={t('settings.projectRepoBranch')}
            value={form.repositoryBranch}
            onChange={set('repositoryBranch')}
            ltr
            error={error('repositoryBranch')}
            placeholder="main"
          />
          <Field
            label={t('settings.projectPorts')}
            value={form.ports}
            onChange={set('ports')}
            ltr
            error={error('ports')}
            placeholder="3000, 8080"
          />
          <Field
            label={t('settings.projectDomains')}
            value={form.domains}
            onChange={set('domains')}
            ltr
            error={error('domains')}
            placeholder="app.example.com"
          />
          <Field
            label={t('settings.projectLinuxUser')}
            value={form.linuxUser}
            onChange={set('linuxUser')}
            ltr
          />
          <Field
            label={t('settings.projectSshKeyRef')}
            value={form.sshKeyRef}
            onChange={set('sshKeyRef')}
            ltr
            error={error('sshKeyRef')}
            placeholder="vps:prod-iran-1"
          />

          <label className={labelClass}>
            <span>{t('settings.projectPolicyMode')}</span>
            <select
              value={form.policyMode}
              onChange={(event) => set('policyMode')(event.target.value)}
              className={fieldClass}
            >
              <option value="">{t('settings.policyInherit')}</option>
              {POLICY_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {t(MODE_KEY[mode])}
                </option>
              ))}
            </select>
            {error('policyMode') ? (
              <span className="text-[10px] text-red-400">{error('policyMode')}</span>
            ) : null}
          </label>

          <label className={labelClass}>
            <span>{t('settings.projectPolicyApproval')}</span>
            <select
              value={form.policyRequireApproval}
              onChange={(event) => set('policyRequireApproval')(event.target.value)}
              disabled={form.policyMode === ''}
              className={`${fieldClass} disabled:opacity-40`}
            >
              {APPROVAL_REQUIREMENTS.map((mode) => (
                <option key={mode} value={mode}>
                  {t(APPROVAL_KEY[mode])}
                </option>
              ))}
            </select>
          </label>

          <Field
            label={t('settings.projectPolicyAllow')}
            value={form.policyAllowCommands}
            onChange={set('policyAllowCommands')}
            ltr
            placeholder="ls, cat, git status"
          />
          <Field
            label={t('settings.projectPolicyDeny')}
            value={form.policyDenyCommands}
            onChange={set('policyDenyCommands')}
            ltr
            placeholder="rm -rf /"
          />

          <Field
            label={t('settings.projectHealthProcess')}
            value={form.healthProcessName}
            onChange={set('healthProcessName')}
            ltr
          />
          <Field
            label={t('settings.projectHealthPort')}
            value={form.healthPort}
            onChange={set('healthPort')}
            ltr
            error={error('healthPort')}
            placeholder="8080"
          />
          <Field
            label={t('settings.projectHealthEndpoint')}
            value={form.healthEndpoint}
            onChange={set('healthEndpoint')}
            ltr
            placeholder="http://localhost:8080/health"
          />
          <label className={labelClass}>
            <span>{t('settings.projectAuditLog')}</span>
            <input
              value={form.auditLogPath}
              readOnly
              dir="ltr"
              className={`${fieldClass} cursor-default font-mono text-neutral-500`}
            />
          </label>

          <div className="col-span-2 flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={cancel}
              className="flex items-center gap-1 rounded border border-border px-3 py-1 text-xs text-neutral-300 hover:bg-bg-tertiary"
            >
              <X className="h-3 w-3" />
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              className="flex items-center gap-1 rounded bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover"
            >
              <Save className="h-3 w-3" />
              {t('common.save')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
