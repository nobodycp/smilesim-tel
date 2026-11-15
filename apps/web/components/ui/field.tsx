"use client";

import * as React from "react";
import { Slot } from "radix-ui";
import { cva } from "class-variance-authority";
import { cn } from "../../lib/cn";
import { Label, type LabelTone } from "./label";

/*
 * A labelled field with its help and its error (Tailwind migration T2.2, ADR 0022): the label names the control by
 * `htmlFor`, and the control gets the id, `aria-describedby` (the help, then the error) and `aria-invalid` while there
 * is an error, through Radix `Slot`, so the one child (an `Input`, a `Textarea`, a `Select`, a `NameField`'s input…)
 * keeps its own tag and props. The help and the error sit outside the label, so they are the control's description,
 * not part of its name.
 * The look follows the legacy label tones (`Label`): the gap between the parts is the tone's label gap; the help is the
 * legacy `.hint` (12px `--rd-text-sm`, `--rd-muted`, no margin; medium weight in a dialog, `.dialog-body label .hint`);
 * the error is the same line in `--rd-danger` (graphite.css `.hint.field-error`).
 */
const fieldVariants = cva("grid min-w-0", {
  variants: {
    tone: { page: "gap-1.5", pane: "gap-1", dialog: "gap-1" },
  },
  defaultVariants: { tone: "page" },
});

const noteVariants = cva("m-0 text-sm", {
  variants: {
    tone: { page: "", pane: "", dialog: "font-medium" },
    error: { true: "text-danger", false: "text-muted" },
  },
  defaultVariants: { tone: "page", error: false },
});

export interface FieldProps {
  label: React.ReactNode;
  /** A line under the control that helps fill it. */
  hint?: React.ReactNode;
  /** What is wrong with the value; the control is marked invalid while it is set. */
  error?: React.ReactNode;
  tone?: LabelTone;
  /** The control's id (the label points at it). Pass it here, not on the control: the control's own id would win. */
  id?: string;
  className?: string;
  /** The one control. */
  children: React.ReactElement;
}

export function Field({ label, hint, error, tone = "page", id, className, children }: FieldProps) {
  const auto = React.useId();
  const controlId = id ?? auto;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div data-slot="field" className={cn(fieldVariants({ tone }), className)}>
      <Label htmlFor={controlId} tone={tone}>
        {label}
      </Label>
      <Slot.Root id={controlId} aria-describedby={describedBy} aria-invalid={error ? true : undefined}>
        {children}
      </Slot.Root>
      {hint ? (
        <p id={hintId} className={noteVariants({ tone })}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className={noteVariants({ tone, error: true })}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
