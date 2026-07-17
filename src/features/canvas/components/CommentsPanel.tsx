/**
 * Comments Panel Component
 * Display and manage comments for a canvas item
 */

"use client";

import React, { useState } from "react";
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  TextField,
  Button,
  List,
  ListItem,
  Avatar,
  CircularProgress,
  Alert,
  Menu,
  MenuItem,
  Divider,
} from "@mui/material";
import { Close, MoreVert, Send } from "@mui/icons-material";
import {
  useComments,
  useCreateComment,
  useDeleteComment,
  useUpdateComment,
} from "@/lib/hooks/use-comments";
import { useSession } from "next-auth/react";
import { formatDistanceToNow } from "date-fns";

export interface CommentsPanelProps {
  open: boolean;
  onClose: () => void;
  itemId: string;
  itemType: string;
  collaborators?: {
    userId: string;
    name?: string;
    email: string;
    color: string;
  }[];
}

export function CommentsPanel({
  open,
  onClose,
  itemId,
  itemType,
  collaborators = [],
}: CommentsPanelProps) {
  const { data: session } = useSession();
  const [newComment, setNewComment] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [anchorEl, setAnchorEl] = useState<{
    element: HTMLElement;
    commentId: string;
  } | null>(null);

  // Mention state
  const [mentionAnchorEl, setMentionAnchorEl] = useState<HTMLElement | null>(
    null,
  );
  const [mentionQuery, setMentionQuery] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);

  const handleCommentChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const val = e.target.value;
    setNewComment(val);

    // Simple atomic check for @ mention at cursor
    const cursor = e.target.selectionStart || 0;
    setCursorPosition(cursor);

    // Look back from cursor to find @
    const textBeforeCursor = val.slice(0, cursor);
    const lastAt = textBeforeCursor.lastIndexOf("@");

    if (
      lastAt !== -1 &&
      (lastAt === 0 || textBeforeCursor[lastAt - 1] === " ")
    ) {
      const query = textBeforeCursor.slice(lastAt + 1);
      // Only show if no spaces in query yet (simple username search)
      if (!query.includes(" ")) {
        setMentionQuery(query);
        // Use a ref or simple anchor if possible, but for TextArea it is hard to get position.
        // We'll just anchor to the input itself for now as a fallback
        setMentionAnchorEl(e.currentTarget);
        return;
      }
    }
    setMentionAnchorEl(null);
  };

  const handleMentionSelect = (user: { name?: string; email: string }) => {
    if (!mentionAnchorEl) return;
    const textBeforeCursor = newComment.slice(0, cursorPosition);
    const lastAt = textBeforeCursor.lastIndexOf("@");
    const textAfterCursor = newComment.slice(cursorPosition);

    const userName = user.name || "You";
    const newText =
      textBeforeCursor.slice(0, lastAt) + `@${userName} ` + textAfterCursor;

    setNewComment(newText);
    setMentionAnchorEl(null);
    // Focus back would be ideal but skipped for brevity
  };

  const { data, isLoading, error } = useComments(itemId);
  const { mutateAsync: createComment, isPending: isCreating } =
    useCreateComment();
  const { mutateAsync: deleteComment } = useDeleteComment();
  const { mutateAsync: updateComment, isPending: isUpdating } =
    useUpdateComment();

  const comments = data?.comments || [];

  const handleSubmitComment = async () => {
    if (!newComment.trim()) return;

    try {
      await createComment({ itemId, content: newComment.trim() });
      setNewComment("");
    } catch (err) {
      console.error("Failed to create comment:", err);
    }
  };

  const handleEditComment = (commentId: string, content: string) => {
    setEditingCommentId(commentId);
    setEditContent(content);
    setAnchorEl(null);
  };

  const handleSaveEdit = async () => {
    if (!editingCommentId || !editContent.trim()) return;

    try {
      await updateComment({
        itemId,
        commentId: editingCommentId,
        content: editContent.trim(),
      });
      setEditingCommentId(null);
      setEditContent("");
    } catch (err) {
      console.error("Failed to update comment:", err);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      await deleteComment({ itemId, commentId });
      setAnchorEl(null);
    } catch (err) {
      console.error("Failed to delete comment:", err);
    }
  };

  const handleMenuOpen = (
    event: React.MouseEvent<HTMLElement>,
    commentId: string,
  ) => {
    setAnchorEl({ element: event.currentTarget, commentId });
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: { width: { xs: "100%", sm: 400 } },
      }}
    >
      <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
        {/* Header */}
        <Box
          sx={{
            p: 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Box>
            <Typography variant="h6">Comments</Typography>
            <Typography variant="caption" color="text.secondary">
              {itemType === "NOTE" ? "Note" : "Bookmark"}
            </Typography>
          </Box>
          <IconButton aria-label="Close comments" onClick={onClose}>
            <Close />
          </IconButton>
        </Box>

        {/* Comments List */}
        <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
          {isLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress />
            </Box>
          ) : error ? (
            <Alert severity="error">Failed to load comments</Alert>
          ) : comments.length === 0 ? (
            <Box sx={{ textAlign: "center", py: 4 }}>
              <Typography variant="body2" color="text.secondary">
                No comments yet. Be the first to comment!
              </Typography>
            </Box>
          ) : (
            <List sx={{ p: 0 }}>
              {comments.map((comment, index) => (
                <React.Fragment key={comment.id}>
                  {index > 0 && <Divider sx={{ my: 2 }} />}
                  <ListItem alignItems="flex-start" sx={{ px: 0 }}>
                    <Avatar
                      src={comment.user.image || undefined}
                      alt={comment.user.name || "User"}
                      sx={{ mr: 2, mt: 0.5 }}
                    >
                      {((comment.user.name || "U")?.[0] || "?").toUpperCase()}
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box
                        sx={{ display: "flex", alignItems: "center", mb: 0.5 }}
                      >
                        <Typography
                          variant="subtitle2"
                          sx={{ fontWeight: 600 }}
                        >
                          {comment.user.name || "Anonymous"}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ ml: 1 }}
                        >
                          {formatDistanceToNow(new Date(comment.createdAt), {
                            addSuffix: true,
                          })}
                        </Typography>
                        {session?.user?.id === comment.userId && (
                          <IconButton
                            aria-label="Comment actions"
                            size="small"
                            sx={{ ml: "auto" }}
                            onClick={(e) => handleMenuOpen(e, comment.id)}
                          >
                            <MoreVert fontSize="small" />
                          </IconButton>
                        )}
                      </Box>

                      {editingCommentId === comment.id ? (
                        <Box sx={{ mt: 1 }}>
                          <TextField
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            multiline
                            rows={2}
                            fullWidth
                            size="small"
                            autoFocus
                          />
                          <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
                            <Button
                              size="small"
                              variant="contained"
                              onClick={handleSaveEdit}
                              disabled={isUpdating || !editContent.trim()}
                            >
                              Save
                            </Button>
                            <Button
                              size="small"
                              onClick={() => {
                                setEditingCommentId(null);
                                setEditContent("");
                              }}
                            >
                              Cancel
                            </Button>
                          </Box>
                        </Box>
                      ) : (
                        <Typography
                          variant="body2"
                          sx={{
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                          }}
                        >
                          {comment.content}
                        </Typography>
                      )}
                    </Box>
                  </ListItem>
                </React.Fragment>
              ))}
            </List>
          )}
        </Box>

        {/* New Comment Input */}
        {session && (
          <Box
            sx={{
              p: 2,
              borderTop: 1,
              borderColor: "divider",
            }}
          >
            <TextField
              value={newComment}
              onChange={handleCommentChange}
              placeholder="Add a comment... (Use @ to mention)"
              multiline
              rows={3}
              fullWidth
              variant="outlined"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  handleSubmitComment();
                }
              }}
            />
            <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1 }}>
              <Button
                variant="contained"
                startIcon={<Send />}
                onClick={handleSubmitComment}
                disabled={isCreating || !newComment.trim()}
              >
                {isCreating ? <CircularProgress size={20} /> : "Comment"}
              </Button>
            </Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mt: 0.5, display: "block" }}
            >
              Cmd/Ctrl + Enter to submit
            </Typography>
          </Box>
        )}

        {!session && (
          <Box
            sx={{
              p: 2,
              borderTop: 1,
              borderColor: "divider",
              textAlign: "center",
            }}
          >
            <Typography variant="body2" color="text.secondary">
              Sign in to add comments
            </Typography>
          </Box>
        )}
      </Box>

      {/* Comment Menu */}
      <Menu
        anchorEl={anchorEl?.element}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
      >
        <MenuItem
          onClick={() => {
            if (anchorEl) {
              const comment = comments.find((c) => c.id === anchorEl.commentId);
              if (comment) {
                handleEditComment(comment.id, comment.content);
              }
            }
          }}
        >
          Edit
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (anchorEl) {
              handleDeleteComment(anchorEl.commentId);
            }
          }}
        >
          Delete
        </MenuItem>
      </Menu>
      <Menu
        anchorEl={mentionAnchorEl}
        open={Boolean(mentionAnchorEl)}
        onClose={() => setMentionAnchorEl(null)}
        PaperProps={{ sx: { maxHeight: 200 } }}
      >
        {collaborators
          .filter(
            (c) =>
              c.name?.toLowerCase().includes(mentionQuery.toLowerCase()) ||
              c.email.toLowerCase().includes(mentionQuery.toLowerCase()),
          )
          .map((c) => (
            <MenuItem key={c.userId} onClick={() => handleMentionSelect(c)}>
              <Avatar sx={{ width: 24, height: 24, mr: 1, bgcolor: c.color }}>
                {((c.name || c.email)?.[0] || "?").toUpperCase()}
              </Avatar>
              <Box>
                <Typography variant="body2">{c.name || c.email}</Typography>
              </Box>
            </MenuItem>
          ))}
        {collaborators.length === 0 && (
          <MenuItem disabled>No collaborators found</MenuItem>
        )}
      </Menu>
    </Drawer>
  );
}
