import { Transaction, TransactionType, Category, formatCurrency, formatDate, parseLocalDate, sortTransactionsByDateTimeDesc } from './models';
import { autoTable } from 'jspdf-autotable';
import type { jsPDF as PDFDocument } from 'jspdf';

// Import jsPDF dynamically for Obsidian compatibility
let jsPDF: typeof PDFDocument | undefined;

// We'll initialize jsPDF when the service is first used
function getJsPDF() {
  if (!jsPDF) {
    jsPDF = window.jspdf?.jsPDF;
  }
  if (!jsPDF) {
    throw new Error('jsPDF is not available.');
  }
  return jsPDF;
}

const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  [TransactionType.EXPENSE]: 'Expense',
  [TransactionType.INCOME]: 'Income',
  [TransactionType.INTERNAL]: 'Transfer'
};

function escapeCSVField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function getCategoryName(transaction: Transaction, categories: Category[]): string {
  return categories.find(category => category.id === transaction.category)?.name
    ?? (transaction.type === TransactionType.INTERNAL ? 'Internal' : 'Other Expenses');
}

// Define jsPDF type for TypeScript
interface JPDF extends PDFDocument {
  lastAutoTable: {
    finalY: number;
  };
}

export interface ExportOptions {
  format: 'csv' | 'json' | 'pdf';
  dateFrom: string | null;
  dateTo: string | null;
  includeExpenses: boolean;
  includeIncome: boolean;
  categories: string[] | null; // Array of category IDs or null for all
  filename: string; // Filename with extension
}

export class ExportService {
  /**
   * Filter transactions based on export options
   */
  public static filterTransactions(transactions: Transaction[], options: ExportOptions): Transaction[] {
    return transactions.filter(transaction => {
      // Filter by date range
      if (options.dateFrom) {
        const fromDate = parseLocalDate(options.dateFrom);
        const transactionDate = parseLocalDate(transaction.date);
        if (transactionDate < fromDate) return false;
      }
      
      if (options.dateTo) {
        const toDate = parseLocalDate(options.dateTo);
        const transactionDate = parseLocalDate(transaction.date);
        if (transactionDate > toDate) return false;
      }
      
      // Filter by transaction type
      switch (transaction.type) {
        case TransactionType.EXPENSE:
          if (!options.includeExpenses) return false;
          break;
        case TransactionType.INCOME:
          if (!options.includeIncome) return false;
          break;
        case TransactionType.INTERNAL:
          // Transfers remain independent of the income/expense toggles.
          break;
        default:
          return false;
      }
      
      // Filter by categories
      if (options.categories && options.categories.length > 0) {
        return options.categories.includes(transaction.category);
      }
      
      return true;
    });
  }
  
  /**
   * Generate CSV data from transactions
   */
  public static generateCSV(transactions: Transaction[], categories: Category[], sourceTransactions: readonly Transaction[] = transactions): string {
    // CSV Header with BOM (Byte Order Mark) for Excel compatibility
    let csv = '\ufeff'; // BOM
    csv += 'Date,Type,Category,Description,Amount,Notes\n';
    
    // Generate CSV rows
    sortTransactionsByDateTimeDesc(transactions, sourceTransactions).forEach(transaction => {
      csv += [
        transaction.date,
        TRANSACTION_TYPE_LABELS[transaction.type],
        getCategoryName(transaction, categories),
        transaction.description,
        transaction.amount.toString(),
        transaction.notes ?? ''
      ].map(escapeCSVField).join(',') + '\n';
    });
    
    return csv;
  }
  
  /**
   * Generate JSON data from transactions
   */
  public static generateJSON(transactions: Transaction[]): string {
    return JSON.stringify(transactions, null, 2);
  }
  
  /**
   * Generate PDF data from transactions
   */
  public static generatePDF(transactions: Transaction[], categories: Category[], currency = 'USD', sourceTransactions: readonly Transaction[] = transactions): Uint8Array {
    try {
      // Create a new PDF document
      const jsPdfConstructor = getJsPDF();
      const doc = new jsPdfConstructor() as JPDF;
      
      // Add header with enhanced branding
      doc.setFontSize(28);
      doc.setTextColor(46, 125, 50); // #2E7D32
      doc.text('Expensica', 20, 20);
      
      doc.setFontSize(12);
      doc.setTextColor(100, 100, 100);
      doc.text(new Date().toLocaleDateString(), 170, 20);
      
      doc.setFontSize(16);
      doc.setTextColor(27, 94, 32); // #1B5E20
      doc.text('Your Personal Finance Dashboard', 20, 35);
      // Group transactions by month
      const groupedTransactions = sortTransactionsByDateTimeDesc(transactions, sourceTransactions).reduce((groups, transaction) => {
        const date = parseLocalDate(transaction.date);
        const monthKey = formatDate(date).slice(0, 7);
        if (!groups[monthKey]) {
          groups[monthKey] = [];
        }
        groups[monthKey].push(transaction);
        return groups;
      }, {} as Record<string, Transaction[]>);
      
      // Sort months in descending order
      const sortedMonths = Object.keys(groupedTransactions).sort().reverse();
      
      let yOffset = 50;
      
      // Process each month
      sortedMonths.forEach((monthKey) => {
        const monthTransactions = groupedTransactions[monthKey];
        const [year, month] = monthKey.split('-');
        
        // Add month header
        const monthDate = new Date(parseInt(year), parseInt(month) - 1);
        const monthName = monthDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });
        
        doc.setFontSize(14);
        doc.setTextColor(27, 94, 32);
        doc.text(monthName, 20, yOffset);
        yOffset += 10;
        
        // Prepare table data for this month
        const tableData = monthTransactions.map(transaction => {
          return [
            parseLocalDate(transaction.date).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric'
            }),
            transaction.description,
            getCategoryName(transaction, categories),
            TRANSACTION_TYPE_LABELS[transaction.type],
            formatCurrency(Math.abs(transaction.amount), currency, false, { currencyDisplay: 'symbol' })
          ];
        });
        
        // Add transactions table for this month
        autoTable(doc, {
          startY: yOffset,
          head: [['Date', 'Description', 'Category', 'Type', 'Amount']],
          body: tableData,
          theme: 'grid',
          headStyles: {
            fillColor: [46, 125, 50],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 11,
            cellPadding: 5
          },
          styles: {
            fontSize: 10,
            cellPadding: 5,
            lineColor: [200, 200, 200],
            lineWidth: 0.1
          },
          columnStyles: {
            0: { cellWidth: 'auto' },
            1: { cellWidth: 'auto' },
            2: { cellWidth: 'auto' },
            3: { cellWidth: 'auto' },
            4: { 
              cellWidth: 'auto',
              halign: 'right',
              fontStyle: 'bold'
            }
          }
        });
        
        yOffset = doc.lastAutoTable.finalY + 15;
        
        // Check if we need to add a new page for the next month
        if (yOffset > 250) {
          doc.addPage();
          yOffset = 20;
        }
      });
      
      // Convert ArrayBuffer to Uint8Array
      const arrayBuffer = doc.output('arraybuffer');
      const pdf = new Uint8Array(arrayBuffer);
      if (pdf.byteLength === 0) {
        throw new Error('PDF generation produced an empty document.');
      }
      return pdf;
    } catch (error) {
      console.error('Error generating PDF:', error);
      throw error;
    }
  }
}
