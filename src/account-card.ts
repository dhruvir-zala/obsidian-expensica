import { AccountType, formatCurrency, type Account, type Transaction, getAccountEmoji, getAccountTypeLabel, getAccountColor } from './models';

interface AccountCardOptions {
    account: Account;
    runningBalance: number;
    lastTransactionDateLabel: string;
    currencyCode: string;
    color?: string;
    creditLimitLabel?: string;
    creditLimitExceeded?: boolean;
    onClick?: (account: Account) => void;
}

interface CreateAccountCardOptions {
    onClick: () => void;
    label?: string;
    description?: string;
    icon?: string;
}

export function renderAccountCard(container: HTMLElement, options: AccountCardOptions): HTMLElement {
    const { account, runningBalance, lastTransactionDateLabel, currencyCode, color, creditLimitLabel, creditLimitExceeded, onClick } = options;
    const card = container.createDiv('expensica-account-card');
    card.setAttribute('data-account-type', account.type);

    if (onClick) {
        card.addClass('expensica-account-card-interactive');
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.addEventListener('click', () => onClick(account));
        card.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') {
                return;
            }

            event.preventDefault();
            onClick(account);
        });
    }

    const header = card.createDiv('expensica-account-card-header');
    const identity = header.createDiv('expensica-account-card-identity');
    const iconRow = identity.createDiv('expensica-account-card-icon-row');
    if (color) {
        const colorSwatch = iconRow.createDiv('expensica-category-color-preview');
        colorSwatch.style.backgroundColor = color;
    }
    iconRow.createDiv({ text: getAccountEmoji(account.type), cls: 'expensica-account-card-icon' });

    const textGroup = identity.createDiv('expensica-account-card-text');
    const titleRow = textGroup.createDiv('expensica-account-card-title-row');
    const name = titleRow.createSpan({ text: account.name, cls: 'expensica-account-card-name' });
    name.style.color = color || getAccountColor(account);
    titleRow.createSpan({ text: getAccountTypeLabel(account.type), cls: 'expensica-account-card-type' });

    textGroup.createSpan({
        text: lastTransactionDateLabel,
        cls: 'expensica-account-card-date'
    });

    const balanceWrap = header.createDiv('expensica-account-card-balance-wrap');
    const balanceEl = balanceWrap.createDiv('expensica-account-card-balance');
    balanceEl.addClass(runningBalance === 0 ? 'is-neutral' : runningBalance > 0 ? 'is-positive' : 'is-negative');
    balanceEl.setText(formatCurrency(runningBalance, currencyCode));
    if (creditLimitLabel) {
        balanceWrap.createDiv({
            text: creditLimitLabel,
            cls: 'expensica-account-card-credit-limit'
        });
    }

    if (creditLimitExceeded || ((account.type === AccountType.CHEQUING || account.isDefault) && account.type !== AccountType.CREDIT && runningBalance < 0)) {
        balanceWrap.createDiv({
            text: creditLimitExceeded ? 'Credit limit exceeded' : 'Overdraft',
            cls: 'expensica-account-card-warning'
        });
    }

    return card;
}

export function renderCreateAccountCard(container: HTMLElement, options: CreateAccountCardOptions): HTMLElement {
    const card = container.createDiv('expensica-account-card expensica-account-card-create expensica-account-card-interactive');
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    const header = card.createDiv('expensica-account-card-header');
    const identity = header.createDiv('expensica-account-card-identity');
    identity.createDiv({ text: options.icon || '+', cls: 'expensica-account-card-icon expensica-account-card-icon-create' });

    const textGroup = identity.createDiv('expensica-account-card-text');
    const titleRow = textGroup.createDiv('expensica-account-card-title-row');
    titleRow.createSpan({ text: options.label || 'Create New Account', cls: 'expensica-account-card-name' });

    textGroup.createSpan({
        text: options.description || 'Add chequing, saving, credit, or other',
        cls: 'expensica-account-card-date'
    });

    card.addEventListener('click', () => options.onClick());
    card.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        event.preventDefault();
        options.onClick();
    });

    return card;
}

export function getLastAccountTransaction(
    transactions: Transaction[]
): Transaction | null {
    return transactions[0] || null;
}
