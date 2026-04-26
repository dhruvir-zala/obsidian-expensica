export interface CategoryCardData {
    id?: string;
    name: string;
    color: string;
    emoji?: string;
    percentage: number;
    formattedAmount?: string;
}

interface CategoryCardRenderOptions {
    onHoverStart?: (index: number, event: PointerEvent) => void;
    onHoverEnd?: (index: number) => void;
    onClick?: (category: CategoryCardData) => void;
}

export function renderCategoryCards(
    container: HTMLElement,
    categories: CategoryCardData[],
    options: CategoryCardRenderOptions = {}
) {
    container.empty();

    categories.forEach((category, index) => {
        const card = container.createDiv('expensica-category-card');
        if (options.onClick && category.id) {
            card.addClass('expensica-category-card-interactive');
            card.setAttribute('role', 'button');
            card.setAttribute('tabindex', '0');
            card.addEventListener('click', () => options.onClick?.(category));
            card.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') {
                    return;
                }

                event.preventDefault();
                options.onClick?.(category);
            });
        }

        const meta = card.createDiv('expensica-category-card-meta');
        const swatch = meta.createSpan('expensica-category-card-swatch');
        swatch.style.backgroundColor = category.color;

        meta.createSpan({
            text: category.emoji || '*',
            cls: 'expensica-category-card-emoji'
        });

        meta.createSpan({
            text: category.name,
            cls: 'expensica-category-card-name'
        });

        const graph = card.createDiv('expensica-category-card-graph');
        graph.createSpan({
            text: `${category.percentage.toFixed(1)}%`,
            cls: 'expensica-category-card-percentage'
        });

        const bar = graph.createDiv('expensica-category-card-bar');
        const fill = bar.createDiv('expensica-category-card-fill');
        fill.style.width = `${Math.max(0, Math.min(100, category.percentage))}%`;
        fill.style.backgroundColor = category.color;

        graph.createSpan({
            text: category.formattedAmount ?? '',
            cls: 'expensica-category-card-amount'
        });

        if (options.onHoverStart) {
            card.addEventListener('pointerenter', (event) => {
                card.addClass('is-hovered');
                options.onHoverStart?.(index, event);
            });
        }

        if (options.onHoverEnd) {
            card.addEventListener('pointerleave', () => {
                card.removeClass('is-hovered');
                options.onHoverEnd?.(index);
            });
        }
    });
}
