"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import {
  Box,
  Typography,
  Paper,
  Avatar,
  Button,
  TextField,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  Switch,
  alpha,
  Alert,
  LinearProgress,
} from "@mui/material";
import {
  Person as PersonIcon,
  Email as EmailIcon,
  Lock as LockIcon,
  Palette as ThemeIcon,
  Keyboard as KeyboardIcon,
  Delete as DeleteIcon,
  Logout as LogoutIcon,
  Save as SaveIcon,
  KeyOutlined as ApiKeysIcon,
  DownloadOutlined as DownloadIcon,
  NotificationsActiveOutlined as NotificationsIcon,
  AutoAwesomeOutlined as AiUsageIcon,
} from "@mui/icons-material";
import { useThemeMode } from "@/lib/theme-context";
import { AgentControlCenter } from "@/features/agents/components/AgentControlCenter";
import { PageHeader } from "@/components/layout/PageHeader";
import { gradients } from "@/lib/theme";
import { NotificationPreferences } from "./NotificationPreferences";

interface SettingsContentProps {
  user: {
    id?: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}

interface AiUsage {
  enabled: boolean;
  tokensUsed: number;
  tokenLimit: number;
  costMicroUsdUsed: number;
  costMicroUsdLimit: number;
  activeRequests: number;
  concurrencyLimit: number;
  requests: number;
  rejections: number;
}

// Keyboard shortcuts data
const keyboardShortcuts = [
  { keys: ["Ctrl", "K"], description: "Open Command Palette" },
  { keys: ["Ctrl", "S"], description: "Save (auto-saved)" },
  { keys: ["Delete"], description: "Delete selected item" },
  { keys: ["Escape"], description: "Deselect / Close dialog" },
  { keys: ["Ctrl", "+"], description: "Zoom in" },
  { keys: ["Ctrl", "-"], description: "Zoom out" },
  { keys: ["Ctrl", "0"], description: "Reset zoom" },
];

function SettingsSection({
  icon,
  title,
  children,
  danger = false,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 2.5, sm: 3.5 },
        borderRadius: 3,
        ...(danger && { borderColor: "error.main" }),
      }}
    >
      <Typography
        variant="h6"
        color={danger ? "error" : undefined}
        sx={{
          fontWeight: 600,
          mb: 2.5,
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        {icon} {title}
      </Typography>
      {children}
    </Paper>
  );
}

export function SettingsContent({ user }: SettingsContentProps) {
  const router = useRouter();
  const { mode, toggleTheme } = useThemeMode();

  // Form states
  const [name, setName] = useState(user.name || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // UI states
  const [saving, setSaving] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [activeExportId, setActiveExportId] = useState<string | null>(null);
  const exportControllerRef = useRef<AbortController | null>(null);
  const [aiUsage, setAiUsage] = useState<AiUsage | null>(null);
  const [usageUnavailable, setUsageUnavailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/usage", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Usage request failed");
        const payload = (await response.json()) as { usage?: { ai?: AiUsage } };
        if (payload.usage?.ai) setAiUsage(payload.usage.ai);
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setUsageUnavailable(true);
      });
    return () => controller.abort();
  }, []);

  const handleExportAccount = async () => {
    const controller = new AbortController();
    exportControllerRef.current?.abort();
    exportControllerRef.current = controller;
    try {
      setExporting(true);
      const response = await fetch("/api/v1/users/account/exports", {
        method: "POST",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Failed to queue account export");
      const created = (await response.json()) as { id: string };
      setActiveExportId(created.id);

      let completed = false;
      for (let attempt = 0; attempt < 600; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        const statusResponse = await fetch(
          `/api/v1/users/account/exports/${created.id}`,
          { signal: controller.signal },
        );
        if (!statusResponse.ok) throw new Error("Failed to read export status");
        const status = (await statusResponse.json()) as {
          status: string;
          lastError?: string | null;
        };
        if (status.status === "COMPLETED") {
          completed = true;
          break;
        }
        if (status.status === "FAILED") {
          throw new Error(status.lastError || "Account export failed");
        }
        if (status.status === "CANCELLED" || status.status === "EXPIRED") {
          throw new DOMException("Account export cancelled", "AbortError");
        }
      }
      if (!completed) throw new Error("Account export timed out");

      const anchor = document.createElement("a");
      anchor.href = `/api/v1/users/account/exports/${created.id}/download`;
      anchor.download = `memoria-account-${new Date().toISOString().slice(0, 10)}.jsonl.gz`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      toast.success("Account export downloaded");
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to export account data",
        );
      }
    } finally {
      if (exportControllerRef.current === controller) {
        exportControllerRef.current = null;
      }
      setActiveExportId(null);
      setExporting(false);
    }
  };

  const handleCancelExport = async () => {
    if (!activeExportId) return;
    const exportId = activeExportId;
    exportControllerRef.current?.abort();
    await fetch(`/api/v1/users/account/exports/${exportId}`, {
      method: "DELETE",
    }).catch(() => undefined);
    toast.info("Account export cancelled");
  };

  // Profile update
  const handleSaveProfile = async () => {
    try {
      setSaving(true);
      const response = await fetch("/api/v1/users/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Failed to update profile");
      }
      toast.success("Profile updated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update profile",
      );
    } finally {
      setSaving(false);
    }
  };

  // Password change
  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (newPassword.length < 10) {
      toast.error("Password must be at least 10 characters");
      return;
    }

    try {
      setSavingPassword(true);
      const response = await fetch("/api/v1/users/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Failed to change password");
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password changed");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to change password",
      );
    } finally {
      setSavingPassword(false);
    }
  };

  // Account deletion
  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== "DELETE" || !deletePassword) return;

    try {
      setDeleting(true);
      const response = await fetch("/api/v1/users/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: deletePassword,
          confirmation: "DELETE",
        }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Failed to delete account");
      }
      await signOut({ callbackUrl: "/" });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete account",
      );
      setDeleting(false);
    }
  };

  const closeDeleteDialog = () => {
    setDeleteDialogOpen(false);
    setDeleteConfirmText("");
    setDeletePassword("");
  };

  const getInitials = (name?: string | null, email?: string | null) => {
    if (name) return name.charAt(0).toUpperCase();
    if (email) return email.charAt(0).toUpperCase();
    return "U";
  };

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Manage your account, preferences, and integrations"
      />

      <Stack spacing={3}>
        {/* Profile */}
        <SettingsSection icon={<PersonIcon color="primary" />} title="Profile">
          <Box sx={{ display: "flex", alignItems: "center", gap: 2.5, mb: 3 }}>
            <Avatar
              sx={{
                width: 64,
                height: 64,
                fontSize: 26,
                fontWeight: 700,
                background: gradients.brand,
                color: "#fff",
              }}
              src={user.image || undefined}
            >
              {getInitials(user.name, user.email)}
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography
                variant="subtitle1"
                noWrap
                sx={{
                  fontWeight: 600,
                }}
              >
                {user.name || "User"}
              </Typography>
              <Typography
                variant="body2"
                noWrap
                sx={{
                  color: "text.secondary",
                }}
              >
                {user.email}
              </Typography>
            </Box>
          </Box>

          <Divider sx={{ mb: 3 }} />

          <Stack spacing={2.5}>
            <TextField
              label="Full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              slotProps={{
                input: {
                  startAdornment: <PersonIcon color="action" sx={{ mr: 1 }} />,
                },
              }}
            />
            <TextField
              label="Email"
              value={user.email || ""}
              disabled
              fullWidth
              helperText="Email cannot be changed"
              slotProps={{
                input: {
                  startAdornment: <EmailIcon color="action" sx={{ mr: 1 }} />,
                },
              }}
            />
            <Button
              variant="contained"
              onClick={handleSaveProfile}
              disabled={saving || name === user.name}
              startIcon={<SaveIcon />}
              sx={{ alignSelf: "flex-start" }}
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </Stack>
        </SettingsSection>

        {/* Password */}
        <SettingsSection
          icon={<LockIcon color="primary" />}
          title="Change password"
        >
          <Stack spacing={2.5}>
            <TextField
              label="Current password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              fullWidth
              autoComplete="current-password"
            />
            <TextField
              label="New password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              fullWidth
              helperText="Minimum 10 characters"
              autoComplete="new-password"
            />
            <TextField
              label="Confirm new password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              fullWidth
              autoComplete="new-password"
              error={
                confirmPassword.length > 0 && newPassword !== confirmPassword
              }
              helperText={
                confirmPassword.length > 0 && newPassword !== confirmPassword
                  ? "Passwords do not match"
                  : ""
              }
            />
            <Button
              variant="contained"
              onClick={handleChangePassword}
              disabled={
                savingPassword ||
                !currentPassword ||
                !newPassword ||
                !confirmPassword
              }
              startIcon={<LockIcon />}
              sx={{ alignSelf: "flex-start" }}
            >
              {savingPassword ? "Changing…" : "Change password"}
            </Button>
          </Stack>
        </SettingsSection>

        {/* Preferences */}
        <SettingsSection
          icon={<ThemeIcon color="primary" />}
          title="Preferences"
        >
          <List disablePadding>
            <ListItem
              sx={{
                borderRadius: 2,
                px: 1,
                "&:hover": { bgcolor: "action.hover" },
              }}
            >
              <ListItemIcon>
                <ThemeIcon />
              </ListItemIcon>
              <ListItemText
                primary="Dark mode"
                secondary="Switch between light and dark themes"
              />
              <Switch
                checked={mode === "dark"}
                onChange={toggleTheme}
                slotProps={{ input: { "aria-label": "Toggle dark mode" } }}
              />
            </ListItem>
          </List>
        </SettingsSection>

        <SettingsSection
          icon={<NotificationsIcon color="primary" />}
          title="Notifications"
        >
          <NotificationPreferences />
        </SettingsSection>

        {/* Keyboard shortcuts */}
        <SettingsSection
          icon={<KeyboardIcon color="primary" />}
          title="Keyboard shortcuts"
        >
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
              gap: 1.5,
            }}
          >
            {keyboardShortcuts.map((shortcut, index) => (
              <Box
                key={index}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  p: 1.5,
                  borderRadius: 2,
                  bgcolor: (theme) => alpha(theme.palette.primary.main, 0.04),
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    color: "text.secondary",
                  }}
                >
                  {shortcut.description}
                </Typography>
                <Box sx={{ display: "flex", gap: 0.5 }}>
                  {shortcut.keys.map((key, i) => (
                    <Box
                      key={i}
                      component="kbd"
                      sx={{
                        px: 1.25,
                        py: 0.5,
                        borderRadius: 1,
                        bgcolor: "background.paper",
                        border: 1,
                        borderColor: "divider",
                        fontFamily: "monospace",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                      }}
                    >
                      {key}
                    </Box>
                  ))}
                </Box>
              </Box>
            ))}
          </Box>
        </SettingsSection>

        {/* AI agents */}
        <AgentControlCenter />

        <SettingsSection
          icon={<AiUsageIcon color="primary" />}
          title="AI usage"
        >
          {usageUnavailable ? (
            <Alert severity="warning">
              AI allowance information is temporarily unavailable.
            </Alert>
          ) : aiUsage ? (
            <Stack spacing={1.5}>
              <Typography variant="body2" color="text.secondary">
                {aiUsage.enabled
                  ? `${aiUsage.tokensUsed.toLocaleString()} of ${aiUsage.tokenLimit.toLocaleString()} worst-case tokens reserved today across ${aiUsage.requests} request${aiUsage.requests === 1 ? "" : "s"}.`
                  : "AI features are currently disabled by the operator."}
              </Typography>
              <LinearProgress
                variant="determinate"
                value={Math.min(
                  100,
                  (aiUsage.tokensUsed / Math.max(1, aiUsage.tokenLimit)) * 100,
                )}
                aria-label="Daily AI token allowance used"
              />
              <Typography variant="caption" color="text.secondary">
                Cost allowance: $
                {(aiUsage.costMicroUsdUsed / 1_000_000).toFixed(4)} of $
                {(aiUsage.costMicroUsdLimit / 1_000_000).toFixed(4)}. Concurrent
                requests: {aiUsage.activeRequests}/{aiUsage.concurrencyLimit}.
                Rejected today: {aiUsage.rejections}.
              </Typography>
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Loading today&apos;s AI allowance…
            </Typography>
          )}
        </SettingsSection>

        {/* Developer settings */}
        <SettingsSection
          icon={<ApiKeysIcon color="primary" />}
          title="Developer settings"
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 2,
            }}
          >
            <Box>
              <Typography
                variant="subtitle1"
                sx={{
                  fontWeight: 600,
                }}
              >
                API keys
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: "text.secondary",
                }}
              >
                Manage API keys for external access and extensions
              </Typography>
            </Box>
            <Button variant="outlined" onClick={() => router.push("/api-keys")}>
              Manage keys
            </Button>
          </Box>
        </SettingsSection>

        <SettingsSection
          icon={<DownloadIcon color="primary" />}
          title="Your data"
        >
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mb: 2,
            }}
          >
            Build a versioned, checksummed JSON Lines archive of your profile,
            workspaces, canvases, items, sharing settings, comments, activity,
            preferences, and authorized upload objects. Large exports run in the
            background and expire after 24 hours.
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={handleExportAccount}
              disabled={exporting}
            >
              {exporting ? "Building secure archive…" : "Download account data"}
            </Button>
            {exporting && activeExportId && (
              <Button color="error" onClick={handleCancelExport}>
                Cancel export
              </Button>
            )}
          </Stack>
        </SettingsSection>

        {/* Danger zone */}
        <SettingsSection icon={<DeleteIcon />} title="Danger zone" danger>
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mb: 3,
            }}
          >
            Once you delete your account, there is no going back. All your
            canvases, notes, and data will be permanently deleted.
          </Typography>

          <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
            <Button
              variant="outlined"
              color="error"
              onClick={() => signOut({ callbackUrl: "/" })}
              startIcon={<LogoutIcon />}
            >
              Sign out
            </Button>
            <Button
              variant="contained"
              color="error"
              onClick={() => setDeleteDialogOpen(true)}
              startIcon={<DeleteIcon />}
            >
              Delete account
            </Button>
          </Box>
        </SettingsSection>
      </Stack>

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={closeDeleteDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 600, color: "error.main" }}>
          Delete account
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            This action cannot be undone. All your data will be permanently
            deleted. Enter your password and type <strong>DELETE</strong> to
            confirm.
          </DialogContentText>
          <Stack spacing={2}>
            <TextField
              fullWidth
              type="password"
              label="Password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              autoComplete="current-password"
            />
            <TextField
              fullWidth
              label="Confirmation"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="Type DELETE to confirm"
              error={
                deleteConfirmText.length > 0 && deleteConfirmText !== "DELETE"
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 1 }}>
          <Button onClick={closeDeleteDialog}>Cancel</Button>
          <Button
            onClick={handleDeleteAccount}
            color="error"
            variant="contained"
            disabled={
              deleteConfirmText !== "DELETE" || !deletePassword || deleting
            }
          >
            {deleting ? "Deleting…" : "Delete account"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
