import { Modal, Setting } from 'obsidian';
import { showExpensicaNotice } from './notice';
import { ExportService } from './export-service';
import { CategoryType, formatDate } from './models';
export class ExportModal extends Modal {
    constructor(app, plugin) {
        super(app);
        this.categoryCheckboxes = new Map();
        this.plugin = plugin;
        // Generate default filename based on date
        const today = new Date();
        const formattedDate = formatDate(today);
        // Initialize with default export options
        this.exportOptions = {
            format: 'csv',
            dateFrom: null,
            dateTo: null,
            includeExpenses: true,
            includeIncome: true,
            categories: null,
            filename: `expensica-export-${formattedDate}`
        };
    }
    onOpen() {
        const { contentEl } = this;
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
            this.exportOptions.format = value;
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
            }
            else {
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
    performExport() {
        // Validate export options
        if (!this.exportOptions.includeExpenses && !this.exportOptions.includeIncome) {
            showExpensicaNotice('Please include at least one transaction type (Expenses or Income)');
            return;
        }
        // Get selected categories if not using "select all"
        const selectAllCheckbox = document.getElementById('select-all-categories');
        if (selectAllCheckbox && !selectAllCheckbox.checked) {
            const selectedCategories = [];
            this.categoryCheckboxes.forEach((checkbox, categoryId) => {
                if (checkbox.checked) {
                    selectedCategories.push(categoryId);
                }
            });
            if (selectedCategories.length === 0) {
                showExpensicaNotice('Please select at least one category');
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
            const filteredTransactions = ExportService.filterTransactions(this.plugin.getAllTransactions(), this.exportOptions);
            // Generate export data based on format
            let exportData;
            let mimeType;
            if (this.exportOptions.format === 'csv') {
                exportData = ExportService.generateCSV(filteredTransactions, this.plugin.settings.categories);
                mimeType = 'text/csv';
            }
            else if (this.exportOptions.format === 'json') {
                exportData = ExportService.generateJSON(filteredTransactions);
                mimeType = 'application/json';
            }
            else {
                exportData = ExportService.generatePDF(filteredTransactions, this.plugin.settings.categories, this.plugin.settings.defaultCurrency);
                mimeType = 'application/pdf';
            }
            // Trigger download via browser's native mechanism
            this.downloadFile(exportData, this.exportOptions.filename, mimeType);
            // Show success message
            showExpensicaNotice(`Export completed successfully!`);
            // Close the modal
            this.close();
        }
        catch (error) {
            console.error('Export error:', error);
            showExpensicaNotice('Export failed. Please check the console for errors.');
        }
    }
    downloadFile(content, filename, mimeType) {
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
    renderCategoryCheckboxes(container, type) {
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
            }).innerHTML = `<span class="category-emoji">${this.plugin.getCategoryEmoji(category.id)}</span> ${category.name}`;
        });
    }
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXhwb3J0LW1vZGFsLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiZXhwb3J0LW1vZGFsLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sRUFBTyxLQUFLLEVBQUUsT0FBTyxFQUFFLE1BQU0sVUFBVSxDQUFDO0FBQy9DLE9BQU8sRUFBRSxtQkFBbUIsRUFBRSxNQUFNLFVBQVUsQ0FBQztBQUMvQyxPQUFPLEVBQWlCLGFBQWEsRUFBRSxNQUFNLGtCQUFrQixDQUFDO0FBQ2hFLE9BQU8sRUFBWSxZQUFZLEVBQUUsVUFBVSxFQUFFLE1BQU0sVUFBVSxDQUFDO0FBRzlELE1BQU0sT0FBTyxXQUFZLFNBQVEsS0FBSztJQUtwQyxZQUFZLEdBQVEsRUFBRSxNQUF1QjtRQUMzQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7UUFITCx1QkFBa0IsR0FBa0MsSUFBSSxHQUFHLEVBQUUsQ0FBQztRQUlwRSxJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQztRQUVyQiwwQ0FBMEM7UUFDMUMsTUFBTSxLQUFLLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQztRQUN6QixNQUFNLGFBQWEsR0FBRyxVQUFVLENBQUMsS0FBSyxDQUFDLENBQUM7UUFFeEMseUNBQXlDO1FBQ3pDLElBQUksQ0FBQyxhQUFhLEdBQUc7WUFDbkIsTUFBTSxFQUFFLEtBQUs7WUFDYixRQUFRLEVBQUUsSUFBSTtZQUNkLE1BQU0sRUFBRSxJQUFJO1lBQ1osZUFBZSxFQUFFLElBQUk7WUFDckIsYUFBYSxFQUFFLElBQUk7WUFDbkIsVUFBVSxFQUFFLElBQUk7WUFDaEIsUUFBUSxFQUFFLG9CQUFvQixhQUFhLEVBQUU7U0FDOUMsQ0FBQztJQUNKLENBQUM7SUFFRCxNQUFNO1FBQ0osTUFBTSxFQUFDLFNBQVMsRUFBQyxHQUFHLElBQUksQ0FBQztRQUN6QixTQUFTLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDbEIsU0FBUyxDQUFDLFFBQVEsQ0FBQyxpQkFBaUIsRUFBRSx3QkFBd0Is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QUUsRUFBRTtnQkFDeEMsR0FBRyxFQUFFLG1DQUFtQzthQUN6QyxDQUFDLENBQUMsU0FBUyxHQUFHLGdDQUFnQyxJQUFJLENBQUMsTUFBTSxDQUFDLGdCQUFnQixDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsV0FBVyxRQUFRLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDckgsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQsT0FBTztRQUNMLE1BQU0sRUFBQyxTQUFTLEVBQUMsR0FBRyxJQUFJLENBQUM7UUFDekIsU0FBUyxDQUFDLEtBQUssRUFBRSxDQUFDO0lBQ3BCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFwcCwgTW9kYWwsIFNldHRpbmcgfSBmcm9tICdvYnNpZGlhbic7XG5pbXBvcnQgeyBzaG93RXhwZW5zaWNhTm90aWNlIH0gZnJvbSAnLi9ub3RpY2UnO1xuaW1wb3J0IHsgRXhwb3J0T3B0aW9ucywgRXhwb3J0U2VydmljZSB9IGZyb20gJy4vZXhwb3J0LXNlcnZpY2UnO1xuaW1wb3J0IHsgQ2F0ZWdvcnksIENhdGVnb3J5VHlwZSwgZm9ybWF0RGF0ZSB9IGZyb20gJy4vbW9kZWxzJztcbmltcG9ydCBFeHBlbnNpY2FQbHVnaW4gZnJvbSAnLi4vbWFpbic7XG5cbmV4cG9ydCBjbGFzcyBFeHBvcnRNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgcHJpdmF0ZSBwbHVnaW46IEV4cGVuc2ljYVBsdWdpbjtcbiAgcHJpdmF0ZSBleHBvcnRPcHRpb25zOiBFeHBvcnRPcHRpb25zO1xuICBwcml2YXRlIGNhdGVnb3J5Q2hlY2tib3hlczogTWFwPHN0cmluZywgSFRNTElucHV0RWxlbWVudD4gPSBuZXcgTWFwKCk7XG4gIFxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcGx1Z2luOiBFeHBlbnNpY2FQbHVnaW4pIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICAgIFxuICAgIC8vIEdlbmVyYXRlIGRlZmF1bHQgZmlsZW5hbWUgYmFzZWQgb24gZGF0ZVxuICAgIGNvbnN0IHRvZGF5ID0gbmV3IERhdGUoKTtcbiAgICBjb25zdCBmb3JtYXR0ZWREYXRlID0gZm9ybWF0RGF0ZSh0b2RheSk7XG4gICAgXG4gICAgLy8gSW5pdGlhbGl6ZSB3aXRoIGRlZmF1bHQgZXhwb3J0IG9wdGlvbnNcbiAgICB0aGlzLmV4cG9ydE9wdGlvbnMgPSB7XG4gICAgICBmb3JtYXQ6ICdjc3YnLFxuICAgICAgZGF0ZUZyb206IG51bGwsXG4gICAgICBkYXRlVG86IG51bGwsXG4gICAgICBpbmNsdWRlRXhwZW5zZXM6IHRydWUsXG4gICAgICBpbmNsdWRlSW5jb21lOiB0cnVlLFxuICAgICAgY2F0ZWdvcmllczogbnVsbCwgLy8gbnVsbCBtZWFucyBhbGwgY2F0ZWdvcmllc1xuICAgICAgZmlsZW5hbWU6IGBleHBlbnNpY2EtZXhwb3J0LSR7Zm9ybWF0dGVkRGF0ZX1gXG4gICAgfTtcbiAgfVxuICBcbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHtjb250ZW50RWx9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgICBjb250ZW50RWwuYWRkQ2xhc3MoJ2V4cGVuc2ljYS1tb2RhbCcsICdleHBlbnNpY2EtZXhwb3J0LW1vZGFsJyk7XG4gICAgXG4gICAgLy8gTW9kYWwgaGVhZGVyXG4gICAgY29uc3QgbW9kYWxUaXRsZSA9IGNvbnRlbnRFbC5jcmVhdGVFbCgnaDInLCB7IGNsczogJ2V4cGVuc2ljYS1tb2RhbC10aXRsZScgfSk7XG4gICAgbW9kYWxUaXRsZS5pbm5lckhUTUwgPSAnPHNwYW4gY2xhc3M9XCJleHBlbnNpY2EtbW9kYWwtdGl0bGUtaWNvblwiPvCfk6Q8L3NwYW4+IEV4cG9ydCBUcmFuc2FjdGlvbnMnO1xuICAgIFxuICAgIC8vIENyZWF0ZSBmb3JtIGNvbnRhaW5lclxuICAgIGNvbnN0IGZvcm0gPSBjb250ZW50RWwuY3JlYXRlRWwoJ2Zvcm0nLCB7IGNsczogJ2V4cGVuc2ljYS1mb3JtJyB9KTtcbiAgICBcbiAgICAvLyBFeHBvcnQgZm9ybWF0XG4gICAgbmV3IFNldHRpbmcoZm9ybSlcbiAgICAgIC5zZXROYW1lKCdFeHBvcnQgRm9ybWF0JylcbiAgICAgIC5zZXREZXNjKCdDaG9vc2UgdGhlIGZvcm1hdCBmb3IgeW91ciBleHBvcnRlZCBkYXRhJylcbiAgICAgIC5hZGREcm9wZG93bihkcm9wZG93biA9PiBkcm9wZG93blxuICAgICAgICAuYWRkT3B0aW9uKCdjc3YnLCAnQ1NWIChFeGNlbCwgR29vZ2xlIFNoZWV0cyknKVxuICAgICAgICAuYWRkT3B0aW9uKCdqc29uJywgJ0pTT04gKERhdGEgYmFja3VwKScpXG4gICAgICAgIC5hZGRPcHRpb24oJ3BkZicsICdQREYgKEJlYXV0aWZ1bCByZXBvcnQpJylcbiAgICAgICAgLnNldFZhbHVlKHRoaXMuZXhwb3J0T3B0aW9ucy5mb3JtYXQpXG4gICAgICAgIC5vbkNoYW5nZSh2YWx1ZSA9PiB7XG4gICAgICAgICAgdGhpcy5leHBvcnRPcHRpb25zLmZvcm1hdCA9IHZhbHVlIGFzICdjc3YnIHwgJ2pzb24nIHwgJ3BkZic7XG4gICAgICAgICAgLy8gVXBkYXRlIGZpbGVuYW1lIGV4dGVuc2lvblxuICAgICAgICAgIGNvbnN0IGZpbGVuYW1lID0gdGhpcy5leHBvcnRPcHRpb25zLmZpbGVuYW1lO1xuICAgICAgICAgIC8vIFJlbW92ZSBvbGQgZXh0ZW5zaW9uIGlmIGV4aXN0c1xuICAgICAgICAgIGNvbnN0IG5hbWVXaXRob3V0RXh0ID0gZmlsZW5hbWUuaW5jbHVkZXMoJy4nKSBcbiAgICAgICAgICAgID8gZmlsZW5hbWUuc3Vic3RyaW5nKDAsIGZpbGVuYW1lLmxhc3RJbmRleE9mKCcuJykpIFxuICAgICAgICAgICAgOiBmaWxlbmFtZTtcbiAgICAgICAgICB0aGlzLmV4cG9ydE9wdGlvbnMuZmlsZW5hbWUgPSBgJHtuYW1lV2l0aG91dEV4dH0uJHt2YWx1ZX1gO1xuICAgICAgICB9KSk7XG4gICAgXG4gICAgLy8gRGF0ZSByYW5nZVxuICAgIGNvbnN0IGRhdGVSYW5nZUNvbnRhaW5lciA9IGZvcm0uY3JlYXRlRGl2KCdleHBlbnNpY2Etc2V0dGluZy1ncm91cCcpO1xuICAgIGRhdGVSYW5nZUNvbnRhaW5lci5jcmVhdGVFbCgnaDMnLCB7IHRleHQ6ICdEYXRlIFJhbmdlJywgY2xzOiAnZXhwZW5zaWNhLXNldHRpbmctZ3JvdXAtdGl0bGUnIH0pO1xuICAgIFxuICAgIG5ldyBTZXR0aW5nKGRhdGVSYW5nZUNvbnRhaW5lcilcbiAgICAgIC5zZXROYW1lKCdGcm9tIERhdGUnKVxuICAgICAgLnNldERlc2MoJ0V4cG9ydCB0cmFuc2FjdGlvbnMgZnJvbSB0aGlzIGRhdGUgKG9wdGlvbmFsKScpXG4gICAgICAuYWRkVGV4dCh0ZXh0ID0+IHRleHRcbiAgICAgICAgLnNldFBsYWNlaG9sZGVyKCdZWVlZLU1NLUREJylcbiAgICAgICAgLnNldFZhbHVlKHRoaXMuZXhwb3J0T3B0aW9ucy5kYXRlRnJvbSB8fCAnJylcbiAgICAgICAgLm9uQ2hhbmdlKHZhbHVlID0+IHtcbiAgICAgICAgICB0aGlzLmV4cG9ydE9wdGlvbnMuZGF0ZUZyb20gPSB2YWx1ZSA/IHZhbHVlIDogbnVsbDtcbiAgICAgICAgfSkpO1xuICAgIFxuICAgIG5ldyBTZXR0aW5nKGRhdGVSYW5nZUNvbnRhaW5lcilcbiAgICAgIC5zZXROYW1lKCdUbyBEYXRlJylcbiAgICAgIC5zZXREZXNjKCdFeHBvcnQgdHJhbnNhY3Rpb25zIHVudGlsIHRoaXMgZGF0ZSAob3B0aW9uYWwpJylcbiAgICAgIC5hZGRUZXh0KHRleHQgPT4gdGV4dFxuICAgICAgICAuc2V0UGxhY2Vob2xkZXIoJ1lZWVktTU0tREQnKVxuICAgICAgICAuc2V0VmFsdWUodGhpcy5leHBvcnRPcHRpb25zLmRhdGVUbyB8fCAnJylcbiAgICAgICAgLm9uQ2hhbmdlKHZhbHVlID0+IHtcbiAgICAgICAgICB0aGlzLmV4cG9ydE9wdGlvbnMuZGF0ZVRvID0gdmFsdWUgPyB2YWx1ZSA6IG51bGw7XG4gICAgICAgIH0pKTtcbiAgICBcbiAgICAvLyBUcmFuc2FjdGlvbiBUeXBlc1xuICAgIGNvbnN0IHR5cGVDb250YWluZXIgPSBmb3JtLmNyZWF0ZURpdignZXhwZW5zaWNhLXNldHRpbmctZ3JvdXAnKTtcbiAgICB0eXBlQ29udGFpbmVyLmNyZWF0ZUVsKCdoMycsIHsgdGV4dDogJ1RyYW5zYWN0aW9uIFR5cGVzJywgY2xzOiAnZXhwZW5zaWNhLXNldHRpbmctZ3JvdXAtdGl0bGUnIH0pO1xuICAgIFxuICAgIG5ldyBTZXR0aW5nKHR5cGVDb250YWluZXIpXG4gICAgICAuc2V0TmFtZSgnSW5jbHVkZSBFeHBlbnNlcycpXG4gICAgICAuYWRkVG9nZ2xlKHRvZ2dsZSA9PiB0b2dnbGVcbiAgICAgICAgLnNldFZhbHVlKHRoaXMuZXhwb3J0T3B0aW9ucy5pbmNsdWRlRXhwZW5zZXMpXG4gICAgICAgIC5vbkNoYW5nZSh2YWx1ZSA9PiB7XG4gICAgICAgICAgdGhpcy5leHBvcnRPcHRpb25zLmluY2x1ZGVFeHBlbnNlcyA9IHZhbHVlO1xuICAgICAgICB9KSk7XG4gICAgXG4gICAgbmV3IFNldHRpbmcodHlwZUNvbnRhaW5lcilcbiAgICAgIC5zZXROYW1lKCdJbmNsdWRlIEluY29tZScpXG4gICAgICAuYWRkVG9nZ2xlKHRvZ2dsZSA9PiB0b2dnbGVcbiAgICAgICAgLnNldFZhbHVlKHRoaXMuZXhwb3J0T3B0aW9ucy5pbmNsdWRlSW5jb21lKVxuICAgICAgICAub25DaGFuZ2UodmFsdWUgPT4ge1xuICAgICAgICAgIHRoaXMuZXhwb3J0T3B0aW9ucy5pbmNsdWRlSW5jb21lID0gdmFsdWU7XG4gICAgICAgIH0pKTtcbiAgICBcbiAgICAvLyBDYXRlZ29yaWVzXG4gICAgY29uc3QgY2F0ZWdvcmllc0NvbnRhaW5lciA9IGZvcm0uY3JlYXRlRGl2KCdleHBlbnNpY2Etc2V0dGluZy1ncm91cCcpO1xuICAgIGNhdGVnb3JpZXNDb250YWluZXIuY3JlYXRlRWwoJ2gzJywgeyB0ZXh0OiAnQ2F0ZWdvcmllcyB0byBJbmNsdWRlJywgY2xzOiAnZXhwZW5zaWNhLXNldHRpbmctZ3JvdXAtdGl0bGUnIH0pO1xuICAgIFxuICAgIC8vIEFkZCBhIFwiU2VsZWN0IEFsbFwiIGNoZWNrYm94XG4gICAgY29uc3Qgc2VsZWN0QWxsQ29udGFpbmVyID0gY2F0ZWdvcmllc0NvbnRhaW5lci5jcmVhdGVEaXYoJ2V4cGVuc2ljYS1zZWxlY3QtYWxsJyk7XG4gICAgY29uc3Qgc2VsZWN0QWxsQ2hlY2tib3ggPSBzZWxlY3RBbGxDb250YWluZXIuY3JlYXRlRWwoJ2lucHV0JywgeyBcbiAgICAgIHR5cGU6ICdjaGVja2JveCcsXG4gICAgICBhdHRyOiB7IGlkOiAnc2VsZWN0LWFsbC1jYXRlZ29yaWVzJyB9XG4gICAgfSk7XG4gICAgc2VsZWN0QWxsQ29udGFpbmVyLmNyZWF0ZUVsKCdsYWJlbCcsIHsgXG4gICAgICB0ZXh0OiAnU2VsZWN0IEFsbCBDYXRlZ29yaWVzJyxcbiAgICAgIGF0dHI6IHsgZm9yOiAnc2VsZWN0LWFsbC1jYXRlZ29yaWVzJyB9XG4gICAgfSk7XG4gICAgc2VsZWN0QWxsQ2hlY2tib3guY2hlY2tlZCA9IHRydWU7XG4gICAgXG4gICAgLy8gQWRkIGV2ZW50IGxpc3RlbmVyIGZvciBcIlNlbGVjdCBBbGxcIlxuICAgIHNlbGVjdEFsbENoZWNrYm94LmFkZEV2ZW50TGlzdGVuZXIoJ2NoYW5nZScsICgpID0+IHtcbiAgICAgIGNvbnN0IGNoZWNrZWQgPSBzZWxlY3RBbGxDaGVja2JveC5jaGVja2VkO1xuICAgICAgdGhpcy5jYXRlZ29yeUNoZWNrYm94ZXMuZm9yRWFjaChjaGVja2JveCA9PiB7XG4gICAgICAgIGNoZWNrYm94LmNoZWNrZWQgPSBjaGVja2VkO1xuICAgICAgfSk7XG4gICAgICBcbiAgICAgIC8vIFVwZGF0ZSBleHBvcnQgb3B0aW9uc1xuICAgICAgaWYgKGNoZWNrZWQpIHtcbiAgICAgICAgdGhpcy5leHBvcnRPcHRpb25zLmNhdGVnb3JpZXMgPSBudWxsOyAvLyBBbGwgY2F0ZWdvcmllc1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5leHBvcnRPcHRpb25zLmNhdGVnb3JpZXMgPSBbXTsgLy8gTm8gY2F0ZWdvcmllc1xuICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIC8vIENyZWF0ZSBjYXRlZ29yaWVzIHNlY3Rpb25cbiAgICBjb25zdCBjYXRlZ29yeUxpc3QgPSBjYXRlZ29yaWVzQ29udGFpbmVyLmNyZWF0ZURpdignZXhwZW5zaWNhLWNhdGVnb3J5LWxpc3QnKTtcbiAgICBcbiAgICAvLyBFeHBlbnNlIGNhdGVnb3JpZXNcbiAgICBjb25zdCBleHBlbnNlQ2F0ZWdvcmllc0NvbnRhaW5lciA9IGNhdGVnb3J5TGlzdC5jcmVhdGVEaXYoJ2V4cGVuc2ljYS1jYXRlZ29yeS1ncm91cCcpO1xuICAgIGV4cGVuc2VDYXRlZ29yaWVzQ29udGFpbmVyLmNyZWF0ZUVsKCdoNCcsIHsgdGV4dDogJ0V4cGVuc2UgQ2F0ZWdvcmllcycgfSk7XG4gICAgdGhpcy5yZW5kZXJDYXRlZ29yeUNoZWNrYm94ZXMoZXhwZW5zZUNhdGVnb3JpZXNDb250YWluZXIsIENhdGVnb3J5VHlwZS5FWFBFTlNFKTtcbiAgICBcbiAgICAvLyBJbmNvbWUgY2F0ZWdvcmllc1xuICAgIGNvbnN0IGluY29tZUNhdGVnb3JpZXNDb250YWluZXIgPSBjYXRlZ29yeUxpc3QuY3JlYXRlRGl2KCdleHBlbnNpY2EtY2F0ZWdvcnktZ3JvdXAnKTtcbiAgICBpbmNvbWVDYXRlZ29yaWVzQ29udGFpbmVyLmNyZWF0ZUVsKCdoNCcsIHsgdGV4dDogJ0luY29tZSBDYXRlZ29yaWVzJyB9KTtcbiAgICB0aGlzLnJlbmRlckNhdGVnb3J5Q2hlY2tib3hlcyhpbmNvbWVDYXRlZ29yaWVzQ29udGFpbmVyLCBDYXRlZ29yeVR5cGUuSU5DT01FKTtcbiAgICBcbiAgICAvLyBBZGQgZmlsZW5hbWUgc2V0dGluZyB3aXRoIGRlZmF1bHQgbmFtZVxuICAgIGNvbnN0IGZpbGVuYW1lQ29udGFpbmVyID0gZm9ybS5jcmVhdGVEaXYoJ2V4cGVuc2ljYS1zZXR0aW5nLWdyb3VwJyk7XG4gICAgZmlsZW5hbWVDb250YWluZXIuY3JlYXRlRWwoJ2gzJywgeyB0ZXh0OiAnRmlsZW5hbWUnLCBjbHM6ICdleHBlbnNpY2Etc2V0dGluZy1ncm91cC10aXRsZScgfSk7XG4gICAgXG4gICAgbmV3IFNldHRpbmcoZmlsZW5hbWVDb250YWluZXIpXG4gICAgICAuc2V0TmFtZSgnRXhwb3J0IEZpbGVuYW1lJylcbiAgICAgIC5zZXREZXNjKCdFbnRlciB0aGUgbmFtZSBmb3IgeW91ciBleHBvcnQgZmlsZScpXG4gICAgICAuYWRkVGV4dCh0ZXh0ID0+IHRleHRcbiAgICAgICAgLnNldFZhbHVlKHRoaXMuZXhwb3J0T3B0aW9ucy5maWxlbmFtZSlcbiAgICAgICAgLm9uQ2hhbmdlKHZhbHVlID0+IHtcbiAgICAgICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgICAgIHRoaXMuZXhwb3J0T3B0aW9ucy5maWxlbmFtZSA9IHZhbHVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfSkpO1xuICAgIFxuICAgIC8vIEJ1dHRvbnNcbiAgICBjb25zdCBmb3JtRm9vdGVyID0gZm9ybS5jcmVhdGVEaXYoJ2V4cGVuc2ljYS1mb3JtLWZvb3RlcicpO1xuICAgIGNvbnN0IGNhbmNlbEJ0biA9IGZvcm1Gb290ZXIuY3JlYXRlRWwoJ2J1dHRvbicsIHtcbiAgICAgIHRleHQ6ICdDYW5jZWwnLFxuICAgICAgY2xzOiAnZXhwZW5zaWNhLWJ0biBleHBlbnNpY2EtYnRuLXNlY29uZGFyeScsXG4gICAgICBhdHRyOiB7IHR5cGU6ICdidXR0b24nIH1cbiAgICB9KTtcbiAgICBcbiAgICBjb25zdCBleHBvcnRCdG4gPSBmb3JtRm9vdGVyLmNyZWF0ZUVsKCdidXR0b24nLCB7XG4gICAgICB0ZXh0OiAnRXhwb3J0JyxcbiAgICAgIGNsczogJ2V4cGVuc2ljYS1idG4gZXhwZW5zaWNhLWJ0bi1wcmltYXJ5JyxcbiAgICAgIGF0dHI6IHsgdHlwZTogJ2J1dHRvbicgfVxuICAgIH0pO1xuICAgIFxuICAgIC8vIEJ1dHRvbiBldmVudCBsaXN0ZW5lcnNcbiAgICBjYW5jZWxCdG4uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XG4gICAgICB0aGlzLmNsb3NlKCk7XG4gICAgfSk7XG4gICAgXG4gICAgZXhwb3J0QnRuLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4ge1xuICAgICAgdGhpcy5wZXJmb3JtRXhwb3J0KCk7XG4gICAgfSk7XG4gIH1cbiAgXG4gIHByaXZhdGUgcGVyZm9ybUV4cG9ydCgpIHtcbiAgICAvLyBWYWxpZGF0ZSBleHBvcnQgb3B0aW9uc1xuICAgIGlmICghdGhpcy5leHBvcnRPcHRpb25zLmluY2x1ZGVFeHBlbnNlcyAmJiAhdGhpcy5leHBvcnRPcHRpb25zLmluY2x1ZGVJbmNvbWUpIHtcbiAgICAgIHNob3dFeHBlbnNpY2FOb3RpY2UoJ1BsZWFzZSBpbmNsdWRlIGF0IGxlYXN0IG9uZSB0cmFuc2FjdGlvbiB0eXBlIChFeHBlbnNlcyBvciBJbmNvbWUpJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIFxuICAgIC8vIEdldCBzZWxlY3RlZCBjYXRlZ29yaWVzIGlmIG5vdCB1c2luZyBcInNlbGVjdCBhbGxcIlxuICAgIGNvbnN0IHNlbGVjdEFsbENoZWNrYm94ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlbGVjdC1hbGwtY2F0ZWdvcmllcycpIGFzIEhUTUxJbnB1dEVsZW1lbnQ7XG4gICAgaWYgKHNlbGVjdEFsbENoZWNrYm94ICYmICFzZWxlY3RBbGxDaGVja2JveC5jaGVja2VkKSB7XG4gICAgICBjb25zdCBzZWxlY3RlZENhdGVnb3JpZXM6IHN0cmluZ1tdID0gW107XG4gICAgICB0aGlzLmNhdGVnb3J5Q2hlY2tib3hlcy5mb3JFYWNoKChjaGVja2JveCwgY2F0ZWdvcnlJZCkgPT4ge1xuICAgICAgICBpZiAoY2hlY2tib3guY2hlY2tlZCkge1xuICAgICAgICAgIHNlbGVjdGVkQ2F0ZWdvcmllcy5wdXNoKGNhdGVnb3J5SWQpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIFxuICAgICAgaWYgKHNlbGVjdGVkQ2F0ZWdvcmllcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgc2hvd0V4cGVuc2ljYU5vdGljZSgnUGxlYXNlIHNlbGVjdCBhdCBsZWFzdCBvbmUgY2F0ZWdvcnknKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgXG4gICAgICB0aGlzLmV4cG9ydE9wdGlvbnMuY2F0ZWdvcmllcyA9IHNlbGVjdGVkQ2F0ZWdvcmllcztcbiAgICB9XG4gICAgXG4gICAgLy8gRW5zdXJlIGZpbGVuYW1lIGhhcyBjb3JyZWN0IGV4dGVuc2lvblxuICAgIGlmICghdGhpcy5leHBvcnRPcHRpb25zLmZpbGVuYW1lLmVuZHNXaXRoKGAuJHt0aGlzLmV4cG9ydE9wdGlvbnMuZm9ybWF0fWApKSB7XG4gICAgICB0aGlzLmV4cG9ydE9wdGlvbnMuZmlsZW5hbWUgKz0gYC4ke3RoaXMuZXhwb3J0T3B0aW9ucy5mb3JtYXR9YDtcbiAgICB9XG4gICAgXG4gICAgdHJ5IHtcbiAgICAgIC8vIEdlbmVyYXRlIHRoZSBleHBvcnQgZGF0YVxuICAgICAgY29uc3QgZmlsdGVyZWRUcmFuc2FjdGlvbnMgPSBFeHBvcnRTZXJ2aWNlLmZpbHRlclRyYW5zYWN0aW9ucyhcbiAgICAgICAgdGhpcy5wbHVnaW4uZ2V0QWxsVHJhbnNhY3Rpb25zKCksXG4gICAgICAgIHRoaXMuZXhwb3J0T3B0aW9uc1xuICAgICAgKTtcbiAgICAgIFxuICAgICAgLy8gR2VuZXJhdGUgZXhwb3J0IGRhdGEgYmFzZWQgb24gZm9ybWF0XG4gICAgICBsZXQgZXhwb3J0RGF0YTogc3RyaW5nIHwgVWludDhBcnJheTtcbiAgICAgIGxldCBtaW1lVHlwZTogc3RyaW5nO1xuICAgICAgXG4gICAgICBpZiAodGhpcy5leHBvcnRPcHRpb25zLmZvcm1hdCA9PT0gJ2NzdicpIHtcbiAgICAgICAgZXhwb3J0RGF0YSA9IEV4cG9ydFNlcnZpY2UuZ2VuZXJhdGVDU1YoZmlsdGVyZWRUcmFuc2FjdGlvbnMsIHRoaXMucGx1Z2luLnNldHRpbmdzLmNhdGVnb3JpZXMpO1xuICAgICAgICBtaW1lVHlwZSA9ICd0ZXh0L2Nzdic7XG4gICAgICB9IGVsc2UgaWYgKHRoaXMuZXhwb3J0T3B0aW9ucy5mb3JtYXQgPT09ICdqc29uJykge1xuICAgICAgICBleHBvcnREYXRhID0gRXhwb3J0U2VydmljZS5nZW5lcmF0ZUpTT04oZmlsdGVyZWRUcmFuc2FjdGlvbnMpO1xuICAgICAgICBtaW1lVHlwZSA9ICdhcHBsaWNhdGlvbi9qc29uJztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGV4cG9ydERhdGEgPSBFeHBvcnRTZXJ2aWNlLmdlbmVyYXRlUERGKFxuICAgICAgICAgIGZpbHRlcmVkVHJhbnNhY3Rpb25zLCBcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jYXRlZ29yaWVzLFxuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmRlZmF1bHRDdXJyZW5jeVxuICAgICAgICApO1xuICAgICAgICBtaW1lVHlwZSA9ICdhcHBsaWNhdGlvbi9wZGYnO1xuICAgICAgfVxuICAgICAgXG4gICAgICAvLyBUcmlnZ2VyIGRvd25sb2FkIHZpYSBicm93c2VyJ3MgbmF0aXZlIG1lY2hhbmlzbVxuICAgICAgdGhpcy5kb3dubG9hZEZpbGUoZXhwb3J0RGF0YSwgdGhpcy5leHBvcnRPcHRpb25zLmZpbGVuYW1lLCBtaW1lVHlwZSk7XG4gICAgICBcbiAgICAgIC8vIFNob3cgc3VjY2VzcyBtZXNzYWdlXG4gICAgICBzaG93RXhwZW5zaWNhTm90aWNlKGBFeHBvcnQgY29tcGxldGVkIHN1Y2Nlc3NmdWxseSFgKTtcbiAgICAgIFxuICAgICAgLy8gQ2xvc2UgdGhlIG1vZGFsXG4gICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICBcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcignRXhwb3J0IGVycm9yOicsIGVycm9yKTtcbiAgICAgIHNob3dFeHBlbnNpY2FOb3RpY2UoJ0V4cG9ydCBmYWlsZWQuIFBsZWFzZSBjaGVjayB0aGUgY29uc29sZSBmb3IgZXJyb3JzLicpO1xuICAgIH1cbiAgfVxuICBcbiAgcHJpdmF0ZSBkb3dubG9hZEZpbGUoY29udGVudDogc3RyaW5nIHwgVWludDhBcnJheSwgZmlsZW5hbWU6IHN0cmluZywgbWltZVR5cGU6IHN0cmluZykge1xuICAgIC8vIENyZWF0ZSBhIGJsb2Igd2l0aCB0aGUgZGF0YVxuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbY29udGVudF0sIHsgdHlwZTogbWltZVR5cGUgfSk7XG4gICAgXG4gICAgLy8gQ3JlYXRlIGEgdGVtcG9yYXJ5IFVSTCBmb3IgdGhlIGJsb2JcbiAgICBjb25zdCB1cmwgPSB3aW5kb3cuVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgICBcbiAgICAvLyBDcmVhdGUgYSB0ZW1wb3JhcnkgbGluayBlbGVtZW50XG4gICAgY29uc3QgZG93bmxvYWRMaW5rID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICAgIGRvd25sb2FkTGluay5ocmVmID0gdXJsO1xuICAgIGRvd25sb2FkTGluay5kb3dubG9hZCA9IGZpbGVuYW1lO1xuICAgIFxuICAgIC8vIEFkZCB0aGUgbGluayB0byB0aGUgZG9jdW1lbnRcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGRvd25sb2FkTGluayk7XG4gICAgXG4gICAgLy8gUHJvZ3JhbW1hdGljYWxseSBjbGljayB0aGUgbGluayB0byB0cmlnZ2VyIHRoZSBkb3dubG9hZFxuICAgIGRvd25sb2FkTGluay5jbGljaygpO1xuICAgIFxuICAgIC8vIENsZWFuIHVwIGJ5IHJlbW92aW5nIHRoZSBsaW5rIGFuZCByZXZva2luZyB0aGUgVVJMXG4gICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChkb3dubG9hZExpbmspO1xuICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgd2luZG93LlVSTC5yZXZva2VPYmplY3RVUkwodXJsKTtcbiAgICB9LCAxMDApO1xuICB9XG4gIFxuICBwcml2YXRlIHJlbmRlckNhdGVnb3J5Q2hlY2tib3hlcyhjb250YWluZXI6IEhUTUxFbGVtZW50LCB0eXBlOiBDYXRlZ29yeVR5cGUpIHtcbiAgICBjb25zdCBjYXRlZ29yaWVzID0gdGhpcy5wbHVnaW4uZ2V0Q2F0ZWdvcmllcyh0eXBlKTtcbiAgICBcbiAgICAvLyBDcmVhdGUgYSBncmlkIGZvciBjaGVja2JveGVzXG4gICAgY29uc3QgZ3JpZCA9IGNvbnRhaW5lci5jcmVhdGVEaXYoJ2V4cGVuc2ljYS1jYXRlZ29yeS1jaGVja2JveC1ncmlkJyk7XG4gICAgXG4gICAgY2F0ZWdvcmllcy5mb3JFYWNoKGNhdGVnb3J5ID0+IHtcbiAgICAgIGNvbnN0IGNhdGVnb3J5Q29udGFpbmVyID0gZ3JpZC5jcmVhdGVEaXYoJ2V4cGVuc2ljYS1jYXRlZ29yeS1jaGVja2JveCcpO1xuICAgICAgXG4gICAgICAvLyBDcmVhdGUgY2hlY2tib3hcbiAgICAgIGNvbnN0IGNoZWNrYm94ID0gY2F0ZWdvcnlDb250YWluZXIuY3JlYXRlRWwoJ2lucHV0Jywge1xuICAgICAgICB0eXBlOiAnY2hlY2tib3gnLFxuICAgICAgICBhdHRyOiB7XG4gICAgICAgICAgaWQ6IGBjYXRlZ29yeS0ke2NhdGVnb3J5LmlkfWAsXG4gICAgICAgICAgY2hlY2tlZDogdHJ1ZVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIFxuICAgICAgLy8gU3RvcmUgcmVmZXJlbmNlIHRvIHRoZSBjaGVja2JveFxuICAgICAgdGhpcy5jYXRlZ29yeUNoZWNrYm94ZXMuc2V0KGNhdGVnb3J5LmlkLCBjaGVja2JveCk7XG4gICAgICBcbiAgICAgIC8vIENyZWF0ZSBsYWJlbFxuICAgICAgY2F0ZWdvcnlDb250YWluZXIuY3JlYXRlRWwoJ2xhYmVsJywge1xuICAgICAgICBhdHRyOiB7IGZvcjogYGNhdGVnb3J5LSR7Y2F0ZWdvcnkuaWR9YCB9LFxuICAgICAgICBjbHM6ICdleHBlbnNpY2EtY2F0ZWdvcnktY2hlY2tib3gtbGFiZWwnXG4gICAgICB9KS5pbm5lckhUTUwgPSBgPHNwYW4gY2xhc3M9XCJjYXRlZ29yeS1lbW9qaVwiPiR7dGhpcy5wbHVnaW4uZ2V0Q2F0ZWdvcnlFbW9qaShjYXRlZ29yeS5pZCl9PC9zcGFuPiAke2NhdGVnb3J5Lm5hbWV9YDtcbiAgICB9KTtcbiAgfVxuICBcbiAgb25DbG9zZSgpIHtcbiAgICBjb25zdCB7Y29udGVudEVsfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG4gIH1cbn1cbiJdfQ==