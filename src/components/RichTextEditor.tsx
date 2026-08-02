"use client";

import React from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import {
  normalizeNoteContent,
  type TiptapNode,
  type VersionedNoteContent,
} from "@/lib/rich-text/note-format";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  TextField,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import {
  FormatBold,
  FormatItalic,
  FormatStrikethrough,
  Code,
  FormatQuote,
  FormatListBulleted,
  FormatListNumbered,
  Link as LinkIcon,
} from "@mui/icons-material";

export const EMPTY_TIPTAP_DOCUMENT: TiptapNode = {
  type: "doc",
  content: [{ type: "paragraph", content: [] }],
};

export const EMPTY_VERSIONED_NOTE_CONTENT: VersionedNoteContent = {
  formatVersion: 1,
  document: EMPTY_TIPTAP_DOCUMENT,
  plainText: "",
  text: "<p></p>",
};

type EditorContentValue =
  VersionedNoteContent | { text?: string } | string | null;

function documentForEditor(content: EditorContentValue): TiptapNode {
  if (content && typeof content === "object" && "formatVersion" in content) {
    return content.document;
  }

  if (typeof content === "string") {
    try {
      return normalizeNoteContent({ text: content }).document;
    } catch {
      return EMPTY_TIPTAP_DOCUMENT;
    }
  }

  if (
    content &&
    typeof content === "object" &&
    typeof content.text === "string"
  ) {
    try {
      return normalizeNoteContent(content).document;
    } catch {
      return EMPTY_TIPTAP_DOCUMENT;
    }
  }

  return EMPTY_TIPTAP_DOCUMENT;
}

export interface RichTextEditorProps {
  content: EditorContentValue;
  onChange: (content: VersionedNoteContent) => void;
  placeholder?: string;
  minHeight?: number;
  editable?: boolean;
}

export function RichTextEditor({
  content,
  onChange,
  placeholder = "Start typing...",
  minHeight = 200,
  editable = true,
}: RichTextEditorProps) {
  const [linkDialogOpen, setLinkDialogOpen] = React.useState(false);
  const [linkUrl, setLinkUrl] = React.useState("");
  const initialDocument = React.useMemo(
    () => documentForEditor(content),
    [content],
  );
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
    ],
    content: initialDocument,
    editable,
    onUpdate: ({ editor }) => {
      const document = editor.getJSON() as TiptapNode;
      try {
        onChange(normalizeNoteContent({ formatVersion: 1, document }));
      } catch {
        // Keep the draft versioned while it is temporarily empty. Submit
        // validation still runs normalizeNoteContent and visibly rejects it.
        onChange({
          formatVersion: 1,
          document,
          plainText: editor.getText(),
          text: editor.getHTML(),
        });
      }
    },
  });

  React.useEffect(() => {
    if (editor) {
      const nextDocument = documentForEditor(content);
      if (JSON.stringify(editor.getJSON()) !== JSON.stringify(nextDocument)) {
        editor.commands.setContent(nextDocument, { emitUpdate: false });
      }
    }
  }, [editor, content]);

  React.useEffect(() => {
    if (editor) {
      editor.setEditable(editable);
    }
  }, [editor, editable]);

  if (!editor) {
    return null;
  }

  const addLink = () => {
    setLinkUrl(editor.getAttributes("link").href ?? "");
    setLinkDialogOpen(true);
  };

  const applyLink = () => {
    const url = linkUrl.trim();
    if (url) editor.chain().focus().setLink({ href: url }).run();
    else editor.chain().focus().unsetLink().run();
    setLinkDialogOpen(false);
  };

  const getActiveFormats = () => {
    const formats: string[] = [];
    if (editor.isActive("bold")) formats.push("bold");
    if (editor.isActive("italic")) formats.push("italic");
    if (editor.isActive("strike")) formats.push("strike");
    if (editor.isActive("code")) formats.push("code");
    return formats;
  };

  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        overflow: "hidden",
      }}
    >
      {editable && (
        <Box
          sx={{
            borderBottom: 1,
            borderColor: "divider",
            bgcolor: "background.paper",
            p: 1,
            display: "flex",
            flexWrap: "wrap",
            gap: 0.5,
            alignItems: "center",
          }}
        >
          {/* Text formatting */}
          <ToggleButtonGroup
            size="small"
            value={getActiveFormats()}
            aria-label="text formatting"
          >
            <ToggleButton
              value="bold"
              onClick={() => editor.chain().focus().toggleBold().run()}
              selected={editor.isActive("bold")}
            >
              <Tooltip title="Bold (Ctrl+B)">
                <FormatBold fontSize="small" />
              </Tooltip>
            </ToggleButton>
            <ToggleButton
              value="italic"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              selected={editor.isActive("italic")}
            >
              <Tooltip title="Italic (Ctrl+I)">
                <FormatItalic fontSize="small" />
              </Tooltip>
            </ToggleButton>
            <ToggleButton
              value="strike"
              onClick={() => editor.chain().focus().toggleStrike().run()}
              selected={editor.isActive("strike")}
            >
              <Tooltip title="Strikethrough">
                <FormatStrikethrough fontSize="small" />
              </Tooltip>
            </ToggleButton>
            <ToggleButton
              value="code"
              onClick={() => editor.chain().focus().toggleCode().run()}
              selected={editor.isActive("code")}
            >
              <Tooltip title="Inline Code">
                <Code fontSize="small" />
              </Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>

          <Divider orientation="vertical" flexItem />

          {/* Headings */}
          <ToggleButtonGroup size="small" exclusive>
            <ToggleButton
              value="h1"
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 1 }).run()
              }
              selected={editor.isActive("heading", { level: 1 })}
            >
              <Tooltip title="Heading 1">
                <span style={{ fontSize: "12px", fontWeight: "bold" }}>H1</span>
              </Tooltip>
            </ToggleButton>
            <ToggleButton
              value="h2"
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 2 }).run()
              }
              selected={editor.isActive("heading", { level: 2 })}
            >
              <Tooltip title="Heading 2">
                <span style={{ fontSize: "12px", fontWeight: "bold" }}>H2</span>
              </Tooltip>
            </ToggleButton>
            <ToggleButton
              value="h3"
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 3 }).run()
              }
              selected={editor.isActive("heading", { level: 3 })}
            >
              <Tooltip title="Heading 3">
                <span style={{ fontSize: "12px", fontWeight: "bold" }}>H3</span>
              </Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>

          <Divider orientation="vertical" flexItem />

          {/* Lists */}
          <ToggleButtonGroup size="small">
            <ToggleButton
              value="bullet"
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              selected={editor.isActive("bulletList")}
            >
              <Tooltip title="Bullet List">
                <FormatListBulleted fontSize="small" />
              </Tooltip>
            </ToggleButton>
            <ToggleButton
              value="numbered"
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              selected={editor.isActive("orderedList")}
            >
              <Tooltip title="Numbered List">
                <FormatListNumbered fontSize="small" />
              </Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>

          <Divider orientation="vertical" flexItem />

          {/* Other formatting */}
          <IconButton
            size="small"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            color={editor.isActive("blockquote") ? "primary" : "default"}
            aria-label="Quote"
          >
            <Tooltip title="Quote">
              <FormatQuote fontSize="small" />
            </Tooltip>
          </IconButton>

          <IconButton
            size="small"
            onClick={addLink}
            color={editor.isActive("link") ? "primary" : "default"}
            aria-label="Add Link"
          >
            <Tooltip title="Add Link">
              <LinkIcon
                sx={{
                  fontSize: "small",
                }}
              />
            </Tooltip>
          </IconButton>
        </Box>
      )}

      <Box
        sx={{
          minHeight,
          maxHeight: editable ? 600 : "none",
          overflow: "auto",
          p: 2,
          "& .ProseMirror": {
            outline: "none",
            minHeight: editable ? minHeight - 32 : "auto",
            "& p.is-editor-empty:first-of-type::before": {
              content: "attr(data-placeholder)",
              float: "left",
              color: "text.secondary",
              pointerEvents: "none",
              height: 0,
            },
            "& h1": {
              fontSize: "2em",
              fontWeight: "bold",
              marginTop: "0.67em",
              marginBottom: "0.67em",
            },
            "& h2": {
              fontSize: "1.5em",
              fontWeight: "bold",
              marginTop: "0.75em",
              marginBottom: "0.75em",
            },
            "& h3": {
              fontSize: "1.17em",
              fontWeight: "bold",
              marginTop: "0.83em",
              marginBottom: "0.83em",
            },
            "& ul, & ol": {
              paddingLeft: "2em",
              marginTop: "0.5em",
              marginBottom: "0.5em",
            },
            "& blockquote": {
              borderLeft: "3px solid",
              borderColor: "divider",
              paddingLeft: "1em",
              marginLeft: 0,
              marginRight: 0,
              fontStyle: "italic",
            },
            "& code": {
              backgroundColor: "action.hover",
              padding: "0.2em 0.4em",
              borderRadius: "3px",
              fontSize: "0.9em",
              fontFamily: "monospace",
            },
            "& pre": {
              backgroundColor: "action.hover",
              borderRadius: "5px",
              padding: "0.75em 1em",
              overflow: "auto",
              "& code": {
                backgroundColor: "transparent",
                padding: 0,
              },
            },
            "& a": {
              color: "primary.main",
              textDecoration: "underline",
              cursor: "pointer",
            },
          },
        }}
      >
        <EditorContent editor={editor} />
      </Box>
      <Dialog
        open={linkDialogOpen}
        onClose={() => setLinkDialogOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Add link</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label="URL"
            type="url"
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink();
              }
            }}
            helperText="Leave empty to remove the current link."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLinkDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={applyLink}>
            Apply
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
