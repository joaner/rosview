import React from 'react';
import { cn } from '@/shared/lib/utils';
import { Navbar } from '@/features/workspace/navbar/Navbar';
import { WelcomeScreen } from '@/features/workspace/common/WelcomeScreen';
import { LoadingOverlay } from '@/features/workspace/common/LoadingOverlay';
import { Skeleton } from '@/shared/ui/skeleton';
import { SampleDatasetDialog } from '@/features/workspace/common/SampleDatasetDialog';
import type { SampleDataset } from '@/services/sampleDatasets';
import type { DatasetHistoryListItem } from '@/shared/utils/datasetHistory';

export interface RosViewerLandingScreenProps {
  className?: string;
  style?: React.CSSProperties;
  fileInputId: string;
  tarInputId: string;

  sourceName?: string;
  sourceLoading?: boolean;
  theme?: 'light' | 'dark' | 'system';
  language?: 'en' | 'zh' | 'ja';
  onThemeChange: (theme: 'light' | 'dark' | 'system') => void;
  onLanguageChange: (language: 'en' | 'zh' | 'ja') => void;
  showLanguageSwitcher: boolean;
  showThemeSwitcher: boolean;
  showNavbarBrand: boolean;
  navbarBrandLabel?: string;
  onBrandClick: () => void;

  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onAddFilesFromPicker: (fileList: FileList | null) => void;
  onLocalTarSelected: (file: File) => void;

  onOpenFilePick: () => void;
  onOpenDirectory: () => void;
  onOpenRemotePrompt: () => void;
  onOpenSampleDialog: () => void;
  onSubmitRemoteUrl: (url: string) => void | Promise<void>;
  remoteSubmitLoading?: boolean;
  onSelectSample: (sample: SampleDataset) => void | Promise<void>;
  historyItems?: DatasetHistoryListItem[];
  onReplayHistory?: (id: string) => void | Promise<void>;

  manualOpenHint?: string | null;
  /** Shows a loading skeleton + cancel overlay instead of the welcome screen while a source is actively loading. */
  showLoadingSkeleton?: boolean;
  loadingSourceName?: string;
  onCancelLoading?: () => void;

  sampleDialogOpen: boolean;
  onSampleDialogOpenChange: (open: boolean) => void;

  /**
   * When `false`, the hidden file/tar `<input>`s are not rendered here —
   * used when a caller renders them itself outside this component so they
   * stay mounted (and clickable via `document.getElementById`) even while
   * this screen itself isn't, e.g. `RosViewerImpl`'s "has a source, but the
   * player isn't ready yet" case needs `#rosview-inline-file` reachable
   * from history-replay even once a player exists and this screen unmounts.
   * @default true
   */
  renderHiddenInputs?: boolean;
}

/**
 * The "no player yet" screen: navbar + either a loading skeleton (source
 * actively loading, no error/hint yet) or the welcome/open-a-recording
 * screen, plus the hidden file/tar `<input>`s and sample dialog every open
 * flow needs. Shared by `RosViewerImpl`'s pre-source landing page and its
 * "has a source, player not ready yet" fallback — those two were
 * previously ~60 lines of near-duplicated JSX each.
 */
export const RosViewerLandingScreen: React.FC<RosViewerLandingScreenProps> = ({
  className,
  style,
  fileInputId,
  tarInputId,
  sourceName,
  sourceLoading,
  theme,
  language,
  onThemeChange,
  onLanguageChange,
  showLanguageSwitcher,
  showThemeSwitcher,
  showNavbarBrand,
  navbarBrandLabel,
  onBrandClick,
  onDragOver,
  onDrop,
  onAddFilesFromPicker,
  onLocalTarSelected,
  onOpenFilePick,
  onOpenDirectory,
  onOpenRemotePrompt,
  onOpenSampleDialog,
  onSubmitRemoteUrl,
  remoteSubmitLoading,
  onSelectSample,
  historyItems,
  onReplayHistory,
  manualOpenHint,
  showLoadingSkeleton,
  loadingSourceName,
  onCancelLoading,
  sampleDialogOpen,
  onSampleDialogOpenChange,
  renderHiddenInputs = true,
}) => {
  return (
    <div
      className={cn('flex h-screen flex-col overflow-hidden bg-background text-foreground', className)}
      style={style}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <Navbar
        sourceName={sourceName}
        sourceLoading={sourceLoading}
        theme={theme}
        language={language}
        onThemeChange={onThemeChange}
        onLanguageChange={onLanguageChange}
        showLanguageSwitcher={showLanguageSwitcher}
        showThemeSwitcher={showThemeSwitcher}
        showNavbarBrand={showNavbarBrand}
        brandLabel={navbarBrandLabel}
        onBrandClick={onBrandClick}
        onOpenFilePick={onOpenFilePick}
        onOpenDirectory={onOpenDirectory}
        onOpenTarPick={() => document.getElementById(tarInputId)?.click()}
        onOpenRemotePrompt={onOpenRemotePrompt}
        onOpenSampleDialog={onOpenSampleDialog}
        recentHistoryItems={historyItems?.slice(0, 10)}
        onReplayHistory={onReplayHistory}
      />
      {showLoadingSkeleton && !manualOpenHint ? (
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="min-h-0 flex-1 rounded-lg" />
          </div>
          <LoadingOverlay sourceName={loadingSourceName} onCancel={onCancelLoading} />
        </div>
      ) : (
        <WelcomeScreen
          manualOpenHint={manualOpenHint}
          onOpenFile={onOpenFilePick}
          onOpenDirectory={onOpenDirectory}
          onOpenTarPicker={() => document.getElementById(tarInputId)?.click()}
          onSubmitRemoteUrl={onSubmitRemoteUrl}
          remoteSubmitLoading={remoteSubmitLoading}
          onSelectSample={onSelectSample}
          historyItems={historyItems}
          onReplayHistory={onReplayHistory}
        />
      )}
      {renderHiddenInputs ? (
        <>
          <input
            id={fileInputId}
            type="file"
            name={fileInputId}
            accept=".mcap,.bag,.db3,.hdf5,.h5,.bvh"
            multiple
            className="hidden"
            onChange={(e) => {
              onAddFilesFromPicker(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            id={tarInputId}
            type="file"
            name={tarInputId}
            accept=".tar,.tgz,.tar.gz,application/x-tar"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onLocalTarSelected(f);
              e.target.value = '';
            }}
          />
        </>
      ) : null}
      <SampleDatasetDialog
        open={sampleDialogOpen}
        onOpenChange={onSampleDialogOpenChange}
        onSelect={onSelectSample}
      />
    </div>
  );
};
