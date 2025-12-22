import type { ComponentType } from 'react';

export type SidebarType =
  | 'notifications'
  | 'post'
  | 'post-create'
  | 'brand-profile'
  | 'asset'
  | 'asset-upload'
  | 'weekly-calendar'
  | (string & {});

export interface SidebarRegistration {
  title: string;
  // The ID param is optional for things like notifications; required for post
  Component: ComponentType<{ id?: string }>;
  // Default width in pixels (desktop). We will translate to percentage at runtime.
  defaultWidthPx?: number;
}

// Populated at runtime when sidebars are imported.
export const SidebarRegistry: Record<SidebarType, SidebarRegistration> = {} as any;
