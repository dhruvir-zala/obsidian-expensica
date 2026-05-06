import { type Budget, formatCurrency } from './models';

interface BudgetCardOptions {
    budget: Budget;
    categoryName: string;
    categoryEmoji: string;
    categoryColor?: string;
    currencyCode: string;
    spent: number;
    remaining: number;
    percentage: number;
    periodLabel: string;
    statusText: string;
    statusClass: string;
    onEdit?: (budget: Budget) => void;
}

export function renderBudgetCard(container: HTMLElement, options: BudgetCardOptions): HTMLElement {
    const {
        budget,
        categoryName,
        categoryEmoji,
        categoryColor,
        currencyCode,
        spent,
        remaining,
        percentage,
        periodLabel,
        statusText,
        statusClass,
        onEdit
    } = options;

    const budgetEl = container.createDiv(`expensica-transaction expensica-budget-card ${statusClass}`);
    budgetEl.setAttribute('data-budget-id', budget.id);

    if (onEdit) {
        budgetEl.addClass('expensica-transaction-interactive');
        budgetEl.setAttribute('role', 'button');
        budgetEl.setAttribute('tabindex', '0');
        budgetEl.addEventListener('click', () => onEdit(budget));
        budgetEl.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') {
                return;
            }

            event.preventDefault();
            onEdit(budget);
        });
    }

    const iconEl = budgetEl.createDiv('expensica-budget-card-icon');
    iconEl.setText(categoryEmoji);
    if (categoryColor) {
        iconEl.style.color = categoryColor;
        iconEl.style.borderColor = categoryColor;
    }

    const detailsEl = budgetEl.createDiv('expensica-transaction-details expensica-budget-card-details');
    const headerEl = detailsEl.createDiv('expensica-budget-card-header');
    headerEl.createEl('div', { text: categoryName, cls: 'expensica-transaction-title expensica-budget-card-title' });

    const progressBar = headerEl.createDiv('expensica-budget-card-progress');
    const budgetBar = progressBar.createDiv('notion-budget-bar');
    const budgetFill = budgetBar.createDiv('notion-budget-fill expensica-budget-fill-width');
    budgetFill.setAttribute('data-percentage', Math.round(percentage).toString());
    progressBar.createDiv({
        text: `${Math.round(percentage)}%`,
        cls: 'expensica-budget-card-percentage'
    });

    const metaEl = detailsEl.createDiv('expensica-transaction-meta expensica-budget-card-meta');
    metaEl.createSpan({
        text: formatBudgetPeriodLabel(periodLabel),
        cls: 'expensica-transaction-date expensica-budget-card-period'
    });
    metaEl.createSpan({
        text: statusText,
        cls: `expensica-budget-card-status ${statusClass}`
    });

    const amountEl = budgetEl.createDiv('expensica-transaction-amount expensica-budget-card-amount');
    amountEl.createEl('span', {
        text: formatCompactCurrency(budget.amount, currencyCode),
        cls: 'expensica-budget-card-value'
    });

    const balanceEl = amountEl.createDiv('expensica-transaction-balance expensica-budget-card-balance');
    balanceEl.createEl('span', {
        text: `Spent ${formatCompactCurrency(spent, currencyCode)}`,
        cls: 'expensica-transaction-balance-label'
    });
    balanceEl.createEl('span', {
        text: `Remaining ${formatCompactCurrency(remaining, currencyCode)}`,
        cls: 'expensica-transaction-balance-label'
    });

    return budgetEl;
}

function formatBudgetPeriodLabel(periodLabel: string): string {
    return periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1).toLowerCase();
}

function formatCompactCurrency(amount: number, currencyCode: string): string {
    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currencyCode,
            currencyDisplay: 'narrowSymbol',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(amount);
    } catch {
        return formatCurrency(amount, currencyCode).replace(/^[A-Z]{2,3}\s?/, '');
    }
}
