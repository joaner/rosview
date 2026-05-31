import React from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AlignCenter,
  BarChart2,
  Box,
  FileText,
  HelpCircle,
  ImageIcon,
  Music,
  Navigation,
  Network,
} from 'lucide-react';
import type { PanelType } from './types';

export const PANEL_ICONS: Partial<Record<PanelType, LucideIcon>> = {
  Image: ImageIcon,
  Plot: Activity,
  JointStatePlot: Activity,
  '3D': Box,
  Audio: Music,
  Pose: Navigation,
  RawMessages: FileText,
  Timeline: BarChart2,
  TopicGraph: Network,
  Align: AlignCenter,
};

export function getPanelIcon(type: PanelType): LucideIcon {
  return PANEL_ICONS[type] ?? HelpCircle;
}

export interface PanelTypeIconProps {
  type: PanelType;
  className?: string;
}

export const PanelTypeIcon: React.FC<PanelTypeIconProps> = ({ type, className = 'h-4 w-4' }) => {
  const Icon = getPanelIcon(type);
  return React.createElement(Icon, { className });
};
