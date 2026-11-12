"use client";

import React, { useState } from "react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import {
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";
import {
  AddBoxOutlined as BlankIcon,
  InboxOutlined as InboxIcon,
  LinkOutlined as LinkIcon,
} from "@mui/icons-material";
import { buildShareTargetHref } from "@/app/share-target/shared-link";

/** A typed address becomes a URL; "example.com" gets https://. */
export function normalizeLink(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

type Tile = {
  label: string;
  hint: string;
  icon: React.ElementType;
} & ({ href: string } | { onClick: () => void });

function StarterTile({ tile }: { tile: Tile }) {
  const Icon = tile.icon;
  const linkProps =
    "href" in tile
      ? // /inbox only redirects, so there is nothing worth prefetching.
        { component: NextLink, href: tile.href, prefetch: false }
      : { onClick: tile.onClick };
  return (
    <ButtonBase
      {...linkProps}
      focusRipple
      sx={{
        display: "flex",
        // Phones: icon over a short label, three across (IMP-083).
        flexDirection: { xs: "column", sm: "row" },
        justifyContent: { xs: "center", sm: "flex-start" },
        gap: { xs: 0.75, sm: 1.5 },
        minHeight: 64,
        px: { xs: 1, sm: 2 },
        py: 1.5,
        borderRadius: 3,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
        textAlign: { xs: "center", sm: "left" },
        transition: "border-color 0.15s ease",
        "&:hover": { borderColor: "primary.main" },
        "&.Mui-focusVisible": {
          outline: "2px solid",
          outlineColor: "primary.main",
          outlineOffset: 2,
        },
      }}
    >
      <Box
        sx={{
          width: 40,
          height: 40,
          flexShrink: 0,
          borderRadius: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "primary.main",
          bgcolor: "action.hover",
        }}
      >
        <Icon />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography
          variant="subtitle2"
          component="span"
          sx={{ display: "block" }}
        >
          {tile.label}
        </Typography>
        <Typography
          variant="caption"
          component="span"
          sx={{
            display: { xs: "none", sm: "block" },
            color: "text.secondary",
          }}
        >
          {tile.hint}
        </Typography>
      </Box>
    </ButtonBase>
  );
}

/**
 * First steps on the dashboard (IMP-083): start a blank canvas, save a link
 * to the Inbox, or open the Inbox.
 */
export function StarterRow({ onBlankCanvas }: { onBlankCanvas: () => void }) {
  const router = useRouter();
  const [linkOpen, setLinkOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [touched, setTouched] = useState(false);
  const link = normalizeLink(address);

  const closeLink = () => {
    setLinkOpen(false);
    setAddress("");
    setTouched(false);
  };

  const saveLink = () => {
    setTouched(true);
    if (!link) return;
    // The share-target page saves to the Inbox after an explicit "Save".
    router.push(buildShareTargetHref({ url: link }));
    closeLink();
  };

  const tiles: Tile[] = [
    {
      label: "Blank canvas",
      hint: "Start from an empty page",
      icon: BlankIcon,
      onClick: onBlankCanvas,
    },
    {
      label: "Save a link",
      hint: "Keep a web page in your Inbox",
      icon: LinkIcon,
      onClick: () => setLinkOpen(true),
    },
    {
      label: "Open Inbox",
      hint: "See what you saved lately",
      icon: InboxIcon,
      href: "/inbox",
    },
  ];

  return (
    <>
      <Box
        component="nav"
        aria-label="Get started"
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 1.5,
          mb: 3,
        }}
      >
        {tiles.map((tile) => (
          <StarterTile key={tile.label} tile={tile} />
        ))}
      </Box>

      <Dialog open={linkOpen} onClose={closeLink} maxWidth="sm" fullWidth>
        <Box
          component="form"
          noValidate
          onSubmit={(event: React.FormEvent) => {
            event.preventDefault();
            saveLink();
          }}
        >
          <DialogTitle sx={{ fontWeight: 600 }}>Save a link</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              margin="dense"
              label="Web address"
              type="url"
              inputMode="url"
              fullWidth
              placeholder="https://example.com/article"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              error={touched && !link}
              helperText={
                touched && !link
                  ? "Enter a web address, like example.com/article"
                  : "It goes to your Inbox; you can move it to any canvas later."
              }
            />
          </DialogContent>
          <DialogActions sx={{ p: 3, pt: 1 }}>
            <Button onClick={closeLink}>Cancel</Button>
            <Button type="submit" variant="contained">
              Continue
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </>
  );
}
