import React from "react";
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import type {
  Block,
  GuideSection,
  Inline,
  ListBlock,
} from "@/lib/guides/markdown";

function InlineText({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, index) => {
        switch (part.kind) {
          case "bold":
            return <strong key={index}>{part.text}</strong>;
          case "italic":
            return <em key={index}>{part.text}</em>;
          case "code":
            return (
              <Box
                key={index}
                component="code"
                sx={{
                  fontFamily: "monospace",
                  fontSize: "0.9em",
                  px: 0.5,
                  borderRadius: 0.5,
                  bgcolor: "action.hover",
                  overflowWrap: "anywhere",
                }}
              >
                {part.text}
              </Box>
            );
          default:
            return <React.Fragment key={index}>{part.text}</React.Fragment>;
        }
      })}
    </>
  );
}

function List({ list }: { list: ListBlock }) {
  return (
    <Box
      component={list.ordered ? "ol" : "ul"}
      sx={{ pl: 3, my: 1, "& li": { mb: 0.5 } }}
    >
      {list.items.map((item, index) => (
        <li key={index}>
          <InlineText parts={item.content} />
          {item.children && <List list={item.children} />}
        </li>
      ))}
    </Box>
  );
}

function GuideBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case "paragraph":
      return (
        <Typography component="p" sx={{ my: 1 }}>
          <InlineText parts={block.content} />
        </Typography>
      );
    case "list":
      return <List list={block} />;
    case "code":
      return (
        <Box
          component="pre"
          sx={{
            p: 1.5,
            borderRadius: 1,
            bgcolor: "action.hover",
            overflowX: "auto",
            fontSize: 13,
          }}
        >
          {block.text}
        </Box>
      );
    case "table":
      return (
        <Box sx={{ overflowX: "auto", my: 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                {block.header.map((cell, index) => (
                  <TableCell key={index} sx={{ fontWeight: 600 }}>
                    <InlineText parts={cell} />
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {block.rows.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {row.map((cell, index) => (
                    <TableCell key={index}>
                      <InlineText parts={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      );
  }
}

/**
 * A guide from `docs/` (IMP-092). Headings start at `baseLevel` so the guide
 * fits under the page's own heading.
 */
export function GuideContent({
  sections,
  baseLevel = 3,
  after,
}: {
  sections: GuideSection[];
  baseLevel?: number;
  /** Extra content placed after the section with this title. */
  after?: { title: string; content: React.ReactNode };
}) {
  const top = Math.min(...sections.map((section) => section.level));
  return (
    <>
      {sections.map((section, index) => {
        const level = Math.min(6, baseLevel + section.level - top);
        return (
          <Box component="section" key={index} sx={{ mt: 2 }}>
            <Typography
              component={`h${level}` as "h3"}
              variant={level <= 3 ? "h6" : "subtitle1"}
              sx={{ fontWeight: 600, color: "text.primary" }}
            >
              {section.title}
            </Typography>
            {section.blocks.map((block, blockIndex) => (
              <GuideBlock key={blockIndex} block={block} />
            ))}
            {after?.title === section.title && after.content}
          </Box>
        );
      })}
    </>
  );
}
