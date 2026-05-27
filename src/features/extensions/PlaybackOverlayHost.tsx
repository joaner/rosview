import React from 'react';
import type { PlaybackOverlayContribution, RosViewExtensionContext } from '@/core/extensions/types';

interface PlaybackOverlayHostProps {
  overlays?: PlaybackOverlayContribution[];
  context: RosViewExtensionContext;
}

class ExtensionRenderBoundary extends React.Component<
  { extensionId: string; children: React.ReactNode },
  { hasError: boolean }
> {
  state: { hasError: boolean } = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    console.error(`[RosView] playback extension "${this.props.extensionId}" crashed`, error);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

function sortByOrder(a: { order?: number }, b: { order?: number }): number {
  return (a.order ?? 0) - (b.order ?? 0);
}

const PlaybackOverlayItem = React.memo(function PlaybackOverlayItem({
  overlay,
  context,
}: {
  overlay: PlaybackOverlayContribution;
  context: RosViewExtensionContext;
}) {
  return (
    <ExtensionRenderBoundary extensionId={overlay.id}>
      <div
        data-testid={`playback-overlay-${overlay.id}`}
        style={overlay.height == undefined ? undefined : { height: overlay.height }}
      >
        {overlay.render(context)}
      </div>
    </ExtensionRenderBoundary>
  );
});

export const PlaybackOverlayHost: React.FC<PlaybackOverlayHostProps> = ({ overlays, context }) => {
  const ordered = React.useMemo(() => [...(overlays ?? [])].sort(sortByOrder), [overlays]);
  if (ordered.length === 0) {
    return null;
  }
  return (
    <>
      {ordered.map((overlay) => (
        <PlaybackOverlayItem key={overlay.id} overlay={overlay} context={context} />
      ))}
    </>
  );
};
