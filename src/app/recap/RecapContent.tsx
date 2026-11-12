"use client";

import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Chip,
  Link,
  List,
  ListItem,
  ListItemText,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import {
  Inventory2Outlined as ArchiveIcon,
  Undo as UndoIcon,
  EventNoteOutlined as RecapIcon,
} from "@mui/icons-material";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import NextLink from "next/link";
import { useRevertChangeSet } from "@/lib/hooks/use-agent-control";
import { openSavedLink } from "@/lib/bookmarks/open-link";

interface RecapLink {
  id: string;
  title: string;
  url: string;
}

interface StaleLink extends RecapLink {
  summary: string | null;
  board: { id: string; name: string };
  lastTouchedAt: string;
}

export interface WeeklyRecapView {
  id: string;
  weekStart: string;
  periodStart: string;
  periodEnd: string;
  savedCount: number;
  savedLinks: RecapLink[];
  suggestedPiles: { title: string; itemCount: number }[];
  staleWeeks: number;
  staleCount: number;
  staleLinks: StaleLink[];
  archived: { changeSetId: string; archivedAt: string | null } | null;
}

const RECAP_QUERY_KEY = ["weekly-recap", "latest"] as const;

function LinkTitle({ link }: { link: RecapLink }) {
  return (
    <Link
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      underline="hover"
      onClick={(event) => {
        // Open through the helper so the open is recorded for the recap.
        event.preventDefault();
        openSavedLink(link);
      }}
    >
      {link.title}
    </Link>
  );
}

/** IMP-070: the latest weekly recap with one-tap archiving of old links. */
export function RecapContent() {
  const queryClient = useQueryClient();
  const revert = useRevertChangeSet();
  const query = useQuery({
    queryKey: RECAP_QUERY_KEY,
    queryFn: async () => {
      const response = await fetch("/api/v1/recaps/latest");
      if (!response.ok) throw new Error("Failed to load the recap");
      return (await response.json()) as { recap: WeeklyRecapView | null };
    },
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: RECAP_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ["trash"] }),
    ]);

  const undo = (changeSetId: string) =>
    revert
      .mutateAsync(changeSetId)
      .then(async () => {
        toast.success("Links are back on their canvases");
        await refresh();
      })
      .catch(() => toast.error("That could not be undone"));

  const archive = useMutation({
    mutationFn: async (recapId: string) => {
      const response = await fetch(
        `/api/v1/recaps/${encodeURIComponent(recapId)}/archive`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error("Archive failed");
      return (await response.json()) as {
        changeSetId: string;
        archivedItemCount: number;
      };
    },
    onSuccess: async (result) => {
      toast.success(
        `Archived ${result.archivedItemCount} ${result.archivedItemCount === 1 ? "link" : "links"}`,
        {
          action: {
            label: "Undo",
            onClick: () => void undo(result.changeSetId),
          },
        },
      );
      await refresh();
    },
    onError: () =>
      toast.error("Could not archive the links. Refresh and try again."),
  });

  const recap = query.data?.recap;

  return (
    <>
      <PageHeader
        title="Weekly recap"
        subtitle={
          recap
            ? `${format(new Date(recap.periodStart), "d MMM")} – ${format(new Date(recap.periodEnd), "d MMM yyyy")}`
            : "What you saved and what could be tidied up"
        }
      />
      {query.isLoading && <Skeleton variant="rounded" height={240} />}
      {query.error && (
        <Alert severity="error">Failed to load the recap. Try again.</Alert>
      )}
      {!query.isLoading && !query.error && !recap && (
        <EmptyState
          icon={RecapIcon}
          title="No recap yet"
          description="Your first weekly recap arrives at the start of next week, in the app. You can also have it sent by email."
          action={
            <Button
              component={NextLink}
              href="/settings#weekly-recap"
              variant="outlined"
            >
              Recap settings
            </Button>
          }
        />
      )}
      {recap && (
        <Stack spacing={3}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" component="h2" gutterBottom>
              {recap.savedCount === 1
                ? "You saved 1 link"
                : `You saved ${recap.savedCount} links`}
            </Typography>
            {recap.savedLinks.length > 0 ? (
              <List dense disablePadding>
                {recap.savedLinks.map((link) => (
                  <ListItem key={link.id} disableGutters>
                    <ListItemText primary={<LinkTitle link={link} />} />
                  </ListItem>
                ))}
              </List>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Nothing new this week.
              </Typography>
            )}
            {recap.suggestedPiles.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Suggested piles
                </Typography>
                <Stack
                  direction="row"
                  spacing={1}
                  useFlexGap
                  sx={{ flexWrap: "wrap" }}
                >
                  {recap.suggestedPiles.map((pile) => (
                    <Chip
                      key={pile.title}
                      label={`${pile.title} (${pile.itemCount})`}
                    />
                  ))}
                </Stack>
              </Box>
            )}
          </Paper>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
              sx={{
                justifyContent: "space-between",
                alignItems: { sm: "center" },
                mb: 1,
              }}
            >
              <Box>
                <Typography variant="h6" component="h2">
                  Not opened in {recap.staleWeeks} weeks
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Archived links keep their summary and wait in Trash until you
                  restore them. Nothing is deleted.
                </Typography>
              </Box>
              {recap.archived ? (
                <Button
                  startIcon={<UndoIcon />}
                  onClick={() => void undo(recap.archived!.changeSetId)}
                  disabled={revert.isPending}
                >
                  Undo archive
                </Button>
              ) : (
                recap.staleLinks.length > 0 && (
                  <Button
                    variant="contained"
                    startIcon={<ArchiveIcon />}
                    onClick={() => archive.mutate(recap.id)}
                    disabled={archive.isPending}
                    sx={{ flexShrink: 0 }}
                  >
                    Archive these
                  </Button>
                )
              )}
            </Stack>
            {recap.archived ? (
              <Alert severity="success">
                Archived
                {recap.archived.archivedAt
                  ? ` ${formatDistanceToNow(new Date(recap.archived.archivedAt), { addSuffix: true })}`
                  : ""}
                . Find them in Trash.
              </Alert>
            ) : recap.staleLinks.length > 0 ? (
              <List disablePadding>
                {recap.staleLinks.map((link) => (
                  <ListItem key={link.id} divider disableGutters>
                    <ListItemText
                      primary={<LinkTitle link={link} />}
                      secondary={[
                        link.summary,
                        `${link.board.name} · last touched ${formatDistanceToNow(new Date(link.lastTouchedAt), { addSuffix: true })}`,
                      ]
                        .filter(Boolean)
                        .join(" — ")}
                    />
                  </ListItem>
                ))}
              </List>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No old links to tidy up.
              </Typography>
            )}
          </Paper>
        </Stack>
      )}
    </>
  );
}
