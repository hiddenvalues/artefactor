import { useEffect, useId, useRef, useState } from "react";
import { Clock, Copy, Lock } from "lucide-react";
import type { LinkGateSummary } from "../../../shared/contracts";
import { Button } from "$lib/components/ui/button";
import { Checkbox } from "$lib/components/ui/checkbox";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "$lib/components/ui/select";
import {
  EXPIRY_CHOICES,
  copyText,
  enablePassword,
  formError,
  formFor,
  type ExpiryChoice,
  type LinkProtectionForm,
} from "../link-protection";

// S32a — the "Link protection" section of the visibility picker: a password
// and/or an expiry on a public link. `publish` rides along with the change to
// Public; `edit` changes the gate of an artefact that is already public. With
// `onSubmit` it keeps its own form behind a Cancel / submit footer (the
// popovers); without, it is controlled — S55's Manage access dialog binds
// `form` to its draft and decides `error` itself.
export function LinkProtection({
  mode = "edit",
  current = null,
  submitLabel = "Save",
  onSubmit,
  onCancel,
  form: boundForm,
  onChange,
  error: boundError,
}: {
  mode?: "publish" | "edit";
  current?: LinkGateSummary | null;
  submitLabel?: string;
  onSubmit?: (form: LinkProtectionForm) => void;
  onCancel?: () => void;
  form?: LinkProtectionForm;
  onChange?: (form: LinkProtectionForm) => void;
  error?: string | null;
}) {
  // Seeded once from the gate being edited; the owner's edits live here after.
  const [ownForm, setOwnForm] = useState<LinkProtectionForm>(() => formFor(mode === "edit" ? current : null));
  const form = boundForm ?? ownForm;
  const setForm = onChange ?? setOwnForm;
  const [copyLabel, setCopyLabel] = useState<"Copy" | "Copied" | "Copy failed">("Copy");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  const errorId = useId();

  const error = boundError !== undefined ? boundError : formError(form, new Date());
  // The inline error is read with whichever field it is about.
  const describedBy = error ? errorId : undefined;

  function togglePassword(on: boolean) {
    setForm(on ? enablePassword(form) : { ...form, requirePassword: false, keepPassword: false });
  }

  async function copy() {
    setCopyLabel(await copyText(navigator.clipboard, form.password));
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyLabel("Copy"), 1600);
  }

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex flex-col gap-3 p-2">
      <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Link protection</span>

      <div className="flex flex-col gap-2">
        {form.keepPassword ? (
          <div className="flex items-center gap-2 text-sm">
            <Lock className="size-3.5" />
            <span className="flex-1">Password set</span>
            <Button variant="outline" size="sm" onClick={() => togglePassword(true)}>
              Change
            </Button>
            <Button variant="outline" size="sm" onClick={() => togglePassword(false)}>
              Clear
            </Button>
          </div>
        ) : (
          <>
            <Label className="flex cursor-pointer items-center gap-2 font-normal">
              <Checkbox checked={form.requirePassword} onCheckedChange={(v) => togglePassword(v === true)} />
              Require a password
            </Label>
            {form.requirePassword && (
              <>
                <div className="flex gap-1.5">
                  <Input
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    aria-label="Link password"
                    aria-describedby={describedBy}
                    aria-invalid={error ? true : undefined}
                    autoComplete="off"
                    spellCheck={false}
                    className="h-8 font-mono"
                  />
                  <Button variant="outline" size="sm" onClick={copy} title="Copy the password">
                    <Copy />
                    {copyLabel}
                  </Button>
                </div>
                <span className="text-xs text-muted-foreground">
                  Share it with the people you send the link to. It is shown only now.
                </span>
              </>
            )}
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {form.keepExpiry ? (
          <div className="flex items-center gap-2 text-sm">
            <Clock className="size-3.5" />
            <span className="flex-1">
              {current?.expiresAt ? `Expires ${fmtDate(current.expiresAt)}` : "Never expires"}
            </span>
            <Button variant="outline" size="sm" onClick={() => setForm({ ...form, keepExpiry: false })}>
              Change
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm">
              <span className="shrink-0">Link expires</span>
              <Select value={form.expiry} onValueChange={(v) => setForm({ ...form, expiry: v as ExpiryChoice })}>
                <SelectTrigger size="sm" className="flex-1" aria-label="Link expires" aria-describedby={describedBy}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_CHOICES.map((choice) => (
                    <SelectItem key={choice.value} value={choice.value}>
                      {choice.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.expiry === "custom" && (
              <Input
                type="datetime-local"
                value={form.customExpiry}
                onChange={(e) => setForm({ ...form, customExpiry: e.target.value })}
                aria-label="Expiry"
                aria-describedby={describedBy}
                className="h-8"
              />
            )}
          </>
        )}
      </div>

      {error && (
        <span id={errorId} className="text-xs text-destructive">
          {error}
        </span>
      )}

      {onSubmit && (
        <div className="flex justify-end gap-1.5">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" disabled={error !== null} onClick={() => onSubmit(form)}>
            {submitLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
