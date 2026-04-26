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
    onSearchClick?: (category: CategoryCardData) => void;
}

export function renderCategoryCards(
    container: HTMLElement,
    categories: CategoryCardData[],
    options: CategoryCardRenderOptions = {}
) {
    container.empty();

    categories.forEach((category, index) => {
        const cardRow = container.createDiv('expensica-category-card-row');
        const card = cardRow.createDiv('expensica-category-card');
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

        if (options.onSearchClick && category.id) {
            const searchButton = cardRow.createEl('button', {
                cls: 'expensica-category-card-search-button',
                attr: {
                    type: 'button',
                    'aria-label': `Show transactions for ${category.name}`,
                    title: `Show transactions for ${category.name}`
                }
            });
            searchButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
            searchButton.addEventListener('click', (event) => {
                event.stopPropagation();
                options.onSearchClick?.(category);
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
