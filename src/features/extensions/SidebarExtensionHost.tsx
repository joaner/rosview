import React from 'react';
import type { RosViewExtensionContext, SidebarTabContribution } from '@/core/extensions/types';

interface SidebarExtensionHostProps {
  contribution: SidebarTabContribution;
  context: RosViewExtensionContext;
}

class ExtensionRenderBoundary extends React.Component<{ extensionId: string; children: React.ReactNode }, { hasError: boolean }> {
  state: { hasError: boolean } = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    console.error(`[RosView] sidebar extension "${this.props.extensionId}" crashed`, error);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

const SidebarExtensionContent = React.memo(function SidebarExtensionContent({
  contribution,
  context,
}: SidebarExtensionHostProps) {
  return (
    <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
      {contribution.render(context)}
    </div>
  );
});

export const SidebarExtensionHost: React.FC<SidebarExtensionHostProps> = React.memo(function SidebarExtensionHost({
  contribution,
  context,
}) {
  return (
    <ExtensionRenderBoundary extensionId={contribution.id}>
      <SidebarExtensionContent contribution={contribution} context={context} />
    </ExtensionRenderBoundary>
  );
});
