"use client";

import { useRouter } from "next/navigation";
import { Component, type ReactNode, startTransition } from "react";
import { Button } from "@/components/ui/button";

// One Home widget that failed to load shows "{Widget} not loaded." with
// Retry; the others still render (home spec, rule 10 and States).

type Props = { label: string; children: ReactNode };

export function WidgetBoundary({ label, children }: Props) {
  const router = useRouter();
  return (
    <Boundary label={label} retry={() => router.refresh()}>
      {children}
    </Boundary>
  );
}

class Boundary extends Component<Props & { retry: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-sm border border-line bg-surface px-[var(--spacing-card)] py-4">
        <span className="text-sm">{`${this.props.label} not loaded.`}</span>
        <Button
          className="ml-auto"
          onClick={() =>
            startTransition(() => {
              this.props.retry();
              this.setState({ failed: false });
            })
          }
        >
          Retry
        </Button>
      </div>
    );
  }
}
