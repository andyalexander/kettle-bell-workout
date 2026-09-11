import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { useState } from "react";

import type { Profile } from "../api";
import { createProfile, describeFailure } from "../api";
import { Avatar } from "../ui/Avatar";
import { CircleButton } from "../ui/CircleButton";
import { Page } from "../ui/Page";

interface ProfilePickerProps {
  readonly profiles: readonly Profile[];
  readonly onChoose: (profile: Profile) => void;
  /** A profile just created — by creating it, they have chosen it. */
  readonly onCreated: (profile: Profile) => void;
}

/**
 * Who is training (#19): one circle per profile, and a + circle that adds one by
 * name alone. Avatars, renames and deletes come with the routine builder.
 */
export function ProfilePicker({ profiles, onChoose, onCreated }: ProfilePickerProps) {
  const [adding, setAdding] = useState(false);

  if (adding) return <NewProfile onCancel={() => setAdding(false)} onCreated={onCreated} />;

  return (
    <Page title="Who's training?">
      <ul className="flex max-w-[1100px] flex-wrap justify-center gap-[5vmin]">
        {profiles.map((profile) => (
          <Tile key={profile.id} label={profile.name}>
            <CircleButton aria-label={profile.name}
              onClick={() => onChoose(profile)}
            >
              <Avatar profile={profile} />
            </CircleButton>
          </Tile>
        ))}
        <Tile label="New">
          <CircleButton
            variant="outline"
            aria-label="New profile"
            onClick={() => setAdding(true)}
          >
            <PlusIcon />
          </CircleButton>
        </Tile>
      </ul>
    </Page>
  );
}

/** A circle with its name beneath, wrapped rather than cut short. */
function Tile({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <li className="flex w-[28vmin] max-w-[200px] min-w-[110px] flex-col items-center gap-[1.5vmin]">
      {children}
      <p
        aria-hidden
        className="w-full text-center text-[clamp(20px,4.4vmin,44px)] leading-tight font-bold break-words"
      >
        {label}
      </p>
    </li>
  );
}

interface NewProfileProps {
  readonly onCancel: () => void;
  readonly onCreated: (profile: Profile) => void;
}

/** A name, and nothing else. The server says why a name won't do; we show it. */
function NewProfile({ onCancel, onCreated }: NewProfileProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      onCreated(await createProfile(name.trim()));
    } catch (failure) {
      setError(describeFailure(failure));
      setSaving(false);
    }
  };

  return (
    <Page title="New profile">
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="flex w-full max-w-[900px] flex-col items-center gap-[4vmin]"
      >
        <input
          autoFocus
          value={name}
          onChange={handleNameChange}
          placeholder="Name"
          aria-label="Name"
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="done"
          className="w-full rounded-[3vmin] bg-white/10 px-[4vmin] py-[3vmin] text-center text-[clamp(28px,7vmin,80px)] font-bold ring-[3px] ring-white/30 outline-none ring-inset placeholder:text-white/35 focus:ring-white"
        />
        <p
          role="alert"
          className="min-h-[1.2em] text-center text-[clamp(18px,4vmin,42px)] font-semibold text-red-300"
        >
          {error}
        </p>
        <div className="flex flex-wrap justify-center gap-[3vmin]">
          <CircleButton type="submit" disabled={saving || !name.trim()}>
            Add
          </CircleButton>
          <CircleButton variant="outline" onClick={onCancel}>
            Cancel
          </CircleButton>
        </div>
      </form>
    </Page>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-1/2" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
      <path d="M12 4v16M4 12h16" />
    </svg>
  );
}
