import { Menu } from 'obsidian';
import {
    CategoryType,
    getAccountColor,
    getCurrencyByCode,
    getTransactionDisplayTime,
    INTERNAL_CATEGORY_ID,
    parseAccountReference,
    Transaction,
    TransactionType
} from './models';
import type ExpensicaPlugin from '../main';
import { renderCategoryChip } from './category-chip';
import { showCategoryQuickMenu } from './category-quick-menu';
import { showExpensicaNotice } from './notice';

interface TransactionCardOptions {
    plugin: ExpensicaPlugin;
    transaction: Transaction;
    runningBalanceLabel: string;
    secondaryRunningBalanceLabel?: string;
    onEdit?: (transaction: Transaction) => void;
    onCategoryChange?: (transaction: Transaction, categoryId: string) => void | Promise<void>;
    selectable?: boolean;
    selected?: boolean;
    onSelectionToggle?: (transaction: Transaction, selected: boolean) => void;
}

export function renderTransactionCard(container: HTMLElement, options: TransactionCardOptions): HTMLElement {
    const { plugin, transaction, runningBalanceLabel, secondaryRunningBalanceLabel, onEdit, onCategoryChange, selectable, selected, onSelectionToggle } = options;
    const transactionEl = container.createDiv('expensica-transaction');
    transactionEl.setAttribute('data-transaction-id', transaction.id);
    transactionEl.toggleClass('is-selected', !!selected);

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

    const selectorEl = transactionEl.createEl('button', {
        cls: 'expensica-transaction-selector',
        attr: {
            type: 'button',
            'aria-label': `${selected ? 'Unselect' : 'Select'} transaction ${transaction.description}`,
            'aria-pressed': String(!!selected)
        }
    });
    selectorEl.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    selectorEl.toggleClass('is-selected', !!selected);
    selectorEl.toggleClass('is-disabled', !selectable);
    if (!selectable) {
        selectorEl.disabled = true;
        selectorEl.setAttribute('aria-hidden', 'true');
        selectorEl.setAttribute('tabindex', '-1');
    } else {
        selectorEl.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const nextSelected = !selectorEl.classList.contains('is-selected');
            transactionEl.toggleClass('is-selected', nextSelected);
            selectorEl.toggleClass('is-selected', nextSelected);
            selectorEl.setAttribute('aria-pressed', String(nextSelected));
            onSelectionToggle?.(transaction, nextSelected);
        });
    }

    const detailsEl = transactionEl.createDiv('expensica-transaction-details');
    detailsEl.createEl('div', { text: transaction.description, cls: 'expensica-transaction-title' });
    const metaEl = detailsEl.createDiv('expensica-transaction-meta');

    const transactionTime = getTransactionDisplayTime(transaction);
    if (transactionTime) {
        const timeEl = metaEl.createEl('span', { cls: 'expensica-transaction-date' });
        timeEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> ${transactionTime}`;
    }

    if (plugin.settings.enableAccounts && transaction.type === TransactionType.INTERNAL) {
        const fromAccount = parseAccountReference(transaction.fromAccount || plugin.normalizeTransactionAccountReference(undefined));
        const toAccount = parseAccountReference(transaction.toAccount || plugin.normalizeTransactionAccountReference(undefined));
        const accounts = plugin.getAccounts();
        const fromAccountRecord = plugin.findAccountByReference(transaction.fromAccount);
        const toAccountRecord = plugin.findAccountByReference(transaction.toAccount);
        const accountEl = metaEl.createEl('span', { cls: 'expensica-transaction-account' });
        renderTransactionAccountEndpoint(accountEl, fromAccount.name, fromAccountRecord ? getAccountColor(fromAccountRecord, accounts) : undefined);
        const separatorEl = accountEl.createSpan({ cls: 'expensica-transaction-account-separator' });
        separatorEl.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"></polyline></svg>';
        renderTransactionAccountEndpoint(accountEl, toAccount.name, toAccountRecord ? getAccountColor(toAccountRecord, accounts) : undefined);
    } else if (plugin.settings.enableAccounts) {
        const accountDisplay = plugin.getTransactionAccountDisplay(transaction.account);
        const accountEl = metaEl.createEl('span', { cls: 'expensica-transaction-account' });
        accountEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg> ${accountDisplay.name}`;
        accountEl.style.color = getAccountColor(accountDisplay, plugin.getAccounts());
    }

    if (plugin.settings.showTransactionCategoryLabels) {
        const categorySpan = renderCategoryChip(metaEl, {
            emoji: categoryDisplay.emoji,
            text: categoryDisplay.name,
            color: category ? plugin.getCategoryColor(category.id, category.name) : undefined,
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
                if (transaction.category === INTERNAL_CATEGORY_ID || transaction.type === TransactionType.INTERNAL) {
                    showExpensicaNotice('You cannot change this category');
                    return;
                }
                showTransactionCategoryMenu(event, plugin, transaction, categoryDisplay.type, onCategoryChange);
            });
            categorySpan.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
                if (transaction.category === INTERNAL_CATEGORY_ID || transaction.type === TransactionType.INTERNAL) {
                    showExpensicaNotice('You cannot change this category');
                    return;
                }
                showTransactionCategoryMenu(event, plugin, transaction, categoryDisplay.type, onCategoryChange);
            });
        }
    }

    const amountEl = transactionEl.createDiv('expensica-transaction-amount');
    const formattedAmount = formatTransactionCardCurrency(transaction.amount, plugin.settings.defaultCurrency);
    const amountClass = transaction.type === TransactionType.INCOME
        ? 'expensica-income'
        : transaction.type === TransactionType.EXPENSE
            ? 'expensica-expense'
            : '';
    const amountPrefix = transaction.type === TransactionType.INCOME ? '+' : transaction.type === TransactionType.EXPENSE ? '-' : '';
    amountEl.createEl('span', {
        text: `${amountPrefix}${formattedAmount}`,
        cls: amountClass
    });
    const balanceEl = amountEl.createDiv('expensica-transaction-balance');
    balanceEl.createEl('span', {
        text: runningBalanceLabel,
        cls: 'expensica-transaction-balance-label'
    });
    if (secondaryRunningBalanceLabel) {
        balanceEl.createEl('span', {
            text: secondaryRunningBalanceLabel,
            cls: 'expensica-transaction-balance-label'
        });
    }

    return transactionEl;
}

function formatTransactionCardCurrency(amount: number, currencyCode: string): string {
    const currency = getCurrencyByCode(currencyCode) || getCurrencyByCode('USD');
    const code = currency?.code || 'USD';
    const symbol = getTransactionCardCurrencySymbol(code, currency?.symbol || '$');
    const sign = amount < 0 ? '-' : '';
    const absoluteAmount = Math.abs(amount);

    let fractionDigits = 2;
    try {
        fractionDigits = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: code
        }).resolvedOptions().maximumFractionDigits;
    } catch {
        fractionDigits = 2;
    }

    const formattedNumber = new Intl.NumberFormat('en-US', {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits
    }).format(absoluteAmount);

    return `${sign}${symbol}${formattedNumber}`;
}

function getTransactionCardCurrencySymbol(currencyCode: string, fallbackSymbol: string): string {
    try {
        const currencyPart = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currencyCode,
            currencyDisplay: 'narrowSymbol'
        }).formatToParts(0).find(part => part.type === 'currency')?.value;

        if (currencyPart) {
            return stripCurrencyAbbreviation(currencyPart);
        }
    } catch {
        // Fall back to the configured symbol below.
    }

    return stripCurrencyAbbreviation(fallbackSymbol);
}

function stripCurrencyAbbreviation(symbol: string): string {
    return symbol.replace(/[A-Za-z]+/g, '').trim();
}

function renderTransactionAccountEndpoint(container: HTMLElement, name: string, color?: string): void {
    const endpointEl = container.createSpan({ cls: 'expensica-transaction-account-endpoint' });
    if (color) {
        endpointEl.style.color = color;
    }

    const iconEl = endpointEl.createSpan({ cls: 'expensica-transaction-account-icon' });
    iconEl.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>';

    endpointEl.createSpan({
        text: name,
        cls: 'expensica-transaction-account-name'
    });
}

function showTransactionCategoryMenu(
    event: MouseEvent | KeyboardEvent,
    plugin: ExpensicaPlugin,
    transaction: Transaction,
    categoryType: CategoryType,
    onCategoryChange: (transaction: Transaction, categoryId: string) => void | Promise<void>
) {
    const target = event.currentTarget as HTMLElement | null;
    if (!target) {
        return;
    }

    showCategoryQuickMenu(target, plugin, categoryType, async (categoryId) => {
        if (categoryId === transaction.category) {
            return;
        }

        await onCategoryChange(transaction, categoryId);
    }, transaction.category);
}

export function showTransactionBulkCategoryMenu(
    target: HTMLElement,
    plugin: ExpensicaPlugin,
    categoryType: CategoryType,
    onCategoryChange: (categoryId: string) => void | Promise<void>
) {
    showCategoryQuickMenu(target, plugin, categoryType, onCategoryChange);
}
