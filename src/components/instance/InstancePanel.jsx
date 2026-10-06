import ModsPanel from './ModsPanel'
import ResourcepacksPage from './ResourcepacksPage'
import ShaderpacksPage from './ShaderpacksPage'
import OverviewPage from './OverviewPage'
import ConsolePage from './ConsolePage'
import FilesPage from './FilesPage'
import TrashPage from './TrashPage'
import SavesPage from './SavesPage'
import InstanceSettingsPage from './InstanceSettingsPage'

export default function InstancePanel({
  instance, theme, lang, displayPage, progress, logs, launchError, crashes, onOpenCrash,
  instances, onBack, onOpenAccounts, onRemove, onSaveInstance, onLaunch, onStop, onRestart,
  account, onNavigate,
}) {
  if (displayPage === 'instance-overview') {
    return (
      <OverviewPage
        instance={instance}
        theme={theme}
        lang={lang}
        progress={progress}
        launchError={launchError}
        onLaunch={onLaunch}
        onStop={onStop}
        onRestart={onRestart}
        onNavigate={onNavigate}
      />
    )
  }
  if (displayPage === 'instance-console') {
    return (
      <ConsolePage
        instance={instance}
        theme={theme}
        lang={lang}
        logs={logs}
        launchError={launchError}
        crash={crashes?.[instance.id] || null}
        onOpenCrash={onOpenCrash}
        onLaunch={onLaunch}
        onStop={onStop}
        onRestart={onRestart}
      />
    )
  }
  if (displayPage === 'instance-mods') {
    return <ModsPanel theme={theme} lang={lang} instance={instance} progress={progress} />
  }
  if (displayPage === 'instance-resourcepacks') {
    return <ResourcepacksPage instance={instance} theme={theme} lang={lang} progress={progress} />
  }
  if (displayPage === 'instance-shaderpacks') {
    return <ShaderpacksPage instance={instance} theme={theme} lang={lang} progress={progress} />
  }
  if (displayPage === 'instance-files') {
    return <FilesPage instance={instance} theme={theme} lang={lang} />
  }
  if (displayPage === 'instance-trash') {
    return <TrashPage instance={instance} theme={theme} lang={lang} />
  }
  if (displayPage === 'instance-saves') {
    return <SavesPage instance={instance} theme={theme} lang={lang} />
  }
  return (
    <InstanceSettingsPage
      instance={instance}
      theme={theme}
      lang={lang}
      account={account}
      onBack={onBack}
      onOpenAccounts={onOpenAccounts}
      onRemove={onRemove}
      onSaveInstance={onSaveInstance}
    />
  )
}
