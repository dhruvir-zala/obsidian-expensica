import { displayTooltip, setTooltip } from 'obsidian';

export function setChartTooltip(element: HTMLElement, text: string, showOnClick = false,
    richContent?: { render?: () => DocumentFragment; focusTarget?: HTMLElement }): void {
    const options = { classes: ['expensica-chart-tooltip'] };
    element.removeAttribute('title');
    setTooltip(element, text, options);
    if (richContent || showOnClick) {
        let visible = false;
        let pressedWhileVisible: boolean | null = null;
        const show = () => {
            if (visible) return;
            visible = true;
            if (showOnClick) element.setAttribute('aria-expanded', 'true');
            displayTooltip(element, richContent?.render ? richContent.render() : text, options);
        };
        const hide = () => {
            const EventClass = element.ownerDocument.defaultView?.Event ?? Event;
            element.dispatchEvent(new EventClass('mouseleave'));
        };
        element.addEventListener('mouseenter', show);
        element.addEventListener('mouseleave', () => {
            visible = false;
            if (showOnClick) element.setAttribute('aria-expanded', 'false');
        });
        const focusTarget = richContent?.focusTarget ?? element;
        focusTarget.removeAttribute('title');
        focusTarget.addEventListener('focus', show);
        focusTarget.addEventListener('blur', hide);
        if (showOnClick) {
            element.setAttribute('aria-expanded', 'false');
            element.addEventListener('pointerdown', () => { pressedWhileVisible = visible; });
            element.addEventListener('click', event => {
                event.stopPropagation();
                if (pressedWhileVisible ?? visible) hide();
                else show();
                pressedWhileVisible = null;
            });
            element.addEventListener('keydown', event => {
                if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                if (visible || event.key === 'Escape') hide();
                else show();
            });
        }
        return;
    }
}
