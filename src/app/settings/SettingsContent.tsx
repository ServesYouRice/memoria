'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
    Box,
    Container,
    Typography,
    Paper,
    Avatar,
    Button,
    TextField,
    Divider,
    Alert,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
    IconButton,
    List,
    ListItem,
    ListItemIcon,
    ListItemText,
    Switch,
    Grid,
    alpha,
    Snackbar,
} from '@mui/material';
import {
    ArrowBack,
    Person as PersonIcon,
    Email as EmailIcon,
    Lock as LockIcon,
    Palette as ThemeIcon,
    Keyboard as KeyboardIcon,
    Delete as DeleteIcon,
    Logout as LogoutIcon,
    Save as SaveIcon,
} from '@mui/icons-material';
import { useThemeMode } from '@/lib/theme-context';

interface SettingsContentProps {
    user: {
        id?: string;
        name?: string | null;
        email?: string | null;
        image?: string | null;
    };
}

// Keyboard shortcuts data
const keyboardShortcuts = [
    { keys: ['Ctrl', 'K'], description: 'Open Command Palette' },
    { keys: ['Ctrl', 'Z'], description: 'Undo' },
    { keys: ['Ctrl', 'Y'], description: 'Redo' },
    { keys: ['Ctrl', 'S'], description: 'Save (auto-saved)' },
    { keys: ['Delete'], description: 'Delete selected item' },
    { keys: ['Escape'], description: 'Deselect / Close dialog' },
    { keys: ['Ctrl', '+'], description: 'Zoom in' },
    { keys: ['Ctrl', '-'], description: 'Zoom out' },
    { keys: ['Ctrl', '0'], description: 'Reset zoom' },
];

export function SettingsContent({ user }: SettingsContentProps) {
    const router = useRouter();
    const { mode, toggleTheme } = useThemeMode();

    // Form states
    const [name, setName] = useState(user.name || '');
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    // UI states
    const [saving, setSaving] = useState(false);
    const [savingPassword, setSavingPassword] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deleteConfirmText, setDeleteConfirmText] = useState('');
    const [deleting, setDeleting] = useState(false);
    const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
        open: false,
        message: '',
        severity: 'success',
    });

    // Profile update
    const handleSaveProfile = async () => {
        try {
            setSaving(true);
            const response = await fetch('/api/v1/users/profile', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to update profile');
            }
            setSnackbar({ open: true, message: 'Profile updated successfully!', severity: 'success' });
        } catch (error) {
            setSnackbar({ open: true, message: error instanceof Error ? error.message : 'Failed to update profile', severity: 'error' });
        } finally {
            setSaving(false);
        }
    };

    // Password change
    const handleChangePassword = async () => {
        if (newPassword !== confirmPassword) {
            setSnackbar({ open: true, message: 'Passwords do not match', severity: 'error' });
            return;
        }
        if (newPassword.length < 10) {
            setSnackbar({ open: true, message: 'Password must be at least 10 characters', severity: 'error' });
            return;
        }

        try {
            setSavingPassword(true);
            const response = await fetch('/api/v1/users/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword, newPassword }),
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to change password');
            }
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setSnackbar({ open: true, message: 'Password changed successfully!', severity: 'success' });
        } catch (error) {
            setSnackbar({ open: true, message: error instanceof Error ? error.message : 'Failed to change password', severity: 'error' });
        } finally {
            setSavingPassword(false);
        }
    };

    // Account deletion
    const handleDeleteAccount = async () => {
        if (deleteConfirmText !== 'DELETE') return;

        // Prompt for password
        const password = prompt('Enter your password to confirm account deletion:');
        if (!password) return;

        try {
            setDeleting(true);
            const response = await fetch('/api/v1/users/account', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password, confirmation: 'DELETE' }),
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to delete account');
            }
            await signOut({ callbackUrl: '/' });
        } catch (error) {
            setSnackbar({ open: true, message: error instanceof Error ? error.message : 'Failed to delete account', severity: 'error' });
            setDeleting(false);
        }
    };

    const getInitials = (name?: string | null, email?: string | null) => {
        if (name) return name.charAt(0).toUpperCase();
        if (email) return email.charAt(0).toUpperCase();
        return 'U';
    };

    return (
        <Box
            sx={{
                minHeight: '100vh',
                bgcolor: 'background.default',
                pb: 6,
            }}
        >
            {/* Header */}
            <Box
                sx={{
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    py: 4,
                    mb: 4,
                }}
            >
                <Container maxWidth="md">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <IconButton
                            onClick={() => router.push('/dashboard')}
                            sx={{ color: 'white' }}
                        >
                            <ArrowBack />
                        </IconButton>
                        <Typography variant="h4" fontWeight={700} color="white">
                            Settings
                        </Typography>
                    </Box>
                </Container>
            </Box>

            <Container maxWidth="md">
                <Grid container spacing={4}>
                    {/* Profile Section */}
                    <Grid item xs={12}>
                        <Paper
                            sx={{
                                p: 4,
                                borderRadius: 3,
                                animation: 'fadeIn 0.5s ease-out',
                            }}
                        >
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, mb: 4 }}>
                                <Avatar
                                    sx={{
                                        width: 80,
                                        height: 80,
                                        fontSize: 32,
                                        fontWeight: 700,
                                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                    }}
                                    src={user.image || undefined}
                                >
                                    {getInitials(user.name, user.email)}
                                </Avatar>
                                <Box>
                                    <Typography variant="h5" fontWeight={600}>
                                        {user.name || 'User'}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {user.email}
                                    </Typography>
                                </Box>
                            </Box>

                            <Divider sx={{ mb: 3 }} />

                            <Typography variant="h6" fontWeight={600} sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 1 }}>
                                <PersonIcon color="primary" /> Profile Information
                            </Typography>

                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                <TextField
                                    label="Full Name"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    fullWidth
                                    InputProps={{
                                        startAdornment: <PersonIcon color="action" sx={{ mr: 1 }} />,
                                    }}
                                />
                                <TextField
                                    label="Email"
                                    value={user.email || ''}
                                    disabled
                                    fullWidth
                                    helperText="Email cannot be changed"
                                    InputProps={{
                                        startAdornment: <EmailIcon color="action" sx={{ mr: 1 }} />,
                                    }}
                                />
                                <Button
                                    variant="contained"
                                    onClick={handleSaveProfile}
                                    disabled={saving || name === user.name}
                                    startIcon={saving ? null : <SaveIcon />}
                                    sx={{
                                        alignSelf: 'flex-start',
                                        px: 4,
                                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                    }}
                                >
                                    {saving ? 'Saving...' : 'Save Changes'}
                                </Button>
                            </Box>
                        </Paper>
                    </Grid>

                    {/* Password Section */}
                    <Grid item xs={12}>
                        <Paper
                            sx={{
                                p: 4,
                                borderRadius: 3,
                                animation: 'fadeIn 0.5s ease-out 0.1s both',
                            }}
                        >
                            <Typography variant="h6" fontWeight={600} sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 1 }}>
                                <LockIcon color="primary" /> Change Password
                            </Typography>

                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                <TextField
                                    label="Current Password"
                                    type="password"
                                    value={currentPassword}
                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                    fullWidth
                                />
                                <TextField
                                    label="New Password"
                                    type="password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    fullWidth
                                    helperText="Minimum 10 characters"
                                />
                                <TextField
                                    label="Confirm New Password"
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    fullWidth
                                    error={confirmPassword.length > 0 && newPassword !== confirmPassword}
                                    helperText={confirmPassword.length > 0 && newPassword !== confirmPassword ? 'Passwords do not match' : ''}
                                />
                                <Button
                                    variant="contained"
                                    onClick={handleChangePassword}
                                    disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}
                                    startIcon={savingPassword ? null : <LockIcon />}
                                    sx={{
                                        alignSelf: 'flex-start',
                                        px: 4,
                                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                    }}
                                >
                                    {savingPassword ? 'Changing...' : 'Change Password'}
                                </Button>
                            </Box>
                        </Paper>
                    </Grid>

                    {/* Preferences Section */}
                    <Grid item xs={12}>
                        <Paper
                            sx={{
                                p: 4,
                                borderRadius: 3,
                                animation: 'fadeIn 0.5s ease-out 0.2s both',
                            }}
                        >
                            <Typography variant="h6" fontWeight={600} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                                <ThemeIcon color="primary" /> Preferences
                            </Typography>

                            <List>
                                <ListItem
                                    sx={{
                                        borderRadius: 2,
                                        '&:hover': { bgcolor: 'action.hover' },
                                    }}
                                >
                                    <ListItemIcon>
                                        <ThemeIcon />
                                    </ListItemIcon>
                                    <ListItemText
                                        primary="Dark Mode"
                                        secondary="Switch between light and dark themes"
                                    />
                                    <Switch checked={mode === 'dark'} onChange={toggleTheme} />
                                </ListItem>
                            </List>
                        </Paper>
                    </Grid>

                    {/* Keyboard Shortcuts Section */}
                    <Grid item xs={12}>
                        <Paper
                            sx={{
                                p: 4,
                                borderRadius: 3,
                                animation: 'fadeIn 0.5s ease-out 0.3s both',
                            }}
                        >
                            <Typography variant="h6" fontWeight={600} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                                <KeyboardIcon color="primary" /> Keyboard Shortcuts
                            </Typography>

                            <Grid container spacing={2}>
                                {keyboardShortcuts.map((shortcut, index) => (
                                    <Grid item xs={12} sm={6} key={index}>
                                        <Box
                                            sx={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                p: 2,
                                                borderRadius: 2,
                                                bgcolor: (theme) => alpha(theme.palette.primary.main, 0.05),
                                            }}
                                        >
                                            <Typography variant="body2" color="text.secondary">
                                                {shortcut.description}
                                            </Typography>
                                            <Box sx={{ display: 'flex', gap: 0.5 }}>
                                                {shortcut.keys.map((key, i) => (
                                                    <Box
                                                        key={i}
                                                        sx={{
                                                            px: 1.5,
                                                            py: 0.5,
                                                            borderRadius: 1,
                                                            bgcolor: 'background.paper',
                                                            border: 1,
                                                            borderColor: 'divider',
                                                            fontFamily: 'monospace',
                                                            fontSize: '0.75rem',
                                                            fontWeight: 600,
                                                        }}
                                                    >
                                                        {key}
                                                    </Box>
                                                ))}
                                            </Box>
                                        </Box>
                                    </Grid>
                                ))}
                            </Grid>
                        </Paper>
                    </Grid>

                    {/* API Keys Section */}
                    <Grid item xs={12}>
                        <Paper
                            sx={{
                                p: 4,
                                borderRadius: 3,
                                animation: 'fadeIn 0.5s ease-out 0.35s both', // Slight delay
                            }}
                        >
                            <Typography variant="h6" fontWeight={600} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                                <ThemeIcon color="primary" /> Developer Settings
                            </Typography>

                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Box>
                                    <Typography variant="subtitle1" fontWeight={600}>API Keys</Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        Manage API keys for external access and extensions
                                    </Typography>
                                </Box>
                                <Button
                                    variant="outlined"
                                    onClick={() => router.push('/api-keys')}
                                >
                                    Manage Keys
                                </Button>
                            </Box>
                        </Paper>
                    </Grid>

                    {/* Danger Zone */}
                    <Grid item xs={12}>
                        <Paper
                            sx={{
                                p: 4,
                                borderRadius: 3,
                                border: 2,
                                borderColor: 'error.main',
                                animation: 'fadeIn 0.5s ease-out 0.4s both',
                            }}
                        >
                            <Typography variant="h6" fontWeight={600} color="error" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                                <DeleteIcon /> Danger Zone
                            </Typography>

                            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                                Once you delete your account, there is no going back. All your canvases, notes, and data will be permanently deleted.
                            </Typography>

                            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                                <Button
                                    variant="outlined"
                                    color="error"
                                    onClick={() => signOut({ callbackUrl: '/' })}
                                    startIcon={<LogoutIcon />}
                                >
                                    Sign Out
                                </Button>
                                <Button
                                    variant="contained"
                                    color="error"
                                    onClick={() => setDeleteDialogOpen(true)}
                                    startIcon={<DeleteIcon />}
                                >
                                    Delete Account
                                </Button>
                            </Box>
                        </Paper>
                    </Grid>
                </Grid>
            </Container>

            {/* Delete Confirmation Dialog */}
            <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
                <DialogTitle sx={{ fontWeight: 600, color: 'error.main' }}>
                    Delete Account
                </DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ mb: 2 }}>
                        This action cannot be undone. All your data will be permanently deleted. Type{' '}
                        <strong>DELETE</strong> to confirm.
                    </DialogContentText>
                    <TextField
                        fullWidth
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        placeholder="Type DELETE to confirm"
                        error={deleteConfirmText.length > 0 && deleteConfirmText !== 'DELETE'}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
                    <Button
                        onClick={handleDeleteAccount}
                        color="error"
                        variant="contained"
                        disabled={deleteConfirmText !== 'DELETE' || deleting}
                    >
                        {deleting ? 'Deleting...' : 'Delete Account'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Snackbar for notifications */}
            <Snackbar
                open={snackbar.open}
                autoHideDuration={4000}
                onClose={() => setSnackbar({ ...snackbar, open: false })}
            >
                <Alert
                    severity={snackbar.severity}
                    onClose={() => setSnackbar({ ...snackbar, open: false })}
                    sx={{ borderRadius: 2 }}
                >
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
}
