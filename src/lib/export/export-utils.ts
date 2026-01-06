import { type CanvasItem, ItemType, isNoteContent, isTextContent, isBookmarkContent, isImageContent, type NoteContent, type TextContent, type BookmarkContent, type ImageContent } from '@/types/canvas';


/**
 * Export canvas to JSON string
 */
export async function exportToJSON(
    canvasId: string,
    name: string,
    items: CanvasItem[]
): Promise<string> {
    const exportData = {
        version: 1,
        canvasId,
        name,
        exportedAt: new Date().toISOString(),
        items: items.map(item => ({
            ...item,
            // Strip server-only fields if necessary
        })),
    };
    return JSON.stringify(exportData, null, 2);
}

/**
 * Export canvas to Markdown
 */
export async function exportToMarkdown(
    canvasId: string,
    name: string,
    items: CanvasItem[]
): Promise<string> {
    let md = `# ${name}\n\n`;

    // Sort items by position Y then X to roughly follow visual flow
    const sortedItems = [...items].sort((a, b) => {
        if (Math.abs(a.positionY - b.positionY) > 50) {
            return a.positionY - b.positionY;
        }
        return a.positionX - b.positionX;
    });

    for (const item of sortedItems) {
        switch (item.type) {
            case ItemType.NOTE:
            case ItemType.TEXT:
                if (isNoteContent(item.content) || isTextContent(item.content)) {
                    const textContent = item.content as NoteContent | TextContent;
                    md += `${textContent.text || ''}\n\n`;
                }
                break;
            case ItemType.BOOKMARK:
                if (isBookmarkContent(item.content)) {
                    const bookmarkContent = item.content as BookmarkContent;
                    md += `[${bookmarkContent.title || bookmarkContent.url}](${bookmarkContent.url})\n\n`;
                }
                break;
            case ItemType.IMAGE:
                if (isImageContent(item.content)) {
                    const imageContent = item.content as ImageContent;
                    md += `![${imageContent.alt || 'Image'}](${imageContent.url})\n\n`;
                }
                break;
            // Add other types as needed
        }
    }

    return md;
}

/**
 * Export to PDF (Basic implementation)
 */
export async function exportToPDF(
    name: string,
    stageRef: any // Konva Stage reference
): Promise<void> {
    if (!stageRef) return;

    // Convert stage to dataURL
    const dataUrl = stageRef.toDataURL({ pixelRatio: 2 });

    // Dynamic import to reduce bundle size
    const { jsPDF } = await import('jspdf');

    const pdf = new jsPDF({
        orientation: 'landscape',
    });

    const imgProps = pdf.getImageProperties(dataUrl);
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

    pdf.addImage(dataUrl, 'PNG', 0, 0, pdfWidth, pdfHeight);
    pdf.save(`${name}.pdf`);
}
