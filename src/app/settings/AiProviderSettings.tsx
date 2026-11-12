"use client";

import { DisabledReason } from "@/components/DisabledReason";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Collapse,
  Link,
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
  keyPageUrl: string | null;
  suggestedModels: string[];
}

/** The result of the one small request that tests a key (IMP-102). */
interface KeyCheck {
  ok: boolean;
  problem?: string;
  message: string;
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
  const [showMore, setShowMore] = useState(false);
  const [check, setCheck] = useState<KeyCheck | null>(null);

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
    setCheck(null);
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
      setCheck(null);
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
      const saved = (await response.json()) as ProviderSettingsPayload & {
        check?: KeyCheck | null;
      };
      applyPayload(saved);
      // The page shows the test result in plain words; no toast on top.
      setCheck(
        saved.check ?? {
          ok: true,
          message: "Saved.",
        },
      );
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
      setCheck(null);
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
  const isLocal = option?.requiresBaseUrl ?? false;

  return (
    <Stack spacing={2.5}>
      {/* IMP-102: say plainly whether AI is on and what it does. */}
      {availability.configured ? (
        <Alert severity="success" icon={false}>
          <strong>AI is on</strong>, using {activeLabel} · {availability.model}{" "}
          ({availability.source === "user" ? "your key" : "the server's key"}).
          It {AI_USES}.
        </Alert>
      ) : (
        <Alert severity="info" icon={false}>
          <strong>AI is off.</strong> Nothing you save is sent to an AI
          provider. Turn it on with your own key in three steps below; it{" "}
          {AI_USES}.
        </Alert>
      )}
      {data.current?.status === "ERROR" && !check && (
        <Alert severity="warning">
          The provider rejected your saved key. Paste a new one below.
        </Alert>
      )}

      <Step number={1} title="Pick a provider">
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
      </Step>

      <Step number={2} title="Get a key">
        {option?.keyPageUrl ? (
          <Typography variant="body2">
            Sign in on{" "}
            <Link
              href={option.keyPageUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {option.label}&apos;s key page
            </Link>
            , create a new key and copy it. Providers charge for use, so the
            account may need a little credit.
          </Typography>
        ) : (
          <Typography variant="body2">
            Use the key your own AI server expects, and enter its address.
          </Typography>
        )}
        {isLocal && (
          <TextField
            label="Server address"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://host/v1"
            helperText="Where your AI server answers, for example https://host/v1"
            fullWidth
          />
        )}
      </Step>

      <Step number={3} title="Paste it">
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
            keyRequired
              ? "Stored encrypted and never shown again."
              : "Enter a new key only to replace it."
          }
          fullWidth
        />
      </Step>

      <Box>
        <Button
          size="small"
          onClick={() => setShowMore((value) => !value)}
          aria-expanded={showMore}
        >
          {showMore ? "Fewer options" : "More options"}
        </Button>
        <Collapse in={showMore} unmountOnExit>
          <Stack spacing={2} sx={{ mt: 1.5 }}>
            <Autocomplete
              freeSolo
              options={option?.suggestedModels ?? []}
              value={model}
              onInputChange={(_event, value) => setModel(value)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Model"
                  helperText="The first one suits most people."
                  fullWidth
                />
              )}
            />
            {!isLocal && (
              <TextField
                label="Server address (optional)"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder={option?.defaultBaseUrl ?? "https://host/v1"}
                helperText="Leave empty to use the provider's own address."
                fullWidth
              />
            )}
          </Stack>
        </Collapse>
      </Box>

      {check && (
        <Alert severity={check.ok ? "success" : "warning"} role="status">
          {check.message}
        </Alert>
      )}

      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || missing !== null}
          aria-describedby={missing ? "ai-provider-save-reason" : undefined}
        >
          {saving ? "Testing your key…" : "Save and test"}
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

/** What AI does in Memoria, said once on the page. */
const AI_USES =
  "is used for Ask, chat and writing help, tags and summaries for saved links, and sorting new items onto canvases";

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Stack
      spacing={1.25}
      component="section"
      aria-label={`Step ${number}: ${title}`}
    >
      <Typography variant="subtitle2" component="h3">
        {number}. {title}
      </Typography>
      {children}
    </Stack>
  );
}
