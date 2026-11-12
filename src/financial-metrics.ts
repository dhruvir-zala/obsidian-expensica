import { appendSvgIcon, formatCurrency } from './models';
import { setChartTooltip } from './chart-tooltip';

export const TREND_PERCENTAGE_LIMIT = 100;

export function renderFinancialMetric(container: HTMLElement, label: string, amount: number, currencyCode: string,
    color: string, periodLabel?: string): HTMLElement {
    const metric = container.createDiv('expensica-cash-flow-metric');
    metric.setCssProps({ '--expensica-cash-flow-color': color });
    const total = metric.createDiv({
        cls: 'expensica-metric-total', attr: { role: 'button', tabindex: '0' }
    });
    total.createSpan({ text: `${label}: `, cls: 'expensica-cash-flow-label' });
    const formattedAmount = formatCurrency(amount, currencyCode);
    total.createSpan({ text: formattedAmount, cls: 'expensica-card-value expensica-card-currency-amount' });
    setChartTooltip(total, `your total ${label}${periodLabel ? ` for ${periodLabel}` : ''} is ${formattedAmount}`, true);
    return metric;
}

export function isEffectivelyZero(value: number, epsilon = 0.000001): boolean {
    return Math.abs(value) < epsilon;
}

function getTrendPercentage(currentValue: number, previousValue: number): number {
    if (isEffectivelyZero(previousValue)) {
        return isEffectivelyZero(currentValue) ? 0 : Math.sign(currentValue) * 100;
    }

    return ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
}

export function formatFinancialAmount(value: number, currencyCode: string): string {
    const formatted = formatCurrency(value, currencyCode);
    return value !== 0 && formatCurrency(Math.abs(value), currencyCode) === formatCurrency(0, currencyCode)
        ? `${Number(value.toPrecision(3))} ${currencyCode}` : formatted;
}

export function renderTrend(
    container: HTMLElement,
    currentValue: number,
    previousValue: number,
    currencyCode: string,
    comparisonLabel: string,
    decreaseIsSuccess = false,
    describe?: (trend: { change: number; percentage: number; amount: string; useAmount: boolean }) => { label: string; tooltip: string }
): void {
    const change = currentValue - previousValue;
    const trendPercentage = getTrendPercentage(currentValue, previousValue);
    const percentage = Number(Math.abs(trendPercentage).toFixed(1));
    const isNeutral = change === 0;
    // Unstable baselines and extreme percentages use absolute changes.
    const useAmount = !isNeutral && (previousValue < 1 || currentValue < 0 || percentage === 0
        || percentage >= TREND_PERCENTAGE_LIMIT || !Number.isFinite(percentage));
    const amount = formatFinancialAmount(Math.abs(change), currencyCode);
    const custom = describe?.({ change, percentage, amount, useAmount });
    const formattedChange = custom?.label ?? (useAmount ? amount : `${percentage}%`);
    const direction = isNeutral ? '' : change > 0 ? 'More than ' : 'Less than ';
    const description = custom?.tooltip ?? `${direction}${useAmount ? amount : `${percentage}% (${amount})`} from ${comparisonLabel}.`;
    const trendClass = isNeutral ? 'is-neutral' : (change > 0) !== decreaseIsSuccess ? 'is-positive' : 'is-negative';
    container.addClass(trendClass);
    if (!isNeutral) {
        const indicator = container.createSpan({
            cls: `expensica-card-trend-indicator ${trendClass}`,
            attr: { 'aria-hidden': 'true' }
        });
        appendSvgIcon(indicator, { size: 12, strokeWidth: '3', ariaHidden: true }, [
            { tag: 'polyline', attrs: { points: change > 0 ? '22 7 13.5 15.5 8.5 10.5 2 17' : '22 17 13.5 8.5 8.5 13.5 2 7' } },
            { tag: 'polyline', attrs: { points: change > 0 ? '16 7 22 7 22 13' : '16 17 22 17 22 11' } }
        ]);
    }
    container.createSpan({ text: formattedChange });
    container.setAttribute('role', 'button');
    container.setAttribute('tabindex', '0');
    setChartTooltip(container, description, true);
}

