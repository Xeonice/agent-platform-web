'use client';
import { useCommandPalette } from '@/hooks/workbench/useCommandPalette';
import { CommandPaletteView } from '@/views/workbench/CommandPalette.view';
import type { ProjectDto } from '@/types/project';
import type { Sandbox } from '@/types/domain';

export function CommandPaletteContainer(props: {
  projects: ProjectDto[];
  tasks: Sandbox[];
  pathname: string;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
  deferFocusRestore: () => void;
}) {
  const palette = useCommandPalette(props);
  return (
    <CommandPaletteView
      query={palette.query}
      onQueryChange={palette.setQuery}
      sections={palette.sections}
      activeId={palette.activeId}
      onActiveChange={palette.setSelectedId}
      onExecute={palette.execute}
      onKeyDown={palette.onKeyDown}
      onClose={props.onClose}
      onCloseAutoFocus={props.onCloseAutoFocus}
    />
  );
}
