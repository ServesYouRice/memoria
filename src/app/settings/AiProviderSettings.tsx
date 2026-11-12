"use client";

import { DisabledReason } from "@/components/DisabledReason";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { ModelProvider } from "@/generated/prisma/enums";

interface ProviderOption {
  provider: ModelProvider;
  label: string;
  defaultBaseUrl: string | null;
  requiresBaseUrl: boolean;
  suggestedModels: string[];
}

interface ProviderSettingsPayload {
  providers: ProviderOption[];
  current: {
    id: string;
    provider: ModelProvider;
    model: string;
    baseUrl: string | null;
    status: string;
    hasKey: boolean;
  } | null;
  availability: {
    configured: boolean;
    source: "user" | "env" | null;
    provider: ModelProvider | null;
    model: string | null;
  };
}

const ENDPOINT = "/api/v1/ai/provider";

async function readProblem(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as {
    detail?: string;
  } | null;
  return payload?.detail || fallback;
}

export function AiProviderSettings() {
  const [data, setData] = useState<ProviderSettingsPayload | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [provider, setProvider] = useState<ModelProvider | "">("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const applyPayload = useCallback((payload: ProviderSettingsPayload) => {
    setData(payload);
    const initial = payload.current?.provider ?? payload.providers[0]?.provider;
    const option = payload.providers.find((p) => p.provider === initial);
    setProvider(initial ?? "");
    setModel(payload.current?.model ?? option?.suggestedModels[0] ?? "");
    setBaseUrl(payload.current?.baseUrl ?? "");
    setApiKey("");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(ENDPOINT, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("AI provider request failed");
        applyPayload((await response.json()) as ProviderSettingsPayload);
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setLoadFailed(true);
      });
    return () => controller.abort();
  }, [applyPayload]);

  const option = useMemo(
    () => data?.providers.find((p) => p.provider === provider) ?? null,
    [data, provider],
  );
  const providerChanged = !!data?.current && data.current.provider !== provider;
  const keyRequired = !data?.current || providerChanged;
  // IMP-086: what is still missing before the provider can be saved.
  const missing = !provider
    ? "Choose a provider first."
    : !model.trim()
      ? "Enter a model name first."
      : keyRequired && !apiKey.trim()
        ? "Paste your API key first."
        : option?.requiresBaseUrl && !baseUrl.trim()
          ? "Enter the server address first."
          : null;

  const handleProviderChange = (next: ModelProvider) => {
    setProvider(next);
    const nextOption = data?.providers.find((p) => p.provider === next);
    setModel(
      data?.current?.provider === next
        ? data.current.model
        : (nextOption?.suggestedModels[0] ?? ""),
    );
    setBaseUrl(
      data?.current?.provider === next ? (data.current.baseUrl ?? "") : "",
    );
  };

  const handleSave = async () => {
    if (!provider) return;
    try {
      setSaving(true);
      const response = await fetch(ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          model: model.trim(),
          baseUrl: baseUrl.trim() || null,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        }),
      });
      if (!response.ok) {
        throw new Error(
          await readProblem(response, "Failed to save AI provider"),
        );
      }
      applyPayload((await response.json()) as ProviderSettingsPayload);
      toast.success("AI provider saved");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save AI provider",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    try {
      setSaving(true);
      const response = await fetch(ENDPOINT, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(
          await readProblem(response, "Failed to remove AI provider"),
        );
      }
      applyPayload((await response.json()) as ProviderSettingsPayload);
      toast.success("AI provider key removed");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to remove AI provider",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loadFailed) {
    return (
      <Alert severity="warning">
        AI provider settings are temporarily unavailable.
      </Alert>
    );
  }
  if (!data) {
    return (
      <Typography variant="body2" color="text.secondary">
        Loading AI provider…
      </Typography>
    );
  }

  const { availability } = data;
  const activeLabel =
    data.providers.find((p) => p.provider === availability.provider)?.label ??
    availability.provider;

  return (
    <Stack spacing={2.5}>
      <Typography variant="body2" color="text.secondary">
        Tags, summaries, chat and generation use the provider and key you save
        here. Keys are stored encrypted and are never shown again.
      </Typography>

      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        {availability.configured ? (
          <Chip
            color="success"
            variant="outlined"
            size="small"
            label={`In use: ${activeLabel} · ${availability.model} (${availability.source === "user" ? "your key" : "server key"})`}
          />
        ) : (
          <Chip variant="outlined" size="small" label="AI not configured" />
        )}
        {data.current?.status === "ERROR" && (
          <Chip
            color="error"
            variant="outlined"
            size="small"
            label="Saved key was rejected"
          />
        )}
      </Box>

      <TextField
        select
        label="Provider"
        value={provider}
        onChange={(event) =>
          handleProviderChange(event.target.value as ModelProvider)
        }
        fullWidth
      >
        {data.providers.map((entry) => (
          <MenuItem key={entry.provider} value={entry.provider}>
            {entry.label}
          </MenuItem>
        ))}
      </TextField>

      <Autocomplete
        freeSolo
        options={option?.suggestedModels ?? []}
        value={model}
        onInputChange={(_event, value) => setModel(value)}
        renderInput={(params) => (
          <TextField {...params} label="Model" fullWidth />
        )}
      />

      <TextField
        label={option?.requiresBaseUrl ? "Base URL" : "Base URL (optional)"}
        value={baseUrl}
        onChange={(event) => setBaseUrl(event.target.value)}
        placeholder={option?.defaultBaseUrl ?? "https://host/v1"}
        helperText={
          option?.requiresBaseUrl
            ? "OpenAI-compatible endpoint, for example https://host/v1"
            : "Leave empty to use the provider's own endpoint"
        }
        fullWidth
      />

      <TextField
        label="API key"
        type="password"
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
        autoComplete="off"
        placeholder={
          keyRequired ? "" : "Saved — leave empty to keep the current key"
        }
        helperText={
          keyRequired ? "Required" : "Enter a new key only to replace it"
        }
        fullWidth
      />

      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || missing !== null}
          aria-describedby={missing ? "ai-provider-save-reason" : undefined}
        >
          {saving ? "Saving…" : "Save AI provider"}
        </Button>
        {data.current && (
          <Button color="error" onClick={handleRemove} disabled={saving}>
            Remove key
          </Button>
        )}
        <DisabledReason
          id="ai-provider-save-reason"
          show={!saving && !!missing}
        >
          {missing}
        </DisabledReason>
      </Stack>
    </Stack>
  );
}
