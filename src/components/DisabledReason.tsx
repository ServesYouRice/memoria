import React from "react";
import { Typography } from "@mui/material";

/**
 * A short line beside a greyed-out button that says why it cannot be used
 * yet (IMP-086). Renders nothing while the button is usable. Give the button
 * `aria-describedby={id}` so screen readers hear the reason too.
 */
export function DisabledReason({
  id,
  show,
  children,
}: {
  id: string;
  show: boolean;
  children: React.ReactNode;
}) {
  if (!show) return null;
  return (
    <Typography
      id={id}
      variant="caption"
      component="span"
      sx={{ color: "text.secondary", alignSelf: "center" }}
    >
      {children}
    </Typography>
  );
}
