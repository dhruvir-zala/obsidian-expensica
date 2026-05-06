import { __awaiter } from "tslib";
import { Modal } from 'obsidian';
import { CategoryType, ColorPalette, getCommonCategoryEmojis, INTERNAL_CATEGORY_ID } from './models';
import { EmojiPickerModal } from './emoji-picker-modal';
import { showExpensicaNotice } from './notice';
let activeQuickMenu = null;
export function showCategoryQuickMenu(target, plugin, categoryType, onCategoryChange, selectedCategoryId) {
    activeQuickMenu === null || activeQuickMenu === void 0 ? void 0 : activeQuickMenu.close();
    activeQuickMenu = new CategoryQuickMenu(target, plugin, categoryType, onCategoryChange, selectedCategoryId);
    activeQuickMenu.open();
}
class CategoryQuickMenu {
    constructor(target, plugin, categoryType, onCategoryChange, selectedCategoryId) {
        this.boundReposition = () => {
            if (!this.menuEl.isConnected) {
                return;
            }
            this.position();
        };
        this.target = target;
        this.plugin = plugin;
        this.categoryType = categoryType;
        this.onCategoryChange = onCategoryChange;
        this.selectedCategoryId = selectedCategoryId;
        this.categories = plugin.getCategories(categoryType)
            .filter(category => category.id !== INTERNAL_CATEGORY_ID)
            .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
        this.hostEl = target.closest('.modal-content') || document.body;
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
            new NewCategoryModal(this.plugin.app, this.plugin, this.categoryType, (categoryId) => __awaiter(this, void 0, void 0, function* () {
                yield this.onCategoryChange(categoryId);
            })).open();
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
    handleDocumentPointerDown(event) {
        const target = event.target;
        if (!target) {
            return;
        }
        if (this.menuEl.contains(target) || this.target.contains(target)) {
            return;
        }
        this.close();
    }
    handleDocumentKeydown(event) {
        if (event.key !== 'Escape') {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.close();
    }
    position() {
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
        const left = Math.min(Math.max(viewportPadding, rect.left), Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding));
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
    renderList(searchTerm = '') {
        this.listEl.empty();
        const normalizedSearch = searchTerm.trim().toLowerCase();
        const filteredCategories = this.categories.filter(category => !normalizedSearch
            || category.name.toLowerCase().includes(normalizedSearch)
            || this.plugin.getCategoryEmoji(category.id).includes(normalizedSearch));
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
    constructor(app, plugin, categoryType, onSave) {
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
        form.addEventListener('submit', (event) => __awaiter(this, void 0, void 0, function* () {
            event.preventDefault();
            const normalizedName = this.plugin.normalizeCategoryName(nameInput.value.trim()).name.trim();
            if (!normalizedName) {
                showExpensicaNotice('Category name is required.');
                return;
            }
            const duplicate = this.plugin.getCategories(this.categoryType).find(category => this.plugin.normalizeCategoryName(category.name).name.toLowerCase() === normalizedName.toLowerCase());
            if (duplicate) {
                showExpensicaNotice(`Category "${normalizedName}" already exists.`);
                return;
            }
            const categoryId = createCategoryId(normalizedName, this.plugin, this.categoryType);
            if (this.categoryType === CategoryType.INCOME) {
                yield this.plugin.addIncomeCategory({
                    id: categoryId,
                    name: normalizedName
                });
            }
            else {
                yield this.plugin.addExpenseCategory({
                    id: categoryId,
                    name: normalizedName
                });
            }
            yield this.plugin.updateCategoryEmoji(categoryId, selectedEmoji);
            yield this.plugin.updateCategoryColor(categoryId, selectedColor);
            yield this.onSave(categoryId);
            this.close();
        }));
        requestAnimationFrame(() => {
            nameInput.focus();
        });
    }
    onClose() {
        this.contentEl.empty();
    }
}
class CategoryColorPaletteModal extends Modal {
    constructor(app, currentColor, onSelect) {
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
function getRandomColor() {
    return ColorPalette.colors[Math.floor(Math.random() * ColorPalette.colors.length)].slice(0, 7);
}
function getRandomEmoji(type) {
    const emojis = getCommonCategoryEmojis(type);
    return emojis[Math.floor(Math.random() * emojis.length)] || '\u{1F3F7}\u{FE0F}';
}
function createCategoryId(name, plugin, type) {
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
function normalizeColorInputValue(color) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2F0ZWdvcnktcXVpY2stbWVudS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNhdGVnb3J5LXF1aWNrLW1lbnUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLE9BQU8sRUFBTyxLQUFLLEVBQUUsTUFBTSxVQUFVLENBQUM7QUFDdEMsT0FBTyxFQUFZLFlBQVksRUFBRSxZQUFZLEVBQUUsdUJBQXVCLEVBQUUsb0JBQW9CLEVBQUUsTUFBTSxVQUFVLENBQUM7QUFFL0csT0FBTyxFQUFFLGdCQUFnQixFQUFFLE1BQU0sc0JBQXNCLENBQUM7QUFDeEQsT0FBTyxFQUFFLG1CQUFtQixFQUFFLE1BQU0sVUFBVSxDQUFDO0FBRS9DLElBQUksZUFBZSxHQUE2QixJQUFJLENBQUM7QUFFckQsTUFBTSxVQUFVLHFCQUFxQixDQUNqQyxNQUFtQixFQUNuQixNQUF1QixFQUN2QixZQUEwQixFQUMxQixnQkFBOEQsRUFDOUQsa0JBQTJCO0lBRTNCLGVBQWUsYUFBZixlQUFlLHVCQUFmLGVBQWUsQ0FBRSxLQUFLLEVBQUUsQ0FBQztJQUN6QixlQUFlLEdBQUcsSUFBSSxpQkFBaUIsQ0FBQyxNQUFNLEVBQUUsTUFBTSxFQUFFLFlBQVksRUFBRSxnQkFBZ0IsRUFBRSxrQkFBa0IsQ0FBQyxDQUFDO0lBQzVHLGVBQWUsQ0FBQyxJQUFJLEVBQUUsQ0FBQztBQUMzQixDQUFDO0FBRUQsTUFBTSxpQkFBaUI7SUFjbkIsWUFDSSxNQUFtQixFQUNuQixNQUF1QixFQUN2QixZQUEwQixFQUMxQixnQkFBOEQsRUFDOUQsa0JBQTJCO1FBOEVkLG9CQUFlLEdBQUcsR0FBRyxFQUFFO1lBQ3BDLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVcsRUFBRTtnQkFDMUIsT0FBTzthQUNWO1lBRUQsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1FBQ3BCLENBQUMsQ0FBQztRQWxGRSxJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQztRQUNyQixJQUFJLENBQUMs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QUFDLEVBQUUsQ0FBQyxFQUFFLENBQUM7QUFDdEcsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFwcCwgTW9kYWwgfSBmcm9tICdvYnNpZGlhbic7XG5pbXBvcnQgeyBDYXRlZ29yeSwgQ2F0ZWdvcnlUeXBlLCBDb2xvclBhbGV0dGUsIGdldENvbW1vbkNhdGVnb3J5RW1vamlzLCBJTlRFUk5BTF9DQVRFR09SWV9JRCB9IGZyb20gJy4vbW9kZWxzJztcbmltcG9ydCB0eXBlIEV4cGVuc2ljYVBsdWdpbiBmcm9tICcuLi9tYWluJztcbmltcG9ydCB7IEVtb2ppUGlja2VyTW9kYWwgfSBmcm9tICcuL2Vtb2ppLXBpY2tlci1tb2RhbCc7XG5pbXBvcnQgeyBzaG93RXhwZW5zaWNhTm90aWNlIH0gZnJvbSAnLi9ub3RpY2UnO1xuXG5sZXQgYWN0aXZlUXVpY2tNZW51OiBDYXRlZ29yeVF1aWNrTWVudSB8IG51bGwgPSBudWxsO1xuXG5leHBvcnQgZnVuY3Rpb24gc2hvd0NhdGVnb3J5UXVpY2tNZW51KFxuICAgIHRhcmdldDogSFRNTEVsZW1lbnQsXG4gICAgcGx1Z2luOiBFeHBlbnNpY2FQbHVnaW4sXG4gICAgY2F0ZWdvcnlUeXBlOiBDYXRlZ29yeVR5cGUsXG4gICAgb25DYXRlZ29yeUNoYW5nZTogKGNhdGVnb3J5SWQ6IHN0cmluZykgPT4gdm9pZCB8IFByb21pc2U8dm9pZD4sXG4gICAgc2VsZWN0ZWRDYXRlZ29yeUlkPzogc3RyaW5nXG4pIHtcbiAgICBhY3RpdmVRdWlja01lbnU/LmNsb3NlKCk7XG4gICAgYWN0aXZlUXVpY2tNZW51ID0gbmV3IENhdGVnb3J5UXVpY2tNZW51KHRhcmdldCwgcGx1Z2luLCBjYXRlZ29yeVR5cGUsIG9uQ2F0ZWdvcnlDaGFuZ2UsIHNlbGVjdGVkQ2F0ZWdvcnlJZCk7XG4gICAgYWN0aXZlUXVpY2tNZW51Lm9wZW4oKTtcbn1cblxuY2xhc3MgQ2F0ZWdvcnlRdWlja01lbnUge1xuICAgIHByaXZhdGUgcmVhZG9ubHkgbWVudUVsOiBIVE1MRGl2RWxlbWVudDtcbiAgICBwcml2YXRlIHJlYWRvbmx5IHNlYXJjaElucHV0RWw6IEhUTUxJbnB1dEVsZW1lbnQ7XG4gICAgcHJpdmF0ZSByZWFkb25seSBsaXN0RWw6IEhUTUxEaXZFbGVtZW50O1xuICAgIHByaXZhdGUgcmVhZG9ubHkgdGFyZ2V0OiBIVE1MRWxlbWVudDtcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbjogRXhwZW5zaWNhUGx1Z2luO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgY2F0ZWdvcnlUeXBlOiBDYXRlZ29yeVR5cGU7XG4gICAgcHJpdmF0ZSByZWFkb25seSBvbkNhdGVnb3J5Q2hhbmdlOiAoY2F0ZWdvcnlJZDogc3RyaW5nKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPjtcbiAgICBwcml2YXRlIHJlYWRvbmx5IHNlbGVjdGVkQ2F0ZWdvcnlJZD86IHN0cmluZztcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNhdGVnb3JpZXM6IENhdGVnb3J5W107XG4gICAgcHJpdmF0ZSByZWFkb25seSBob3N0RWw6IEhUTUxFbGVtZW50O1xuICAgIHByaXZhdGUgcmVhZG9ubHkgYm91bmRIYW5kbGVEb2N1bWVudFBvaW50ZXJEb3duOiAoZXZlbnQ6IE1vdXNlRXZlbnQpID0+IHZvaWQ7XG4gICAgcHJpdmF0ZSByZWFkb25seSBib3VuZEhhbmRsZURvY3VtZW50S2V5ZG93bjogKGV2ZW50OiBLZXlib2FyZEV2ZW50KSA9PiB2b2lkO1xuXG4gICAgY29uc3RydWN0b3IoXG4gICAgICAgIHRhcmdldDogSFRNTEVsZW1lbnQsXG4gICAgICAgIHBsdWdpbjogRXhwZW5zaWNhUGx1Z2luLFxuICAgICAgICBjYXRlZ29yeVR5cGU6IENhdGVnb3J5VHlwZSxcbiAgICAgICAgb25DYXRlZ29yeUNoYW5nZTogKGNhdGVnb3J5SWQ6IHN0cmluZykgPT4gdm9pZCB8IFByb21pc2U8dm9pZD4sXG4gICAgICAgIHNlbGVjdGVkQ2F0ZWdvcnlJZD86IHN0cmluZ1xuICAgICkge1xuICAgICAgICB0aGlzLnRhcmdldCA9IHRhcmdldDtcbiAgICAgICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gICAgICAgIHRoaXMuY2F0ZWdvcnlUeXBlID0gY2F0ZWdvcnlUeXBlO1xuICAgICAgICB0aGlzLm9uQ2F0ZWdvcnlDaGFuZ2UgPSBvbkNhdGVnb3J5Q2hhbmdlO1xuICAgICAgICB0aGlzLnNlbGVjdGVkQ2F0ZWdvcnlJZCA9IHNlbGVjdGVkQ2F0ZWdvcnlJZDtcbiAgICAgICAgdGhpcy5jYXRlZ29yaWVzID0gcGx1Z2luLmdldENhdGVnb3JpZXMoY2F0ZWdvcnlUeXBlKVxuICAgICAgICAgICAgLmZpbHRlcihjYXRlZ29yeSA9PiBjYXRlZ29yeS5pZCAhPT0gSU5URVJOQUxfQ0FURUdPUllfSUQpXG4gICAgICAgICAgICAuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQubmFtZS5sb2NhbGVDb21wYXJlKHJpZ2h0Lm5hbWUsIHVuZGVmaW5lZCwgeyBzZW5zaXRpdml0eTogJ2Jhc2UnIH0pKTtcbiAgICAgICAgdGhpcy5ob3N0RWwgPSAodGFyZ2V0LmNsb3Nlc3QoJy5tb2RhbC1jb250ZW50JykgYXMgSFRNTEVsZW1lbnQgfCBudWxsKSB8fCBkb2N1bWVudC5ib2R5O1xuICAgICAgICB0aGlzLmJvdW5kSGFuZGxlRG9jdW1lbnRQb2ludGVyRG93biA9IHRoaXMuaGFuZGxlRG9jdW1lbnRQb2ludGVyRG93bi5iaW5kKHRoaXMpO1xuICAgICAgICB0aGlzLmJvdW5kSGFuZGxlRG9jdW1lbnRLZXlkb3duID0gdGhpcy5oYW5kbGVEb2N1bWVudEtleWRvd24uYmluZCh0aGlzKTtcblxuICAgICAgICB0aGlzLm1lbnVFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICAgICAgICB0aGlzLm1lbnVFbC5jbGFzc05hbWUgPSAnZXhwZW5zaWNhLWNhdGVnb3J5LXF1aWNrLW1lbnUnO1xuICAgICAgICB0aGlzLm1lbnVFbC5zZXRBdHRyaWJ1dGUoJ3JvbGUnLCAnbWVudScpO1xuXG4gICAgICAgIGNvbnN0IHNlYXJjaFNlY3Rpb24gPSB0aGlzLm1lbnVFbC5jcmVhdGVEaXYoJ2V4cGVuc2ljYS1jYXRlZ29yeS1xdWljay1tZW51LXNlY3Rpb24nKTtcbiAgICAgICAgY29uc3Qgc2VhcmNoV3JhcCA9IHNlYXJjaFNlY3Rpb24uY3JlYXRlRGl2KCdleHBlbnNpY2EtY2F0ZWdvcnktcXVpY2stbWVudS1zZWFyY2gnKTtcbiAgICAgICAgdGhpcy5zZWFyY2hJbnB1dEVsID0gc2VhcmNoV3JhcC5jcmVhdGVFbCgnaW5wdXQnLCB7XG4gICAgICAgICAgICBjbHM6ICdleHBlbnNpY2EtZm9ybS1pbnB1dCBleHBlbnNpY2EtY2F0ZWdvcnktcXVpY2stbWVudS1zZWFyY2gtaW5wdXQnLFxuICAgICAgICAgICAgYXR0cjoge1xuICAgICAgICAgICAgICAgIHR5cGU6ICdzZWFyY2gnLFxuICAgICAgICAgICAgICAgIHBsYWNlaG9sZGVyOiAnU2VhcmNoIGNhdGVnb3JpZXMnLFxuICAgICAgICAgICAgICAgICdhcmlhLWxhYmVsJzogJ1NlYXJjaCBjYXRlZ29yaWVzJ1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmxpc3RFbCA9IHRoaXMubWVudUVsLmNyZWF0ZURpdignZXhwZW5zaWNhLWNhdGVnb3J5LXF1aWNrLW1lbnUtc2VjdGlvbiBleHBlbnNpY2EtY2F0ZWdvcnktcXVpY2stbWVudS1saXN0Jyk7XG5cbiAgICAgICAgY29uc3QgZm9vdGVyU2VjdGlvbiA9IHRoaXMubWVudUVsLmNyZWF0ZURpdignZXhwZW5zaWNhLWNhdGVnb3J5LXF1aWNrLW1lbnUtc2VjdGlvbicpO1xuICAgICAgICBjb25zdCBuZXdDYXRlZ29yeUJ1dHRvbiA9IGZvb3RlclNlY3Rpb24uY3JlYXRlRWwoJ2J1dHRvbicsIHtcbiAgICAgICAgICAgIGNsczogJ2V4cGVuc2ljYS1jYXRlZ29yeS1xdWljay1tZW51LW5ldy1idXR0b24nLFxuICAgICAgICAgICAgYXR0cjoge1xuICAgICAgICAgICAgICAgIHR5cGU6ICdidXR0b24nXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBuZXdDYXRlZ29yeUJ1dHRvbi5pbm5lckhUTUwgPSAnPHNwYW4gY2xhc3M9XCJleHBlbnNpY2EtY2F0ZWdvcnktcXVpY2stbWVudS1uZXctaWNvblwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPjxzdmcgeG1sbnM9XCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiIHdpZHRoPVwiMTRcIiBoZWlnaHQ9XCIxNFwiIHZpZXdCb3g9XCIwIDAgMjQgMjRcIiBmaWxsPVwibm9uZVwiIHN0cm9rZT1cImN1cnJlbnRDb2xvclwiIHN0cm9rZS13aWR0aD1cIjIuMlwiIHN0cm9rZS1saW5lY2FwPVwicm91bmRcIiBzdHJva2UtbGluZWpvaW49XCJyb3VuZFwiPjxwYXRoIGQ9XCJNMTIgNXYxNFwiPjwvcGF0aD48cGF0aCBkPVwiTTUgMTJoMTRcIj48L3BhdGg+PC9zdmc+PC9zcGFuPjxzcGFuIGNsYXNzPVwiZXhwZW5zaWNhLWNhdGVnb3J5LXF1aWNrLW1lbnUtbmV3LWxhYmVsXCI+TmV3IENhdGVnb3J5PC9zcGFuPic7XG4gICAgICAgIG5ld0NhdGVnb3J5QnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICAgICAgbmV3IE5ld0NhdGVnb3J5TW9kYWwodGhpcy5wbHVnaW4uYXBwLCB0aGlzLnBsdWdpbiwgdGhpcy5jYXRlZ29yeVR5cGUsIGFzeW5jIChjYXRlZ29yeUlkKSA9PiB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5vbkNhdGVnb3J5Q2hhbmdlKGNhdGVnb3J5SWQpO1xuICAgICAgICAgICAgfSkub3BlbigpO1xuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLnNlYXJjaElucHV0RWwuYWRkRXZlbnRMaXN0ZW5lcignaW5wdXQnLCAoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnJlbmRlckxpc3QodGhpcy5zZWFyY2hJbnB1dEVsLnZhbHVlKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgb3BlbigpIHtcbiAgICAgICAgdGhpcy5ob3N0RWwuYXBwZW5kQ2hpbGQodGhpcy5tZW51RWwpO1xuICAgICAgICB0aGlzLnJlbmRlckxpc3QoKTtcbiAgICAgICAgdGhpcy5wb3NpdGlvbigpO1xuXG4gICAgICAgIHJlcXVlc3RBbmltYXRpb25GcmFtZSgoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnNlYXJjaElucHV0RWwuZm9jdXMoKTtcbiAgICAgICAgICAgIHRoaXMuc2VhcmNoSW5wdXRFbC5zZWxlY3QoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignbW91c2Vkb3duJywgdGhpcy5ib3VuZEhhbmRsZURvY3VtZW50UG9pbnRlckRvd24sIHRydWUpO1xuICAgICAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCdrZXlkb3duJywgdGhpcy5ib3VuZEhhbmRsZURvY3VtZW50S2V5ZG93biwgdHJ1ZSk7XG4gICAgICAgIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdyZXNpemUnLCB0aGlzLmJvdW5kUmVwb3NpdGlvbiwgdHJ1ZSk7XG4gICAgICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ3Njcm9sbCcsIHRoaXMuYm91bmRSZXBvc2l0aW9uLCB0cnVlKTtcbiAgICB9XG5cbiAgICBjbG9zZSgpIHtcbiAgICAgICAgd2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIHRoaXMuYm91bmRSZXBvc2l0aW9uLCB0cnVlKTtcbiAgICAgICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcignc2Nyb2xsJywgdGhpcy5ib3VuZFJlcG9zaXRpb24sIHRydWUpO1xuICAgICAgICBkb2N1bWVudC5yZW1vdmVFdmVudExpc3RlbmVyKCdtb3VzZWRvd24nLCB0aGlzLmJvdW5kSGFuZGxlRG9jdW1lbnRQb2ludGVyRG93biwgdHJ1ZSk7XG4gICAgICAgIGRvY3VtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCB0aGlzLmJvdW5kSGFuZGxlRG9jdW1lbnRLZXlkb3duLCB0cnVlKTtcbiAgICAgICAgdGhpcy5tZW51RWwucmVtb3ZlKCk7XG4gICAgICAgIGlmIChhY3RpdmVRdWlja01lbnUgPT09IHRoaXMpIHtcbiAgICAgICAgICAgIGFjdGl2ZVF1aWNrTWVudSA9IG51bGw7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGJvdW5kUmVwb3NpdGlvbiA9ICgpID0+IHtcbiAgICAgICAgaWYgKCF0aGlzLm1lbnVFbC5pc0Nvbm5lY3RlZCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5wb3NpdGlvbigpO1xuICAgIH07XG5cbiAgICBwcml2YXRlIGhhbmRsZURvY3VtZW50UG9pbnRlckRvd24oZXZlbnQ6IE1vdXNlRXZlbnQpIHtcbiAgICAgICAgY29uc3QgdGFyZ2V0ID0gZXZlbnQudGFyZ2V0IGFzIE5vZGUgfCBudWxsO1xuICAgICAgICBpZiAoIXRhcmdldCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRoaXMubWVudUVsLmNvbnRhaW5zKHRhcmdldCkgfHwgdGhpcy50YXJnZXQuY29udGFpbnModGFyZ2V0KSkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgIH1cblxuICAgIHByaXZhdGUgaGFuZGxlRG9jdW1lbnRLZXlkb3duKGV2ZW50OiBLZXlib2FyZEV2ZW50KSB7XG4gICAgICAgIGlmIChldmVudC5rZXkgIT09ICdFc2NhcGUnKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgIH1cblxuICAgIHByaXZhdGUgcG9zaXRpb24oKSB7XG4gICAgICAgIGNvbnN0IHJlY3QgPSB0aGlzLnRhcmdldC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgICAgY29uc3Qgdmlld3BvcnRQYWRkaW5nID0gMTI7XG4gICAgICAgIGNvbnN0IHByZWZlcnJlZFdpZHRoID0gMjgwO1xuICAgICAgICBjb25zdCBhdmFpbGFibGVXaWR0aCA9IE1hdGgubWF4KDIyMCwgd2luZG93LmlubmVyV2lkdGggLSAodmlld3BvcnRQYWRkaW5nICogMikpO1xuICAgICAgICBjb25zdCBtZW51V2lkdGggPSBNYXRoLm1pbihwcmVmZXJyZWRXaWR0aCwgYXZhaWxhYmxlV2lkdGgpO1xuICAgICAgICBjb25zdCBzcGFjaW5nID0gODtcbiAgICAgICAgY29uc3Qgc2VhcmNoU2VjdGlvbkhlaWdodCA9IDQ5O1xuICAgICAgICBjb25zdCBmb290ZXJTZWN0aW9uSGVpZ2h0ID0gNDU7XG4gICAgICAgIGNvbnN0IHNlcGFyYXRvckhlaWdodCA9IDI7XG4gICAgICAgIGNvbnN0IG1lbnVDaHJvbWVIZWlnaHQgPSBzZWFyY2hTZWN0aW9uSGVpZ2h0ICsgZm9vdGVyU2VjdGlvbkhlaWdodCArIHNlcGFyYXRvckhlaWdodDtcbiAgICAgICAgY29uc3QgbWF4VmlzaWJsZUxpc3RIZWlnaHQgPSAzNjA7XG4gICAgICAgIGNvbnN0IGF2YWlsYWJsZUJlbG93ID0gd2luZG93LmlubmVySGVpZ2h0IC0gcmVjdC5ib3R0b20gLSB2aWV3cG9ydFBhZGRpbmcgLSBzcGFjaW5nO1xuICAgICAgICBjb25zdCBhdmFpbGFibGVBYm92ZSA9IHJlY3QudG9wIC0gdmlld3BvcnRQYWRkaW5nIC0gc3BhY2luZztcbiAgICAgICAgY29uc3QgbGlzdE1heEhlaWdodCA9IE1hdGgubWF4KDgwLCBNYXRoLm1pbihtYXhWaXNpYmxlTGlzdEhlaWdodCwgTWF0aC5tYXgoYXZhaWxhYmxlQmVsb3csIGF2YWlsYWJsZUFib3ZlKSAtIG1lbnVDaHJvbWVIZWlnaHQpKTtcbiAgICAgICAgY29uc3QgZXhwZWN0ZWRNZW51SGVpZ2h0ID0gbWVudUNocm9tZUhlaWdodCArIGxpc3RNYXhIZWlnaHQ7XG4gICAgICAgIGNvbnN0IGxlZnQgPSBNYXRoLm1pbihcbiAgICAgICAgICAgIE1hdGgubWF4KHZpZXdwb3J0UGFkZGluZywgcmVjdC5sZWZ0KSxcbiAgICAgICAgICAgIE1hdGgubWF4KHZpZXdwb3J0UGFkZGluZywgd2luZG93LmlubmVyV2lkdGggLSBtZW51V2lkdGggLSB2aWV3cG9ydFBhZGRpbmcpXG4gICAgICAgICk7XG4gICAgICAgIGNvbnN0IHNob3VsZE9wZW5BYm92ZSA9IGF2YWlsYWJsZUJlbG93IDwgZXhwZWN0ZWRNZW51SGVpZ2h0ICYmIGF2YWlsYWJsZUFib3ZlID4gYXZhaWxhYmxlQmVsb3c7XG4gICAgICAgIGNvbnN0IHRvcCA9IHNob3VsZE9wZW5BYm92ZVxuICAgICAgICAgICAgPyBNYXRoLm1heCh2aWV3cG9ydFBhZGRpbmcsIHJlY3QudG9wIC0gTWF0aC5taW4oZXhwZWN0ZWRNZW51SGVpZ2h0LCByZWN0LnRvcCAtIHZpZXdwb3J0UGFkZGluZykgLSBzcGFjaW5nKVxuICAgICAgICAgICAgOiBNYXRoLm1pbih3aW5kb3cuaW5uZXJIZWlnaHQgLSB2aWV3cG9ydFBhZGRpbmcgLSBNYXRoLm1pbihleHBlY3RlZE1lbnVIZWlnaHQsIGF2YWlsYWJsZUJlbG93ICsgbWVudUNocm9tZUhlaWdodCksIHJlY3QuYm90dG9tICsgc3BhY2luZyk7XG5cbiAgICAgICAgdGhpcy5tZW51RWwuc3R5bGUud2lkdGggPSBgJHttZW51V2lkdGh9cHhgO1xuICAgICAgICB0aGlzLm1lbnVFbC5zdHlsZS5tYXhIZWlnaHQgPSBgJHtNYXRoLm1heCgxNDAsIHdpbmRvdy5pbm5lckhlaWdodCAtICh2aWV3cG9ydFBhZGRpbmcgKiAyKSl9cHhgO1xuICAgICAgICB0aGlzLm1lbnVFbC5zdHlsZS5sZWZ0ID0gYCR7bGVmdH1weGA7XG4gICAgICAgIHRoaXMubWVudUVsLnN0eWxlLnRvcCA9IGAke3RvcH1weGA7XG4gICAgICAgIHRoaXMubGlzdEVsLnN0eWxlLm1heEhlaWdodCA9IGAke2xpc3RNYXhIZWlnaHR9cHhgO1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVuZGVyTGlzdChzZWFyY2hUZXJtID0gJycpIHtcbiAgICAgICAgdGhpcy5saXN0RWwuZW1wdHkoKTtcblxuICAgICAgICBjb25zdCBub3JtYWxpemVkU2VhcmNoID0gc2VhcmNoVGVybS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgY29uc3QgZmlsdGVyZWRDYXRlZ29yaWVzID0gdGhpcy5jYXRlZ29yaWVzLmZpbHRlcihjYXRlZ29yeSA9PlxuICAgICAgICAgICAgIW5vcm1hbGl6ZWRTZWFyY2hcbiAgICAgICAgICAgIHx8IGNhdGVnb3J5Lm5hbWUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhub3JtYWxpemVkU2VhcmNoKVxuICAgICAgICAgICAgfHwgdGhpcy5wbHVnaW4uZ2V0Q2F0ZWdvcnlFbW9qaShjYXRlZ29yeS5pZCkuaW5jbHVkZXMobm9ybWFsaXplZFNlYXJjaClcbiAgICAgICAgKTtcblxuICAgICAgICBpZiAoZmlsdGVyZWRDYXRlZ29yaWVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgdGhpcy5saXN0RWwuY3JlYXRlRGl2KHtcbiAgICAgICAgICAgICAgICB0ZXh0OiAnTm8gY2F0ZWdvcmllcyBmb3VuZCcsXG4gICAgICAgICAgICAgICAgY2xzOiAnZXhwZW5zaWNhLWNhdGVnb3J5LXF1aWNrLW1lbnUtZW1wdHknXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGZpbHRlcmVkQ2F0ZWdvcmllcy5mb3JFYWNoKGNhdGVnb3J5ID0+IHtcbiAgICAgICAgICAgIGNvbnN0IG9wdGlvbkJ1dHRvbiA9IHRoaXMubGlzdEVsLmNyZWF0ZUVsKCdidXR0b24nLCB7XG4gICAgICAgICAgICAgICAgY2xzOiAnZXhwZW5zaWNhLWNhdGVnb3J5LXF1aWNrLW1lbnUtaXRlbScsXG4gICAgICAgICAgICAgICAgYXR0cjoge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnYnV0dG9uJyxcbiAgICAgICAgICAgICAgICAgICAgJ2FyaWEtcHJlc3NlZCc6IFN0cmluZyhjYXRlZ29yeS5pZCA9PT0gdGhpcy5zZWxlY3RlZENhdGVnb3J5SWQpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGlmIChjYXRlZ29yeS5pZCA9PT0gdGhpcy5zZWxlY3RlZENhdGVnb3J5SWQpIHtcbiAgICAgICAgICAgICAgICBvcHRpb25CdXR0b24uYWRkQ2xhc3MoJ2lzLXNlbGVjdGVkJyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIG9wdGlvbkJ1dHRvbi5jcmVhdGVTcGFuKHtcbiAgICAgICAgICAgICAgICB0ZXh0OiB0aGlzLnBsdWdpbi5nZXRDYXRlZ29yeUVtb2ppKGNhdGVnb3J5LmlkKSxcbiAgICAgICAgICAgICAgICBjbHM6ICdleHBlbnNpY2EtY2F0ZWdvcnktcXVpY2stbWVudS1pdGVtLWVtb2ppJ1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBvcHRpb25CdXR0b24uY3JlYXRlU3Bhbih7XG4gICAgICAgICAgICAgICAgdGV4dDogY2F0ZWdvcnkubmFtZSxcbiAgICAgICAgICAgICAgICBjbHM6ICdleHBlbnNpY2EtY2F0ZWdvcnktcXVpY2stbWVudS1pdGVtLWxhYmVsJ1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIG9wdGlvbkJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICAgICAgICAgICAgdm9pZCB0aGlzLm9uQ2F0ZWdvcnlDaGFuZ2UoY2F0ZWdvcnkuaWQpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cbn1cblxuY2xhc3MgTmV3Q2F0ZWdvcnlNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbjogRXhwZW5zaWNhUGx1Z2luO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgY2F0ZWdvcnlUeXBlOiBDYXRlZ29yeVR5cGU7XG4gICAgcHJpdmF0ZSByZWFkb25seSBvblNhdmU6IChjYXRlZ29yeUlkOiBzdHJpbmcpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+O1xuXG4gICAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogRXhwZW5zaWNhUGx1Z2luLCBjYXRlZ29yeVR5cGU6IENhdGVnb3J5VHlwZSwgb25TYXZlOiAoY2F0ZWdvcnlJZDogc3RyaW5nKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPikge1xuICAgICAgICBzdXBlcihhcHApO1xuICAgICAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgICAgICAgdGhpcy5jYXRlZ29yeVR5cGUgPSBjYXRlZ29yeVR5cGU7XG4gICAgICAgIHRoaXMub25TYXZlID0gb25TYXZlO1xuICAgIH1cblxuICAgIG9uT3BlbigpIHtcbiAgICAgICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuICAgICAgICB0aGlzLm1vZGFsRWwuYWRkQ2xhc3MoJ2V4cGVuc2ljYS10cmFuc2FjdGlvbi1tb2RhbCcpO1xuICAgICAgICBjb250ZW50RWwuYWRkQ2xhc3MoJ2V4cGVuc2ljYS1tb2RhbCcpO1xuXG4gICAgICAgIGNvbnN0IHRpdGxlID0gY29udGVudEVsLmNyZWF0ZUVsKCdoMicsIHsgY2xzOiAnZXhwZW5zaWNhLW1vZGFsLXRpdGxlJyB9KTtcbiAgICAgICAgdGl0bGUuaW5uZXJIVE1MID0gYDxzcGFuIGNsYXNzPVwiZXhwZW5zaWNhLW1vZGFsLXRpdGxlLWljb25cIj5cXHV7MUYzRjd9XFx1e0ZFMEZ9PC9zcGFuPiAke3RoaXMuY2F0ZWdvcnlUeXBlID09PSBDYXRlZ29yeVR5cGUuSU5DT01FID8gJ05ldyBJbmNvbWUgQ2F0ZWdvcnknIDogJ05ldyBFeHBlbnNlIENhdGVnb3J5J31gO1xuXG4gICAgICAgIGNvbnN0IGZvcm0gPSBjb250ZW50RWwuY3JlYXRlRWwoJ2Zvcm0nLCB7IGNsczogJ2V4cGVuc2ljYS1mb3JtJyB9KTtcbiAgICAgICAgY29uc3QgbmFtZUdyb3VwID0gZm9ybS5jcmVhdGVEaXYoJ2V4cGVuc2ljYS1mb3JtLWdyb3VwJyk7XG4gICAgICAgIG5hbWVHcm91cC5jcmVhdGVFbCgnbGFiZWwnLCB7XG4gICAgICAgICAgICB0ZXh0OiAnTmFtZScsXG4gICAgICAgICAgICBjbHM6ICdleHBlbnNpY2EtZm9ybS1sYWJlbCcsXG4gICAgICAgICAgICBhdHRyOiB7IGZvcjogJ25ldy1jYXRlZ29yeS1uYW1lJyB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IG5hbWVSb3cgPSBuYW1lR3JvdXAuY3JlYXRlRGl2KCdleHBlbnNpY2EtY2F0ZWdvcnktbmFtZS1yb3cnKTtcbiAgICAgICAgY29uc3QgZHJhZnRDYXRlZ29yeSA9IHtcbiAgICAgICAgICAgIGlkOiAnX19uZXdfY2F0ZWdvcnlfXycsXG4gICAgICAgICAgICBuYW1lOiAnJyxcbiAgICAgICAgICAgIHR5cGU6IHRoaXMuY2F0ZWdvcnlUeXBlXG4gICAgICAgIH0gYXMgQ2F0ZWdvcnk7XG4gICAgICAgIGxldCBzZWxlY3RlZEVtb2ppID0gZ2V0UmFuZG9tRW1vamkodGhpcy5jYXRlZ29yeVR5cGUpO1xuICAgICAgICBsZXQgc2VsZWN0ZWRDb2xvciA9IG5vcm1hbGl6ZUNvbG9ySW5wdXRWYWx1ZShnZXRSYW5kb21Db2xvcigpKTtcblxuICAgICAgICBjb25zdCBjb2xvckJ1dHRvbiA9IG5hbWVSb3cuY3JlYXRlRWwoJ2J1dHRvbicsIHtcbiAgICAgICAgICAgIGNsczogJ2V4cGVuc2ljYS1zdGFuZGFyZC1idXR0b24gZXhwZW5zaWNhLWNhdGVnb3J5LWNvbG9yLWJ1dHRvbicsXG4gICAgICAgICAgICBhdHRyOiB7XG4gICAgICAgICAgICAgICAgdHlwZTogJ2J1dHRvbicsXG4gICAgICAgICAgICAgICAgaWQ6ICduZXctY2F0ZWdvcnktY29sb3InLFxuICAgICAgICAgICAgICAgICdhcmlhLWxhYmVsJzogJ0Nob29zZSBjb2xvcidcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGNvbG9yQnV0dG9uLnN0eWxlLnNldFByb3BlcnR5KCctLWV4cGVuc2ljYS1jYXRlZ29yeS1idXR0b24tY29sb3InLCBzZWxlY3RlZENvbG9yKTtcbiAgICAgICAgY29sb3JCdXR0b24uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XG4gICAgICAgICAgICBuZXcgQ2F0ZWdvcnlDb2xvclBhbGV0dGVNb2RhbCh0aGlzLmFwcCwgc2VsZWN0ZWRDb2xvciwgKGNvbG9yKSA9PiB7XG4gICAgICAgICAgICAgICAgc2VsZWN0ZWRDb2xvciA9IG5vcm1hbGl6ZUNvbG9ySW5wdXRWYWx1ZShjb2xvcik7XG4gICAgICAgICAgICAgICAgY29sb3JCdXR0b24uc3R5bGUuc2V0UHJvcGVydHkoJy0tZXhwZW5zaWNhLWNhdGVnb3J5LWJ1dHRvbi1jb2xvcicsIHNlbGVjdGVkQ29sb3IpO1xuICAgICAgICAgICAgfSkub3BlbigpO1xuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBlbW9qaUJ1dHRvbiA9IG5hbWVSb3cuY3JlYXRlRWwoJ2J1dHRvbicsIHtcbiAgICAgICAgICAgIHRleHQ6IHNlbGVjdGVkRW1vamksXG4gICAgICAgICAgICBjbHM6ICdleHBlbnNpY2Etc3RhbmRhcmQtYnV0dG9uIGV4cGVuc2ljYS1jYXRlZ29yeS1waWNrZXItdHJpZ2dlciBleHBlbnNpY2EtY2F0ZWdvcnktbW9kYWwtZW1vamktYnV0dG9uJyxcbiAgICAgICAgICAgIGF0dHI6IHtcbiAgICAgICAgICAgICAgICB0eXBlOiAnYnV0dG9uJyxcbiAgICAgICAgICAgICAgICBpZDogJ25ldy1jYXRlZ29yeS1lbW9qaScsXG4gICAgICAgICAgICAgICAgJ2FyaWEtbGFiZWwnOiAnQ2hvb3NlIGVtb2ppJ1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgZW1vamlCdXR0b24uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XG4gICAgICAgICAgICBuZXcgRW1vamlQaWNrZXJNb2RhbCh0aGlzLmFwcCwgZHJhZnRDYXRlZ29yeSwgc2VsZWN0ZWRFbW9qaSwgKGVtb2ppKSA9PiB7XG4gICAgICAgICAgICAgICAgc2VsZWN0ZWRFbW9qaSA9IGVtb2ppO1xuICAgICAgICAgICAgICAgIGVtb2ppQnV0dG9uLnNldFRleHQoZW1vamkpO1xuICAgICAgICAgICAgfSkub3BlbigpO1xuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBuYW1lSW5wdXQgPSBuYW1lUm93LmNyZWF0ZUVsKCdpbnB1dCcsIHtcbiAgICAgICAgICAgIGNsczogJ2V4cGVuc2ljYS1mb3JtLWlucHV0IGV4cGVuc2ljYS1lZGl0LWZpZWxkIGV4cGVuc2ljYS1jYXRlZ29yeS1uYW1lLWZpZWxkJyxcbiAgICAgICAgICAgIGF0dHI6IHtcbiAgICAgICAgICAgICAgICB0eXBlOiAndGV4dCcsXG4gICAgICAgICAgICAgICAgaWQ6ICduZXctY2F0ZWdvcnktbmFtZScsXG4gICAgICAgICAgICAgICAgbmFtZTogJ25ldy1jYXRlZ29yeS1uYW1lJyxcbiAgICAgICAgICAgICAgICBwbGFjZWhvbGRlcjogJ0VudGVyIGNhdGVnb3J5IG5hbWUnLFxuICAgICAgICAgICAgICAgIHJlcXVpcmVkOiAncmVxdWlyZWQnXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IGZvb3RlciA9IGZvcm0uY3JlYXRlRGl2KCdleHBlbnNpY2EtZm9ybS1mb290ZXInKTtcbiAgICAgICAgY29uc3QgY2FuY2VsQnV0dG9uID0gZm9vdGVyLmNyZWF0ZUVsKCdidXR0b24nLCB7XG4gICAgICAgICAgICB0ZXh0OiAnQ2FuY2VsJyxcbiAgICAgICAgICAgIGNsczogJ2V4cGVuc2ljYS1zdGFuZGFyZC1idXR0b24gZXhwZW5zaWNhLWJ0biBleHBlbnNpY2EtYnRuLXNlY29uZGFyeScsXG4gICAgICAgICAgICBhdHRyOiB7IHR5cGU6ICdidXR0b24nIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGZvb3Rlci5jcmVhdGVFbCgnYnV0dG9uJywge1xuICAgICAgICAgICAgdGV4dDogJ1NhdmUnLFxuICAgICAgICAgICAgY2xzOiAnZXhwZW5zaWNhLXN0YW5kYXJkLWJ1dHRvbiBleHBlbnNpY2EtYnRuIGV4cGVuc2ljYS1idG4tcHJpbWFyeScsXG4gICAgICAgICAgICBhdHRyOiB7IHR5cGU6ICdzdWJtaXQnIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgY2FuY2VsQnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICB9KTtcblxuICAgICAgICBmb3JtLmFkZEV2ZW50TGlzdGVuZXIoJ3N1Ym1pdCcsIGFzeW5jIChldmVudDogU3VibWl0RXZlbnQpID0+IHtcbiAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG5cbiAgICAgICAgICAgIGNvbnN0IG5vcm1hbGl6ZWROYW1lID0gdGhpcy5wbHVnaW4ubm9ybWFsaXplQ2F0ZWdvcnlOYW1lKG5hbWVJbnB1dC52YWx1ZS50cmltKCkpLm5hbWUudHJpbSgpO1xuICAgICAgICAgICAgaWYgKCFub3JtYWxpemVkTmFtZSkge1xuICAgICAgICAgICAgICAgIHNob3dFeHBlbnNpY2FOb3RpY2UoJ0NhdGVnb3J5IG5hbWUgaXMgcmVxdWlyZWQuJyk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBkdXBsaWNhdGUgPSB0aGlzLnBsdWdpbi5nZXRDYXRlZ29yaWVzKHRoaXMuY2F0ZWdvcnlUeXBlKS5maW5kKGNhdGVnb3J5ID0+XG4gICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4ubm9ybWFsaXplQ2F0ZWdvcnlOYW1lKGNhdGVnb3J5Lm5hbWUpLm5hbWUudG9Mb3dlckNhc2UoKSA9PT0gbm9ybWFsaXplZE5hbWUudG9Mb3dlckNhc2UoKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGlmIChkdXBsaWNhdGUpIHtcbiAgICAgICAgICAgICAgICBzaG93RXhwZW5zaWNhTm90aWNlKGBDYXRlZ29yeSBcIiR7bm9ybWFsaXplZE5hbWV9XCIgYWxyZWFkeSBleGlzdHMuYCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBjYXRlZ29yeUlkID0gY3JlYXRlQ2F0ZWdvcnlJZChub3JtYWxpemVkTmFtZSwgdGhpcy5wbHVnaW4sIHRoaXMuY2F0ZWdvcnlUeXBlKTtcbiAgICAgICAgICAgIGlmICh0aGlzLmNhdGVnb3J5VHlwZSA9PT0gQ2F0ZWdvcnlUeXBlLklOQ09NRSkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmFkZEluY29tZUNhdGVnb3J5KHtcbiAgICAgICAgICAgICAgICAgICAgaWQ6IGNhdGVnb3J5SWQsXG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IG5vcm1hbGl6ZWROYW1lXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmFkZEV4cGVuc2VDYXRlZ29yeSh7XG4gICAgICAgICAgICAgICAgICAgIGlkOiBjYXRlZ29yeUlkLFxuICAgICAgICAgICAgICAgICAgICBuYW1lOiBub3JtYWxpemVkTmFtZVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4udXBkYXRlQ2F0ZWdvcnlFbW9qaShjYXRlZ29yeUlkLCBzZWxlY3RlZEVtb2ppKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnVwZGF0ZUNhdGVnb3J5Q29sb3IoY2F0ZWdvcnlJZCwgc2VsZWN0ZWRDb2xvcik7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLm9uU2F2ZShjYXRlZ29yeUlkKTtcbiAgICAgICAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmVxdWVzdEFuaW1hdGlvbkZyYW1lKCgpID0+IHtcbiAgICAgICAgICAgIG5hbWVJbnB1dC5mb2N1cygpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBvbkNsb3NlKCkge1xuICAgICAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIH1cbn1cblxuY2xhc3MgQ2F0ZWdvcnlDb2xvclBhbGV0dGVNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgICBwcml2YXRlIHJlYWRvbmx5IGN1cnJlbnRDb2xvcjogc3RyaW5nO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgb25TZWxlY3Q6IChjb2xvcjogc3RyaW5nKSA9PiB2b2lkO1xuXG4gICAgY29uc3RydWN0b3IoYXBwOiBBcHAsIGN1cnJlbnRDb2xvcjogc3RyaW5nLCBvblNlbGVjdDogKGNvbG9yOiBzdHJpbmcpID0+IHZvaWQpIHtcbiAgICAgICAgc3VwZXIoYXBwKTtcbiAgICAgICAgdGhpcy5jdXJyZW50Q29sb3IgPSBjdXJyZW50Q29sb3I7XG4gICAgICAgIHRoaXMub25TZWxlY3QgPSBvblNlbGVjdDtcbiAgICB9XG5cbiAgICBvbk9wZW4oKSB7XG4gICAgICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgICAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgICAgICAgY29udGVudEVsLmFkZENsYXNzKCdleHBlbnNpY2EtY2F0ZWdvcnktY29sb3ItcGFsZXR0ZS1tb2RhbCcpO1xuXG4gICAgICAgIGNvbnN0IGdyaWQgPSBjb250ZW50RWwuY3JlYXRlRGl2KCdleHBlbnNpY2EtY2F0ZWdvcnktY29sb3ItcGFsZXR0ZS1ncmlkJyk7XG4gICAgICAgIENvbG9yUGFsZXR0ZS5jb2xvcnMuZm9yRWFjaChjb2xvciA9PiB7XG4gICAgICAgICAgICBjb25zdCBub3JtYWxpemVkQ29sb3IgPSBjb2xvci5zbGljZSgwLCA3KTtcbiAgICAgICAgICAgIGNvbnN0IHN3YXRjaCA9IGdyaWQuY3JlYXRlRWwoJ2J1dHRvbicsIHtcbiAgICAgICAgICAgICAgICBjbHM6ICdleHBlbnNpY2EtY2F0ZWdvcnktY29sb3Itc3dhdGNoJyxcbiAgICAgICAgICAgICAgICBhdHRyOiB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICdidXR0b24nLFxuICAgICAgICAgICAgICAgICAgICAnYXJpYS1sYWJlbCc6IGBTZWxlY3QgY29sb3IgJHtub3JtYWxpemVkQ29sb3J9YFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgc3dhdGNoLnN0eWxlLmJhY2tncm91bmRDb2xvciA9IG5vcm1hbGl6ZWRDb2xvcjtcbiAgICAgICAgICAgIGlmIChub3JtYWxpemVkQ29sb3IudG9Mb3dlckNhc2UoKSA9PT0gdGhpcy5jdXJyZW50Q29sb3IudG9Mb3dlckNhc2UoKSkge1xuICAgICAgICAgICAgICAgIHN3YXRjaC5hZGRDbGFzcygnaXMtc2VsZWN0ZWQnKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgc3dhdGNoLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMub25TZWxlY3Qobm9ybWFsaXplZENvbG9yKTtcbiAgICAgICAgICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgb25DbG9zZSgpIHtcbiAgICAgICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGdldFJhbmRvbUNvbG9yKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIENvbG9yUGFsZXR0ZS5jb2xvcnNbTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogQ29sb3JQYWxldHRlLmNvbG9ycy5sZW5ndGgpXS5zbGljZSgwLCA3KTtcbn1cblxuZnVuY3Rpb24gZ2V0UmFuZG9tRW1vamkodHlwZTogQ2F0ZWdvcnlUeXBlKTogc3RyaW5nIHtcbiAgICBjb25zdCBlbW9qaXMgPSBnZXRDb21tb25DYXRlZ29yeUVtb2ppcyh0eXBlKTtcbiAgICByZXR1cm4gZW1vamlzW01hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIGVtb2ppcy5sZW5ndGgpXSB8fCAnXFx1ezFGM0Y3fVxcdXtGRTBGfSc7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUNhdGVnb3J5SWQobmFtZTogc3RyaW5nLCBwbHVnaW46IEV4cGVuc2ljYVBsdWdpbiwgdHlwZTogQ2F0ZWdvcnlUeXBlKTogc3RyaW5nIHtcbiAgICBjb25zdCBiYXNlSWQgPSBuYW1lXG4gICAgICAgIC50b0xvd2VyQ2FzZSgpXG4gICAgICAgIC5yZXBsYWNlKC9bXmEtejAtOV0rL2csICdfJylcbiAgICAgICAgLnJlcGxhY2UoL15fK3xfKyQvZywgJycpXG4gICAgICAgIHx8ICdjYXRlZ29yeSc7XG4gICAgY29uc3QgZXhpc3RpbmdJZHMgPSBuZXcgU2V0KHBsdWdpbi5nZXRDYXRlZ29yaWVzKHR5cGUpLm1hcChjYXRlZ29yeSA9PiBjYXRlZ29yeS5pZCkpO1xuXG4gICAgaWYgKCFleGlzdGluZ0lkcy5oYXMoYmFzZUlkKSkge1xuICAgICAgICByZXR1cm4gYmFzZUlkO1xuICAgIH1cblxuICAgIGxldCBzdWZmaXggPSAyO1xuICAgIHdoaWxlIChleGlzdGluZ0lkcy5oYXMoYCR7YmFzZUlkfV8ke3N1ZmZpeH1gKSkge1xuICAgICAgICBzdWZmaXggKz0gMTtcbiAgICB9XG5cbiAgICByZXR1cm4gYCR7YmFzZUlkfV8ke3N1ZmZpeH1gO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVDb2xvcklucHV0VmFsdWUoY29sb3I6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgaWYgKC9eI1swLTlhLWZdezZ9JC9pLnRlc3QoY29sb3IpKSB7XG4gICAgICAgIHJldHVybiBjb2xvcjtcbiAgICB9XG5cbiAgICBpZiAoL14jWzAtOWEtZl17M30kL2kudGVzdChjb2xvcikpIHtcbiAgICAgICAgcmV0dXJuIGAjJHtjb2xvci5zbGljZSgxKS5zcGxpdCgnJykubWFwKGNoYXIgPT4gYCR7Y2hhcn0ke2NoYXJ9YCkuam9pbignJyl9YDtcbiAgICB9XG5cbiAgICBjb25zdCBwcm9iZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICAgIHByb2JlLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChwcm9iZSk7XG4gICAgY29uc3QgY29tcHV0ZWQgPSBnZXRDb21wdXRlZFN0eWxlKHByb2JlKS5jb2xvcjtcbiAgICBwcm9iZS5yZW1vdmUoKTtcblxuICAgIGNvbnN0IG1hdGNoID0gY29tcHV0ZWQubWF0Y2goL1xcZCsvZyk7XG4gICAgaWYgKCFtYXRjaCB8fCBtYXRjaC5sZW5ndGggPCAzKSB7XG4gICAgICAgIHJldHVybiAnIzAwMDAwMCc7XG4gICAgfVxuXG4gICAgcmV0dXJuIGAjJHttYXRjaC5zbGljZSgwLCAzKS5tYXAodmFsdWUgPT4gTnVtYmVyKHZhbHVlKS50b1N0cmluZygxNikucGFkU3RhcnQoMiwgJzAnKSkuam9pbignJyl9YDtcbn1cbiJdfQ==