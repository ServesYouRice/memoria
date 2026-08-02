/**
 * Lazy-loaded Canvas Dialog Components
 *
 * These components are dynamically imported to reduce initial bundle size.
 * They are only loaded when the user opens the respective dialog.
 *
 * @module features/canvas/components/lazy
 */

import dynamic from "next/dynamic";
import { Skeleton, Box } from "@mui/material";

// Loading fallback for dialogs
const DialogLoading = () => (
  <Box sx={{ p: 3, minWidth: 400 }}>
    <Skeleton variant="text" width="60%" height={32} sx={{ mb: 2 }} />
    <Skeleton variant="rectangular" height={100} sx={{ mb: 2 }} />
    <Skeleton variant="rectangular" height={40} width={100} />
  </Box>
);

/**
 * Lazy-loaded ShareDialog
 * Only loaded when user clicks "Share" button
 */
export const LazyShareDialog = dynamic(
  () => import("./ShareDialog").then((mod) => mod.ShareDialog),
  {
    loading: DialogLoading,
    ssr: false,
  },
);

/**
 * Lazy-loaded ExportDialog
 * Only loaded when user clicks "Export" button
 */
export const LazyExportDialog = dynamic(
  () => import("./ExportDialog").then((mod) => mod.ExportDialog),
  {
    loading: DialogLoading,
    ssr: false,
  },
);

/**
 * Lazy-loaded VersionHistoryDialog
 * Only loaded when user clicks "Version History" button
 */
export const LazyVersionHistoryDialog = dynamic(
  () =>
    import("./VersionHistoryDialog").then((mod) => mod.VersionHistoryDialog),
  {
    loading: DialogLoading,
    ssr: false,
  },
);

/**
 * Lazy-loaded CommentsPanel
 * Only loaded when user opens comments
 */
export const LazyCommentsPanel = dynamic(
  () => import("./CommentsPanel").then((mod) => mod.CommentsPanel),
  {
    loading: DialogLoading,
    ssr: false,
  },
);
