import { App, Modal, setIcon } from 'obsidian';
import { showExpensicaNotice } from './notice';
import { ExportOptions, ExportService } from './export-service';
import { renderUiIcon, renderPanelTitle, CategoryType, formatDate, parseLocalDate, INTERNAL_CATEGORY_ID } from './models';
import type { UiIcon } from './models';
import { renderCategoryChip } from './category-chip';
import { DateRangePickerModal, DateRangeType, getDateRangeOptions, resolveDateRange } from './dashboard-view';
import type { DateRange } from './dashboard-view';
import type ExpensicaPlugin from '../main';

export class ExportModal extends Modal {
  private plugin: ExpensicaPlugin;
  private exportOptions: ExportOptions;
  private categoryChips = new Map<string, HTMLElement>();
  private selectedCategories = new Set<string>();
  private categoryGroups: { ids: string[]; checkbox: HTMLInputElement }[] = [];
  private dateRange: DateRange;
  private dateRangePicker: DateRangePickerModal | null = null;
  private dropdownCleanups: (() => void)[] = [];
  private activeDropdown: (() => void) | null = null;
  private dismissed = false;
  
  constructor(app: App, plugin: ExpensicaPlugin) {
    super(app);
    this.plugin = plugin;
    
    // Generate default filename based on date
    const today = new Date();
    const formattedDate = formatDate(today);
    const sharedRange = plugin.getSharedDateRangeState();
    this.dateRange = sharedRange
      ? { type: sharedRange.type, startDate: parseLocalDate(sharedRange.startDate),
          endDate: parseLocalDate(sharedRange.endDate), label: '' }
      : resolveDateRange(DateRangeType.THIS_MONTH);
    
    // Initialize with default export options
    this.exportOptions = {
      format: 'csv',
      dateFrom: this.dateRange.type === DateRangeType.ALL_TIME ? null : formatDate(this.dateRange.startDate),
      dateTo: this.dateRange.type === DateRangeType.ALL_TIME ? null : formatDate(this.dateRange.endDate),
      includeExpenses: true,
      includeIncome: true,
      includeInternal: true,
      categories: null, // null means all categories
      filename: `expensica-export-${formattedDate}`
    };
  }
  
  onOpen() {
    this.dismissed = false;
    this.categoryChips.clear();
    this.selectedCategories.clear();
    this.categoryGroups = [];
    const {contentEl} = this;
    contentEl.empty();
    contentEl.addClass('expensica-modal', 'expensica-export-modal');
    
    // Modal header
    const modalTitle = contentEl.createEl('h2', { cls: 'expensica-modal-title' });
    renderUiIcon(modalTitle, 'export', 'expensica-modal-title-icon');
    modalTitle.appendText(' Export Transactions');
    
    // Create form container
    const form = contentEl.createEl('form', { cls: 'expensica-form' });
    
    // Export format
    const formatContainer = form.createDiv('expensica-export-section expensica-export-panel-row');
    this.renderFieldLabel(formatContainer, 'Format', 'file');
    const formatDropdown = this.renderDropdown(formatContainer, 'Format', [
      { value: 'csv' as const, label: 'CSV' },
      { value: 'json' as const, label: 'JSON' },
      { value: 'pdf' as const, label: 'PDF' }
    ], this.exportOptions.format, value => {
      this.exportOptions.format = value;
      this.exportOptions.filename = this.exportOptions.filename.replace(/\.(csv|json|pdf)$/i, '');
      formatDropdown.setValue(value);
    });
    
    // Date range
    const dateRangeContainer = form.createDiv('expensica-export-section expensica-export-panel-row');
    const dateRangeHeading = dateRangeContainer.createDiv('expensica-export-panel-heading');
    this.renderFieldLabel(dateRangeHeading, 'Date Range', 'calendar');
    const dateDescription = dateRangeHeading.createEl('p', { cls: 'expensica-export-date-description' });
    const dateDropdown = this.renderDropdown(dateRangeContainer, 'Date range',
      getDateRangeOptions().map(option => ({ value: option.type, label: option.label })),
      this.dateRange.type, type => {
        if (type === DateRangeType.CUSTOM) {
          this.dateRangePicker?.close();
          this.dateRangePicker = new DateRangePickerModal(this.app, this.dateRange.startDate, this.dateRange.endDate,
            (start, end) => {
              if (this.dismissed) return;
              this.dateRange = resolveDateRange(type, start, end);
              updateDateRange();
            });
          this.dateRangePicker.open();
        } else {
          this.dateRange = resolveDateRange(type);
          updateDateRange();
        }
      }, 'calendar');
    const updateDateRange = () => {
      const allTime = this.dateRange.type === DateRangeType.ALL_TIME;
      this.exportOptions.dateFrom = allTime ? null : formatDate(this.dateRange.startDate);
      this.exportOptions.dateTo = allTime ? null : formatDate(this.dateRange.endDate);
      const description = allTime ? 'All transactions' : `${this.exportOptions.dateFrom} to ${this.exportOptions.dateTo}`;
      dateDescription.textContent = description;
      dateDropdown.setValue(this.dateRange.type);
      dateDropdown.button.setAttribute('aria-description', description);
    };
    updateDateRange();
    
    // Categories
    const categoriesContainer = form.createDiv('expensica-export-section');
    
    // Create categories section
    const categoryList = categoriesContainer.createDiv('expensica-category-list');
    
    this.renderCategoryGroup(categoryList, 'Expenses categories', 'expense', this.plugin.getCategories(CategoryType.EXPENSE));
    this.renderCategoryGroup(categoryList, 'Income categories', 'income', this.plugin.getCategories(CategoryType.INCOME));
    this.renderCategoryGroup(categoryList, 'Internal categories', 'internal', [{ id: INTERNAL_CATEGORY_ID, name: 'Internal' }]);
    this.syncCategorySelection();
    
    // Buttons
    const formFooter = form.createDiv('expensica-form-footer');
    const cancelBtn = formFooter.createEl('button', {
      text: 'Cancel',
      cls: 'expensica-standard-button expensica-btn expensica-btn-secondary',
      attr: { type: 'button' }
    });
    
    formFooter.createEl('button', {
      text: 'Export',
      cls: 'expensica-standard-button expensica-btn expensica-btn-primary',
      attr: { type: 'submit' }
    });
    
    // Button event listeners
    cancelBtn.addEventListener('click', () => {
      this.close();
    });
    
    form.addEventListener('submit', event => {
      event.preventDefault();
      this.performExport();
    });
  }
  
  private performExport() {
    if (this.selectedCategories.size === 0) {
      showExpensicaNotice('Please select at least one category');
      return;
    }
    
    // Ensure filename has correct extension
    if (!this.exportOptions.filename.endsWith(`.${this.exportOptions.format}`)) {
      this.exportOptions.filename += `.${this.exportOptions.format}`;
    }
    
    try {
      // Generate the export data
      const sourceTransactions = this.plugin.getAllTransactions();
      const filteredTransactions = ExportService.filterTransactions(
        sourceTransactions,
        this.exportOptions
      );
      
      // Generate export data based on format
      let exportData: string | Uint8Array;
      let mimeType: string;
      
      if (this.exportOptions.format === 'csv') {
        exportData = ExportService.generateCSV(filteredTransactions, this.plugin.settings.categories, sourceTransactions);
        mimeType = 'text/csv';
      } else if (this.exportOptions.format === 'json') {
        exportData = ExportService.generateJSON(filteredTransactions);
        mimeType = 'application/json';
      } else {
        exportData = ExportService.generatePDF(
          filteredTransactions, 
          this.plugin.settings.categories,
          this.plugin.settings.defaultCurrency,
          sourceTransactions
        );
        if (exportData.byteLength === 0) {
          throw new Error('PDF generation produced an empty document.');
        }
        mimeType = 'application/pdf';
      }
      
      // Trigger download via browser's native mechanism
      this.downloadFile(exportData, this.exportOptions.filename, mimeType);
      
      // Show success message
      showExpensicaNotice(`Export completed successfully!`);
      
      // Close the modal
      this.close();
      
    } catch (error) {
      console.error('Export error:', error);
      showExpensicaNotice('Export failed. Please check the console for errors.');
    }
  }
  
  private downloadFile(content: string | Uint8Array, filename: string, mimeType: string) {
    // Create a blob with the data
    const blob = new Blob([content], { type: mimeType });
    
    // Create a temporary URL for the blob
    const url = window.URL.createObjectURL(blob);
    
    // Create a temporary link element
    const downloadLink = document.body.createEl('a', { attr: { href: url, download: filename } });
    
    // Programmatically click the link to trigger the download
    downloadLink.click();
    
    // Clean up by removing the link and revoking the URL
    downloadLink.remove();
    window.setTimeout(() => {
      window.URL.revokeObjectURL(url);
    }, 100);
  }
  
  private renderFieldLabel(container: HTMLElement, text: string, icon: UiIcon) {
    const label = container.createDiv('expensica-export-label');
    renderUiIcon(label, icon);
    label.createSpan({ text });
  }

  private renderCategoryGroup(container: HTMLElement, label: string, icon: UiIcon, categories: { id: string; name: string }[]) {
    const group = container.createDiv('expensica-category-group');
    const header = group.createDiv('expensica-export-category-group-header');
    renderPanelTitle(header, label, icon, 'h3', 'expensica-chart-title expensica-setting-group-title');
    const selectAll = header.createEl('label', { cls: 'expensica-select-all expensica-export-group-select-all' });
    const checkbox = selectAll.createEl('input', {
      attr: { type: 'checkbox', 'aria-label': `Select all ${label.toLowerCase()}` }
    });
    selectAll.createSpan({ text: 'Select All' });
    const ids = categories.map(category => category.id);
    this.categoryGroups.push({ ids, checkbox });
    checkbox.addEventListener('change', () => {
      ids.forEach(id => {
        if (checkbox.checked) this.selectedCategories.add(id);
        else this.selectedCategories.delete(id);
      });
      this.syncCategorySelection();
    });
    const grid = group.createDiv('expensica-category-chip-grid expensica-donut-category-legend expensica-export-category-grid');
    categories.forEach(category => this.renderCategoryPill(grid, category.id, category.name));
  }

  private renderCategoryPill(container: HTMLElement, id: string, name: string) {
    const color = this.plugin.getCategoryColor(id, name);
    const chip = renderCategoryChip(container, {
      text: name, emoji: this.plugin.getCategoryEmoji(id), color, swatchColor: color, interactive: true
    });
    this.categoryChips.set(id, chip);
    this.selectedCategories.add(id);
    chip.addEventListener('click', () => {
      if (this.selectedCategories.has(id)) this.selectedCategories.delete(id);
      else this.selectedCategories.add(id);
      this.syncCategorySelection();
    });
  }

  private syncCategorySelection() {
    this.categoryChips.forEach((chip, id) => {
      const selected = this.selectedCategories.has(id);
      chip.toggleClass('is-hidden', !selected);
      chip.setAttribute('aria-pressed', String(selected));
    });
    const allSelected = this.selectedCategories.size === this.categoryChips.size;
    this.categoryGroups.forEach(({ ids, checkbox }) => {
      const count = ids.filter(id => this.selectedCategories.has(id)).length;
      checkbox.disabled = ids.length === 0;
      checkbox.checked = ids.length > 0 && count === ids.length;
      checkbox.indeterminate = count > 0 && count < ids.length;
    });
    this.exportOptions.categories = allSelected ? null : [...this.selectedCategories];
  }

  private renderDropdown<T extends string>(container: HTMLElement, label: string,
    options: { value: T; label: string }[], selectedValue: T, onSelect: (value: T) => void, iconName?: UiIcon) {
    let currentValue = selectedValue;
    const wrapper = container.createDiv('shadcn-date-range-container expensica-export-dropdown');
    const selector = wrapper.createDiv('shadcn-date-range-selector');
    const button = selector.createEl('button', {
      cls: 'expensica-standard-button shadcn-date-range-current',
      attr: { type: 'button', 'aria-label': label, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }
    });
    if (iconName) renderUiIcon(button, iconName);
    const text = button.createSpan({ cls: 'shadcn-date-range-text' });
    const icon = button.createSpan({ cls: 'shadcn-date-range-icon', attr: { 'aria-hidden': 'true' } });
    setIcon(icon, 'chevron-down');
    const menu = selector.createDiv({
      cls: 'shadcn-date-range-options expensica-date-range-options shadcn-date-range-hidden',
      attr: { role: 'menu', 'aria-label': label }
    });
    const doc = button.ownerDocument;
    const outside = (event: Event) => {
      if (!selector.contains(event.target as Node)) hide();
    };
    const hide = () => {
      menu.addClass('shadcn-date-range-hidden');
      icon.removeClass('dropdown-icon-open');
      button.setAttribute('aria-expanded', 'false');
      doc.removeEventListener('click', outside);
      doc.removeEventListener('focusin', outside);
      if (this.activeDropdown === hide) this.activeDropdown = null;
    };
    this.dropdownCleanups.push(hide);
    const show = () => {
      this.activeDropdown?.();
      this.activeDropdown = hide;
      menu.removeClass('shadcn-date-range-hidden');
      icon.addClass('dropdown-icon-open');
      button.setAttribute('aria-expanded', 'true');
      doc.addEventListener('click', outside);
      doc.addEventListener('focusin', outside);
    };
    const items = options.map(option => {
      const item = menu.createEl('button', {
        text: option.label, cls: 'shadcn-date-range-option expensica-date-range-option',
        attr: { type: 'button', role: 'menuitemradio', tabindex: '-1' }
      });
      item.addEventListener('click', () => {
        hide();
        button.focus();
        onSelect(option.value);
      });
      return item;
    });
    const setValue = (value: T) => {
      currentValue = value;
      text.textContent = options.find(option => option.value === value)?.label || '';
      items.forEach((item, index) => {
        const selected = options[index].value === value;
        item.toggleClass('shadcn-date-range-option-active', selected);
        item.setAttribute('aria-checked', String(selected));
      });
    };
    setValue(selectedValue);
    button.addEventListener('click', () => {
      if (menu.hasClass('shadcn-date-range-hidden')) show();
      else hide();
    });
    selector.addEventListener('keydown', event => {
      if (event.key === 'Escape') { hide(); button.focus(); event.preventDefault(); event.stopPropagation(); return; }
      if (event.key === 'Tab') { hide(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = items.indexOf(event.target as HTMLButtonElement);
      const selected = options.findIndex(option => option.value === currentValue);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : index < 0 ? Math.max(0, selected) : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      if (menu.hasClass('shadcn-date-range-hidden')) show();
      items[next].focus();
    });
    return { button, setValue };
  }
  
  onClose() {
    this.dismissed = true;
    this.dropdownCleanups.forEach(cleanup => cleanup());
    this.dropdownCleanups = [];
    this.dateRangePicker?.close();
    this.dateRangePicker = null;
    this.categoryChips.clear();
    this.selectedCategories.clear();
    this.categoryGroups = [];
    const {contentEl} = this;
    contentEl.empty();
  }
}
