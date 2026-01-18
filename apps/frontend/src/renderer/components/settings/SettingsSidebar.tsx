import { useTranslation } from 'react-i18next';
import {
  PanelLeftClose,
  PanelLeft,
  Palette,
  Bot,
  FolderOpen,
  Key,
  Package,
  Bell,
  Settings2,
  Zap,
  Github,
  Database,
  Sparkles,
  Monitor,
  Globe,
  Code,
  Bug,
  Server,
  Cloud
} from 'lucide-react';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '../ui/tooltip';
import { cn } from '../../lib/utils';
import { ProjectSelector } from './ProjectSelector';

// GitLab icon component (lucide-react doesn't have one)
function GitLabIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" role="img" aria-labelledby="gitlab-sidebar-icon-title">
      <title id="gitlab-sidebar-icon-title">GitLab</title>
      <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z"/>
    </svg>
  );
}

// App-level settings sections
export type AppSection = 'appearance' | 'display' | 'language' | 'devtools' | 'agent' | 'paths' | 'integrations' | 'api-profiles' | 'updates' | 'notifications' | 'debug';

// Project-level settings sections
export type ProjectSettingsSection = 'general' | 'linear' | 'github' | 'gitlab' | 'azure-devops' | 'memory';

interface NavItemConfig<T extends string> {
  id: T;
  icon: React.ElementType;
}

const appNavItemsConfig: NavItemConfig<AppSection>[] = [
  { id: 'appearance', icon: Palette },
  { id: 'display', icon: Monitor },
  { id: 'language', icon: Globe },
  { id: 'devtools', icon: Code },
  { id: 'agent', icon: Bot },
  { id: 'paths', icon: FolderOpen },
  { id: 'integrations', icon: Key },
  { id: 'api-profiles', icon: Server },
  { id: 'updates', icon: Package },
  { id: 'notifications', icon: Bell },
  { id: 'debug', icon: Bug }
];

const projectNavItemsConfig: NavItemConfig<ProjectSettingsSection>[] = [
  { id: 'general', icon: Settings2 },
  { id: 'linear', icon: Zap },
  { id: 'github', icon: Github },
  { id: 'gitlab', icon: GitLabIcon },
  { id: 'azure-devops', icon: Cloud },
  { id: 'memory', icon: Database }
];

interface SettingsSidebarProps {
  /** Whether the sidebar is collapsed (icon-only mode) */
  isCollapsed: boolean;
  /** Callback when the collapse state changes */
  onCollapsedChange: (collapsed: boolean) => void;
  /** Current top-level section (app or project) */
  activeTopLevel: 'app' | 'project';
  /** Current app section */
  appSection: AppSection;
  /** Current project section */
  projectSection: ProjectSettingsSection;
  /** Callback when app section changes */
  onAppSectionChange: (section: AppSection) => void;
  /** Callback when project section changes */
  onProjectSectionChange: (section: ProjectSettingsSection) => void;
  /** Callback when top-level section changes */
  onTopLevelChange: (topLevel: 'app' | 'project') => void;
  /** Currently selected project ID */
  selectedProjectId: string | null;
  /** Callback when project selection changes */
  onProjectChange: (projectId: string | null) => void;
  /** App version to display */
  version?: string;
  /** Optional callback to re-run the wizard */
  onRerunWizard?: () => void;
  /** Callback when settings dialog should close (for wizard re-run) */
  onClose?: () => void;
}

/**
 * Collapsible sidebar for the Settings dialog.
 * Supports collapse/expand with smooth animations and tooltips in icon-only mode.
 */
export function SettingsSidebar({
  isCollapsed,
  onCollapsedChange,
  activeTopLevel,
  appSection,
  projectSection,
  onAppSectionChange,
  onProjectSectionChange,
  onTopLevelChange,
  selectedProjectId,
  onProjectChange,
  version,
  onRerunWizard,
  onClose
}: SettingsSidebarProps) {
  const { t } = useTranslation('settings');

  // Determine if project nav items should be disabled
  const projectNavDisabled = !selectedProjectId;

  const handleToggleCollapse = () => {
    onCollapsedChange(!isCollapsed);
  };

  const renderNavButton = <T extends string>(
    item: NavItemConfig<T>,
    isActive: boolean,
    onClick: () => void,
    translationPrefix: string,
    disabled?: boolean
  ) => {
    const Icon = item.icon;

    const button = (
      <button
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'w-full flex items-center gap-3 rounded-lg text-left transition-all',
          isCollapsed ? 'justify-center p-3' : 'items-start p-3',
          isActive
            ? 'bg-accent text-accent-foreground'
            : disabled
              ? 'opacity-50 cursor-not-allowed text-muted-foreground'
              : 'hover:bg-accent/50 text-muted-foreground hover:text-foreground'
        )}
      >
        <Icon className={cn('h-5 w-5 shrink-0', !isCollapsed && 'mt-0.5')} />
        {!isCollapsed && (
          <div className="min-w-0">
            <div className="font-medium text-sm">{t(`${translationPrefix}.${item.id}.title`)}</div>
            <div className="text-xs text-muted-foreground truncate">{t(`${translationPrefix}.${item.id}.description`)}</div>
          </div>
        )}
      </button>
    );

    // Wrap in tooltip when collapsed
    if (isCollapsed) {
      return (
        <Tooltip key={item.id}>
          <TooltipTrigger asChild>
            {button}
          </TooltipTrigger>
          <TooltipContent side="right" className="flex flex-col gap-0.5">
            <span className="font-medium">{t(`${translationPrefix}.${item.id}.title`)}</span>
            <span className="text-xs text-muted-foreground">{t(`${translationPrefix}.${item.id}.description`)}</span>
          </TooltipContent>
        </Tooltip>
      );
    }

    return <div key={item.id}>{button}</div>;
  };

  return (
    <TooltipProvider delayDuration={0}>
      <nav
        className={cn(
          'settings-sidebar border-r border-border bg-muted/30 flex flex-col transition-all duration-300 ease-in-out',
          isCollapsed ? 'w-16' : 'w-80'
        )}
      >
        {/* Toggle button at top */}
        <div className={cn(
          'flex items-center border-b border-border p-2',
          isCollapsed ? 'justify-center' : 'justify-end'
        )}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleToggleCollapse}
                className="h-8 w-8"
                aria-label={isCollapsed ? t('sidebar.expand', 'Expand sidebar') : t('sidebar.collapse', 'Collapse sidebar')}
              >
                {isCollapsed ? (
                  <PanelLeft className="h-4 w-4" />
                ) : (
                  <PanelLeftClose className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {isCollapsed ? t('sidebar.expand', 'Expand sidebar') : t('sidebar.collapse', 'Collapse sidebar')}
            </TooltipContent>
          </Tooltip>
        </div>

        <ScrollArea className="flex-1">
          <div className={cn('space-y-6', isCollapsed ? 'p-2' : 'p-4')}>
            {/* APPLICATION Section */}
            <div>
              {!isCollapsed && (
                <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('tabs.app')}
                </h3>
              )}
              <div className="space-y-1">
                {appNavItemsConfig.map((item) =>
                  renderNavButton(
                    item,
                    activeTopLevel === 'app' && appSection === item.id,
                    () => {
                      onTopLevelChange('app');
                      onAppSectionChange(item.id);
                    },
                    'sections'
                  )
                )}

                {/* Re-run Wizard button */}
                {onRerunWizard && !isCollapsed && (
                  <button
                    onClick={() => {
                      onClose?.();
                      onRerunWizard();
                    }}
                    className={cn(
                      'w-full flex items-start gap-3 p-3 rounded-lg text-left transition-all mt-2',
                      'border border-dashed border-muted-foreground/30',
                      'hover:bg-accent/50 text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Sparkles className="h-5 w-5 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{t('actions.rerunWizard')}</div>
                      <div className="text-xs text-muted-foreground truncate">{t('actions.rerunWizardDescription')}</div>
                    </div>
                  </button>
                )}

                {/* Re-run Wizard button (collapsed mode with tooltip) */}
                {onRerunWizard && isCollapsed && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => {
                          onClose?.();
                          onRerunWizard();
                        }}
                        className={cn(
                          'w-full flex items-center justify-center p-3 rounded-lg transition-all mt-2',
                          'border border-dashed border-muted-foreground/30',
                          'hover:bg-accent/50 text-muted-foreground hover:text-foreground'
                        )}
                      >
                        <Sparkles className="h-5 w-5 shrink-0" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="flex flex-col gap-0.5">
                      <span className="font-medium">{t('actions.rerunWizard')}</span>
                      <span className="text-xs text-muted-foreground">{t('actions.rerunWizardDescription')}</span>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>

            {/* PROJECT Section */}
            <div>
              {!isCollapsed && (
                <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('tabs.project')}
                </h3>
              )}

              {/* Project Selector - only visible when expanded */}
              {!isCollapsed && (
                <div className="px-1 mb-3">
                  <ProjectSelector
                    selectedProjectId={selectedProjectId}
                    onProjectChange={onProjectChange}
                  />
                </div>
              )}

              {/* Project Nav Items */}
              <div className="space-y-1">
                {projectNavItemsConfig.map((item) =>
                  renderNavButton(
                    item,
                    activeTopLevel === 'project' && projectSection === item.id,
                    () => {
                      onTopLevelChange('project');
                      onProjectSectionChange(item.id);
                    },
                    'projectSections',
                    projectNavDisabled
                  )
                )}
              </div>
            </div>
          </div>

          {/* Version at bottom */}
          {version && !isCollapsed && (
            <div className="mt-8 pt-4 mx-4 border-t border-border">
              <p className="text-xs text-muted-foreground text-center">
                {t('updates.version')} {version}
              </p>
            </div>
          )}

          {/* Version tooltip when collapsed */}
          {version && isCollapsed && (
            <div className="mt-8 pt-4 mx-2 border-t border-border flex justify-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="text-xs text-muted-foreground text-center cursor-default">
                    v
                  </p>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {t('updates.version')} {version}
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </ScrollArea>
      </nav>
    </TooltipProvider>
  );
}

export { appNavItemsConfig, projectNavItemsConfig };
export type { NavItemConfig };
