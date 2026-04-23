import { formatCurrency, type Account, type Transaction, type Currency, getAccountEmoji, getAccountTypeLabel } from './models';

interface AccountCardOptions {
    account: Account;
    runningBalance: number;
    lastTransactionDateLabel: string;
    currency: Currency;
    creditLimitLabel?: string;
    onClick?: (account: Account) => void;
}

interface CreateAccountCardOptions {
    onClick: () => void;
}

export function renderAccountCard(container: HTMLElement, options: AccountCardOptions): HTMLElement {
    const { account, runningBalance, lastTransactionDateLabel, currency, creditLimitLabel, onClick } = options;
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
    identity.createDiv({ text: getAccountEmoji(account.type), cls: 'expensica-account-card-icon' });

    const textGroup = identity.createDiv('expensica-account-card-text');
    const titleRow = textGroup.createDiv('expensica-account-card-title-row');
    titleRow.createSpan({ text: account.name, cls: 'expensica-account-card-name' });
    titleRow.createSpan({ text: getAccountTypeLabel(account.type), cls: 'expensica-account-card-type' });

    textGroup.createSpan({
        text: lastTransactionDateLabel,
        cls: 'expensica-account-card-date'
    });

    const balanceWrap = header.createDiv('expensica-account-card-balance-wrap');
    const balanceEl = balanceWrap.createDiv('expensica-account-card-balance');
    balanceEl.addClass(runningBalance === 0 ? 'is-neutral' : runningBalance > 0 ? 'is-positive' : 'is-negative');
    balanceEl.setText(formatCurrency(runningBalance, currency.code));
    if (creditLimitLabel) {
        balanceWrap.createDiv({
            text: creditLimitLabel,
            cls: 'expensica-account-card-credit-limit'
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
    identity.createDiv({ text: '+', cls: 'expensica-account-card-icon expensica-account-card-icon-create' });

    const textGroup = identity.createDiv('expensica-account-card-text');
    const titleRow = textGroup.createDiv('expensica-account-card-title-row');
    titleRow.createSpan({ text: 'Create New Account', cls: 'expensica-account-card-name' });

    textGroup.createSpan({
        text: 'Add chequing, saving, credit, or other',
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
