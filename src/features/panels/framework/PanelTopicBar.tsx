import React from 'react';
import { cn } from '@/shared/lib/utils';

export interface PanelTopicBarProps {
  className?: string;
  children: React.ReactNode;
}

/**
 * Shared container for a panel's top "topic picker" row (`TopicQuickPicker`
 * plus any adjacent controls). Height comes purely from the row's content
 * (the picker's own `h-8` trigger) with horizontal-only padding, so every
 * panel using this gets the same compact height instead of each hand-rolling
 * its own wrapper with inconsistent vertical padding. Colors/borders stay
 * overridable via `className` (e.g. Image panel's permanently-dark chrome)
 * since panels can differ there while sharing the same box model.
 */
export const PanelTopicBar: React.FC<PanelTopicBarProps> = ({ className, children }) => (
  <div
    data-testid="panel-topic-bar"
    className={cn('flex shrink-0 items-center gap-2 border-b border-border bg-muted px-2', className)}
  >
    {children}
  </div>
);
