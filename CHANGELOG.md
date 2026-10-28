# Changelog

## 1.1.1 - 2026-10-28

### Fixed

- Remove jsPDF's unused PDFObject CDN loader from the bundled plugin, preventing runtime script injection while preserving PDF exports.

## 1.1.0 - 2026-10-28

Expensica 1.1.0 adds richer account-aware tracking and makes everyday financial data more reliable.

### Added

- Manage multiple accounts, track account balances and credit limits, and record transfers between accounts.
- Review cumulative spending trends and running balances alongside existing dashboard charts.
- Import transaction data with validation and recover from invalid or damaged saved data.

### Improved

- Sort transactions by date and time, and retain dashboard and transaction-view state.
- Refine calendar navigation, category quick-menu keyboard support, and responsive, theme-aware views.
- Improve data validation, financial precision, rendering performance, and cleanup of interactive views.

Requires Obsidian 1.8.7 or later. Licensed under MIT.

## [1.0.0](https://github.com/dhruvir-zala/obsidian-expensica/releases/tag/1.0.0) - 2025-04-23

First public release of Expensica for Obsidian.

- Add and review income, expenses, and transfers.
- See balances, category breakdowns, budgets, and transactions on the dashboard.
- Browse spending with the calendar heatmap and transaction filters.
- Use custom categories with emoji.
- Import transactions from JSON and export them as JSON, CSV, or PDF.
- Keep transaction, account, and budget data in JSON files in the vault.
- Create daily finance reviews as Markdown notes.

Requires Obsidian 1.8.7 or later. Licensed under MIT.
