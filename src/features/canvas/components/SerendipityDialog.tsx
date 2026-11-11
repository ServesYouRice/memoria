import React, { useState } from "react";
import {
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  CircularProgress,
  Card,
  CardContent,
  List,
  Chip,
} from "@mui/material";
import { AutoAwesome, Shuffle, Add as AddIcon } from "@mui/icons-material";
import { type ItemType } from "@/types/canvas";

interface SerendipityResult {
  item: {
    id: string;
    type: ItemType;
    content: any;
  };
  reason: string;
  similarityScore: number;
}

interface SerendipityDialogProps {
  open: boolean;
  onClose: () => void;
  canvasId: string;
  onAddItems: (items: any[]) => void | Promise<void>;
}

export function SerendipityDialog({
  open,
  onClose,
  canvasId,
  onAddItems,
}: SerendipityDialogProps) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SerendipityResult[]>([]);
  const [scanned, setScanned] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const handleScan = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/v1/ai/serendipity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvasId }),
      });
      const data = await response.json();
      setResults(data.results || []);
      setScanned(true);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // Close only once the item exists; on failure keep the results so the
  // user can retry.
  const handleUsage = async (item: any) => {
    if (adding) return;
    setAdding(true);
    setAddError(null);
    let added = false;
    try {
      await onAddItems([item]);
      added = true;
    } catch (error) {
      setAddError(
        error instanceof Error && error.message
          ? error.message
          : "Could not add this item. Please try again.",
      );
    } finally {
      setAdding(false);
    }
    if (added) onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Shuffle color="secondary" />
        Serendipity Engine
      </DialogTitle>
      <DialogContent>
        {!scanned ? (
          <Box sx={{ textAlign: "center", py: 4 }}>
            <Typography variant="body1" sx={{ mb: 2 }}>
              Discover forgotten connections. The Serendipity Engine will scan
              your other canvases for relevant ideas.
            </Typography>
            <Button
              variant="contained"
              color="secondary"
              startIcon={
                loading ? (
                  <CircularProgress size={20} color="inherit" />
                ) : (
                  <AutoAwesome />
                )
              }
              onClick={handleScan}
              disabled={loading}
            >
              {loading ? "Scanning..." : "Surprise Me"}
            </Button>
          </Box>
        ) : (
          <Box>
            <Typography
              variant="subtitle2"
              sx={{
                color: "text.secondary",
                mb: 2,
              }}
            >
              Found {results.length} connections:
            </Typography>
            {addError && (
              <Alert
                severity="error"
                sx={{ mb: 2 }}
                onClose={() => setAddError(null)}
              >
                {addError}
              </Alert>
            )}
            <List>
              {results.map((res, i) => (
                <Card key={i} variant="outlined" sx={{ mb: 1 }}>
                  <CardContent sx={{ pb: 1, "&:last-child": { pb: 1 } }}>
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                      }}
                    >
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: "bold" }}>
                          {res.item.type}
                        </Typography>
                        <Typography
                          variant="body2"
                          noWrap
                          sx={{ maxWidth: 300 }}
                        >
                          {JSON.stringify(res.item.content).slice(0, 100)}...
                        </Typography>
                        <Chip
                          label={res.reason}
                          size="small"
                          color="info"
                          variant="outlined"
                          sx={{ mt: 1 }}
                        />
                      </Box>
                      <Button
                        size="small"
                        startIcon={<AddIcon />}
                        onClick={() => void handleUsage(res.item)}
                        disabled={adding}
                      >
                        Add
                      </Button>
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </List>
            {results.length === 0 && (
              <Typography
                align="center"
                sx={{
                  color: "text.secondary",
                }}
              >
                No connections found this time.
              </Typography>
            )}
            <Box sx={{ mt: 2, display: "flex", justifyContent: "center" }}>
              <Button onClick={handleScan} startIcon={<Shuffle />}>
                Try Again
              </Button>
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
