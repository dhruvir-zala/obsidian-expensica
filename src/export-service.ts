import { Transaction, TransactionType, Category } from './models';

// Import jsPDF dynamically for Obsidian compatibility
let jsPDF: any;

// We'll initialize jsPDF when the service is first used
function getJsPDF() {
  if (!jsPDF) {
    try {
      // Try to load jsPDF from the bundled version
      // @ts-ignore
      jsPDF = window.jspdf?.jsPDF;
      
      if (!jsPDF) {
        console.error('Failed to load jsPDF. PDF export functionality will not work.');
      }
    } catch (error) {
      console.error('Error loading jsPDF:', error);
    }
  }
  return jsPDF;
}

// Define jsPDF type for TypeScript
interface JPDF {
  text(text: string, x: number, y: number): JPDF;
  setFontSize(size: number): JPDF;
  setTextColor(r: number, g: number, b: number): JPDF;
  addPage(): JPDF;
  output(type: string): any;
  autoTable: (options: any) => void;
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
        const fromDate = new Date(options.dateFrom);
        const transactionDate = new Date(transaction.date);
        if (transactionDate < fromDate) return false;
      }
      
      if (options.dateTo) {
        const toDate = new Date(options.dateTo);
        const transactionDate = new Date(transaction.date);
        if (transactionDate > toDate) return false;
      }
      
      // Filter by transaction type
      if (transaction.type === TransactionType.EXPENSE && !options.includeExpenses) {
        return false;
      }
      
      if (transaction.type === TransactionType.INCOME && !options.includeIncome) {
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
  public static generateCSV(transactions: Transaction[], categories: Category[]): string {
    // CSV Header with BOM (Byte Order Mark) for Excel compatibility
    let csv = '\ufeff'; // BOM
    csv += 'Date,Type,Category,Description,Amount,Notes\n';
    
    // Generate CSV rows
    transactions.forEach(transaction => {
      const category = categories.find(c => c.id === transaction.category);
      const categoryName = category ? category.name : 'Unknown';
      
      // Format each field and handle potential commas in text fields
      const date = transaction.date;
      const type = transaction.type === TransactionType.EXPENSE ? 'Expense' : 'Income';
      const description = `"${transaction.description.replace(/"/g, '""')}"`;
      const amount = transaction.amount.toString();
      const notes = transaction.notes ? `"${transaction.notes.replace(/"/g, '""')}"` : '';
      
      csv += `${date},${type},"${categoryName}",${description},${amount},${notes}\n`;
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
  public static generatePDF(transactions: Transaction[], categories: Category[], currency: string = 'USD'): Uint8Array {
    try {
      // Create a new PDF document
      const jsPdfConstructor = getJsPDF();
      if (!jsPdfConstructor) {
        console.error('jsPDF not available');
        return new Uint8Array();
      }
      
      const doc = new jsPdfConstructor();
      
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
      
      // Get locale based on currency
      const locale = currency === 'INR' ? 'en-IN' : 'en-US';
      
      // Group transactions by month
      const groupedTransactions = transactions.reduce((groups, transaction) => {
        const date = new Date(transaction.date);
        const monthKey = `${date.getFullYear()}-${date.getMonth() + 1}`;
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
          const category = categories.find(c => c.id === transaction.category);
          return [
            new Date(transaction.date).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric'
            }),
            transaction.description,
            category ? category.name : 'Unknown',
            transaction.type === TransactionType.EXPENSE ? 'Expense' : 'Income',
            Math.abs(transaction.amount).toLocaleString(locale, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            })
          ];
        });
        
        // Sort transactions by date (newest first)
        tableData.sort((a, b) => {
          const dateA = new Date(monthDate.getFullYear(), monthDate.getMonth(), parseInt(a[0]));
          const dateB = new Date(monthDate.getFullYear(), monthDate.getMonth(), parseInt(b[0]));
          return dateB.getTime() - dateA.getTime();
        });
        
        // Add transactions table for this month
        doc.autoTable({
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
      return new Uint8Array(arrayBuffer);
    } catch (error) {
      console.error('Error generating PDF:', error);
      // Return empty buffer in case of error
      return new Uint8Array();
    }
  }
}