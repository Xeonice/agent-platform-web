// Settings use the v2 canvas, structural borders and 64px page header.
import type { ReactNode } from 'react';

export interface SettingsLayoutProps {
  menu?: ReactNode;
  hideHeader?: boolean;
  width?: 'form' | 'wide';
  pageTitle: string;
  children: ReactNode;
}

export function SettingsLayoutView({
  menu,
  hideHeader = false,
  width = 'form',
  pageTitle,
  children,
}: SettingsLayoutProps) {
  return (
    <div className="flex h-full w-full bg-background text-foreground">
      {menu}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!hideHeader && (
          <header className="flex h-14 shrink-0 items-center border-b border-[var(--v2-border-subtle)] px-4 md:px-6">
            <h1 className="text-base font-semibold tracking-[-0.02em]">{pageTitle}</h1>
          </header>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div
            data-width={width}
            className={`w-full p-4 md:p-8 ${width === 'wide' ? 'max-w-none' : 'max-w-[832px]'}`}
          >
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
