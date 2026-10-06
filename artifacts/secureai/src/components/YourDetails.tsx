import React, { useState } from "react";
import { useUpdateUser } from "@workspace/api-client-react";
import { Button, Input, Label } from "./ui";
import { useAuth } from "../contexts/AuthContext";

// Privacy policy section 11 (correction): change the name on your account yourself. An email
// address is the sign-in identity, so changing it still goes through us (the policy says so).
const NAME_MAX = 100;

export function YourDetails() {
  const { user, refetchUser } = useAuth();
  const updateMutation = useUpdateUser();
  const [name, setName] = useState(user?.name ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  if (!user) return null;

  const trimmed = name.trim();
  const unchanged = trimmed === user.name;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    try {
      await updateMutation.mutateAsync({
        id: user.id,
        data: { name: trimmed },
      });
      refetchUser();
      setMessage({ ok: true, text: "Name saved." });
    } catch (err: any) {
      setMessage({
        ok: false,
        text: err?.data?.error || "Could not save your name. Try again.",
      });
    }
  };

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="your-name">Name</Label>
        <Input
          id="your-name"
          value={name}
          maxLength={NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          data-testid="input-your-name"
        />
      </div>
      <p className="text-xs font-mono text-muted-foreground">
        Email: {user.email}. To change your email address, contact us.
      </p>
      <Button
        type="submit"
        variant="outline"
        disabled={!trimmed || unchanged}
        isLoading={updateMutation.isPending}
        data-testid="button-save-name"
      >
        Save name
      </Button>
      {message && (
        <p
          className={`font-mono text-xs ${message.ok ? "text-primary" : "text-destructive"}`}
          data-testid="your-details-message"
        >
          {message.text}
        </p>
      )}
    </form>
  );
}
