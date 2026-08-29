"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
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
import { gradients } from "@/lib/theme";
import { useUnreadNotifications } from "@/lib/hooks/use-notifications";

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

export interface AppShellProps {
  children: React.ReactNode;
  /** Max width of the page content container. Pass false for full-bleed pages. */
  maxWidth?: "sm" | "md" | "lg" | "xl" | false;
}

/**
 * Shared application shell for authenticated pages: sticky glass top bar
 * with primary navigation, search, notifications, theme toggle, and the
 * user account menu.
 */
export function AppShell({ children, maxWidth = "lg" }: AppShellProps) {
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
        <Toolbar sx={{ gap: 1 }}>
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
            sx={{ display: { xs: "none", md: "flex" }, gap: 0.5, flexGrow: 1 }}
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
                    bgcolor: (theme) => alpha(theme.palette.primary.main, 0.08),
                    color: "primary.main",
                  },
                }}
              >
                {item.label}
              </Button>
            ))}
          </Box>

          <Box sx={{ flexGrow: { xs: 1, md: 0 } }} />

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
                color: isActive("/notifications") ? "primary.main" : undefined,
              }}
            >
              <Badge
                badgeContent={unreadNotifications}
                color="error"
                max={99}
                invisible={unreadNotifications === 0}
              >
                <NotificationsIcon />
              </Badge>
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
                src={user?.image || undefined}
                sx={{
                  width: 32,
                  height: 32,
                  fontSize: 14,
                  fontWeight: 700,
                  background: gradients.brand,
                  color: "#fff",
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
                signOut({ callbackUrl: "/" });
              }}
            >
              <ListItemIcon>
                <LogoutIcon fontSize="small" />
              </ListItemIcon>
              Sign out
            </MenuItem>
          </Menu>
        </Toolbar>
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
      {maxWidth === false ? (
        <Box
          id="main-content"
          component="main"
          tabIndex={-1}
          sx={{ flexGrow: 1 }}
        >
          {children}
        </Box>
      ) : (
        <Container
          component="main"
          id="main-content"
          tabIndex={-1}
          maxWidth={maxWidth}
          sx={{ flexGrow: 1, py: 4 }}
        >
          {children}
        </Container>
      )}
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
