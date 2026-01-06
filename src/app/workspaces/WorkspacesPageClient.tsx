'use client';

import React, { useState } from 'react';
import {
    Box,
    Container,
    Typography,
    Paper,
    Button,
    Card,
    CardContent,
    CardActions,
    IconButton,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    CircularProgress,
    Alert,
    Chip,
    Menu,
    MenuItem,
    ListItemIcon,
    ListItemText,
} from '@mui/material';
import {
    Add as AddIcon,
    Folder as FolderIcon,
    MoreVert as MoreIcon,
    Edit as EditIcon,
    Delete as DeleteIcon,
} from '@mui/icons-material';
import {
    useWorkspaces,
    useCreateWorkspace,
    useUpdateWorkspace,
    useDeleteWorkspace,
    type Workspace,
} from '@/lib/hooks/use-workspaces';
import Link from 'next/link';

export default function WorkspacesPageClient() {
    const { data, isLoading, error } = useWorkspaces();
    const createWorkspace = useCreateWorkspace();
    const updateWorkspace = useUpdateWorkspace();
    const deleteWorkspace = useDeleteWorkspace();

    // Dialog states
    const [createOpen, setCreateOpen] = useState(false);
    const [editOpen, setEditOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [workspaceName, setWorkspaceName] = useState('');
    const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null);

    // Menu state
    const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
    const [menuWorkspace, setMenuWorkspace] = useState<Workspace | null>(null);

    const workspaces = data?.workspaces ?? [];

    const handleCreate = async () => {
        if (!workspaceName.trim()) return;
        try {
            await createWorkspace.mutateAsync({ name: workspaceName.trim() });
            setWorkspaceName('');
            setCreateOpen(false);
        } catch {
            // Error handled by mutation
        }
    };

    const handleEdit = async () => {
        if (!selectedWorkspace || !workspaceName.trim()) return;
        try {
            await updateWorkspace.mutateAsync({
                workspaceId: selectedWorkspace.id,
                name: workspaceName.trim(),
            });
            setWorkspaceName('');
            setEditOpen(false);
            setSelectedWorkspace(null);
        } catch {
            // Error handled by mutation
        }
    };

    const handleDelete = async () => {
        if (!selectedWorkspace) return;
        try {
            await deleteWorkspace.mutateAsync({ workspaceId: selectedWorkspace.id });
            setDeleteOpen(false);
            setSelectedWorkspace(null);
        } catch {
            // Error handled by mutation
        }
    };

    const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, workspace: Workspace) => {
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
        <Container maxWidth="lg" sx={{ py: 4 }}>
            {/* Header */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 4 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <FolderIcon color="primary" sx={{ fontSize: 32 }} />
                    <Box>
                        <Typography variant="h4" fontWeight={700}>
                            Workspaces
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            Organize your canvases into workspaces
                        </Typography>
                    </Box>
                </Box>
                <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={() => setCreateOpen(true)}
                >
                    New Workspace
                </Button>
            </Box>

            {/* Error state */}
            {error && (
                <Alert severity="error" sx={{ mb: 3 }}>
                    Failed to load workspaces
                </Alert>
            )}

            {/* Loading state */}
            {isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                    <CircularProgress />
                </Box>
            ) : workspaces.length === 0 ? (
                /* Empty state */
                <Paper
                    variant="outlined"
                    sx={{
                        p: 6,
                        textAlign: 'center',
                        borderStyle: 'dashed',
                        borderRadius: 3,
                    }}
                >
                    <FolderIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
                    <Typography variant="h6" gutterBottom>
                        No workspaces yet
                    </Typography>
                    <Typography color="text.secondary" sx={{ mb: 3 }}>
                        Create a workspace to organize your canvases into groups.
                    </Typography>
                    <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={() => setCreateOpen(true)}
                    >
                        Create Your First Workspace
                    </Button>
                </Paper>
            ) : (
                /* Workspace grid */
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                        gap: 3,
                    }}
                >
                    {workspaces.map((workspace) => (
                        <Card
                            key={workspace.id}
                            variant="outlined"
                            sx={{
                                transition: 'all 0.2s',
                                '&:hover': {
                                    boxShadow: 4,
                                    borderColor: 'primary.main',
                                },
                            }}
                        >
                            <CardContent>
                                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                        <FolderIcon color="primary" />
                                        <Typography variant="h6" fontWeight={600}>
                                            {workspace.name}
                                        </Typography>
                                    </Box>
                                    <IconButton
                                        size="small"
                                        onClick={(e) => handleMenuOpen(e, workspace)}
                                    >
                                        <MoreIcon />
                                    </IconButton>
                                </Box>
                                <Box sx={{ mt: 2 }}>
                                    <Chip
                                        size="small"
                                        label={`${workspace.canvasCount} canvas${workspace.canvasCount !== 1 ? 'es' : ''}`}
                                        variant="outlined"
                                    />
                                </Box>
                            </CardContent>
                            <CardActions sx={{ px: 2, pb: 2 }}>
                                <Button
                                    component={Link}
                                    href={`/dashboard?workspace=${workspace.id}`}
                                    size="small"
                                >
                                    View Canvases
                                </Button>
                            </CardActions>
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
                <MenuItem onClick={openDeleteDialog} sx={{ color: 'error.main' }}>
                    <ListItemIcon>
                        <DeleteIcon fontSize="small" color="error" />
                    </ListItemIcon>
                    <ListItemText>Delete</ListItemText>
                </MenuItem>
            </Menu>

            {/* Create Dialog */}
            <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="sm">
                <DialogTitle>Create Workspace</DialogTitle>
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
                            if (e.key === 'Enter') handleCreate();
                        }}
                    />
                </DialogContent>
                <DialogActions>
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
            <Dialog open={editOpen} onClose={() => setEditOpen(false)} fullWidth maxWidth="sm">
                <DialogTitle>Rename Workspace</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        label="Workspace name"
                        fullWidth
                        value={workspaceName}
                        onChange={(e) => setWorkspaceName(e.target.value)}
                        sx={{ mt: 1 }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleEdit();
                        }}
                    />
                </DialogContent>
                <DialogActions>
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
            <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} fullWidth maxWidth="sm">
                <DialogTitle>Delete Workspace</DialogTitle>
                <DialogContent>
                    <Typography>
                        Are you sure you want to delete <strong>{selectedWorkspace?.name}</strong>?
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        Canvases in this workspace will not be deleted, they will simply be unassigned.
                    </Typography>
                </DialogContent>
                <DialogActions>
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
        </Container>
    );
}
