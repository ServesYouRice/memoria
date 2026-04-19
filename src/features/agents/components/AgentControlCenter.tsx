"use client";

import React, { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import LinkIcon from "@mui/icons-material/Link";
import RestoreIcon from "@mui/icons-material/Restore";
import PendingActionsIcon from "@mui/icons-material/PendingActions";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import CloseIcon from "@mui/icons-material/Close";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import {
  useAgentIntegrations,
  useAgentProfiles,
  useAgentProviders,
  useAgentTimeline,
  useApproveSuggestion,
  useExecuteSuggestion,
  useRejectSuggestion,
  useRevertChangeSet,
  type ChangeSetRecord,
  type SuggestionRecord,
} from "@/lib/hooks/use-agent-control";

function getSuggestionColor(status: SuggestionRecord["status"]) {
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

function getChangeSetColor(status: ChangeSetRecord["status"]) {
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

export function AgentControlCenter() {
  const profilesQuery = useAgentProfiles();
  const providersQuery = useAgentProviders();
  const integrationsQuery = useAgentIntegrations();
  const timelineQuery = useAgentTimeline(60);
  const approveSuggestion = useApproveSuggestion();
  const rejectSuggestion = useRejectSuggestion();
  const executeSuggestion = useExecuteSuggestion();
  const revertChangeSet = useRevertChangeSet();

  const [feedback, setFeedback] = useState<{
    severity: "success" | "error";
    message: string;
  } | null>(null);

  const isLoading =
    profilesQuery.isLoading ||
    providersQuery.isLoading ||
    integrationsQuery.isLoading ||
    timelineQuery.isLoading;

  const agentProfiles = profilesQuery.data?.agentProfiles || [];
  const providerSlots = providersQuery.data?.providerSlots || [];
  const credentials = providersQuery.data?.credentials || [];
  const integrationAccounts = integrationsQuery.data?.integrationAccounts || [];
  const suggestions = timelineQuery.data?.suggestions || [];
  const changeSets = timelineQuery.data?.changeSets || [];

  const profilesById = new Map(
    agentProfiles.map((profile) => [profile.id, profile]),
  );

  async function runAction(
    handler: () => Promise<unknown>,
    successMessage: string,
    fallbackMessage: string,
  ) {
    try {
      await handler();
      setFeedback({ severity: "success", message: successMessage });
    } catch (error) {
      setFeedback({
        severity: "error",
        message: error instanceof Error ? error.message : fallbackMessage,
      });
    }
  }

  return (
    <Paper
      id="agent-console"
      sx={{
        p: 4,
        borderRadius: 3,
        animation: "fadeIn 0.5s ease-out 0.33s both",
      }}
    >
      {isLoading && <LinearProgress sx={{ mb: 2 }} />}

      <Stack
        direction={{ xs: "column", lg: "row" }}
        spacing={2}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", lg: "center" }}
        sx={{ mb: 3 }}
      >
        <Box>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <SmartToyIcon color="primary" />
            <Typography variant="h6" fontWeight={700}>
              Agent control center
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Review agent profiles, configured BYOK providers, external
            integrations, pending suggestions, and audited changes before or
            after the organizer layer touches anything.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap">
          <Chip
            label={`${agentProfiles.length} agents`}
            color="primary"
            variant="outlined"
          />
          <Chip
            label={`${credentials.length}/${providerSlots.length} providers configured`}
            variant="outlined"
          />
          <Chip
            label={`${integrationAccounts.length} integrations`}
            variant="outlined"
          />
        </Stack>
      </Stack>

      {feedback && (
        <Alert
          severity={feedback.severity}
          onClose={() => setFeedback(null)}
          sx={{ mb: 3 }}
        >
          {feedback.message}
        </Alert>
      )}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", xl: "repeat(3, minmax(0, 1fr))" },
          gap: 3,
          mb: 3,
        }}
      >
        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3 }}>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ mb: 1.5 }}
          >
            <SmartToyIcon color="primary" />
            <Typography variant="subtitle1" fontWeight={700}>
              Agent profiles
            </Typography>
          </Stack>
          <Stack spacing={1.25}>
            {agentProfiles.length === 0 ? (
              <Alert severity="info">No agent profiles configured yet.</Alert>
            ) : (
              agentProfiles.map((profile) => (
                <Paper
                  key={profile.id}
                  variant="outlined"
                  sx={{ p: 1.5, borderRadius: 2 }}
                >
                  <Stack spacing={0.75}>
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      justifyContent="space-between"
                    >
                      <Typography variant="subtitle2" fontWeight={700}>
                        {profile.name}
                      </Typography>
                      <Chip
                        label={profile.status.toLowerCase()}
                        size="small"
                        variant="outlined"
                      />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      Max rung {profile.maxCapabilityRung} · enabled{" "}
                      {profile.enabledRungs.join(", ")}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {profile.integrationAccounts.length} integration
                      account(s)
                    </Typography>
                  </Stack>
                </Paper>
              ))
            )}
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3 }}>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ mb: 1.5 }}
          >
            <VpnKeyIcon color="primary" />
            <Typography variant="subtitle1" fontWeight={700}>
              Provider credentials
            </Typography>
          </Stack>
          <Stack spacing={1.25}>
            {providerSlots.map((slot) => {
              const configured = credentials.filter(
                (credential) => credential.provider === slot.provider,
              );
              return (
                <Paper
                  key={slot.provider}
                  variant="outlined"
                  sx={{ p: 1.5, borderRadius: 2 }}
                >
                  <Stack spacing={0.75}>
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      justifyContent="space-between"
                    >
                      <Typography variant="subtitle2" fontWeight={700}>
                        {slot.label}
                      </Typography>
                      <Chip
                        label={
                          configured.length > 0
                            ? `${configured.length} configured`
                            : "not configured"
                        }
                        size="small"
                        color={configured.length > 0 ? "success" : "default"}
                        variant="outlined"
                      />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {slot.suggestedModels.join(", ")}
                    </Typography>
                  </Stack>
                </Paper>
              );
            })}
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3 }}>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ mb: 1.5 }}
          >
            <LinkIcon color="primary" />
            <Typography variant="subtitle1" fontWeight={700}>
              Integrations
            </Typography>
          </Stack>
          <Stack spacing={1.25}>
            {integrationAccounts.length === 0 ? (
              <Alert severity="info">
                No integration accounts configured yet.
              </Alert>
            ) : (
              integrationAccounts.map((integration) => (
                <Paper
                  key={integration.id}
                  variant="outlined"
                  sx={{ p: 1.5, borderRadius: 2 }}
                >
                  <Stack spacing={0.75}>
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      justifyContent="space-between"
                    >
                      <Typography variant="subtitle2" fontWeight={700}>
                        {integration.providerType}
                      </Typography>
                      <Chip
                        label={integration.status.toLowerCase()}
                        size="small"
                        variant="outlined"
                      />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {integration.externalAccountId}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Agent{" "}
                      {profilesById.get(integration.agentProfileId)?.name ||
                        integration.agentProfileId}
                    </Typography>
                  </Stack>
                </Paper>
              ))
            )}
          </Stack>
        </Paper>
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", xl: "1.2fr 1fr" },
          gap: 3,
        }}
      >
        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3 }}>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ mb: 1.5 }}
          >
            <PendingActionsIcon color="primary" />
            <Typography variant="subtitle1" fontWeight={700}>
              Suggestion queue
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Approve or reject low-risk proposals first. Execution is separated
            so higher-risk actions still need an explicit second step.
          </Typography>

          <Stack spacing={1.5}>
            {suggestions.length === 0 ? (
              <Alert severity="info">
                No suggestions are waiting for review.
              </Alert>
            ) : (
              suggestions.slice(0, 12).map((suggestion) => (
                <Paper
                  key={suggestion.id}
                  variant="outlined"
                  sx={{ p: 1.5, borderRadius: 2.5 }}
                >
                  <Stack spacing={1}>
                    <Stack
                      direction="row"
                      spacing={1}
                      justifyContent="space-between"
                      alignItems="center"
                    >
                      <Stack
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        flexWrap="wrap"
                      >
                        <Chip
                          label={suggestion.status.toLowerCase()}
                          size="small"
                          color={getSuggestionColor(suggestion.status)}
                          variant="outlined"
                        />
                        <Chip
                          label={suggestion.kind
                            .replaceAll("_", " ")
                            .toLowerCase()}
                          size="small"
                          variant="outlined"
                        />
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(suggestion.createdAt).toLocaleString()}
                      </Typography>
                    </Stack>
                    <Typography variant="subtitle2" fontWeight={700}>
                      {suggestion.summary}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Agent{" "}
                      {suggestion.agentProfileId
                        ? profilesById.get(suggestion.agentProfileId)?.name ||
                          suggestion.agentProfileId
                        : "system/user"}
                    </Typography>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<CheckCircleOutlineIcon />}
                        disabled={
                          suggestion.status !== "OPEN" ||
                          approveSuggestion.isPending
                        }
                        onClick={() =>
                          runAction(
                            () => approveSuggestion.mutateAsync(suggestion.id),
                            "Suggestion approved.",
                            "Failed to approve suggestion.",
                          )
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        color="inherit"
                        startIcon={<CloseIcon />}
                        disabled={
                          !["OPEN", "APPROVED"].includes(suggestion.status) ||
                          rejectSuggestion.isPending
                        }
                        onClick={() =>
                          runAction(
                            () => rejectSuggestion.mutateAsync(suggestion.id),
                            "Suggestion rejected.",
                            "Failed to reject suggestion.",
                          )
                        }
                      >
                        Reject
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<PlayArrowIcon />}
                        disabled={
                          suggestion.status !== "APPROVED" ||
                          executeSuggestion.isPending
                        }
                        onClick={() =>
                          runAction(
                            () => executeSuggestion.mutateAsync(suggestion.id),
                            "Suggestion executed.",
                            "Failed to execute suggestion.",
                          )
                        }
                      >
                        Execute
                      </Button>
                    </Stack>
                  </Stack>
                </Paper>
              ))
            )}
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3 }}>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ mb: 1.5 }}
          >
            <RestoreIcon color="primary" />
            <Typography variant="subtitle1" fontWeight={700}>
              Rollback and history
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Reverts are change-set driven. If an agent write goes wrong, roll
            back the whole audited change set instead of trying to patch over
            partial state by hand.
          </Typography>
          <Stack spacing={1.5}>
            {changeSets.length === 0 ? (
              <Alert severity="info">
                No change sets have been recorded yet.
              </Alert>
            ) : (
              changeSets.slice(0, 12).map((changeSet) => (
                <Paper
                  key={changeSet.id}
                  variant="outlined"
                  sx={{ p: 1.5, borderRadius: 2.5 }}
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
                        color={getChangeSetColor(changeSet.status)}
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
                      {changeSet.changeRecords.length} change record(s) · scope{" "}
                      {changeSet.scopeType}
                    </Typography>
                    <Divider />
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<RestoreIcon />}
                      disabled={
                        Boolean(changeSet.revertedAt) ||
                        changeSet.status === "FAILED" ||
                        revertChangeSet.isPending
                      }
                      onClick={() =>
                        runAction(
                          () => revertChangeSet.mutateAsync(changeSet.id),
                          "Change set reverted.",
                          "Failed to revert change set.",
                        )
                      }
                    >
                      {changeSet.revertedAt
                        ? "Already reverted"
                        : "Revert change set"}
                    </Button>
                  </Stack>
                </Paper>
              ))
            )}
          </Stack>
        </Paper>
      </Box>
    </Paper>
  );
}
