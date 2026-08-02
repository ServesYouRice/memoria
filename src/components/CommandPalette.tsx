"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Dialog } from "@mui/material";
import {
  Add as AddIcon,
  Search as SearchIcon,
  Home as HomeIcon,
  Download as DownloadIcon,
  GridOn as GridIcon,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
} from "@mui/icons-material";
import "./command-palette.css";

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onCreateCanvas?: () => void;
  onSearch?: () => void;
  onToggleGrid?: () => void;
  onToggleTheme?: () => void;
  onExport?: () => void;
  isDarkMode?: boolean;
}

export function CommandPalette({
  open,
  onClose,
  onCreateCanvas,
  onSearch,
  onToggleGrid,
  onToggleTheme,
  onExport,
  isDarkMode = false,
}: CommandPaletteProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) {
      setSearch("");
    }
  }, [open]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K or Ctrl+K to open
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (!open) {
          // Parent component should handle opening
        }
      }
      // Escape to close
      if (e.key === "Escape" && open) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const handleSelect = (callback?: () => void) => {
    if (callback) {
      callback();
    }
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            overflow: "hidden",
            borderRadius: 2,
            boxShadow: 24,
          },
        },
      }}
    >
      <Command className="command-palette" loop>
        <div className="command-input-wrapper">
          <SearchIcon sx={{ mr: 1, color: "text.secondary" }} />
          <Command.Input
            value={search}
            onValueChange={setSearch}
            placeholder="Type a command or search..."
            className="command-input"
          />
        </div>

        <Command.List className="command-list">
          <Command.Empty className="command-empty">
            No results found.
          </Command.Empty>

          <Command.Group heading="Navigation" className="command-group">
            <Command.Item
              onSelect={() => handleSelect(() => router.push("/dashboard"))}
              className="command-item"
            >
              <HomeIcon fontSize="small" sx={{ mr: 1.5 }} />
              Go to Dashboard
            </Command.Item>
          </Command.Group>

          <Command.Separator className="command-separator" />

          <Command.Group heading="Actions" className="command-group">
            {onCreateCanvas && (
              <Command.Item
                onSelect={() => handleSelect(onCreateCanvas)}
                className="command-item"
              >
                <AddIcon fontSize="small" sx={{ mr: 1.5 }} />
                Create New Canvas
              </Command.Item>
            )}

            {onSearch && (
              <Command.Item
                onSelect={() => handleSelect(onSearch)}
                className="command-item"
              >
                <SearchIcon fontSize="small" sx={{ mr: 1.5 }} />
                Search Across Canvases
              </Command.Item>
            )}

            {onExport && (
              <Command.Item
                onSelect={() => handleSelect(onExport)}
                className="command-item"
              >
                <DownloadIcon fontSize="small" sx={{ mr: 1.5 }} />
                Export Canvas
              </Command.Item>
            )}
          </Command.Group>

          <Command.Separator className="command-separator" />

          <Command.Group heading="View" className="command-group">
            {onToggleGrid && (
              <Command.Item
                onSelect={() => handleSelect(onToggleGrid)}
                className="command-item"
              >
                <GridIcon fontSize="small" sx={{ mr: 1.5 }} />
                Toggle Grid
              </Command.Item>
            )}

            {onToggleTheme && (
              <Command.Item
                onSelect={() => handleSelect(onToggleTheme)}
                className="command-item"
              >
                {isDarkMode ? (
                  <LightModeIcon fontSize="small" sx={{ mr: 1.5 }} />
                ) : (
                  <DarkModeIcon fontSize="small" sx={{ mr: 1.5 }} />
                )}
                {isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
              </Command.Item>
            )}
          </Command.Group>
        </Command.List>

        <div className="command-footer">
          <kbd className="command-kbd">↑↓</kbd> to navigate
          <kbd className="command-kbd">↵</kbd> to select
          <kbd className="command-kbd">esc</kbd> to close
        </div>
      </Command>
    </Dialog>
  );
}
