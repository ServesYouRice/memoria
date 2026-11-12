"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSession, signOutAndRedirect } from "@/lib/auth-client";
import {
  AppBar,
  Avatar,
  Badge,
  Box,
  Button,
  Container,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
  alpha,
} from "@mui/material";
import {
  Menu as MenuIcon,
  Search as SearchIcon,
  DashboardOutlined as DashboardIcon,
  FolderOutlined as WorkspacesIcon,
  PeopleAltOutlined as SharedIcon,
  NotificationsNoneOutlined as NotificationsIcon,
  SettingsOutlined as SettingsIcon,
  KeyOutlined as ApiKeysIcon,
  LogoutOutlined as LogoutIcon,
  DeleteOutlineOutlined as TrashIcon,
} from "@mui/icons-material";
import { MemoriaLogo } from "@/components/MemoriaLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useUnreadNotifications } from "@/lib/hooks/use-notifications";
import { toImageProxyUrl } from "@/lib/images/proxy-url";
import { AskLauncher } from "@/features/command-palette/AskPalette";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: DashboardIcon },
  { label: "Shared with me", href: "/shared", icon: SharedIcon },
  { label: "Workspaces", href: "/workspaces", icon: WorkspacesIcon },
  { label: "Trash", href: "/trash", icon: TrashIcon },
];

function getInitials(name?: string | null, email?: string | null) {
  if (name) return name.charAt(0).toUpperCase();
  if (email) return email.charAt(0).toUpperCase();
  return "U";
}

/** Outer width shared by the top bar and every signed-in page (IMP-087). */
export const SHELL_MAX_WIDTH = "lg" as const;

export interface AppShellProps {
  children: React.ReactNode;
  /**
   * Narrow reading pages keep the shared outer width (so titles line up with
   * the top bar on every page) and set a left-aligned inner column instead.
   */
  readingWidth?: "sm" | "md";
}

/**
 * Shared application shell for authenticated pages: sticky glass top bar
 * with primary navigation, search, notifications, theme toggle, and the
 * user account menu.
 */
export function AppShell({ children, readingWidth }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [accountAnchor, setAccountAnchor] = useState<null | HTMLElement>(null);

  const user = session?.user;
  const { data: unreadNotifications = 0 } = useUnreadNotifications(
    Boolean(user),
  );

  const isActive = (href: string) =>
    pathname === href ||
    (href !== "/dashboard" && pathname?.startsWith(`${href}/`));

  const closeAccountMenu = () => setAccountAnchor(null);

  return (
    <Box
      sx={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.default",
      }}
    >
      <Button
        component="a"
        href="#main-content"
        sx={{
          position: "fixed",
          zIndex: (theme) => theme.zIndex.tooltip + 1,
          top: 8,
          left: 8,
          transform: "translateY(-160%)",
          bgcolor: "background.paper",
          "&:focus-visible": { transform: "translateY(0)" },
        }}
      >
        Skip to main content
      </Button>
      <AppBar position="sticky">
        {/* Same outer width as the page, so the logo lines up with titles. */}
        <Container maxWidth={SHELL_MAX_WIDTH}>
          {/* Tighter on the narrowest phones: seven controls fit 320px. */}
          <Toolbar disableGutters sx={{ gap: { xs: 0.5, sm: 1 } }}>
            {/* Mobile menu */}
            <IconButton
              edge="start"
              aria-label="Open navigation menu"
              onClick={() => setDrawerOpen(true)}
              sx={{ display: { xs: "inline-flex", md: "none" } }}
            >
              <MenuIcon />
            </IconButton>

            {/* Brand */}
            <Box
              component={Link}
              href="/dashboard"
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                textDecoration: "none",
                color: "inherit",
                mr: { md: 2 },
              }}
            >
              <MemoriaLogo size={32} />
              <Typography
                variant="h6"
                sx={{ fontWeight: 700, display: { xs: "none", sm: "block" } }}
              >
                Memoria
              </Typography>
            </Box>

            {/* Desktop nav */}
            <Box
              component="nav"
              aria-label="Primary navigation"
              sx={{
                display: { xs: "none", md: "flex" },
                gap: 0.5,
                flexGrow: 1,
              }}
            >
              {NAV_ITEMS.map((item) => (
                <Button
                  key={item.href}
                  component={Link}
                  href={item.href}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  size="small"
                  startIcon={<item.icon />}
                  sx={{
                    px: 1.5,
                    color: isActive(item.href)
                      ? "primary.main"
                      : "text.secondary",
                    bgcolor: (theme) =>
                      isActive(item.href)
                        ? alpha(theme.palette.primary.main, 0.08)
                        : "transparent",
                    "&:hover": {
                      bgcolor: (theme) =>
                        alpha(theme.palette.primary.main, 0.08),
                      color: "primary.main",
                    },
                  }}
                >
                  {item.label}
                </Button>
              ))}
            </Box>

            <Box sx={{ flexGrow: { xs: 1, md: 0 } }} />
            {user && <AskLauncher />}

            {/* Actions */}
            <Tooltip title="Search">
              <IconButton
                aria-label="Search"
                onClick={() => router.push("/search")}
              >
                <SearchIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Notifications">
              <IconButton
                aria-label={
                  unreadNotifications > 0
                    ? `Notifications, ${unreadNotifications} unread`
                    : "Notifications"
                }
                component={Link}
                href="/notifications"
                sx={{
                  color: isActive("/notifications")
                    ? "primary.main"
                    : undefined,
                }}
              >
                {/* Render no badge at zero: MUI's hidden-badge transform can
                  compute to `none` after a full load and leave a red "0". */}
                {unreadNotifications > 0 ? (
                  <Badge
                    badgeContent={unreadNotifications}
                    color="error"
                    max={99}
                  >
                    <NotificationsIcon />
                  </Badge>
                ) : (
                  <NotificationsIcon />
                )}
              </IconButton>
            </Tooltip>
            <ThemeToggle />
            <Tooltip title="Account">
              <IconButton
                aria-label="Account menu"
                onClick={(e) => setAccountAnchor(e.currentTarget)}
                sx={{ ml: 0.5 }}
              >
                <Avatar
                  src={toImageProxyUrl(user?.image)}
                  sx={{
                    width: 32,
                    height: 32,
                    fontSize: 14,
                    fontWeight: 700,
                    bgcolor: "primary.main",
                    color: "primary.contrastText",
                  }}
                >
                  {getInitials(user?.name, user?.email)}
                </Avatar>
              </IconButton>
            </Tooltip>

            <Menu
              anchorEl={accountAnchor}
              open={Boolean(accountAnchor)}
              onClose={closeAccountMenu}
              anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
              transformOrigin={{ vertical: "top", horizontal: "right" }}
            >
              <Box sx={{ px: 2, py: 1.5 }}>
                <Typography variant="subtitle2" noWrap>
                  {user?.name || "Account"}
                </Typography>
                <Typography
                  variant="caption"
                  noWrap
                  sx={{
                    color: "text.secondary",
                    display: "block",
                  }}
                >
                  {user?.email}
                </Typography>
              </Box>
              <Divider sx={{ mb: 0.5 }} />
              <MenuItem
                component={Link}
                href="/settings"
                onClick={closeAccountMenu}
              >
                <ListItemIcon>
                  <SettingsIcon fontSize="small" />
                </ListItemIcon>
                Settings
              </MenuItem>
              <MenuItem
                component={Link}
                href="/api-keys"
                onClick={closeAccountMenu}
              >
                <ListItemIcon>
                  <ApiKeysIcon fontSize="small" />
                </ListItemIcon>
                API Keys
              </MenuItem>
              <Divider sx={{ my: 0.5 }} />
              <MenuItem
                onClick={() => {
                  closeAccountMenu();
                  void signOutAndRedirect("/").catch(() => {
                    toast.error("Sign out failed. Please try again.");
                  });
                }}
              >
                <ListItemIcon>
                  <LogoutIcon fontSize="small" />
                </ListItemIcon>
                Sign out
              </MenuItem>
            </Menu>
          </Toolbar>
        </Container>
      </AppBar>

      {/* Mobile drawer */}
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 264 }} role="navigation" aria-label="Main navigation">
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 2 }}>
            <MemoriaLogo size={32} />
            <Typography
              variant="h6"
              sx={{
                fontWeight: 700,
              }}
            >
              Memoria
            </Typography>
          </Box>
          <Divider />
          <List>
            {[
              ...NAV_ITEMS,
              {
                label: "Notifications",
                href: "/notifications",
                icon: NotificationsIcon,
              },
            ].map((item) => (
              <ListItem key={item.href} disablePadding>
                <ListItemButton
                  component={Link}
                  href={item.href}
                  selected={isActive(item.href)}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  onClick={() => setDrawerOpen(false)}
                  sx={{ borderRadius: 2, mx: 1 }}
                >
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    <item.icon />
                  </ListItemIcon>
                  <ListItemText primary={item.label} />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Box>
      </Drawer>

      {/* Page content */}
      <Container
        component="main"
        id="main-content"
        tabIndex={-1}
        maxWidth={SHELL_MAX_WIDTH}
        sx={{ flexGrow: 1, py: 4 }}
      >
        {readingWidth ? (
          <Box
            data-testid="reading-column"
            sx={{
              maxWidth: (theme) => theme.breakpoints.values[readingWidth],
            }}
          >
            {children}
          </Box>
        ) : (
          children
        )}
      </Container>
      <Divider />
      <Box component="footer" sx={{ py: 2, px: 3 }}>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <Button component={Link} href="/help" size="small">
            Help
          </Button>
          <Button component={Link} href="/status" size="small">
            Status
          </Button>
          <Button component={Link} href="/privacy" size="small">
            Privacy
          </Button>
          <Button component={Link} href="/terms" size="small">
            Terms
          </Button>
        </Stack>
      </Box>
    </Box>
  );
}
