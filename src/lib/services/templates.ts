/**
 * Template Service
 *
 * Template management utilities.
 *
 * @module lib/services/templates
 */

export interface Template {
    id: string;
    name: string;
    description?: string;
    category: TemplateCategory;
    thumbnail?: string;
    items: TemplateItem[];
    createdAt: Date;
    isPublic: boolean;
    usageCount: number;
}

export interface TemplateItem {
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    content: unknown;
}

export type TemplateCategory =
    | 'brainstorming'
    | 'planning'
    | 'research'
    | 'design'
    | 'notes'
    | 'productivity'
    | 'personal'
    | 'other';

export const TEMPLATE_CATEGORIES: { value: TemplateCategory; label: string; icon: string }[] = [
    { value: 'brainstorming', label: 'Brainstorming', icon: '💡' },
    { value: 'planning', label: 'Planning', icon: '📋' },
    { value: 'research', label: 'Research', icon: '🔬' },
    { value: 'design', label: 'Design', icon: '🎨' },
    { value: 'notes', label: 'Notes', icon: '📝' },
    { value: 'productivity', label: 'Productivity', icon: '⚡' },
    { value: 'personal', label: 'Personal', icon: '👤' },
    { value: 'other', label: 'Other', icon: '📁' },
];

/**
 * Get category info
 */
export function getCategoryInfo(category: TemplateCategory) {
    return TEMPLATE_CATEGORIES.find((c) => c.value === category) || TEMPLATE_CATEGORIES[TEMPLATE_CATEGORIES.length - 1];
}

/**
 * Create template from canvas items
 */
export function createTemplateFromItems(
    name: string,
    items: Array<{ type: string; x: number; y: number; width: number; height: number; content: unknown }>,
    options?: {
        description?: string;
        category?: TemplateCategory;
        isPublic?: boolean;
    }
): Omit<Template, 'id' | 'createdAt' | 'usageCount'> {
    // Normalize positions to start from 0,0
    let minX = Infinity;
    let minY = Infinity;

    for (const item of items) {
        minX = Math.min(minX, item.x);
        minY = Math.min(minY, item.y);
    }

    const normalizedItems: TemplateItem[] = items.map((item) => ({
        type: item.type,
        x: item.x - minX,
        y: item.y - minY,
        width: item.width,
        height: item.height,
        content: item.content,
    }));

    return {
        name,
        description: options?.description,
        category: options?.category || 'other',
        items: normalizedItems,
        isPublic: options?.isPublic || false,
    };
}

/**
 * Apply template to canvas at position
 */
export function applyTemplate(
    template: Template,
    targetX: number,
    targetY: number
): Array<{ type: string; x: number; y: number; width: number; height: number; content: unknown }> {
    return template.items.map((item) => ({
        type: item.type,
        x: item.x + targetX,
        y: item.y + targetY,
        width: item.width,
        height: item.height,
        content: item.content,
    }));
}

/**
 * Built-in template definitions
 */
export const BUILT_IN_TEMPLATES: Array<Omit<Template, 'id' | 'createdAt' | 'usageCount'>> = [
    {
        name: 'Quick Notes',
        description: 'Three note cards for quick capture',
        category: 'notes',
        isPublic: true,
        items: [
            { type: 'NOTE', x: 0, y: 0, width: 200, height: 150, content: { title: 'Ideas', text: '' } },
            { type: 'NOTE', x: 220, y: 0, width: 200, height: 150, content: { title: 'To Do', text: '' } },
            { type: 'NOTE', x: 440, y: 0, width: 200, height: 150, content: { title: 'Reference', text: '' } },
        ],
    },
    {
        name: 'Research Board',
        description: 'Organize research with notes and bookmarks',
        category: 'research',
        isPublic: true,
        items: [
            { type: 'NOTE', x: 0, y: 0, width: 300, height: 100, content: { title: '📚 Research Topic', text: 'Enter your research topic here' } },
            { type: 'NOTE', x: 0, y: 120, width: 200, height: 200, content: { title: 'Key Findings', text: '' } },
            { type: 'NOTE', x: 220, y: 120, width: 200, height: 200, content: { title: 'Questions', text: '' } },
            { type: 'NOTE', x: 440, y: 120, width: 200, height: 200, content: { title: 'Sources', text: '' } },
        ],
    },
    {
        name: 'Mood Board',
        description: 'Visual inspiration collection',
        category: 'design',
        isPublic: true,
        items: [
            { type: 'NOTE', x: 0, y: 0, width: 400, height: 60, content: { title: '🎨 Mood Board', text: '' } },
            { type: 'NOTE', x: 0, y: 80, width: 180, height: 180, content: { title: 'Colors', text: '' } },
            { type: 'NOTE', x: 200, y: 80, width: 180, height: 180, content: { title: 'Typography', text: '' } },
            { type: 'NOTE', x: 0, y: 280, width: 180, height: 180, content: { title: 'Imagery', text: '' } },
            { type: 'NOTE', x: 200, y: 280, width: 180, height: 180, content: { title: 'Texture', text: '' } },
        ],
    },
];
