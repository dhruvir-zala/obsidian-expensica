import { formatCurrency } from './models';
export function renderBudgetCard(container, options) {
    const { budget, categoryName, categoryEmoji, categoryColor, currencyCode, spent, remaining, percentage, periodLabel, statusText, statusClass, onEdit } = options;
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
    detailsEl.createEl('div', { text: categoryName, cls: 'expensica-transaction-title' });
    const metaEl = detailsEl.createDiv('expensica-transaction-meta expensica-budget-card-meta');
    metaEl.createSpan({
        text: formatBudgetPeriodLabel(periodLabel),
        cls: 'expensica-transaction-date expensica-budget-card-period'
    });
    metaEl.createSpan({
        text: statusText,
        cls: `expensica-budget-card-status ${statusClass}`
    });
    const progressEl = detailsEl.createDiv('expensica-budget-card-progress-row');
    const progressBar = progressEl.createDiv('notion-budget-progress expensica-budget-card-progress');
    const budgetBar = progressBar.createDiv('notion-budget-bar');
    const budgetFill = budgetBar.createDiv('notion-budget-fill expensica-budget-fill-width');
    budgetFill.setAttribute('data-percentage', Math.round(percentage).toString());
    progressBar.createDiv({
        text: `${Math.round(percentage)}%`,
        cls: 'notion-budget-percentage'
    });
    const progressLabels = progressEl.createDiv('notion-budget-labels');
    progressLabels.createSpan({ text: `Spent ${formatCurrency(spent, currencyCode)}` });
    progressLabels.createSpan({ text: `Remaining ${formatCurrency(remaining, currencyCode)}` });
    const amountEl = budgetEl.createDiv('expensica-transaction-amount expensica-budget-card-amount');
    amountEl.createEl('span', {
        text: formatCurrency(budget.amount, currencyCode),
        cls: 'expensica-budget'
    });
    const balanceEl = amountEl.createDiv('expensica-transaction-balance expensica-budget-card-balance');
    balanceEl.createEl('span', {
        text: 'Budget',
        cls: 'expensica-transaction-balance-label'
    });
    balanceEl.createEl('span', {
        text: `Spent ${formatCurrency(spent, currencyCode)}`,
        cls: 'expensica-transaction-balance-label'
    });
    return budgetEl;
}
function formatBudgetPeriodLabel(periodLabel) {
    return periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1).toLowerCase();
}
