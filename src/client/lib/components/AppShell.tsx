import type { ReactNode } from "react";

export type AppShellProps = {
  /** The `Sidebar`, which brings its own `aside`; empty when the sidebar is closed. */
  sidebar: ReactNode;
  /** The `TopBar`, which brings its own sticky `header`. */
  topBar: ReactNode;
  /** The current screen. */
  children: ReactNode;
};

/**
 * The signed-in app's frame (S69): the sidebar beside a column holding the top
 * bar above `main`. A layout only — it places its slots and never looks inside.
 */
// r[impl platform.shell.layout-slots]
export function AppShell({ sidebar, topBar, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen">
      {sidebar}
      <div className="flex min-w-0 flex-1 flex-col">
        {topBar}
        <main className="mx-auto w-full max-w-7xl flex-1 px-6 pt-6 pb-16">{children}</main>
      </div>
    </div>
  );
}
