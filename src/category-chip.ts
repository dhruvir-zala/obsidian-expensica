import { getCategoryColor } from './models';

interface CategoryChipOptions {
    emoji?: string;
    text: string;
    swatchColor?: string;
    colorName?: string;
    color?: string;
    interactive?: boolean;
    hidden?: boolean;
    title?: string;
}

export function renderCategoryChip(container: HTMLElement, options: CategoryChipOptions): HTMLElement {
    const chip = options.interactive
        ? container.createEl('button', {
            cls: 'expensica-category-chip',
            attr: { type: 'button' }
        })
        : container.createSpan('expensica-category-chip');

    if (options.hidden) {
        chip.addClass('is-hidden');
    }

    if (options.title) {
        chip.setAttribute('title', options.title);
    }

    const color = options.color || getCategoryColor(options.colorName || options.text);
    chip.style.setProperty('--expensica-category-chip-color', color);
    chip.style.setProperty('--expensica-category-chip-hover-border-color', adjustCategoryChipColor(color, -20));

    if (options.swatchColor) {
        const swatch = chip.createSpan('expensica-category-chip-swatch');
        swatch.style.backgroundColor = options.swatchColor;
    }

    const label = options.emoji ? `${options.emoji} ${options.text}` : options.text;
    chip.createSpan({ text: label, cls: 'expensica-category-chip-label' });
    return chip;
}

function adjustCategoryChipColor(color: string, amount: number): string {
    const match = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
    if (!match) {
        return color;
    }

    const h = parseInt(match[1]);
    const s = parseInt(match[2]);
    const l = Math.max(0, Math.min(100, parseInt(match[3]) + amount));
    return `hsl(${h}, ${s}%, ${l}%)`;
}
