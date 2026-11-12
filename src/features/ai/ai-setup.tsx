"use client";

import React from "react";
import Link from "next/link";
import { Link as MuiLink } from "@mui/material";

/**
 * IMP-102 — when a feature needs AI and none is set up, its message links
 * to the set-up. The server marks those failures with this code.
 */
export const AI_SETUP_PATH = "/settings/ai";
export const AI_NOT_SET_UP_CODE = "AI_NOT_SET_UP";

/** True for an `ApiError` from `apiFetch` that carries the set-up code. */
export function isAiNotSetUp(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === AI_NOT_SET_UP_CODE
  );
}

/** "Set up AI" link shown next to such a message. */
export function AiSetupLink({ onClick }: { onClick?: () => void }) {
  return (
    <MuiLink component={Link} href={AI_SETUP_PATH} onClick={onClick}>
      Set up AI
    </MuiLink>
  );
}

export const AI_NOT_SET_UP_MESSAGE = "AI is not set up yet.";

/** For raw `fetch` callers: whether a failed response means "set up AI". */
export async function aiSetupNeeded(response: Response): Promise<boolean> {
  if (response.status !== 503) return false;
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { code?: unknown } | null;
  return body?.code === AI_NOT_SET_UP_CODE;
}
