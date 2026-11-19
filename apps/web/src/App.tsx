import { useCallback, useState, type CSSProperties } from 'react'
import type { ContentWidth } from '@yagent/core'
import { harness } from './harness'
import { userAvatarLetter, userNickname } from './settingsMeta'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { ChatView } from './components/ChatView'
import { AskUserQuestionBar } from './components/AskUserQuestionBar'
import { Composer } from './components/Composer'
import { ApprovalBar } from './components/ApprovalBar'
import { ComposerNoticeBar } from './components/ComposerNoticeBar'
import { SshOfflineBanner } from './components/SshOfflineBanner'
import { SightBoard } from './components/SightBoard'
import {
  PANEL_W_DEFAULT,
  PANEL_W_MAX,
  PANEL_W_MIN,
  SIDEBAR_W_DEFAULT,
  SIDEBAR_W_MAX,
  SIDEBAR_W_MIN,
  Splitter,
} from './components/Splitter'
import { RightPanel } from './components/RightPanel'
import { ConfirmDialog } from './components/ConfirmDialog'
import { SettingsPanel } from './components/SettingsPanel'
import { useAppearance } from './hooks/useAppearance'
import { useAppSettings } from './hooks/useAppSettings'
import { useApprovals } from './hooks/useApprovals'
import { useAskUserQueue } from './hooks/useAskUserQueue'
import { useChromeLayout } from './hooks/useChromeLayout'
import {
  pickInitialActiveConvId,
  useConversationActions,
} from './hooks/useConversationActions'
import { useHarnessBridge } from './hooks/useHarnessBridge'
import { useInsightsBridge } from './hooks/useInsightsBridge'
import { useProjects } from './hooks/useProjects'
import { useSshProbe } from './hooks/useSshProbe'

function App() {
  const [activeConvId, setActiveConvId] = useState(pickInitialActiveConvId)

  const {
    settings,
    setSettings,
    loaded: settingsLoaded,
    models,
    currentModelId,
    setCurrentModelId,
    approvalMode,
    handleApprovalModeChange,
    handleSettingsChange,
  } = useAppSettings()

  const { theme, toggleTheme } = useAppearance(settings)
  const { knownProjects, trackProject, handleForgetProject } = useProjects()

  // 同步读 harness；setWorkdir / 切会话后由 harnessTick 触发重渲再读
  const activeWorkdir = harness.getConversation(activeConvId)?.workdir
  const { sshHost, sshStatus, sshError, remoteToolsDegraded, retry: retrySsh } = useSshProbe(
    activeWorkdir,
    activeConvId,
    settings.tools,
  )

  const {
    conversations,
    conversation,
    running,
    queuedItems,
    contextMeter,
    inspirationOn,
  } = useHarnessBridge({
    activeConvId,
    models,
    currentModelId,
    tools: settings.tools,
    inspiration: settings.inspiration,
    remoteToolsDegraded,
  })

  const chrome = useChromeLayout({
    settings,
    setSettings,
    inspirationOn,
    activeConvId,
  })

  const { approvals, answerFront } = useApprovals(approvalMode)
  const { askQueue } = useAskUserQueue()

  const insights = useInsightsBridge({
    conversationId: conversation?.id,
    insightIds: conversation?.insightIds,
    settingsInsights: settings.insights,
    settingsLoaded,
    onSettingsChange: setSettings,
    onOpenInsightsPanel: chrome.openInsightsPanel,
  })

  const actions = useConversationActions({
    activeConvId,
    setActiveConvId,
    tools: settings.tools,
    sshHost,
    sshStatus,
    trackProject,
    refreshSight: insights.refreshSight,
  })

  const handleContentWidth = useCallback(
    (w: ContentWidth) => {
      setSettings((s) => ({
        ...s,
        appearance: { ...s.appearance, contentWidth: w },
      }))
    },
    [setSettings],
  )

  const handleOpenSettings = useCallback(() => {
    chrome.setSettingsOpen((v) => !v)
  }, [chrome.setSettingsOpen])

  const handleOpenUserSettings = useCallback(() => {
    // 已打开：再点昵称则关闭；否则切到「用户」并打开（避免先翻面再卸载）
    if (chrome.settingsOpen && chrome.settingsPane === 'user') {
      chrome.setSettingsOpen(false)
      return
    }
    chrome.setSettingsPane('user')
    chrome.setSettingsOpen(true)
  }, [
    chrome.settingsOpen,
    chrome.settingsPane,
    chrome.setSettingsOpen,
    chrome.setSettingsPane,
  ])

  const nickname = userNickname(settings)
  const avatarLetter = userAvatarLetter(settings)

  if (!conversation) {
    return (
      <div className="app">
        <div className="stage" style={{ display: 'grid', placeItems: 'center', color: 'var(--text-1)' }}>
          正在准备会话…
        </div>
      </div>
    )
  }

  return (
    <div
      className={`app${chrome.sidebarCollapsed ? ' collapsed' : ''}${chrome.panelOpen ? ' panel-open' : ''}`}
      style={
        {
          '--sidebar-w': `${chrome.sidebarWidth}px`,
          '--panel-w': `${chrome.panelWidth}px`,
        } as CSSProperties
      }
    >
      {window.yagentDesktop && <div className="drag-region" />}
      <Sidebar
        conversations={conversations}
        knownProjects={knownProjects}
        activeId={activeConvId}
        theme={theme}
        settingsOpen={chrome.settingsOpen}
        settingsPane={chrome.settingsPane}
        nickname={nickname}
        avatarLetter={avatarLetter}
        onSelect={setActiveConvId}
        onNewChat={actions.handleNewChat}
        onNewTaskWithWorkdir={actions.handleNewTask}
        onNewSshTask={actions.handleNewSshTask}
        onNewTaskInProject={actions.handleNewTaskInProject}
        onForgetProject={handleForgetProject}
        onToggleTheme={toggleTheme}
        onOpenSettings={handleOpenSettings}
        onOpenUserSettings={handleOpenUserSettings}
        onSelectSettingsPane={chrome.setSettingsPane}
      />
      <Splitter
        edge="left"
        value={chrome.sidebarWidth}
        min={SIDEBAR_W_MIN}
        max={SIDEBAR_W_MAX}
        defaultValue={SIDEBAR_W_DEFAULT}
        onChange={chrome.setSidebarWidthLive}
        onCommit={chrome.commitSidebarWidth}
      />

      <div className={`stage-column${inspirationOn && chrome.sightOpen ? ' sight-open' : ''}`}>
        <main className="stage">
          <div className={`flip-inner${chrome.settingsOpen ? ' flipped' : ''}`}>
            <div className="flip-front">
              <Topbar
                conversation={conversation}
                models={models}
                currentModelId={currentModelId}
                contentWidth={settings.appearance?.contentWidth ?? 'standard'}
                popover={chrome.popover}
                onPopover={chrome.setPopover}
                onToggleSidebar={() => chrome.setSidebarCollapsed((v) => !v)}
                onTogglePanel={() => chrome.setPanelOpen((v) => !v)}
                onRename={actions.handleRename}
                onSelectModel={setCurrentModelId}
                onContentWidth={handleContentWidth}
                onBindWorkdir={actions.handleBindWorkdir}
                onToggleArchive={actions.handleToggleArchive}
                onDelete={actions.handleDeleteConversation}
                sandbox={settings.sandbox}
                sshStatus={sshHost ? sshStatus : null}
              />
              {sshHost && (sshStatus === 'fail' || sshStatus === 'checking') && (
                <SshOfflineBanner
                  host={sshHost}
                  status={sshStatus}
                  error={sshError}
                  onRetry={retrySsh}
                />
              )}
              <ChatView
                conversation={conversation}
                editingNodeId={actions.editingNodeId}
                onRefClick={chrome.handleRefClick}
                onToggleFiles={chrome.handleToggleFiles}
                onStartEditUserMessage={actions.startEditUserMessage}
              />
              <Composer
                ref={actions.composerRef}
                conversationId={conversation.id}
                running={running}
                askingUser={askQueue.length > 0}
                editingMessage={!!actions.editingNodeId}
                context={contextMeter}
                queuedItems={queuedItems}
                toolsDegraded={remoteToolsDegraded}
                toolsDegradedHint={
                  remoteToolsDegraded
                    ? sshStatus === 'checking'
                      ? `正在检测 · ${sshHost}，读写/命令暂不可用`
                      : `远程离线 · ${sshHost} 不可用，读写/命令已暂停`
                    : undefined
                }
                sendKey={settings.appearance?.sendKey ?? 'cmdEnter'}
                onRemoveQueued={(i) => {
                  harness.removePending(conversation.id, i)
                }}
                onClearQueued={() => {
                  harness.clearPending(conversation.id)
                }}
                approvalMode={approvalMode}
                approval={
                  askQueue.length > 0 ? (
                    <AskUserQuestionBar
                      key={askQueue[0].id}
                      req={askQueue[0].req}
                      onSubmit={(answers) => askQueue[0].resolve(answers)}
                      onCancel={() => askQueue[0].reject(new Error('用户取消了回答'))}
                    />
                  ) : approvalMode !== 'all' && approvals.length > 0 ? (
                    <ApprovalBar
                      req={approvals[0].req}
                      onAnswer={answerFront}
                    />
                  ) : actions.slashNotice ? (
                    <ComposerNoticeBar
                      message={actions.slashNotice}
                      onDismiss={() => actions.setSlashNotice('')}
                    />
                  ) : null
                }
                onSend={actions.handleSend}
                onStop={actions.handleStop}
                onApprovalModeChange={handleApprovalModeChange}
                onCancelEdit={actions.cancelEditMessage}
              />
            </div>
            <div className="flip-back">
              {chrome.settingsOpen || chrome.settingsMounted ? (
                <SettingsPanel
                  pane={chrome.settingsPane}
                  settings={settings}
                  conversations={conversations}
                  onChange={handleSettingsChange}
                  onClose={() => chrome.setSettingsOpen(false)}
                />
              ) : null}
            </div>
          </div>
        </main>
        {inspirationOn ? (
          <>
            <button
              type="button"
              className={`sight-pull${chrome.sightOpen ? ' open' : ''}`}
              title={chrome.sightOpen ? '收回主区' : '打开收藏便签'}
              aria-label={chrome.sightOpen ? '收回主区' : '打开收藏便签'}
              aria-expanded={chrome.sightOpen}
              onClick={() => {
                chrome.setSightOpen((v) => !v)
                insights.refreshSight()
              }}
            >
              <span className="sight-pull-bar" aria-hidden />
            </button>
            <SightBoard
              open={chrome.sightOpen}
              insights={insights.sightInsights}
              onMove={insights.handleSightMove}
            />
          </>
        ) : null}
      </div>

      <Splitter
        edge="right"
        value={chrome.panelWidth}
        min={PANEL_W_MIN}
        max={PANEL_W_MAX}
        defaultValue={PANEL_W_DEFAULT}
        onChange={chrome.setPanelWidthLive}
        onCommit={chrome.commitPanelWidth}
      />
      <RightPanel
        conversation={conversation}
        tab={chrome.panelTab}
        activeSrcId={chrome.activeSrcId}
        inspirationEnabled={inspirationOn}
        insights={insights.convInsights}
        sightInsights={insights.sightInsights}
        remoteFs={sshHost ? sshStatus : null}
        onTabChange={chrome.setPanelTab}
        onSelectSrc={chrome.setActiveSrcId}
        onMarkInsight={insights.handleMarkInsight}
        onDeleteInsight={insights.handleDeleteInsight}
        onTogglePanel={() => chrome.setPanelOpen((v) => !v)}
        sandbox={settings.sandbox}
      />

      <ConfirmDialog
        open={!!actions.deleteConfirm}
        title="删除对话"
        message={
          actions.deleteConfirm
            ? `确定删除「${actions.deleteConfirm.title}」？相关附件会一并删除，且不可恢复。`
            : ''
        }
        confirmLabel="删除"
        cancelLabel="取消"
        danger
        onConfirm={actions.confirmDeleteConversation}
        onCancel={() => actions.setDeleteConfirm(null)}
      />
    </div>
  )
}

export default App
