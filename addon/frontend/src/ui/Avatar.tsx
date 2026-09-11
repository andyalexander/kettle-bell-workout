import { useState } from "react";

import type { Profile } from "../api";
import defaultAvatar from "./default-avatar.svg";

/**
 * A profile's picture, filling whatever circle holds it. Falls back to the
 * bundled default when there is no avatar yet or the image fails to load (#13).
 */
export function Avatar({ profile }: { readonly profile: Profile }) {
  const [failed, setFailed] = useState(false);
  const src = failed || !profile.avatar_url ? defaultAvatar : profile.avatar_url;

  return (
    <img
      src={src}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
      className="size-full rounded-full object-cover"
    />
  );
}
