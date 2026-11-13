"use client";

import React, { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Skeleton,
  Typography,
} from "@mui/material";

export interface SavedCopyResponse {
  url: string | null;
  copy: {
    text: string | null;
    readAt: string | null;
    archiveUrl: string | null;
  } | null;
  archivePending?: boolean;
}

export function savedCopyDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "long" });
}

/**
 * "Read saved copy" (IMP-094): the text Memoria kept of a saved link's page,
 * and when it was made. The text came from a website, so it is shown as
 * plain text only.
 */
export function SavedCopyDialog({
  itemId,
  onClose,
}: {
  itemId: string | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<SavedCopyResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!itemId) return;
    setData(null);
    setFailed(false);
    const controller = new AbortController();
    void fetch(`/api/v1/canvas-items/${encodeURIComponent(itemId)}/page-copy`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Saved copy request failed");
        setData((await response.json()) as SavedCopyResponse);
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setFailed(true);
      });
    return () => controller.abort();
  }, [itemId]);

  const copy = data?.copy;
  return (
    <Dialog
      open={Boolean(itemId)}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      aria-labelledby="saved-copy-title"
    >
      <DialogTitle id="saved-copy-title">Saved copy</DialogTitle>
      <DialogContent dividers>
        {failed && (
          <Alert severity="error">Could not load the saved copy.</Alert>
        )}
        {!failed && !data && <Skeleton variant="rounded" height={160} />}
        {data && (
          <>
            {copy?.text ? (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {copy.readAt
                  ? `Copy of the page's text, made on ${savedCopyDate(copy.readAt)}.`
                  : "Copy of the page's text."}
                {data.url && (
                  <>
                    {" "}
                    From{" "}
                    <Box component="span" sx={{ wordBreak: "break-all" }}>
                      {data.url}
                    </Box>
                  </>
                )}
              </Typography>
            ) : (
              <Typography variant="body2" sx={{ mb: 2 }}>
                There is no saved copy yet. Memoria keeps one when it reads the
                page, shortly after the link is saved, unless the page could not
                be read.
              </Typography>
            )}
            {copy?.archiveUrl && (
              <Typography variant="body2" sx={{ mb: 2 }}>
                <Link
                  href={copy.archiveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open the web-archive copy
                </Link>
              </Typography>
            )}
            {data.archivePending && !copy?.archiveUrl && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Looking for a web-archive copy. Open this again in a minute.
              </Typography>
            )}
            {copy?.text && (
              <Typography
                component="div"
                variant="body1"
                data-testid="saved-copy-text"
                sx={{
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  maxHeight: "60vh",
                  overflowY: "auto",
                }}
              >
                {copy.text}
              </Typography>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
