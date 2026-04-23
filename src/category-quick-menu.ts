import { App, Modal } from 'obsidian';
import { Category, CategoryType, ColorPalette, getCommonCategoryEmojis, INTERNAL_CATEGORY_ID } from './models';
import type ExpensicaPlugin from '../main';
import { EmojiPickerModal } from './emoji-picker-modal';
import { showExpensicaNotice } from './notice';

let activeQuickMenu: CategoryQuickMenu | null = null;

export function showCategoryQuickMenu(
    target: HTMLElement,
    plugin: ExpensicaPlugin,
    categoryType: CategoryType,
    onCategoryChange: (categoryId: string) => void | Promise<void>,
    selectedCategoryId?: string
) {
    activeQuickMenu?.close();
    activeQuickMenu = new CategoryQuickMenu(target, plugin, categoryType, onCategoryChange, selectedCategoryId);
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
    private readonly hostEl: HTMLElement;
    private readonly boundHandleDocumentPointerDown: (event: MouseEvent) => void;
    private readonly boundHandleDocumentKeydown: (event: KeyboardEvent) => void;

    constructor(
        target: HTMLElement,
        plugin: ExpensicaPlugin,
        categoryType: CategoryType,
        onCategoryChange: (categoryId: string) => void | Promise<void>,
        selectedCategoryId?: string
    ) {
        this.target = target;
        this.plugin = plugin;
        this.categoryType = categoryType;
        this.onCategoryChange = onCategoryChange;
        this.selectedCategoryId = selectedCategoryId;
        this.categories = plugin.getCategories(categoryType).filter(category => category.id !== INTERNAL_CATEGORY_ID);
        this.hostEl = (target.closest('.modal-content') as HTMLElement | null) || document.body;
        this.boundHandleDocumentPointerDown = this.handleDocumentPointerDown.bind(this);
        this.boundHandleDocumentKeydown = this.handleDocumentKeydown.bind(this);

        this.menuEl = document.createElement('div');
        this.menuEl.className = 'expensica-category-quick-menu';
        this.menuEl.setAttribute('role', 'menu');

        const searchSection = this.menuEl.createDiv('expensica-category-quick-menu-section');
        const searchWrap = searchSection.createDiv('expensica-category-quick-menu-search');
        this.searchInputEl = searchWrap.createEl('input', {
            cls: 'expensica-form-input expensica-category-quick-menu-search-input',
            attr: {
                type: 'search',
                placeholder: 'Search categories',
                'aria-label': 'Search categories'
            }
        });

        this.listEl = this.menuEl.createDiv('expensica-category-quick-menu-section expensica-category-quick-menu-list');

        const footerSection = this.menuEl.createDiv('expensica-category-quick-menu-section');
        const newCategoryButton = footerSection.createEl('button', {
            cls: 'expensica-category-quick-menu-new-button',
            attr: {
                type: 'button'
            }
        });
        newCategoryButton.innerHTML = '<span class="expensica-category-quick-menu-new-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg></span><span class="expensica-category-quick-menu-new-label">New Category</span>';
        newCategoryButton.addEventListener('click', () => {
            this.close();
            new NewCategoryModal(this.plugin.app, this.plugin, this.categoryType, async (categoryId) => {
                await this.onCategoryChange(categoryId);
            }).open();
        });

        this.searchInputEl.addEventListener('input', () => {
            this.renderList(this.searchInputEl.value);
        });
    }

    open() {
        this.hostEl.appendChild(this.menuEl);
        this.renderList();
        this.position();

        requestAnimationFrame(() => {
            this.searchInputEl.focus();
            this.searchInputEl.select();
        });

        document.addEventListener('mousedown', this.boundHandleDocumentPointerDown, true);
        document.addEventListener('keydown', this.boundHandleDocumentKeydown, true);
        window.addEventListener('resize', this.boundReposition, true);
        document.addEventListener('scroll', this.boundReposition, true);
    }

    close() {
        window.removeEventListener('resize', this.boundReposition, true);
        document.removeEventListener('scroll', this.boundReposition, true);
        document.removeEventListener('mousedown', this.boundHandleDocumentPointerDown, true);
        document.removeEventListener('keydown', this.boundHandleDocumentKeydown, true);
        this.menuEl.remove();
        if (activeQuickMenu === this) {
            activeQuickMenu = null;
        }
    }

    private readonly boundReposition = () => {
        if (!this.menuEl.isConnected) {
            return;
        }

        this.position();
    };

    private handleDocumentPointerDown(event: MouseEvent) {
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
        if (event.key !== 'Escape') {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.close();
    }

    private position() {
        const rect = this.target.getBoundingClientRect();
        const viewportPadding = 12;
        const preferredWidth = 280;
        const availableWidth = Math.max(220, window.innerWidth - (viewportPadding * 2));
        const menuWidth = Math.min(preferredWidth, availableWidth);
        const spacing = 8;
        const searchSectionHeight = 49;
        const footerSectionHeight = 45;
        const separatorHeight = 2;
        const menuChromeHeight = searchSectionHeight + footerSectionHeight + separatorHeight;
        const maxVisibleListHeight = 360;
        const availableBelow = window.innerHeight - rect.bottom - viewportPadding - spacing;
        const availableAbove = rect.top - viewportPadding - spacing;
        const listMaxHeight = Math.max(80, Math.min(maxVisibleListHeight, Math.max(availableBelow, availableAbove) - menuChromeHeight));
        const expectedMenuHeight = menuChromeHeight + listMaxHeight;
        const left = Math.min(
            Math.max(viewportPadding, rect.left),
            Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding)
        );
        const shouldOpenAbove = availableBelow < expectedMenuHeight && availableAbove > availableBelow;
        const top = shouldOpenAbove
            ? Math.max(viewportPadding, rect.top - Math.min(expectedMenuHeight, rect.top - viewportPadding) - spacing)
            : Math.min(window.innerHeight - viewportPadding - Math.min(expectedMenuHeight, availableBelow + menuChromeHeight), rect.bottom + spacing);

        this.menuEl.style.width = `${menuWidth}px`;
        this.menuEl.style.maxHeight = `${Math.max(140, window.innerHeight - (viewportPadding * 2))}px`;
        this.menuEl.style.left = `${left}px`;
        this.menuEl.style.top = `${top}px`;
        this.listEl.style.maxHeight = `${listMaxHeight}px`;
    }

    private renderList(searchTerm = '') {
        this.listEl.empty();

        const normalizedSearch = searchTerm.trim().toLowerCase();
        const filteredCategories = this.categories.filter(category =>
            !normalizedSearch
            || category.name.toLowerCase().includes(normalizedSearch)
            || this.plugin.getCategoryEmoji(category.id).includes(normalizedSearch)
        );

        if (filteredCategories.length === 0) {
            this.listEl.createDiv({
                text: 'No categories found',
                cls: 'expensica-category-quick-menu-empty'
            });
            return;
        }

        filteredCategories.forEach(category => {
            const optionButton = this.listEl.createEl('button', {
                cls: 'expensica-category-quick-menu-item',
                attr: {
                    type: 'button',
                    'aria-pressed': String(category.id === this.selectedCategoryId)
                }
            });

            if (category.id === this.selectedCategoryId) {
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
                this.close();
                void this.onCategoryChange(category.id);
            });
        });
    }
}

class NewCategoryModal extends Modal {
    private readonly plugin: ExpensicaPlugin;
    private readonly categoryType: CategoryType;
    private readonly onSave: (categoryId: string) => void | Promise<void>;

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
        title.innerHTML = `<span class="expensica-modal-title-icon">\u{1F3F7}\u{FE0F}</span> ${this.categoryType === CategoryType.INCOME ? 'New Income Category' : 'New Expense Category'}`;

        const form = contentEl.createEl('form', { cls: 'expensica-form' });
        const nameGroup = form.createDiv('expensica-form-group');
        nameGroup.createEl('label', {
            text: 'Name',
            cls: 'expensica-form-label',
            attr: { for: 'new-category-name' }
        });

        const nameRow = nameGroup.createDiv('expensica-category-name-row');
        const draftCategory = {
            id: '__new_category__',
            name: '',
            type: this.categoryType
        } as Category;
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

        form.addEventListener('submit', async (event: SubmitEvent) => {
            event.preventDefault();

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
            await this.plugin.updateCategoryEmoji(categoryId, selectedEmoji);
            await this.plugin.updateCategoryColor(categoryId, selectedColor);
            await this.onSave(categoryId);
            this.close();
        });

        requestAnimationFrame(() => {
            nameInput.focus();
        });
    }

    onClose() {
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

    const probe = document.createElement('div');
    probe.style.color = color;
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();

    const match = computed.match(/\d+/g);
    if (!match || match.length < 3) {
        return '#000000';
    }

    return `#${match.slice(0, 3).map(value => Number(value).toString(16).padStart(2, '0')).join('')}`;
}
