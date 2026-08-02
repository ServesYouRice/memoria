"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Box,
  Typography,
  Button,
  Card,
  CardActionArea,
  CardContent,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Skeleton,
  Alert,
  Chip,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  alpha,
} from "@mui/material";
import {
  Add as AddIcon,
  FolderOutlined as FolderIcon,
  MoreVert as MoreIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
} from "@mui/icons-material";
import {
  useWorkspaces,
  useCreateWorkspace,
  useUpdateWorkspace,
  useDeleteWorkspace,
  type Workspace,
} from "@/lib/hooks/use-workspaces";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";

export default function WorkspacesPageClient() {
  const router = useRouter();
  const { data, isLoading, error } = useWorkspaces();
  const createWorkspace = useCreateWorkspace();
  const updateWorkspace = useUpdateWorkspace();
  const deleteWorkspace = useDeleteWorkspace();

  // Dialog states
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(
    null,
  );

  // Menu state
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuWorkspace, setMenuWorkspace] = useState<Workspace | null>(null);

  const workspaces = data?.workspaces ?? [];

  const handleCreate = async () => {
    if (!workspaceName.trim()) return;
    try {
      await createWorkspace.mutateAsync({ name: workspaceName.trim() });
      setWorkspaceName("");
      setCreateOpen(false);
      toast.success("Workspace created");
    } catch {
      toast.error("Failed to create workspace");
    }
  };

  const handleEdit = async () => {
    if (!selectedWorkspace || !workspaceName.trim()) return;
    try {
      await updateWorkspace.mutateAsync({
        workspaceId: selectedWorkspace.id,
        name: workspaceName.trim(),
      });
      setWorkspaceName("");
      setEditOpen(false);
      setSelectedWorkspace(null);
      toast.success("Workspace renamed");
    } catch {
      toast.error("Failed to rename workspace");
    }
  };

  const handleDelete = async () => {
    if (!selectedWorkspace) return;
    try {
      await deleteWorkspace.mutateAsync({ workspaceId: selectedWorkspace.id });
      setDeleteOpen(false);
      setSelectedWorkspace(null);
      toast.success("Workspace deleted");
    } catch {
      toast.error("Failed to delete workspace");
    }
  };

  const handleMenuOpen = (
    event: React.MouseEvent<HTMLElement>,
    workspace: Workspace,
  ) => {
    event.stopPropagation();
    setMenuAnchor(event.currentTarget);
    setMenuWorkspace(workspace);
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
    setMenuWorkspace(null);
  };

  const openEditDialog = () => {
    if (menuWorkspace) {
      setSelectedWorkspace(menuWorkspace);
      setWorkspaceName(menuWorkspace.name);
      setEditOpen(true);
    }
    handleMenuClose();
  };

  const openDeleteDialog = () => {
    if (menuWorkspace) {
      setSelectedWorkspace(menuWorkspace);
      setDeleteOpen(true);
    }
    handleMenuClose();
  };

  return (
    <>
      <PageHeader
        title="Workspaces"
        subtitle="Organize your canvases into workspaces"
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreateOpen(true)}
          >
            New workspace
          </Button>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load workspaces
        </Alert>
      )}

      {isLoading ? (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 2.5,
          }}
        >
          {[0, 1, 2].map((i) => (
            <Card key={i} variant="outlined">
              <CardContent>
                <Skeleton width="60%" height={30} />
                <Skeleton width="35%" height={22} sx={{ mt: 1.5 }} />
              </CardContent>
            </Card>
          ))}
        </Box>
      ) : workspaces.length === 0 ? (
        <EmptyState
          icon={FolderIcon}
          title="No workspaces yet"
          description="Create a workspace to organize your canvases into groups."
          action={
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setCreateOpen(true)}
            >
              Create your first workspace
            </Button>
          }
        />
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 2.5,
          }}
        >
          {workspaces.map((workspace, index) => (
            <Card
              key={workspace.id}
              sx={{
                position: "relative",
                animation: `fadeIn 0.4s ease-out ${Math.min(index * 0.04, 0.4)}s both`,
              }}
            >
              <IconButton
                size="small"
                aria-label={`Actions for ${workspace.name}`}
                onClick={(e) => handleMenuOpen(e, workspace)}
                sx={{ position: "absolute", top: 10, right: 10, zIndex: 2 }}
              >
                <MoreIcon />
              </IconButton>
              <CardActionArea
                onClick={() =>
                  router.push(`/dashboard?workspace=${workspace.id}`)
                }
              >
                <CardContent>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1.5,
                      pr: 4,
                    }}
                  >
                    <Box
                      sx={{
                        width: 40,
                        height: 40,
                        borderRadius: 2,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        bgcolor: (theme) =>
                          alpha(theme.palette.primary.main, 0.1),
                        flexShrink: 0,
                      }}
                    >
                      <FolderIcon color="primary" />
                    </Box>
                    <Typography
                      variant="h6"
                      noWrap
                      sx={{
                        fontWeight: 600,
                      }}
                    >
                      {workspace.name}
                    </Typography>
                  </Box>
                  <Box sx={{ mt: 2 }}>
                    <Chip
                      size="small"
                      label={`${workspace.canvasCount} canvas${workspace.canvasCount !== 1 ? "es" : ""}`}
                      variant="outlined"
                    />
                  </Box>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Box>
      )}

      {/* Context menu */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={openEditDialog}>
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Rename</ListItemText>
        </MenuItem>
        <MenuItem onClick={openDeleteDialog} sx={{ color: "error.main" }}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>

      {/* Create Dialog */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle sx={{ fontWeight: 600 }}>Create workspace</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label="Workspace name"
            fullWidth
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            placeholder="e.g., Project Alpha"
            sx={{ mt: 1 }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
          />
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 1 }}>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={!workspaceName.trim() || createWorkspace.isPending}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle sx={{ fontWeight: 600 }}>Rename workspace</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label="Workspace name"
            fullWidth
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            sx={{ mt: 1 }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleEdit();
            }}
          />
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 1 }}>
          <Button onClick={() => setEditOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleEdit}
            disabled={!workspaceName.trim() || updateWorkspace.isPending}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle sx={{ fontWeight: 600 }}>Delete workspace</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete{" "}
            <strong>{selectedWorkspace?.name}</strong>?
          </Typography>
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mt: 1,
            }}
          >
            Canvases in this workspace will not be deleted, they will simply be
            unassigned.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 1 }}>
          <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDelete}
            disabled={deleteWorkspace.isPending}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
