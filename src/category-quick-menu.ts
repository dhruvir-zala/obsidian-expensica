import { App, Modal } from 'obsidian';
import { appendSvgIcon, Category, CategoryType, ColorPalette, getCommonCategoryEmojis, INTERNAL_CATEGORY_ID } from './models';
import type ExpensicaPlugin from '../main';
import { EmojiPickerModal } from './emoji-picker-modal';
import { showExpensicaNotice } from './notice';

let activeQuickMenu: CategoryQuickMenu | null = null;

export interface CategoryQuickMenuOptions {
    categories?: Category[];
    selectedCategoryIds?: string[];
    closeOnSelect?: boolean;
    autoFocusSearch?: boolean;
    preferredSide?: 'bottom' | 'left';
}

export function showCategoryQuickMenu(
    target: HTMLElement,
    plugin: ExpensicaPlugin,
    categoryType: CategoryType,
    onCategoryChange: (categoryId: string) => void | Promise<void>,
    selectedCategoryId?: string,
    options?: CategoryQuickMenuOptions
) {
    const ownerWindow = target.ownerDocument.defaultView;
    if (!target.isConnected || !ownerWindow) return;
    activeQuickMenu?.close();
    activeQuickMenu = new CategoryQuickMenu(target, plugin, categoryType, onCategoryChange, selectedCategoryId, options, ownerWindow);
    activeQuickMenu.open();
}

class CategoryQuickMenu {
    private readonly menuEl: HTMLDivElement;
    private readonly searchInputEl: HTMLInputElement;
    private readonly listEl: HTMLDivElement;
    private readonly target: HTMLElement;
    private readonly plugin: ExpensicaPlugin;
    private readonly categoryType: CategoryType;
    private readonly onCategoryChange: (categoryId: string) => void | Promise<void>;
    private readonly selectedCategoryId?: string;
    private readonly categories: Category[];
    private readonly closeOnSelect: boolean;
    private readonly autoFocusSearch: boolean;
    private readonly preferredSide: 'bottom' | 'left';
    private readonly hostEl: HTMLElement;
    private readonly ownerDocument: Document;
    private readonly boundHandleDocumentPointerDown: (event: MouseEvent) => void;
    private readonly boundHandleDocumentKeydown: (event: KeyboardEvent) => void;
    private filteredCategories: Category[] = [];
    private activeIndex = -1;
    private selectedCategoryIds: Set<string>;
    private horizontalAnchorLeft: number | null = null;
    private originObserver: MutationObserver | null = null;
    private focusFrame: number | null = null;
    private closed = false;

    constructor(
        target: HTMLElement,
        plugin: ExpensicaPlugin,
        categoryType: CategoryType,
        onCategoryChange: (categoryId: string) => void | Promise<void>,
        selectedCategoryId: string | undefined,
        options: CategoryQuickMenuOptions | undefined,
        private readonly ownerWindow: NonNullable<Document['defaultView']>
    ) {
        this.target = target;
        this.plugin = plugin;
        this.categoryType = categoryType;
        this.onCategoryChange = onCategoryChange;
        this.selectedCategoryId = selectedCategoryId;
        this.categories = (options?.categories ?? plugin.getCategories(categoryType))
            .filter(category => category.id !== INTERNAL_CATEGORY_ID)
            .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
        this.closeOnSelect = options?.closeOnSelect ?? true;
        this.autoFocusSearch = options?.autoFocusSearch ?? true;
        this.preferredSide = options?.preferredSide ?? 'bottom';
        this.ownerDocument = target.ownerDocument;
        this.hostEl = target.closest('.modal-content') || this.ownerDocument.body;
        this.boundHandleDocumentPointerDown = this.handleDocumentPointerDown.bind(this);
        this.boundHandleDocumentKeydown = this.handleDocumentKeydown.bind(this);
        this.selectedCategoryIds = new Set(options?.selectedCategoryIds ?? (selectedCategoryId ? [selectedCategoryId] : []));

        this.menuEl = this.ownerDocument.createElement('div');
        this.menuEl.className = 'expensica-category-quick-menu';
        this.menuEl.setAttribute('role', 'menu');

        const searchSection = this.menuEl.createDiv('expensica-category-quick-menu-section');
        const searchWrap = searchSection.createDiv('expensica-category-quick-menu-search');
        this.searchInputEl = searchWrap.createEl('input', {
            cls: 'expensica-form-input expensica-category-quick-menu-search-input',
            attr: {
                type: 'search',
                placeholder: 'Search categories',
                'aria-label': 'Search categories',
                autocomplete: 'off'
            }
        });

        this.listEl = this.menuEl.createDiv('expensica-category-quick-menu-section expensica-category-quick-menu-list');
        this.listEl.setAttribute('role', 'listbox');

        const footerSection = this.menuEl.createDiv('expensica-category-quick-menu-section');
        const newCategoryButton = footerSection.createEl('button', {
            cls: 'expensica-category-quick-menu-new-button',
            attr: {
                type: 'button'
            }
        });
        const newIconEl = newCategoryButton.createSpan({ cls: 'expensica-category-quick-menu-new-icon', attr: { 'aria-hidden': 'true' } });
        appendSvgIcon(newIconEl, { size: 14, strokeWidth: '2.2' }, [
            { tag: 'path', attrs: { d: 'M12 5v14' } },
            { tag: 'path', attrs: { d: 'M5 12h14' } }
        ]);
        newCategoryButton.createSpan({ cls: 'expensica-category-quick-menu-new-label', text: 'New Category' });
        newCategoryButton.addEventListener('click', () => {
            if (!this.isOpen()) return;
            this.close();
            new NewCategoryModal(this.plugin.app, this.plugin, this.categoryType, (categoryId) => {
                if (this.ownerDocument.contains(this.target)) return this.onCategoryChange(categoryId);
            }).open();
        });

        this.searchInputEl.addEventListener('input', () => {
            if (!this.isOpen()) return;
            this.renderList(this.searchInputEl.value);
        });
    }

    open() {
        this.hostEl.appendChild(this.menuEl);
        this.renderList();
        this.position();

        this.originObserver = new this.ownerWindow.MutationObserver(() => { this.isOpen(); });
        this.originObserver.observe(this.ownerDocument.body, { childList: true, subtree: true });

        if (this.autoFocusSearch) {
            const frame = this.ownerWindow.requestAnimationFrame(() => {
                if (this.focusFrame !== frame) return;
                this.focusFrame = null;
                if (!this.isOpen()) return;
                this.searchInputEl.focus();
                this.searchInputEl.select();
            });
            this.focusFrame = frame;
        }

        this.ownerDocument.addEventListener('mousedown', this.boundHandleDocumentPointerDown, true);
        this.ownerDocument.addEventListener('keydown', this.boundHandleDocumentKeydown, true);
        this.ownerWindow.addEventListener('resize', this.boundReposition, true);
        this.ownerWindow.addEventListener('unload', this.boundClose);
        this.ownerDocument.addEventListener('scroll', this.boundReposition, true);
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        this.originObserver?.disconnect();
        this.originObserver = null;
        if (this.focusFrame !== null) {
            this.ownerWindow.cancelAnimationFrame(this.focusFrame);
            this.focusFrame = null;
        }
        this.plugin.releaseSaveOperation(this);
        this.ownerWindow.removeEventListener('resize', this.boundReposition, true);
        this.ownerWindow.removeEventListener('unload', this.boundClose);
        this.ownerDocument.removeEventListener('scroll', this.boundReposition, true);
        this.ownerDocument.removeEventListener('mousedown', this.boundHandleDocumentPointerDown, true);
        this.ownerDocument.removeEventListener('keydown', this.boundHandleDocumentKeydown, true);
        this.menuEl.remove();
        if (activeQuickMenu === this) {
            activeQuickMenu = null;
        }
    }

    private isOpen(): boolean {
        if (this.closed) return false;
        if (!this.ownerDocument.contains(this.target) || !this.ownerDocument.contains(this.menuEl)) {
            this.close();
            return false;
        }
        return true;
    }

    private readonly boundClose = () => this.close();

    private readonly boundReposition = () => {
        if (!this.isOpen()) return;
        this.position();
    };

    private handleDocumentPointerDown(event: MouseEvent) {
        if (!this.isOpen()) return;
        if (this.plugin.hasSaveFailure(this) && (event.target as HTMLElement)?.closest('.modal-container')) return;
        const target = event.target as Node | null;
        if (!target) {
            return;
        }

        if (this.menuEl.contains(target) || this.target.contains(target)) {
            return;
        }

        this.close();
    }

    private handleDocumentKeydown(event: KeyboardEvent) {
        if (!this.isOpen()) return;
        if (this.plugin.hasSaveFailure(this) && (event.target as HTMLElement)?.closest('.modal-container')) return;

        const eventTarget = event.target as Node | null;
        const activeElement = this.ownerDocument.activeElement;
        const isWithinMenu = !!eventTarget && this.menuEl.contains(eventTarget);
        const isSearchFocused = activeElement === this.searchInputEl;

        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.close();
            return;
        }

        if (!isWithinMenu && !isSearchFocused) {
            return;
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            event.stopPropagation();
            this.moveActiveIndex(1);
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            this.moveActiveIndex(-1);
            return;
        }

        if (event.key === 'Enter' && activeElement === this.searchInputEl) {
            const activeCategory = this.filteredCategories[this.activeIndex];
            if (!activeCategory) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            void this.selectCategory(activeCategory.id);
        }
    }

    private position() {
        const rect = this.target.getBoundingClientRect();
        const viewportPadding = 12;
        const preferredWidth = 280;
        const availableWidth = Math.max(220, this.ownerWindow.innerWidth - (viewportPadding * 2));
        const menuWidth = Math.min(preferredWidth, availableWidth);
        const spacing = 8;
        const searchSectionHeight = 49;
        const footerSectionHeight = 45;
        const separatorHeight = 2;
        const menuChromeHeight = searchSectionHeight + footerSectionHeight + separatorHeight;
        const maxVisibleListHeight = 360;
        const availableBelow = this.ownerWindow.innerHeight - rect.bottom - viewportPadding - spacing;
        const availableAbove = rect.top - viewportPadding - spacing;
        const listMaxHeight = Math.max(80, Math.min(maxVisibleListHeight, Math.max(availableBelow, availableAbove) - menuChromeHeight));
        const expectedMenuHeight = menuChromeHeight + listMaxHeight;
        let left: number;
        let top: number;

        if (this.preferredSide === 'left') {
            if (this.horizontalAnchorLeft === null) {
                const preferredLeft = rect.left - menuWidth - spacing;
                const fallbackLeft = rect.right + spacing;
                this.horizontalAnchorLeft = preferredLeft >= viewportPadding
                    ? preferredLeft
                    : Math.min(
                        Math.max(viewportPadding, fallbackLeft),
                        Math.max(viewportPadding, this.ownerWindow.innerWidth - menuWidth - viewportPadding)
                    );
            }
            left = Math.min(
                Math.max(viewportPadding, this.horizontalAnchorLeft),
                Math.max(viewportPadding, this.ownerWindow.innerWidth - menuWidth - viewportPadding)
            );
            top = Math.min(
                Math.max(viewportPadding, rect.top),
                Math.max(viewportPadding, this.ownerWindow.innerHeight - expectedMenuHeight - viewportPadding)
            );
        } else {
            left = Math.min(
                Math.max(viewportPadding, rect.left),
                Math.max(viewportPadding, this.ownerWindow.innerWidth - menuWidth - viewportPadding)
            );
            const shouldOpenAbove = availableBelow < expectedMenuHeight && availableAbove > availableBelow;
            top = shouldOpenAbove
                ? Math.max(viewportPadding, rect.top - Math.min(expectedMenuHeight, rect.top - viewportPadding) - spacing)
                : Math.min(this.ownerWindow.innerHeight - viewportPadding - Math.min(expectedMenuHeight, availableBelow + menuChromeHeight), rect.bottom + spacing);
        }

        this.menuEl.style.width = `${menuWidth}px`;
        this.menuEl.style.maxHeight = `${Math.max(140, this.ownerWindow.innerHeight - (viewportPadding * 2))}px`;
        this.menuEl.style.left = `${left}px`;
        this.menuEl.style.top = `${top}px`;
        this.listEl.style.maxHeight = `${listMaxHeight}px`;
    }

    private renderList(searchTerm = '') {
        this.listEl.empty();

        const normalizedSearch = searchTerm.trim().toLowerCase();
        this.filteredCategories = this.categories.filter(category =>
            !normalizedSearch
            || category.name.toLowerCase().includes(normalizedSearch)
            || this.plugin.getCategoryEmoji(category.id).includes(normalizedSearch)
        );

        if (this.filteredCategories.length > 0) {
            const selectedIndex = this.filteredCategories.findIndex(category => category.id === this.selectedCategoryId);
            if (selectedIndex >= 0 && (this.activeIndex < 0 || this.activeIndex >= this.filteredCategories.length || normalizedSearch)) {
                this.activeIndex = selectedIndex;
            } else if (this.activeIndex < 0 || this.activeIndex >= this.filteredCategories.length || normalizedSearch) {
                this.activeIndex = 0;
            }
        } else {
            this.activeIndex = -1;
        }

        if (this.filteredCategories.length === 0) {
            this.listEl.createDiv({
                text: 'No categories found',
                cls: 'expensica-category-quick-menu-empty'
            });
            return;
        }

        this.filteredCategories.forEach((category, index) => {
            const isSelected = this.selectedCategoryIds.has(category.id) || category.id === this.selectedCategoryId;
            const optionButton = this.listEl.createEl('button', {
                cls: 'expensica-category-quick-menu-item',
                attr: {
                    type: 'button',
                    role: 'option',
                    'aria-pressed': String(isSelected),
                    'aria-selected': String(index === this.activeIndex)
                }
            });

            if (isSelected || index === this.activeIndex) {
                optionButton.addClass('is-selected');
            }

            optionButton.createSpan({
                text: this.plugin.getCategoryEmoji(category.id),
                cls: 'expensica-category-quick-menu-item-emoji'
            });
            optionButton.createSpan({
                text: category.name,
                cls: 'expensica-category-quick-menu-item-label'
            });

            optionButton.addEventListener('click', () => {
                if (!this.listEl.contains(optionButton)) return;
                void this.selectCategory(category.id);
            });
        });

        this.ensureActiveItemVisible();
    }

    private moveActiveIndex(direction: 1 | -1) {
        if (this.filteredCategories.length === 0) {
            this.activeIndex = -1;
            return;
        }

        if (this.activeIndex < 0) {
            this.activeIndex = direction > 0 ? 0 : this.filteredCategories.length - 1;
        } else {
            this.activeIndex = (this.activeIndex + direction + this.filteredCategories.length) % this.filteredCategories.length;
        }

        this.renderList(this.searchInputEl.value);
    }

    private ensureActiveItemVisible() {
        if (this.activeIndex < 0) {
            return;
        }

        const activeOption = this.listEl.children.item(this.activeIndex) as HTMLElement | null;
        activeOption?.scrollIntoView({ block: 'nearest' });
    }

    private selecting = false;

    private async selectCategory(categoryId: string) {
        if (!this.isOpen()) return;
        if (this.closeOnSelect) {
            if (this.selecting) return;
            this.selecting = true;
            await this.plugin.runSaveOperation(this, 'Change transaction category', async () => {
                try {
                    if (!this.isOpen()) return false;
                    await this.onCategoryChange(categoryId);
                    this.close();
                } finally {
                    this.selecting = false;
                }
            });
            return;
        }

        if (this.selectedCategoryIds.has(categoryId)) {
            this.selectedCategoryIds.delete(categoryId);
        } else {
            this.selectedCategoryIds.add(categoryId);
        }

        try {
            await this.onCategoryChange(categoryId);
        } catch (error) {
            console.error('Expensica: Category change did not complete', error);
            showExpensicaNotice('Category could not be changed. Please try again.');
        } finally {
            if (this.isOpen()) {
                this.renderList(this.searchInputEl.value);
                this.searchInputEl.focus();
            }
        }
    }
}

class NewCategoryModal extends Modal {
    private readonly plugin: ExpensicaPlugin;
    private readonly categoryType: CategoryType;
    private readonly onSave: (categoryId: string) => void | Promise<void>;
    private focusFrame: number | null = null;

    constructor(app: App, plugin: ExpensicaPlugin, categoryType: CategoryType, onSave: (categoryId: string) => void | Promise<void>) {
        super(app);
        this.plugin = plugin;
        this.categoryType = categoryType;
        this.onSave = onSave;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('expensica-transaction-modal');
        contentEl.addClass('expensica-modal');

        const title = contentEl.createEl('h2', { cls: 'expensica-modal-title' });
        title.createSpan({ cls: 'expensica-modal-title-icon', text: '\u{1F3F7}\u{FE0F}' });
        title.appendText(` ${this.categoryType === CategoryType.INCOME ? 'New Income Category' : 'New Expense Category'}`);

        const form = contentEl.createEl('form', { cls: 'expensica-form' });
        const nameGroup = form.createDiv('expensica-form-group');
        nameGroup.createEl('label', {
            text: 'Name',
            cls: 'expensica-form-label',
            attr: { for: 'new-category-name' }
        });

        const nameRow = nameGroup.createDiv('expensica-category-name-row');
        const draftCategory: Category = {
            id: '__new_category__',
            name: '',
            type: this.categoryType
        };
        let selectedEmoji = getRandomEmoji(this.categoryType);
        let selectedColor = normalizeColorInputValue(getRandomColor());

        const colorButton = nameRow.createEl('button', {
            cls: 'expensica-standard-button expensica-category-color-button',
            attr: {
                type: 'button',
                id: 'new-category-color',
                'aria-label': 'Choose color'
            }
        });
        colorButton.style.setProperty('--expensica-category-button-color', selectedColor);
        colorButton.addEventListener('click', () => {
            new CategoryColorPaletteModal(this.app, selectedColor, (color) => {
                selectedColor = normalizeColorInputValue(color);
                colorButton.style.setProperty('--expensica-category-button-color', selectedColor);
            }).open();
        });

        const emojiButton = nameRow.createEl('button', {
            text: selectedEmoji,
            cls: 'expensica-standard-button expensica-category-picker-trigger expensica-category-modal-emoji-button',
            attr: {
                type: 'button',
                id: 'new-category-emoji',
                'aria-label': 'Choose emoji'
            }
        });
        emojiButton.addEventListener('click', () => {
            new EmojiPickerModal(this.app, draftCategory, selectedEmoji, (emoji) => {
                selectedEmoji = emoji;
                emojiButton.setText(emoji);
            }).open();
        });

        const nameInput = nameRow.createEl('input', {
            cls: 'expensica-form-input expensica-edit-field expensica-category-name-field',
            attr: {
                type: 'text',
                id: 'new-category-name',
                name: 'new-category-name',
                placeholder: 'Enter category name',
                required: 'required'
            }
        });

        const footer = form.createDiv('expensica-form-footer');
        const cancelButton = footer.createEl('button', {
            text: 'Cancel',
            cls: 'expensica-standard-button expensica-btn expensica-btn-secondary',
            attr: { type: 'button' }
        });
        footer.createEl('button', {
            text: 'Save',
            cls: 'expensica-standard-button expensica-btn expensica-btn-primary',
            attr: { type: 'submit' }
        });

        cancelButton.addEventListener('click', () => {
            this.close();
        });

        form.addEventListener('submit', (event: SubmitEvent) => {
            event.preventDefault();
            void this.submitForm(nameInput, () => selectedEmoji, () => selectedColor);
        });

        const ownerWindow = contentEl.ownerDocument.defaultView;
        if (ownerWindow) {
            const frame = ownerWindow.requestAnimationFrame(() => {
                if (this.focusFrame !== frame) return;
                this.focusFrame = null;
                if (nameInput.isConnected) nameInput.focus();
            });
            this.focusFrame = frame;
        }
    }

    private async submitForm(nameInput: HTMLInputElement, getEmoji: () => string, getColor: () => string): Promise<void> {
        const normalizedName = this.plugin.normalizeCategoryName(nameInput.value.trim()).name.trim();
        if (!normalizedName) {
            showExpensicaNotice('Category name is required.');
            return;
        }

        const duplicate = this.plugin.getCategories(this.categoryType).find(category =>
            this.plugin.normalizeCategoryName(category.name).name.toLowerCase() === normalizedName.toLowerCase()
        );
        if (duplicate) {
            showExpensicaNotice(`Category "${normalizedName}" already exists.`);
            return;
        }

        try {
            const categoryId = createCategoryId(normalizedName, this.plugin, this.categoryType);
            if (this.categoryType === CategoryType.INCOME) {
                await this.plugin.addIncomeCategory({
                    id: categoryId,
                    name: normalizedName
                });
            } else {
                await this.plugin.addExpenseCategory({
                    id: categoryId,
                    name: normalizedName
                });
            }
            await this.plugin.updateCategoryEmoji(categoryId, getEmoji());
            await this.plugin.updateCategoryColor(categoryId, getColor());
            await this.onSave(categoryId);
            this.close();
        } catch (error) {
            console.error('Expensica: New category did not save', error);
            showExpensicaNotice('Category could not be saved. Please try again.');
        }
    }

    onClose() {
        if (this.focusFrame !== null) {
            this.contentEl.ownerDocument.defaultView?.cancelAnimationFrame(this.focusFrame);
            this.focusFrame = null;
        }
        this.contentEl.empty();
    }
}

class CategoryColorPaletteModal extends Modal {
    private readonly currentColor: string;
    private readonly onSelect: (color: string) => void;

    constructor(app: App, currentColor: string, onSelect: (color: string) => void) {
        super(app);
        this.currentColor = currentColor;
        this.onSelect = onSelect;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('expensica-category-color-palette-dialog');
        contentEl.addClass('expensica-category-color-palette-modal');

        const grid = contentEl.createDiv('expensica-category-color-palette-grid');
        ColorPalette.colors.forEach(color => {
            const normalizedColor = color.slice(0, 7);
            const swatch = grid.createEl('button', {
                cls: 'expensica-category-color-swatch',
                attr: {
                    type: 'button',
                    'aria-label': `Select color ${normalizedColor}`
                }
            });
            swatch.style.backgroundColor = normalizedColor;
            if (normalizedColor.toLowerCase() === this.currentColor.toLowerCase()) {
                swatch.addClass('is-selected');
            }

            swatch.addEventListener('click', () => {
                this.onSelect(normalizedColor);
                this.close();
            });
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}

function getRandomColor(): string {
    return ColorPalette.colors[Math.floor(Math.random() * ColorPalette.colors.length)].slice(0, 7);
}

function getRandomEmoji(type: CategoryType): string {
    const emojis = getCommonCategoryEmojis(type);
    return emojis[Math.floor(Math.random() * emojis.length)] || '\u{1F3F7}\u{FE0F}';
}

function createCategoryId(name: string, plugin: ExpensicaPlugin, type: CategoryType): string {
    const baseId = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        || 'category';
    const existingIds = new Set(plugin.getCategories(type).map(category => category.id));

    if (!existingIds.has(baseId)) {
        return baseId;
    }

    let suffix = 2;
    while (existingIds.has(`${baseId}_${suffix}`)) {
        suffix += 1;
    }

    return `${baseId}_${suffix}`;
}

function normalizeColorInputValue(color: string): string {
    if (/^#[0-9a-f]{6}$/i.test(color)) {
        return color;
    }

    if (/^#[0-9a-f]{3}$/i.test(color)) {
        return `#${color.slice(1).split('').map(char => `${char}${char}`).join('')}`;
    }

    const probe = document.body.createDiv();
    probe.style.color = color;
    const computed = getComputedStyle(probe).color;
    probe.remove();

    const match = computed.match(/\d+/g);
    if (!match || match.length < 3) {
        return '#000000';
    }

    return `#${match.slice(0, 3).map(value => Number(value).toString(16).padStart(2, '0')).join('')}`;
}
