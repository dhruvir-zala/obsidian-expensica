import { App, Modal, Setting, Notice } from 'obsidian';
import { ExportOptions, ExportService } from './export-service';
import { Category, CategoryType } from './models';
import ExpensicaPlugin from '../main';

export class ExportModal extends Modal {
  private plugin: ExpensicaPlugin;
  private exportOptions: ExportOptions;
  private categoryCheckboxes: Map<string, HTMLInputElement> = new Map();
  
  constructor(app: App, plugin: ExpensicaPlugin) {
    super(app);
    this.plugin = plugin;
    
    // Generate default filename based on date
    const today = new Date();
    const formattedDate = today.toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Initialize with default export options
    this.exportOptions = {
      format: 'csv',
      dateFrom: null,
      dateTo: null,
      includeExpenses: true,
      includeIncome: true,
      categories: null, // null means all categories
      filename: `expensica-export-${formattedDate}`
    };
  }
  
  onOpen() {
    const {contentEl} = this;
    contentEl.empty();
    contentEl.addClass('expensica-modal', 'expensica-export-modal');
    
    // Modal header
    const modalTitle = contentEl.createEl('h2', { cls: 'expensica-modal-title' });
    modalTitle.innerHTML = '<span class="expensica-modal-title-icon">📤</span> Export Transactions';
    
    // Create form container
    const form = contentEl.createEl('form', { cls: 'expensica-form' });
    
    // Export format
    new Setting(form)
      .setName('Export Format')
      .setDesc('Choose the format for your exported data')
      .addDropdown(dropdown => dropdown
        .addOption('csv', 'CSV (Excel, Google Sheets)')
        .addOption('json', 'JSON (Data backup)')
        .addOption('pdf', 'PDF (Beautiful report)')
        .setValue(this.exportOptions.format)
        .onChange(value => {
          this.exportOptions.format = value as 'csv' | 'json' | 'pdf';
          // Update filename extension
          const filename = this.exportOptions.filename;
          // Remove old extension if exists
          const nameWithoutExt = filename.includes('.') 
            ? filename.substring(0, filename.lastIndexOf('.')) 
            : filename;
          this.exportOptions.filename = `${nameWithoutExt}.${value}`;
        }));
    
    // Date range
    const dateRangeContainer = form.createDiv('expensica-setting-group');
    dateRangeContainer.createEl('h3', { text: 'Date Range', cls: 'expensica-setting-group-title' });
    
    new Setting(dateRangeContainer)
      .setName('From Date')
      .setDesc('Export transactions from this date (optional)')
      .addText(text => text
        .setPlaceholder('YYYY-MM-DD')
        .setValue(this.exportOptions.dateFrom || '')
        .onChange(value => {
          this.exportOptions.dateFrom = value ? value : null;
        }));
    
    new Setting(dateRangeContainer)
      .setName('To Date')
      .setDesc('Export transactions until this date (optional)')
      .addText(text => text
        .setPlaceholder('YYYY-MM-DD')
        .setValue(this.exportOptions.dateTo || '')
        .onChange(value => {
          this.exportOptions.dateTo = value ? value : null;
        }));
    
    // Transaction Types
    const typeContainer = form.createDiv('expensica-setting-group');
    typeContainer.createEl('h3', { text: 'Transaction Types', cls: 'expensica-setting-group-title' });
    
    new Setting(typeContainer)
      .setName('Include Expenses')
      .addToggle(toggle => toggle
        .setValue(this.exportOptions.includeExpenses)
        .onChange(value => {
          this.exportOptions.includeExpenses = value;
        }));
    
    new Setting(typeContainer)
      .setName('Include Income')
      .addToggle(toggle => toggle
        .setValue(this.exportOptions.includeIncome)
        .onChange(value => {
          this.exportOptions.includeIncome = value;
        }));
    
    // Categories
    const categoriesContainer = form.createDiv('expensica-setting-group');
    categoriesContainer.createEl('h3', { text: 'Categories to Include', cls: 'expensica-setting-group-title' });
    
    // Add a "Select All" checkbox
    const selectAllContainer = categoriesContainer.createDiv('expensica-select-all');
    const selectAllCheckbox = selectAllContainer.createEl('input', { 
      type: 'checkbox',
      attr: { id: 'select-all-categories' }
    });
    selectAllContainer.createEl('label', { 
      text: 'Select All Categories',
      attr: { for: 'select-all-categories' }
    });
    selectAllCheckbox.checked = true;
    
    // Add event listener for "Select All"
    selectAllCheckbox.addEventListener('change', () => {
      const checked = selectAllCheckbox.checked;
      this.categoryCheckboxes.forEach(checkbox => {
        checkbox.checked = checked;
      });
      
      // Update export options
      if (checked) {
        this.exportOptions.categories = null; // All categories
      } else {
        this.exportOptions.categories = []; // No categories
      }
    });
    
    // Create categories section
    const categoryList = categoriesContainer.createDiv('expensica-category-list');
    
    // Expense categories
    const expenseCategoriesContainer = categoryList.createDiv('expensica-category-group');
    expenseCategoriesContainer.createEl('h4', { text: 'Expense Categories' });
    this.renderCategoryCheckboxes(expenseCategoriesContainer, CategoryType.EXPENSE);
    
    // Income categories
    const incomeCategoriesContainer = categoryList.createDiv('expensica-category-group');
    incomeCategoriesContainer.createEl('h4', { text: 'Income Categories' });
    this.renderCategoryCheckboxes(incomeCategoriesContainer, CategoryType.INCOME);
    
    // Add filename setting with default name
    const filenameContainer = form.createDiv('expensica-setting-group');
    filenameContainer.createEl('h3', { text: 'Filename', cls: 'expensica-setting-group-title' });
    
    new Setting(filenameContainer)
      .setName('Export Filename')
      .setDesc('Enter the name for your export file')
      .addText(text => text
        .setValue(this.exportOptions.filename)
        .onChange(value => {
          if (value) {
            this.exportOptions.filename = value;
          }
        }));
    
    // Buttons
    const formFooter = form.createDiv('expensica-form-footer');
    const cancelBtn = formFooter.createEl('button', {
      text: 'Cancel',
      cls: 'expensica-btn expensica-btn-secondary',
      attr: { type: 'button' }
    });
    
    const exportBtn = formFooter.createEl('button', {
      text: 'Export',
      cls: 'expensica-btn expensica-btn-primary',
      attr: { type: 'button' }
    });
    
    // Button event listeners
    cancelBtn.addEventListener('click', () => {
      this.close();
    });
    
    exportBtn.addEventListener('click', () => {
      this.performExport();
    });
  }
  
  private performExport() {
    // Validate export options
    if (!this.exportOptions.includeExpenses && !this.exportOptions.includeIncome) {
      new Notice('Please include at least one transaction type (Expenses or Income)');
      return;
    }
    
    // Get selected categories if not using "select all"
    const selectAllCheckbox = document.getElementById('select-all-categories') as HTMLInputElement;
    if (selectAllCheckbox && !selectAllCheckbox.checked) {
      const selectedCategories: string[] = [];
      this.categoryCheckboxes.forEach((checkbox, categoryId) => {
        if (checkbox.checked) {
          selectedCategories.push(categoryId);
        }
      });
      
      if (selectedCategories.length === 0) {
        new Notice('Please select at least one category');
        return;
      }
      
      this.exportOptions.categories = selectedCategories;
    }
    
    // Ensure filename has correct extension
    if (!this.exportOptions.filename.endsWith(`.${this.exportOptions.format}`)) {
      this.exportOptions.filename += `.${this.exportOptions.format}`;
    }
    
    try {
      // Generate the export data
      const filteredTransactions = ExportService.filterTransactions(
        this.plugin.getAllTransactions(),
        this.exportOptions
      );
      
      // Generate export data based on format
      let exportData: string | Uint8Array;
      let mimeType: string;
      
      if (this.exportOptions.format === 'csv') {
        exportData = ExportService.generateCSV(filteredTransactions, this.plugin.settings.categories);
        mimeType = 'text/csv';
      } else if (this.exportOptions.format === 'json') {
        exportData = ExportService.generateJSON(filteredTransactions);
        mimeType = 'application/json';
      } else {
        exportData = ExportService.generatePDF(
          filteredTransactions, 
          this.plugin.settings.categories,
          this.plugin.settings.defaultCurrency
        );
        mimeType = 'application/pdf';
      }
      
      // Trigger download via browser's native mechanism
      this.downloadFile(exportData, this.exportOptions.filename, mimeType);
      
      // Show success message
      new Notice(`Export completed successfully!`);
      
      // Close the modal
      this.close();
      
    } catch (error) {
      console.error('Export error:', error);
      new Notice('Export failed. Please check the console for errors.');
    }
  }
  
  private downloadFile(content: string | Uint8Array, filename: string, mimeType: string) {
    // Create a blob with the data
    const blob = new Blob([content], { type: mimeType });
    
    // Create a temporary URL for the blob
    const url = window.URL.createObjectURL(blob);
    
    // Create a temporary link element
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = filename;
    
    // Add the link to the document
    document.body.appendChild(downloadLink);
    
    // Programmatically click the link to trigger the download
    downloadLink.click();
    
    // Clean up by removing the link and revoking the URL
    document.body.removeChild(downloadLink);
    setTimeout(() => {
      window.URL.revokeObjectURL(url);
    }, 100);
  }
  
  private renderCategoryCheckboxes(container: HTMLElement, type: CategoryType) {
    const categories = this.plugin.getCategories(type);
    
    // Create a grid for checkboxes
    const grid = container.createDiv('expensica-category-checkbox-grid');
    
    categories.forEach(category => {
      const categoryContainer = grid.createDiv('expensica-category-checkbox');
      
      // Create checkbox
      const checkbox = categoryContainer.createEl('input', {
        type: 'checkbox',
        attr: {
          id: `category-${category.id}`,
          checked: true
        }
      });
      
      // Store reference to the checkbox
      this.categoryCheckboxes.set(category.id, checkbox);
      
      // Create label
      categoryContainer.createEl('label', {
        attr: { for: `category-${category.id}` },
        cls: 'expensica-category-checkbox-label'
      }).innerHTML = `<span class="category-emoji">${category.emoji}</span> ${category.name}`;
    });
  }
  
  onClose() {
    const {contentEl} = this;
    contentEl.empty();
  }
}