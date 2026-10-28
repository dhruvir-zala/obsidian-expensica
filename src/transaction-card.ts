import {
    appendSvgIcon,
    CategoryType,
    SvgIconShape,
    getAccountColor,
    formatCurrency,
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
import { formatTimeForDisplay } from './time-selector-modal';

const CHECK_SHAPES: SvgIconShape[] = [{ tag: 'polyline', attrs: { points: '20 6 9 17 4 12' } }];
const CLOCK_SHAPES: SvgIconShape[] = [
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '10' } },
    { tag: 'polyline', attrs: { points: '12 6 12 12 16 14' } }
];
const CHEVRON_SHAPES: SvgIconShape[] = [{ tag: 'polyline', attrs: { points: '9 6 15 12 9 18' } }];
const CARD_SHAPES: SvgIconShape[] = [
    { tag: 'rect', attrs: { x: '2', y: '5', width: '20', height: '14', rx: '2' } },
    { tag: 'line', attrs: { x1: '2', y1: '10', x2: '22', y2: '10' } }
];

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
            id: 'other_expense',
            name: 'Other Expenses',
            emoji: plugin.getCategoryEmoji('other_expense'),
            type: CategoryType.EXPENSE
        };
    const selectorEl = transactionEl.createEl('button', {
        cls: 'expensica-transaction-selector',
        attr: {
            type: 'button',
            'aria-label': `${selected ? 'Unselect' : 'Select'} transaction ${transaction.description}`,
            'aria-pressed': String(!!selected)
        }
    });
    appendSvgIcon(selectorEl, { size: 14, strokeWidth: '3', ariaHidden: true }, CHECK_SHAPES);
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
    detailsEl.createDiv({ text: transaction.description, cls: 'expensica-transaction-title' });
    const metaEl = detailsEl.createDiv('expensica-transaction-meta');

    const transactionTime = formatTimeForDisplay(getTransactionDisplayTime(transaction) || '', plugin.settings.timeFormat);
    if (transactionTime) {
        const timeEl = metaEl.createSpan({ cls: 'expensica-transaction-date' });
        appendSvgIcon(timeEl, { size: 12, strokeWidth: '2' }, CLOCK_SHAPES);
        timeEl.appendText(` ${transactionTime}`);
    }

    if (plugin.settings.enableAccounts && transaction.type === TransactionType.INTERNAL) {
        const fromAccount = parseAccountReference(transaction.fromAccount || plugin.normalizeTransactionAccountReference(undefined));
        const toAccount = parseAccountReference(transaction.toAccount || plugin.normalizeTransactionAccountReference(undefined));
        const accounts = plugin.getAccounts();
        const fromAccountRecord = plugin.findAccountByReference(transaction.fromAccount);
        const toAccountRecord = plugin.findAccountByReference(transaction.toAccount);
        const accountEl = metaEl.createSpan({ cls: 'expensica-transaction-account' });
        renderTransactionAccountEndpoint(accountEl, fromAccount.name, fromAccountRecord ? getAccountColor(fromAccountRecord, accounts) : undefined);
        const separatorEl = accountEl.createSpan({ cls: 'expensica-transaction-account-separator' });
        appendSvgIcon(separatorEl, { size: 12, strokeWidth: '2.25', ariaHidden: true }, CHEVRON_SHAPES);
        renderTransactionAccountEndpoint(accountEl, toAccount.name, toAccountRecord ? getAccountColor(toAccountRecord, accounts) : undefined);
    } else if (plugin.settings.enableAccounts) {
        const accountDisplay = plugin.getTransactionAccountDisplay(transaction.account);
        const accountEl = metaEl.createSpan({ cls: 'expensica-transaction-account' });
        appendSvgIcon(accountEl, { size: 12, strokeWidth: '2' }, CARD_SHAPES);
        accountEl.appendText(` ${accountDisplay.name}`);
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
    const formattedAmount = formatCurrency(transaction.amount, plugin.settings.defaultCurrency);
    const amountClass = transaction.type === TransactionType.INCOME
        ? 'expensica-income'
        : transaction.type === TransactionType.EXPENSE
            ? 'expensica-expense'
            : '';
    const amountPrefix = transaction.type === TransactionType.INCOME ? '+' : transaction.type === TransactionType.EXPENSE ? '-' : '';
    amountEl.createSpan({
        text: `${amountPrefix}${formattedAmount}`,
        cls: amountClass
    });
    const balanceEl = amountEl.createDiv('expensica-transaction-balance');
    balanceEl.createSpan({
        text: runningBalanceLabel,
        cls: 'expensica-transaction-balance-label'
    });
    if (secondaryRunningBalanceLabel) {
        balanceEl.createSpan({
            text: secondaryRunningBalanceLabel,
            cls: 'expensica-transaction-balance-label'
        });
    }

    return transactionEl;
}

function renderTransactionAccountEndpoint(container: HTMLElement, name: string, color?: string): void {
    const endpointEl = container.createSpan({ cls: 'expensica-transaction-account-endpoint' });
    if (color) {
        endpointEl.style.color = color;
    }

    const iconEl = endpointEl.createSpan({ cls: 'expensica-transaction-account-icon' });
    appendSvgIcon(iconEl, { size: 12, strokeWidth: '2', ariaHidden: true }, CARD_SHAPES);

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

    showCategoryQuickMenu(target, plugin, categoryType, (categoryId) => {
        if (categoryId === transaction.category) {
            return Promise.resolve();
        }

        return onCategoryChange(transaction, categoryId);
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
