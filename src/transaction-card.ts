import { Menu } from 'obsidian';
import {
    CategoryType,
    formatCurrency,
    getTransactionDisplayTime,
    Transaction,
    TransactionType
} from './models';
import type ExpensicaPlugin from '../main';
import { renderCategoryChip } from './category-chip';

interface TransactionCardOptions {
    plugin: ExpensicaPlugin;
    transaction: Transaction;
    runningBalance: number;
    onEdit?: (transaction: Transaction) => void;
    onCategoryChange?: (transaction: Transaction, categoryId: string) => void | Promise<void>;
}

export function renderTransactionCard(container: HTMLElement, options: TransactionCardOptions): HTMLElement {
    const { plugin, transaction, runningBalance, onEdit, onCategoryChange } = options;
    const transactionEl = container.createDiv('expensica-transaction');

    if (onEdit) {
        transactionEl.addClass('expensica-transaction-interactive');
        transactionEl.setAttribute('role', 'button');
        transactionEl.setAttribute('tabindex', '0');

        transactionEl.addEventListener('click', () => onEdit(transaction));
        transactionEl.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') {
                return;
            }

            event.preventDefault();
            onEdit(transaction);
        });
    }

    const category = plugin.getCategoryById(transaction.category);
    const categoryDisplay = category ?
        { id: category.id, name: category.name, emoji: plugin.getCategoryEmoji(category.id), type: category.type } :
        {
            id: 'unknown',
            name: 'Unknown Category',
            emoji: '?',
            type: transaction.type === TransactionType.INCOME ? CategoryType.INCOME : CategoryType.EXPENSE
        };

    const iconEl = transactionEl.createDiv('expensica-transaction-icon');
    iconEl.setText(categoryDisplay.emoji);
    iconEl.addClass(transaction.type === TransactionType.INCOME ? 'expensica-income-icon' : 'expensica-expense-icon');

    const detailsEl = transactionEl.createDiv('expensica-transaction-details');
    detailsEl.createEl('div', { text: transaction.description, cls: 'expensica-transaction-title' });
    const metaEl = detailsEl.createDiv('expensica-transaction-meta');

    const transactionTime = getTransactionDisplayTime(transaction);
    if (transactionTime) {
        const timeEl = metaEl.createEl('span', { cls: 'expensica-transaction-date' });
        timeEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> ${transactionTime}`;
    }

    if (plugin.settings.showTransactionCategoryLabels) {
        const categorySpan = renderCategoryChip(metaEl, {
            emoji: categoryDisplay.emoji,
            text: categoryDisplay.name,
            colorName: categoryDisplay.name,
            title: !category ? 'This category was deleted. Edit the transaction to select a new category.' : undefined
        });
        categorySpan.addClass('expensica-transaction-category');

        if (!category) {
            categorySpan.addClass('category-unknown');
        }

        if (onCategoryChange) {
            categorySpan.setAttribute('role', 'button');
            categorySpan.setAttribute('tabindex', '0');
            categorySpan.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                showTransactionCategoryMenu(event, plugin, transaction, categoryDisplay.type, onCategoryChange);
            });
            categorySpan.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
                showTransactionCategoryMenu(event, plugin, transaction, categoryDisplay.type, onCategoryChange);
            });
        }
    }

    const amountEl = transactionEl.createDiv('expensica-transaction-amount');
    const formattedAmount = formatCurrency(transaction.amount, plugin.settings.defaultCurrency);
    const amountClass = transaction.type === TransactionType.INCOME ? 'expensica-income' : 'expensica-expense';
    const amountPrefix = transaction.type === TransactionType.INCOME ? '+' : '-';
    amountEl.createEl('span', {
        text: `${amountPrefix}${formattedAmount}`,
        cls: amountClass
    });
    amountEl.createEl('span', {
        text: formatCurrency(runningBalance, plugin.settings.defaultCurrency),
        cls: 'expensica-transaction-balance'
    });

    return transactionEl;
}

function showTransactionCategoryMenu(
    event: MouseEvent | KeyboardEvent,
    plugin: ExpensicaPlugin,
    transaction: Transaction,
    categoryType: CategoryType,
    onCategoryChange: (transaction: Transaction, categoryId: string) => void | Promise<void>
) {
    const menu = new Menu();
    const categories = plugin.getCategories(categoryType);

    if (categories.length === 0) {
        menu.addItem(item => item
            .setTitle('No categories')
            .setDisabled(true));
    } else {
        categories.forEach(category => {
            menu.addItem(item => item
                .setTitle(`${plugin.getCategoryEmoji(category.id)} ${category.name}`)
                .setChecked(category.id === transaction.category)
                .onClick(() => {
                    if (category.id === transaction.category) {
                        return;
                    }

                    void onCategoryChange(transaction, category.id);
                }));
        });
    }

    if (event instanceof MouseEvent) {
        menu.showAtMouseEvent(event);
        return;
    }

    const target = event.currentTarget as HTMLElement | null;
    const rect = target?.getBoundingClientRect();

    menu.showAtPosition({
        x: rect?.left ?? 0,
        y: rect?.bottom ?? 0
    });
}
