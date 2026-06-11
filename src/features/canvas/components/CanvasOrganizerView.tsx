"use client";

import React, { useEffect, useRef, useState } from "react";
import { CanvasViewType } from "@prisma/client";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControl,
  InputLabel,
  LinearProgress,
  List,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import HubIcon from "@mui/icons-material/Hub";
import PendingActionsIcon from "@mui/icons-material/PendingActions";
import RestoreIcon from "@mui/icons-material/Restore";
import type { CanvasItem } from "@/types/canvas";
import {
  isBookmarkContent,
  isEmbedContent,
  isFrameContent,
  isImageContent,
  isNoteContent,
  isPollContent,
  isTextContent,
} from "@/types/canvas";
import {
  useAgentKnowledge,
  useAgentTimeline,
  type KnowledgeEntityRecord,
  type KnowledgeRelationRecord,
  type SuggestionRecord,
  type ChangeSetRecord,
} from "@/lib/hooks/use-agent-control";
import { useCanvasView, useSaveCanvasView } from "@/lib/hooks/use-canvas-views";

interface CanvasOrganizerViewProps {
  canvasId: string;
  items: CanvasItem[];
}

function getItemSummary(item: CanvasItem) {
  if (isNoteContent(item.content)) {
    return item.content.text.slice(0, 140) || "Empty note";
  }

  if (isBookmarkContent(item.content)) {
    return item.content.title || item.content.url;
  }

  if (isImageContent(item.content)) {
    return item.content.filename || item.content.alt || item.content.url;
  }

  if (isTextContent(item.content)) {
    return item.content.text.slice(0, 140) || "Text block";
  }

  if (isFrameContent(item.content)) {
    return item.content.title || "Frame";
  }

  if (isPollContent(item.content)) {
    return item.content.question;
  }

  if (isEmbedContent(item.content)) {
    return item.content.url;
  }

  return `${item.type.toLowerCase()} item`;
}

function getSuggestionCanvasId(
  suggestion: SuggestionRecord,
  itemsById: Map<string, CanvasItem>,
) {
  const payload = suggestion.payload;
  if (typeof payload.canvasId === "string") {
    return payload.canvasId;
  }

  if (typeof payload.itemId === "string") {
    return itemsById.get(payload.itemId)?.canvasId ?? null;
  }

  return null;
}

function getSuggestionStatusColor(status: SuggestionRecord["status"]) {
  switch (status) {
    case "OPEN":
      return "warning";
    case "APPROVED":
      return "info";
    case "EXECUTED":
      return "success";
    case "REJECTED":
    case "EXPIRED":
      return "default";
    default:
      return "default";
  }
}

function getChangeSetStatusColor(status: ChangeSetRecord["status"]) {
  switch (status) {
    case "COMPLETED":
      return "success";
    case "REVERTED":
      return "warning";
    case "FAILED":
      return "error";
    default:
      return "default";
  }
}

function renderEntityCard(
  entity: KnowledgeEntityRecord,
  itemsById: Map<string, CanvasItem>,
) {
  const sourceItems = entity.itemLinks
    .map((link) => itemsById.get(link.itemId))
    .filter((item): item is CanvasItem => Boolean(item));
  const relationGroups: Array<{
    label: string;
    relations: KnowledgeRelationRecord[];
    getCounterpart: (relation: KnowledgeRelationRecord) => {
      title: string;
      entityType: string;
    };
  }> = [
    {
      label: "Outgoing relations",
      relations: entity.outgoingRelations,
      getCounterpart: (relation) => relation.targetEntity,
    },
    {
      label: "Incoming relations",
      relations: entity.incomingRelations,
      getCounterpart: (relation) => relation.sourceEntity,
    },
  ];

  return (
    <Card
      key={entity.id}
      variant="outlined"
      sx={{
        borderRadius: 3,
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(247,248,252,0.96) 100%)",
      }}
    >
      <CardContent sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Chip
            label={entity.entityType}
            color="primary"
            size="small"
            variant="outlined"
          />
          {entity.sourceConfidence != null && (
            <Chip
              label={`${Math.round(entity.sourceConfidence * 100)}% confidence`}
              size="small"
              color="secondary"
              variant="outlined"
            />
          )}
          <Chip
            label={entity.status.toLowerCase()}
            size="small"
            variant="outlined"
          />
        </Stack>
        <Typography variant="h6" fontWeight={700}>
          {entity.title}
        </Typography>
        {entity.summary && (
          <Typography variant="body2" color="text.secondary">
            {entity.summary}
          </Typography>
        )}
        <Divider />
        <Box>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ textTransform: "uppercase" }}
          >
            Source items
          </Typography>
          <Stack spacing={1} sx={{ mt: 1 }}>
            {sourceItems.length > 0 ? (
              sourceItems.map((item) => (
                <Paper
                  key={item.id}
                  variant="outlined"
                  sx={{
                    p: 1.25,
                    borderRadius: 2,
                    bgcolor: "background.default",
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <Chip
                      label={item.type.toLowerCase()}
                      size="small"
                      variant="outlined"
                    />
                    <Typography variant="caption" color="text.secondary">
                      {item.tags.length > 0 ? item.tags.join(", ") : "untagged"}
                    </Typography>
                  </Stack>
                  <Typography variant="body2" sx={{ mt: 0.75 }}>
                    {getItemSummary(item)}
                  </Typography>
                </Paper>
              ))
            ) : (
              <Typography variant="body2" color="text.secondary">
                This entity no longer has a readable source item on the canvas.
              </Typography>
            )}
          </Stack>
        </Box>
        <Divider />
        <Box>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ textTransform: "uppercase" }}
          >
            Derived relations
          </Typography>
          <Stack spacing={1} sx={{ mt: 1 }}>
            {relationGroups.every((group) => group.relations.length === 0) ? (
              <Typography variant="body2" color="text.secondary">
                No derived relations connect to this entity yet.
              </Typography>
            ) : (
              relationGroups.map((group) =>
                group.relations.length === 0 ? null : (
                  <Box key={group.label}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", mb: 0.75 }}
                    >
                      {group.label}
                    </Typography>
                    <Stack spacing={1}>
                      {group.relations.map((relation) => {
                        const counterpart = group.getCounterpart(relation);
                        return (
                          <Paper
                            key={relation.id}
                            variant="outlined"
                            sx={{
                              p: 1.25,
                              borderRadius: 2,
                              bgcolor: "background.default",
                            }}
                          >
                            <Stack spacing={0.75}>
                              <Stack
                                direction="row"
                                spacing={1}
                                alignItems="center"
                                flexWrap="wrap"
                              >
                                <Chip
                                  label={relation.relationType}
                                  size="small"
                                  color="primary"
                                  variant="outlined"
                                />
                                <Chip
                                  label={counterpart.entityType}
                                  size="small"
                                  variant="outlined"
                                />
                                {relation.confidence != null && (
                                  <Chip
                                    label={`${Math.round(relation.confidence * 100)}% confidence`}
                                    size="small"
                                    color="secondary"
                                    variant="outlined"
                                  />
                                )}
                              </Stack>
                              <Typography variant="body2" fontWeight={600}>
                                {counterpart.title}
                              </Typography>
                              {relation.summary && (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                >
                                  {relation.summary}
                                </Typography>
                              )}
                            </Stack>
                          </Paper>
                        );
                      })}
                    </Stack>
                  </Box>
                ),
              )
            )}
          </Stack>
        </Box>
      </CardContent>
    </Card>
  );
}

export function CanvasOrganizerView({
  canvasId,
  items,
}: CanvasOrganizerViewProps) {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const viewQuery = useCanvasView(canvasId, CanvasViewType.ORGANIZER);
  const { mutate: saveCanvasView } = useSaveCanvasView(
    canvasId,
    CanvasViewType.ORGANIZER,
  );
  const knowledgeQuery = useAgentKnowledge(canvasId);
  const timelineQuery = useAgentTimeline(100);

  const [entityTypeFilter, setEntityTypeFilter] = useState("all");
  const [suggestionStatusFilter, setSuggestionStatusFilter] = useState("OPEN");
  const hydratedViewRef = useRef(false);
  const lastSavedFiltersRef = useRef<string | null>(null);

  useEffect(() => {
    if (hydratedViewRef.current || !viewQuery.data) {
      return;
    }

    const filters = viewQuery.data.view?.filters;
    if (filters && typeof filters === "object") {
      if (typeof filters.entityTypeFilter === "string") {
        setEntityTypeFilter(filters.entityTypeFilter);
      }
      if (typeof filters.suggestionStatusFilter === "string") {
        setSuggestionStatusFilter(filters.suggestionStatusFilter);
      }
      lastSavedFiltersRef.current = JSON.stringify({
        entityTypeFilter:
          typeof filters.entityTypeFilter === "string"
            ? filters.entityTypeFilter
            : "all",
        suggestionStatusFilter:
          typeof filters.suggestionStatusFilter === "string"
            ? filters.suggestionStatusFilter
            : "OPEN",
      });
    } else {
      lastSavedFiltersRef.current = JSON.stringify({
        entityTypeFilter: "all",
        suggestionStatusFilter: "OPEN",
      });
    }

    hydratedViewRef.current = true;
  }, [viewQuery.data]);

  useEffect(() => {
    if (!hydratedViewRef.current) {
      return;
    }

    const nextState = JSON.stringify({
      entityTypeFilter,
      suggestionStatusFilter,
    });

    if (lastSavedFiltersRef.current === nextState) {
      return;
    }

    lastSavedFiltersRef.current = nextState;

    saveCanvasView({
      name: "Organizer",
      filters: JSON.parse(nextState) as Record<string, unknown>,
      layout: {
        mode: "read-only",
      },
    });
  }, [entityTypeFilter, saveCanvasView, suggestionStatusFilter]);

  const entities = (knowledgeQuery.data?.entities || []).filter((entity) =>
    entityTypeFilter === "all" ? true : entity.entityType === entityTypeFilter,
  );

  const suggestions = (timelineQuery.data?.suggestions || []).filter(
    (suggestion) => {
      const suggestionCanvasId = getSuggestionCanvasId(suggestion, itemsById);
      if (suggestionCanvasId !== canvasId) {
        return false;
      }

      if (suggestionStatusFilter === "ALL") {
        return true;
      }

      return suggestion.status === suggestionStatusFilter;
    },
  );

  const changeSets = (timelineQuery.data?.changeSets || []).filter(
    (changeSet) =>
      changeSet.scopeType === "canvas" && changeSet.scopeId === canvasId,
  );
  const relationCount = new Set(
    (knowledgeQuery.data?.entities || []).flatMap((entity) =>
      entity.outgoingRelations.map((relation) => relation.id),
    ),
  ).size;

  const availableEntityTypes = Array.from(
    new Set(
      (knowledgeQuery.data?.entities || []).map((entity) => entity.entityType),
    ),
  ).sort((left, right) => left.localeCompare(right));

  return (
    <Box
      sx={{
        flexGrow: 1,
        overflow: "auto",
        bgcolor: "#eef2f8",
        px: { xs: 2, md: 3 },
        py: 3,
      }}
    >
      {(knowledgeQuery.isLoading || timelineQuery.isLoading) && (
        <LinearProgress sx={{ mb: 2 }} />
      )}

      <Paper
        elevation={0}
        sx={{
          p: 3,
          borderRadius: 4,
          mb: 3,
          border: "1px solid",
          borderColor: "divider",
          background:
            "radial-gradient(circle at top left, rgba(29,78,216,0.14), transparent 42%), linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          color: "common.white",
        }}
      >
        <Stack
          direction={{ xs: "column", lg: "row" }}
          spacing={2}
          justifyContent="space-between"
          alignItems={{ xs: "flex-start", lg: "center" }}
        >
          <Box>
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ mb: 1 }}
            >
              <AutoAwesomeIcon />
              <Typography variant="overline" sx={{ letterSpacing: 1.5 }}>
                Organizer Lens
              </Typography>
            </Stack>
            <Typography variant="h4" fontWeight={800} sx={{ mb: 1 }}>
              Derived structure, not live mutation
            </Typography>
            <Typography
              variant="body1"
              sx={{ maxWidth: 760, color: "rgba(255,255,255,0.78)" }}
            >
              This tab is the agent-organized view of the current canvas. It
              stays read-only here, keeps traceability back to raw notes, and
              sends approvals and rollbacks through the dedicated agent control
              surface.
            </Typography>
          </Box>
          <Button
            component="a"
            href="/settings#agent-console"
            variant="contained"
            color="secondary"
            sx={{
              borderRadius: 999,
              px: 2.5,
              py: 1,
              background: "linear-gradient(135deg, #f97316 0%, #fb7185 100%)",
            }}
          >
            Open agent console
          </Button>
        </Stack>
      </Paper>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            md: "repeat(2, minmax(0, 1fr))",
            xl: "repeat(4, minmax(0, 1fr))",
          },
          gap: 2,
          mb: 3,
        }}
      >
        {[
          { label: "Manual items", value: items.length, icon: <HubIcon /> },
          {
            label: "Derived entities",
            value: knowledgeQuery.data?.entities.length || 0,
            icon: <AutoAwesomeIcon />,
          },
          {
            label: "Derived relations",
            value: relationCount,
            icon: <HubIcon />,
          },
          {
            label: "Open suggestions",
            value: suggestions.filter((entry) => entry.status === "OPEN")
              .length,
            icon: <PendingActionsIcon />,
          },
          {
            label: "Audited change sets",
            value: changeSets.length,
            icon: <RestoreIcon />,
          },
        ].map((metric) => (
          <Paper
            key={metric.label}
            elevation={0}
            sx={{
              p: 2.5,
              borderRadius: 3,
              border: "1px solid",
              borderColor: "divider",
              backgroundColor: "background.paper",
            }}
          >
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
            >
              <Box>
                <Typography variant="body2" color="text.secondary">
                  {metric.label}
                </Typography>
                <Typography variant="h4" fontWeight={800}>
                  {metric.value}
                </Typography>
              </Box>
              <Box sx={{ color: "primary.main" }}>{metric.icon}</Box>
            </Stack>
          </Paper>
        ))}
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            xl: "minmax(0, 1.55fr) minmax(0, 1fr)",
          },
          gap: 3,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Paper
            elevation={0}
            sx={{
              p: 3,
              borderRadius: 4,
              border: "1px solid",
              borderColor: "divider",
            }}
          >
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={2}
              justifyContent="space-between"
              alignItems={{ xs: "stretch", md: "center" }}
              sx={{ mb: 2.5 }}
            >
              <Box>
                <Typography variant="h5" fontWeight={700}>
                  Derived entities
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Stable semantic records connected back to source items through
                  item links.
                </Typography>
              </Box>
              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel id="organizer-entity-filter-label">
                  Entity type
                </InputLabel>
                <Select
                  labelId="organizer-entity-filter-label"
                  value={entityTypeFilter}
                  label="Entity type"
                  onChange={(event) => setEntityTypeFilter(event.target.value)}
                >
                  <MenuItem value="all">All entity types</MenuItem>
                  {availableEntityTypes.map((entityType) => (
                    <MenuItem key={entityType} value={entityType}>
                      {entityType}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>

            {knowledgeQuery.error ? (
              <Alert severity="error">
                {knowledgeQuery.error instanceof Error
                  ? knowledgeQuery.error.message
                  : "Failed to load organizer knowledge."}
              </Alert>
            ) : entities.length === 0 ? (
              <Alert severity="info">
                No derived entities match the current filter yet. The manual
                canvas is still the source of truth, so this view remains empty
                until an agent or user-approved process creates semantic
                records.
              </Alert>
            ) : (
              <Stack spacing={2}>
                {entities.map((entity) => renderEntityCard(entity, itemsById))}
              </Stack>
            )}
          </Paper>
        </Box>

        <Stack spacing={3}>
          <Paper
            elevation={0}
            sx={{
              p: 3,
              borderRadius: 4,
              border: "1px solid",
              borderColor: "divider",
            }}
          >
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={2}
              justifyContent="space-between"
              alignItems={{ xs: "stretch", md: "center" }}
              sx={{ mb: 2.5 }}
            >
              <Box>
                <Typography variant="h6" fontWeight={700}>
                  Proposal queue
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Internal organization suggestions tied to this canvas.
                </Typography>
              </Box>
              <FormControl size="small" sx={{ minWidth: 180 }}>
                <InputLabel id="organizer-suggestion-filter-label">
                  Suggestion status
                </InputLabel>
                <Select
                  labelId="organizer-suggestion-filter-label"
                  value={suggestionStatusFilter}
                  label="Suggestion status"
                  onChange={(event) =>
                    setSuggestionStatusFilter(event.target.value)
                  }
                >
                  {[
                    "OPEN",
                    "APPROVED",
                    "EXECUTED",
                    "REJECTED",
                    "EXPIRED",
                    "ALL",
                  ].map((status) => (
                    <MenuItem key={status} value={status}>
                      {status === "ALL" ? "All statuses" : status.toLowerCase()}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>

            {suggestions.length === 0 ? (
              <Alert severity="info">
                No suggestions match this filter. Approval, execution, and
                rejection are handled in the agent console.
              </Alert>
            ) : (
              <List
                disablePadding
                sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}
              >
                {suggestions.slice(0, 8).map((suggestion) => (
                  <Paper
                    key={suggestion.id}
                    variant="outlined"
                    sx={{
                      p: 1.5,
                      borderRadius: 2.5,
                      bgcolor: "background.default",
                    }}
                  >
                    <Stack spacing={1}>
                      <Stack
                        direction="row"
                        spacing={1}
                        justifyContent="space-between"
                        alignItems="center"
                      >
                        <Chip
                          label={suggestion.status.toLowerCase()}
                          size="small"
                          color={getSuggestionStatusColor(suggestion.status)}
                          variant="outlined"
                        />
                        <Typography variant="caption" color="text.secondary">
                          expires{" "}
                          {new Date(suggestion.expiresAt).toLocaleString()}
                        </Typography>
                      </Stack>
                      <Typography variant="subtitle2" fontWeight={700}>
                        {suggestion.summary}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {suggestion.kind.replaceAll("_", " ").toLowerCase()}
                      </Typography>
                    </Stack>
                  </Paper>
                ))}
              </List>
            )}
          </Paper>

          <Paper
            elevation={0}
            sx={{
              p: 3,
              borderRadius: 4,
              border: "1px solid",
              borderColor: "divider",
            }}
          >
            <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>
              Audited writes
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
              Recent change sets scoped to this canvas. Revert actions remain
              gated in the control console.
            </Typography>

            {changeSets.length === 0 ? (
              <Alert severity="info">
                No audited change sets exist for this canvas yet. Proposal-only
                runs will not show up here until an approved write occurs.
              </Alert>
            ) : (
              <Stack spacing={1.5}>
                {changeSets.slice(0, 8).map((changeSet) => (
                  <Paper
                    key={changeSet.id}
                    variant="outlined"
                    sx={{
                      p: 1.5,
                      borderRadius: 2.5,
                      bgcolor: "background.default",
                    }}
                  >
                    <Stack spacing={1}>
                      <Stack
                        direction="row"
                        spacing={1}
                        justifyContent="space-between"
                        alignItems="center"
                      >
                        <Chip
                          label={changeSet.status.toLowerCase()}
                          size="small"
                          color={getChangeSetStatusColor(changeSet.status)}
                          variant="outlined"
                        />
                        <Typography variant="caption" color="text.secondary">
                          {new Date(changeSet.startedAt).toLocaleString()}
                        </Typography>
                      </Stack>
                      <Typography variant="subtitle2" fontWeight={700}>
                        {changeSet.summary}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {changeSet.changeRecords.length} recorded changes
                      </Typography>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            )}
          </Paper>
        </Stack>
      </Box>
    </Box>
  );
}
