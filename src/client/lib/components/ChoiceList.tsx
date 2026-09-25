import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { LucideIcon } from "lucide-react";
import { Label } from "$lib/components/ui/label";
import { RadioGroup, RadioGroupItem } from "$lib/components/ui/radio-group";
import { cn } from "../utils";

export interface Choice<T extends string> {
  value: T;
  label: string;
  desc: string;
  icon?: LucideIcon;
}

// A radio list whose choice takes effect at once — a click, Space or Enter
// commits it. Arrow keys only move the selection: a radio checks on every
// arrow press, and a commit there would fire a visibility change per keypress.
export function ChoiceList<T extends string>({
  choices,
  value,
  onChoose,
  bordered = false,
  className,
}: {
  choices: readonly Choice<T>[];
  value: T | undefined;
  onChoose: (v: T) => void;
  // The collection editor's roomier variant: each choice in its own box.
  bordered?: boolean;
  className?: string;
}) {
  const id = useId();
  const arrowing = useRef(false);
  const [pending, setPending] = useState<T | null>(null);

  function onKeyDown(e: KeyboardEvent) {
    arrowing.current = e.key.startsWith("Arrow");
    if ((e.key === "Enter" || e.key === " ") && pending !== null) {
      e.preventDefault();
      setPending(null);
      onChoose(pending);
    }
  }

  return (
    <RadioGroup
      value={pending ?? value ?? ""}
      onValueChange={(v) => {
        if (arrowing.current) setPending(v as T);
        else {
          setPending(null);
          onChoose(v as T);
        }
      }}
      onKeyDown={onKeyDown}
      onPointerDown={() => (arrowing.current = false)}
      className={cn(bordered ? "gap-1.5" : "gap-0.5", className)}
    >
      {choices.map((c) => {
        const Icon = c.icon;
        const checked = (pending ?? value) === c.value;
        return (
          <Label
            key={c.value}
            htmlFor={`${id}-${c.value}`}
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-md p-2 font-normal hover:bg-accent",
              bordered && "border",
              checked && "bg-accent",
              bordered && checked && "border-primary",
            )}
          >
            <RadioGroupItem id={`${id}-${c.value}`} value={c.value} className="mt-0.5" />
            {Icon && <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{c.label}</span>
              <span className="block text-xs text-muted-foreground">{c.desc}</span>
            </span>
          </Label>
        );
      })}
    </RadioGroup>
  );
}
