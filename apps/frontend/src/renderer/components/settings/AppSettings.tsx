import { useState, useEffect, useCallback } from 'react';
import { useLocalStorage, useBreakpoint } from '../../hooks';
import { useTranslation } from 'react-i18next';
import {
  Settings,
  Save,
  Loader2
} from 'lucide-react';
import {
  FullScreenDialog,
  FullScreenDialogContent,
  FullScreenDialogHeader,
  FullScreenDialogBody,
  FullScreenDialogFooter,
  FullScreenDialogTitle,
  FullScreenDialogDescription
} from '../ui/full-screen-dialog';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { useSettings } from './hooks/useSettings';
import { ThemeSettings } from './ThemeSettings';
import { DisplaySettings } from './DisplaySettings';
import { LanguageSettings } from './LanguageSettings';
import { GeneralSettings } from './GeneralSettings';
import { IntegrationSettings } from './IntegrationSettings';
import { AdvancedSettings } from './AdvancedSettings';
import { DevToolsSettings } from './DevToolsSettings';
import { DebugSettings } from './DebugSettings';
import { ProfileList } from './ProfileList';
import { ProjectSettingsContent } from './ProjectSettingsContent';
import { SettingsSidebar, type AppSection, type ProjectSettingsSection } from './SettingsSidebar';
import { useProjectStore } from '../../stores/project-store';
import type { UseProjectSettingsReturn } from '../project-settings/hooks/useProjectSettings';

interface AppSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: AppSection;
  initialProjectSection?: ProjectSettingsSection;
  onRerunWizard?: () => void;
}

/**
 * Main application settings dialog container
 * Coordinates app and project settings sections
 */
export function AppSettingsDialog({ open, onOpenChange, initialSection, initialProjectSection, onRerunWizard }: AppSettingsDialogProps) {
  const { t } = useTranslation('settings');
  const { settings, setSettings, isSaving, error, saveSettings, revertTheme, commitTheme } = useSettings();
  const [version, setVersion] = useState<string>('');

  // Track which top-level section is active
  const [activeTopLevel, setActiveTopLevel] = useState<'app' | 'project'>('app');
  const [appSection, setAppSection] = useState<AppSection>(initialSection || 'appearance');
  const [projectSection, setProjectSection] = useState<ProjectSettingsSection>('general');

  // Sidebar collapse state (persisted to localStorage)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useLocalStorage('settings-sidebar-collapsed', false);

  // Mobile detection for auto-collapse
  const isMobile = useBreakpoint('md');

  // Navigate to initial section when dialog opens with a specific section
  useEffect(() => {
    if (open) {
      if (initialProjectSection) {
        setActiveTopLevel('project');
        setProjectSection(initialProjectSection);
      } else if (initialSection) {
        setActiveTopLevel('app');
        setAppSection(initialSection);
      }
    }
  }, [open, initialSection, initialProjectSection]);

  // Auto-collapse sidebar on mobile when dialog opens
  useEffect(() => {
    if (open && isMobile) {
      setIsSidebarCollapsed(true);
    }
  }, [open, isMobile, setIsSidebarCollapsed]);

  // Project state
  const projects = useProjectStore((state) => state.projects);
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
  const selectProject = useProjectStore((state) => state.selectProject);
  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  // Project settings hook state (lifted from child)
  const [projectSettingsHook, setProjectSettingsHook] = useState<UseProjectSettingsReturn | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);

  // Load app version on mount
  useEffect(() => {
    window.electronAPI.getAppVersion().then(setVersion);
  }, []);

  // Memoize the callback to avoid infinite loops
  const handleProjectHookReady = useCallback((hook: UseProjectSettingsReturn | null) => {
    setProjectSettingsHook(hook);
    if (hook) {
      setProjectError(hook.error || hook.envError || null);
    } else {
      setProjectError(null);
    }
  }, []);

  const handleSave = async () => {
    // Save app settings first
    const appSaveSuccess = await saveSettings();

    // If on project section with a project selected, save project settings too
    if (activeTopLevel === 'project' && selectedProject && projectSettingsHook) {
      await projectSettingsHook.handleSave(() => {});
      // Check for project errors
      if (projectSettingsHook.error || projectSettingsHook.envError) {
        setProjectError(projectSettingsHook.error || projectSettingsHook.envError);
        return; // Don't close dialog on error
      }
    }

    if (appSaveSuccess) {
      // Commit the theme so future cancels won't revert to old values
      commitTheme();
      onOpenChange(false);
    }
  };

  const handleCancel = () => {
    // onOpenChange handler will revert theme changes
    onOpenChange(false);
  };

  const handleProjectChange = (projectId: string | null) => {
    selectProject(projectId);
  };

  const renderAppSection = () => {
    switch (appSection) {
      case 'appearance':
        return <ThemeSettings settings={settings} onSettingsChange={setSettings} />;
      case 'display':
        return <DisplaySettings settings={settings} onSettingsChange={setSettings} />;
      case 'language':
        return <LanguageSettings settings={settings} onSettingsChange={setSettings} />;
      case 'devtools':
        return <DevToolsSettings settings={settings} onSettingsChange={setSettings} />;
      case 'agent':
        return <GeneralSettings settings={settings} onSettingsChange={setSettings} section="agent" />;
      case 'paths':
        return <GeneralSettings settings={settings} onSettingsChange={setSettings} section="paths" />;
      case 'integrations':
        return <IntegrationSettings settings={settings} onSettingsChange={setSettings} isOpen={open} />;
      case 'api-profiles':
        return <ProfileList />;
      case 'updates':
        return <AdvancedSettings settings={settings} onSettingsChange={setSettings} section="updates" version={version} />;
      case 'notifications':
        return <AdvancedSettings settings={settings} onSettingsChange={setSettings} section="notifications" version={version} />;
      case 'debug':
        return <DebugSettings />;
      default:
        return null;
    }
  };

  const renderContent = () => {
    if (activeTopLevel === 'app') {
      return renderAppSection();
    }
    return (
      <ProjectSettingsContent
        project={selectedProject}
        activeSection={projectSection}
        isOpen={open}
        onHookReady={handleProjectHookReady}
      />
    );
  };

  return (
    <FullScreenDialog open={open} onOpenChange={(newOpen) => {
      if (!newOpen) {
        // Dialog is being closed (via X, escape, or overlay click)
        // Revert any unsaved theme changes
        revertTheme();
      }
      onOpenChange(newOpen);
    }}>
      <FullScreenDialogContent>
        <FullScreenDialogHeader>
          <FullScreenDialogTitle className="flex items-center gap-3">
            <Settings className="h-6 w-6" />
            {t('title')}
          </FullScreenDialogTitle>
          <FullScreenDialogDescription>
            {t('tabs.app')} & {t('tabs.project')}
          </FullScreenDialogDescription>
        </FullScreenDialogHeader>

        <FullScreenDialogBody>
          <div className="flex h-full">
            {/* Navigation sidebar */}
            <SettingsSidebar
              isCollapsed={isSidebarCollapsed}
              onCollapsedChange={setIsSidebarCollapsed}
              activeTopLevel={activeTopLevel}
              appSection={appSection}
              projectSection={projectSection}
              onAppSectionChange={setAppSection}
              onProjectSectionChange={setProjectSection}
              onTopLevelChange={setActiveTopLevel}
              selectedProjectId={selectedProjectId}
              onProjectChange={handleProjectChange}
              version={version}
              onRerunWizard={onRerunWizard}
              onClose={() => onOpenChange(false)}
            />

            {/* Main content */}
            <div className="flex-1 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="p-8 max-w-2xl">
                  {renderContent()}
                </div>
              </ScrollArea>
            </div>
          </div>
        </FullScreenDialogBody>

        <FullScreenDialogFooter>
          {(error || projectError) && (
            <div className="flex-1 rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-2 text-sm text-destructive">
              {error || projectError}
            </div>
          )}
          <Button variant="outline" onClick={handleCancel}>
            {t('common:buttons.cancel', 'Cancel')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || (activeTopLevel === 'project' && projectSettingsHook?.isSaving)}
          >
            {(isSaving || (activeTopLevel === 'project' && projectSettingsHook?.isSaving)) ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('common:buttons.saving', 'Saving...')}
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                {t('actions.save')}
              </>
            )}
          </Button>
        </FullScreenDialogFooter>
      </FullScreenDialogContent>
    </FullScreenDialog>
  );
}

// Re-export types for backward compatibility
export type { AppSection };
