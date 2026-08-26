"use client";

import Image from "next/image";
import { useState } from "react";

interface RepPhotoProps {
  bioguideId: string | null;
  firstName: string | undefined;
  lastName: string | undefined;
  /** Extra classes for the <img>. Use to override object-position. */
  imgClassName?: string;
  /** Extra classes for the initials fallback (font-size, etc.). */
  fallbackClassName?: string;
  /** Skip lazy-loading for above-the-fold photos. */
  priority?: boolean;
  /** Alt-text override; defaults to first + last name. */
  alt?: string;
}

/**
 * Bioguide-backed representative photo with an initials fallback.
 *
 * The wrapping element must be `position: relative` with a fixed width/height,
 * since the image uses Next.js `fill` layout.
 */
export function RepPhoto({
  bioguideId,
  firstName,
  lastName,
  imgClassName = "object-top",
  fallbackClassName = "text-2xl",
  priority = false,
  alt,
}: RepPhotoProps) {
  const [failed, setFailed] = useState(false);
  const initials = `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`;

  if (!bioguideId || failed) {
    return (
      <div
        className={`bg-sand font-heading wdth-110 text-ink flex h-full w-full items-center justify-center font-bold ${fallbackClassName}`}
      >
        {initials}
      </div>
    );
  }

  return (
    <Image
      src={`/api/photos/${bioguideId}`}
      alt={alt ?? `${firstName ?? ""} ${lastName ?? ""}`.trim()}
      fill
      sizes="(max-width: 640px) 80px, 120px"
      className={`pointer-events-none object-cover select-none ${imgClassName}`}
      draggable={false}
      priority={priority}
      onError={() => setFailed(true)}
      unoptimized
    />
  );
}
